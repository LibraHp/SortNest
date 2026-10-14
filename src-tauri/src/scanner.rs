use crate::{db, Core};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use image::{imageops::FilterType, GenericImageView, ImageDecoder};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};
use walkdir::WalkDir;

pub fn canonical(path: &str) -> Result<PathBuf> {
    std::fs::canonicalize(path).context("路径不存在或没有访问权限")
}
pub fn add_folder(core: &Core, path: &str) -> Result<i64> {
    let path = canonical(path)?;
    if !path.is_dir() {
        bail!("请选择文件夹")
    }
    let db = core.db()?;
    for row in db::rows(&db, "SELECT path FROM folders", [])? {
        let other = PathBuf::from(row["path"].as_str().unwrap());
        if path.starts_with(&other) || other.starts_with(&path) {
            bail!("该目录已添加，或与已有目录重叠")
        }
    }
    db.execute(
        "INSERT INTO folders(path) VALUES(?)",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(db.last_insert_rowid())
}
pub fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff" | "tif" | "heic" | "heif"
    )
}
pub fn file_hash(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn decode(path: &Path) -> Result<image::DynamicImage> {
    let mut reader = image::ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .context("图片无法解码（损坏、超出内存限制，或 HEIC/HEIF 解码器未安装）")?;
    let orientation = decoder.orientation()?;
    let mut image = image::DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    Ok(image)
}
pub fn dhash(image: &image::DynamicImage) -> String {
    let small = image.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut bits = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            bits = (bits << 1) | u64::from(small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0]);
        }
    }
    format!("{bits:016x}")
}
pub fn hamming(a: &str, b: &str) -> u32 {
    match (u64::from_str_radix(a, 16), u64::from_str_radix(b, 16)) {
        (Ok(a), Ok(b)) => (a ^ b).count_ones(),
        _ => 64,
    }
}
fn stamp(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|x| x.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

pub fn checkpoint(control: &AtomicU8) -> bool {
    while control.load(Ordering::SeqCst) == 1 {
        std::thread::sleep(Duration::from_millis(150));
    }
    control.load(Ordering::SeqCst) != 2
}

#[derive(Clone)]
struct Existing {
    id: i64,
    size: i64,
    modified: i64,
    status: String,
    hash: Option<String>,
}

enum Prepared {
    Reused { id: i64 },
    Indexed {
        path: String,
        name: String,
        extension: String,
        size: i64,
        width: u32,
        height: u32,
        created: Option<String>,
        modified: i64,
        hash: String,
        phash: String,
        thumbnail: String,
        exif: String,
        previous: Option<(i64, Option<String>)>,
    },
}

fn prepare_image(
    path: &Path,
    existing: Option<Existing>,
    cache: &Path,
    read_exif: bool,
) -> Result<Prepared> {
    let resolved = std::fs::canonicalize(path)?;
    let path = resolved.as_path();
    let before = std::fs::metadata(path)?;
    let modified = stamp(&before);
    let size = before.len() as i64;
    let path_s = path.to_string_lossy().to_string();
    // Hash on each scan catches changed content even when timestamps and sizes are preserved.
    let hash = file_hash(path)?;
    if let Some(old) = &existing {
        if old.size == size
            && old.modified == modified
            && old.status == "ready"
            && old.hash.as_deref() == Some(hash.as_str())
            && cache.join(format!("{hash}.jpg")).is_file()
        {
            return Ok(Prepared::Reused { id: old.id });
        }
    }
    let image = decode(path)?;
    let (width, height) = image.dimensions();
    let phash = dhash(&image);
    let thumbnail = cache.join(format!("{hash}.jpg"));
    if !thumbnail.exists() {
        let partial = cache.join(format!("{hash}.jpg.partial"));
        image.thumbnail(400, 400).write_to(
            &mut File::create(&partial)?,
            image::ImageFormat::Jpeg,
        )?;
        if std::fs::rename(&partial, &thumbnail).is_err() {
            let _ = std::fs::remove_file(&partial);
        }
    }
    let mut exif = serde_json::Map::new();
    if read_exif {
        if let Ok(data) =
            exif::Reader::new().read_from_container(&mut BufReader::new(File::open(path)?))
        {
            for field in data.fields() {
                exif.insert(
                    field.tag.to_string(),
                    serde_json::Value::String(field.display_value().with_unit(&data).to_string()),
                );
            }
        }
    }
    let after = std::fs::metadata(path)?;
    if stamp(&after) != modified || after.len() != before.len() {
        bail!("扫描期间文件发生变化，请重新扫描")
    }
    let created = before
        .created()
        .ok()
        .map(|t| DateTime::<Utc>::from(t).to_rfc3339());
    Ok(Prepared::Indexed {
        path: path_s,
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        extension: path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase(),
        size,
        width,
        height,
        created,
        modified,
        hash,
        phash,
        thumbnail: thumbnail.to_string_lossy().into_owned(),
        exif: serde_json::Value::Object(exif).to_string(),
        previous: existing.map(|old| (old.id, old.hash)),
    })
}

fn apply_prepared(db: &mut rusqlite::Connection, folder: i64, run: &str, prepared: Prepared) -> Result<bool> {
    match prepared {
        Prepared::Reused { id } => {
            db.execute(
                "UPDATE images SET seen_run=?,missing=0 WHERE id=?",
                params![run, id],
            )?;
            Ok(false)
        }
        Prepared::Indexed {
            path,
            name,
            extension,
            size,
            width,
            height,
            created,
            modified,
            hash,
            phash,
            thumbnail,
            exif,
            previous,
        } => {
            let tx = db.transaction()?;
            tx.execute("INSERT INTO images(folder_id,path,name,extension,size,width,height,ratio,created_at,modified,hash,phash,thumbnail,exif,status,seen_run) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'ready',?15) ON CONFLICT(path) DO UPDATE SET size=excluded.size,width=excluded.width,height=excluded.height,ratio=excluded.ratio,modified=excluded.modified,hash=excluded.hash,phash=excluded.phash,thumbnail=excluded.thumbnail,exif=excluded.exif,status='ready',error=NULL,missing=0,seen_run=excluded.seen_run",params![folder,path,name,extension,size,width,height,width as f64/height as f64,created,modified,hash,phash,thumbnail,exif,run])?;
            if let Some((id, old_hash)) = previous {
                if old_hash.as_deref() != Some(hash.as_str()) {
                    tx.execute("DELETE FROM embeddings WHERE image_id=?", [id])?;
                    tx.execute(
                        "DELETE FROM descriptions WHERE image_id=? AND user_edited=0",
                        [id],
                    )?;
                    tx.execute(
                        "DELETE FROM image_tags WHERE image_id=? AND confirmed=0",
                        [id],
                    )?;
                    tx.execute(
                        "DELETE FROM image_categories WHERE image_id=? AND source<>'user'",
                        [id],
                    )?;
                }
            }
            tx.commit()?;
            Ok(true)
        }
    }
}

pub fn index_file(core: &Core, folder: i64, path: &Path, run: &str) -> Result<bool> {
    let mut db = core.db()?;
    let resolved = std::fs::canonicalize(path)?;
    let path_s = resolved.to_string_lossy().to_string();
    let existing = db
        .query_row(
            "SELECT id,size,modified,status,hash FROM images WHERE path=?",
            [&path_s],
            |r| {
                Ok(Existing {
                    id: r.get(0)?,
                    size: r.get(1)?,
                    modified: r.get(2)?,
                    status: r.get(3)?,
                    hash: r.get(4)?,
                })
            },
        )
        .optional()?;
    let read_exif: String = db.query_row(
        "SELECT value FROM settings WHERE key='read_exif'",
        [],
        |r| r.get(0),
    )?;
    let prepared = prepare_image(&resolved, existing, &core.cache, read_exif == "true")?;
    apply_prepared(&mut db, folder, run, prepared)
}

fn record_failure(
    db: &rusqlite::Connection,
    folder: i64,
    job: &str,
    path: &Path,
    visit: &str,
    message: &str,
) -> Result<()> {
    db.execute("INSERT INTO images(folder_id,path,name,extension,status,error,seen_run) VALUES(?,?,?,?,'failed',?,?) ON CONFLICT(path) DO UPDATE SET status='failed',error=excluded.error,seen_run=excluded.seen_run,missing=0",params![folder,path.to_string_lossy(),path.file_name().unwrap_or_default().to_string_lossy(),path.extension().unwrap_or_default().to_string_lossy().to_lowercase(),message,visit])?;
    db.execute(
        "INSERT INTO errors(job_id,path,message) VALUES(?,?,?)",
        params![job, path.to_string_lossy(), message],
    )?;
    Ok(())
}

struct ScanProgress {
    count: i64,
    failed: i64,
    changed: i64,
    cancelled: bool,
    last_note: Instant,
}

fn accept_scan_result(
    db: &mut rusqlite::Connection,
    folder: i64,
    job: &str,
    visit: &str,
    started: Instant,
    progress: &mut ScanProgress,
    path: PathBuf,
    result: Option<Result<Prepared>>,
) -> Result<()> {
    let Some(result) = result else {
        progress.cancelled = true;
        return Ok(());
    };
    progress.count += 1;
    match result {
        Ok(prepared) => {
            if apply_prepared(db, folder, visit, prepared)? {
                progress.changed += 1;
            }
        }
        Err(error) => {
            progress.failed += 1;
            record_failure(db, folder, job, &path, visit, &error.to_string())?;
        }
    }
    note_progress(
        db,
        job,
        progress.count,
        progress.failed,
        progress.changed,
        started,
        &mut progress.last_note,
        false,
    )
}

fn note_progress(
    db: &rusqlite::Connection,
    job: &str,
    count: i64,
    failed: i64,
    changed: i64,
    started: Instant,
    last_note: &mut Instant,
    force: bool,
) -> Result<()> {
    if !force && last_note.elapsed() < Duration::from_millis(400) {
        return Ok(());
    }
    *last_note = Instant::now();
    db.execute("UPDATE jobs SET processed=?,failed=?,total=?,message=?,elapsed_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",params![count,failed,count,format!("发现 {count} 张 · 新增或更新 {changed} 张；总量在遍历完成后确定"),started.elapsed().as_millis() as i64,job])?;
    Ok(())
}

pub fn scan(core: &Core, job: &str, folder: i64, control: Arc<AtomicU8>) -> Result<()> {
    // A resumed job re-traverses from the beginning. Its visit marker must be new
    // so files deleted since the previous attempt are correctly marked missing.
    let visit = uuid::Uuid::new_v4().to_string();
    let mut db = core.db()?;
    let root: String = db.query_row("SELECT path FROM folders WHERE id=?", [folder], |r| {
        r.get(0)
    })?;
    if !Path::new(&root).is_dir() {
        bail!("目录不可访问；现有索引已保留")
    }
    let started = Instant::now();
    let mut progress = ScanProgress {
        count: 0,
        failed: 0,
        changed: 0,
        cancelled: false,
        last_note: Instant::now(),
    };
    let mut traversal_failed = false;
    let read_exif: String = db.query_row(
        "SELECT value FROM settings WHERE key='read_exif'",
        [],
        |r| r.get(0),
    )?;
    let read_exif = read_exif == "true";
    if !read_exif {
        db.execute("UPDATE images SET exif='{}' WHERE folder_id=?", [folder])?;
    }
    let mut known = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT path,id,size,modified,status,hash FROM images WHERE folder_id=?",
        )?;
        let rows = stmt.query_map([folder], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Existing {
                    id: row.get(1)?,
                    size: row.get(2)?,
                    modified: row.get(3)?,
                    status: row.get(4)?,
                    hash: row.get(5)?,
                },
            ))
        })?;
        for row in rows {
            let (path, existing) = row?;
            known.insert(path, existing);
        }
    }
    let known = Arc::new(known);
    let workers = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 4);
    let (task_tx, task_rx) = mpsc::sync_channel::<PathBuf>(workers);
    let (done_tx, done_rx) = mpsc::sync_channel(workers);
    let task_rx = Mutex::new(task_rx);
    let scan_result: Result<()> = thread::scope(|scope| {
        for _ in 0..workers {
            let done_tx = done_tx.clone();
            let task_rx = &task_rx;
            let known = Arc::clone(&known);
            let cache = core.cache.clone();
            let control = Arc::clone(&control);
            scope.spawn(move || {
                loop {
                    let path = {
                        let rx = task_rx.lock().unwrap();
                        rx.recv()
                    };
                    let Ok(path) = path else { break };
                    if !checkpoint(&control) {
                        let _ = done_tx.send((path, None));
                        continue;
                    }
                    let result = (|| {
                        let resolved = std::fs::canonicalize(&path)?;
                        let key = resolved.to_string_lossy().to_string();
                        let existing = known.get(&key).cloned();
                        prepare_image(&resolved, existing, &cache, read_exif)
                    })();
                    if done_tx.send((path, Some(result))).is_err() {
                        break;
                    }
                }
            });
        }
        drop(done_tx);
        for entry in WalkDir::new(&root).follow_links(false).into_iter() {
            if !checkpoint(&control) {
                progress.cancelled = true;
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    traversal_failed = true;
                    progress.failed += 1;
                    record_failure(&db, folder, job, Path::new(&root), &visit, &error.to_string())?;
                    continue;
                }
            };
            if !entry.file_type().is_file() || !supported(entry.path()) {
                continue;
            }
            let mut pending = entry.path().to_path_buf();
            loop {
                while let Ok((path, result)) = done_rx.try_recv() {
                    accept_scan_result(
                        &mut db, folder, job, &visit, started, &mut progress, path, result,
                    )?;
                }
                match task_tx.try_send(pending) {
                    Ok(()) => break,
                    Err(mpsc::TrySendError::Full(returned)) => {
                        pending = returned;
                        let (path, result) = done_rx.recv().context("扫描线程已退出")?;
                        accept_scan_result(
                            &mut db, folder, job, &visit, started, &mut progress, path, result,
                        )?;
                    }
                    Err(mpsc::TrySendError::Disconnected(_)) => {
                        progress.cancelled = true;
                        break;
                    }
                }
            }
        }
        drop(task_tx);
        while let Ok((path, result)) = done_rx.recv() {
            accept_scan_result(
                &mut db, folder, job, &visit, started, &mut progress, path, result,
            )?;
        }
        Ok(())
    });
    scan_result?;
    if progress.cancelled || !checkpoint(&control) {
        note_progress(
            &db,
            job,
            progress.count,
            progress.failed,
            progress.changed,
            started,
            &mut progress.last_note,
            true,
        )?;
        return Ok(());
    }
    // Never mark unseen files missing after cancellation or an incomplete traversal.
    if !traversal_failed {
        db.execute(
            "UPDATE images SET missing=1 WHERE folder_id=? AND (seen_run IS NULL OR seen_run<>?)",
            params![folder, visit],
        )?;
    }
    db.execute(
        "UPDATE folders SET last_scan=CURRENT_TIMESTAMP WHERE id=?",
        [folder],
    )?;
    db.execute(
        "UPDATE jobs SET processed=?,failed=?,total=?,message=?,elapsed_ms=? WHERE id=?",
        params![
            progress.count,
            progress.failed,
            progress.count,
            format!(
                "扫描完成 · {} 张更新 · {} 张复用 · {} 个错误",
                progress.changed,
                (progress.count - progress.changed - progress.failed).max(0),
                progress.failed
            ),
            started.elapsed().as_millis() as i64,
            job
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scan_incremental_errors_and_missing() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().join("data")).unwrap();
        let pictures = root.path().join("pictures");
        std::fs::create_dir(&pictures).unwrap();
        let p = pictures.join("猫.png");
        image::RgbImage::new(12, 8).save(&p).unwrap();
        std::fs::write(pictures.join("broken.jpg"), b"broken").unwrap();
        let folder = add_folder(&core, pictures.to_str().unwrap()).unwrap();
        assert!(add_folder(&core, pictures.to_str().unwrap()).is_err());
        let db = core.db().unwrap();
        db.execute(
            "INSERT INTO jobs(id,kind,status,folder_id) VALUES('j','scan','running',?)",
            [folder],
        )
        .unwrap();
        scan(&core, "j", folder, Arc::new(AtomicU8::new(0))).unwrap();
        let rows = db::rows(&db, "SELECT * FROM images ORDER BY status", []).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["status"], "failed");
        assert!(!index_file(&core, folder, &p, "j").unwrap());
        std::fs::remove_file(&p).unwrap();
        db.execute(
            "INSERT INTO jobs(id,kind,status,folder_id) VALUES('j2','scan','running',?)",
            [folder],
        )
        .unwrap();
        // Reuse the job ID, as happens when resuming after app restart.
        scan(&core, "j", folder, Arc::new(AtomicU8::new(0))).unwrap();
        assert_eq!(
            db::rows(&db, "SELECT missing FROM images WHERE status='ready'", []).unwrap()[0]
                ["missing"],
            1
        );
        assert!(pictures.join("broken.jpg").exists());
    }
    #[test]
    fn hash_distance() {
        assert_eq!(hamming("0000000000000000", "000000000000000f"), 4);
    }
}
