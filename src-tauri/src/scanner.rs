use crate::{db, Core};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use image::{imageops::FilterType, GenericImageView, ImageDecoder};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
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
    let mut buffer = [0u8; 64 * 1024];
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

pub fn index_file(core: &Core, folder: i64, path: &Path, run: &str) -> Result<bool> {
    let resolved = std::fs::canonicalize(path)?;
    let path = resolved.as_path();
    let before = std::fs::metadata(path)?;
    let modified = stamp(&before);
    let size = before.len() as i64;
    let path_s = path.to_string_lossy().to_string();
    let mut db = core.db()?;
    let old: Option<(i64, i64, i64, String, Option<String>)> = db
        .query_row(
            "SELECT id,size,modified,status,hash FROM images WHERE path=?",
            [&path_s],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    // Hash on each scan catches changed content even when timestamps and sizes are preserved.
    let hash = file_hash(path)?;
    if let Some((id, old_size, old_modified, status, old_hash)) = &old {
        if *old_size == size
            && *old_modified == modified
            && status == "ready"
            && old_hash.as_deref() == Some(&hash)
            && core.cache.join(format!("{hash}.jpg")).is_file()
        {
            db.execute(
                "UPDATE images SET seen_run=?,missing=0 WHERE id=?",
                params![run, id],
            )?;
            return Ok(false);
        }
    }
    let image = decode(path)?;
    let (width, height) = image.dimensions();
    let phash = dhash(&image);
    let thumbnail = core.cache.join(format!("{hash}.jpg"));
    if !thumbnail.exists() {
        image.thumbnail(400, 400).to_rgb8().save(&thumbnail)?;
    }
    let exif_enabled: String = db.query_row(
        "SELECT value FROM settings WHERE key='read_exif'",
        [],
        |r| r.get(0),
    )?;
    let mut exif = serde_json::Map::new();
    if exif_enabled == "true" {
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
    let tx = db.transaction()?;
    tx.execute("INSERT INTO images(folder_id,path,name,extension,size,width,height,ratio,created_at,modified,hash,phash,thumbnail,exif,status,seen_run) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'ready',?15) ON CONFLICT(path) DO UPDATE SET size=excluded.size,width=excluded.width,height=excluded.height,ratio=excluded.ratio,modified=excluded.modified,hash=excluded.hash,phash=excluded.phash,thumbnail=excluded.thumbnail,exif=excluded.exif,status='ready',error=NULL,missing=0,seen_run=excluded.seen_run",params![folder,path_s,path.file_name().unwrap_or_default().to_string_lossy(),path.extension().unwrap_or_default().to_string_lossy().to_lowercase(),size,width,height,width as f64/height as f64,created,modified,hash,phash,thumbnail.to_string_lossy(),serde_json::Value::Object(exif).to_string(),run])?;
    if let Some((id, _, _, _, old_hash)) = old {
        if old_hash.as_deref() != Some(&hash) {
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

pub fn scan(core: &Core, job: &str, folder: i64, control: Arc<AtomicU8>) -> Result<()> {
    // A resumed job re-traverses from the beginning. Its visit marker must be new
    // so files deleted since the previous attempt are correctly marked missing.
    let visit = uuid::Uuid::new_v4().to_string();
    let db = core.db()?;
    let root: String = db.query_row("SELECT path FROM folders WHERE id=?", [folder], |r| {
        r.get(0)
    })?;
    if !Path::new(&root).is_dir() {
        bail!("目录不可访问；现有索引已保留")
    }
    let started = Instant::now();
    let (mut count, mut failed, mut changed) = (0, 0, 0);
    let mut traversal_failed = false;
    let read_exif: String = db.query_row(
        "SELECT value FROM settings WHERE key='read_exif'",
        [],
        |r| r.get(0),
    )?;
    if read_exif != "true" {
        db.execute("UPDATE images SET exif='{}' WHERE folder_id=?", [folder])?;
    }
    for entry in WalkDir::new(&root).follow_links(false).into_iter() {
        if !checkpoint(&control) {
            return Ok(());
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                traversal_failed = true;
                failed += 1;
                crate::jobs::error(core, job, &root, &e.to_string())?;
                continue;
            }
        };
        if !entry.file_type().is_file() || !supported(entry.path()) {
            continue;
        }
        count += 1;
        match index_file(core, folder, entry.path(), &visit) {
            Ok(updated) => {
                changed += i64::from(updated);
            }
            Err(e) => {
                failed += 1;
                let p = entry.path().to_string_lossy();
                db.execute("INSERT INTO images(folder_id,path,name,extension,status,error,seen_run) VALUES(?,?,?,?,'failed',?,?) ON CONFLICT(path) DO UPDATE SET status='failed',error=excluded.error,seen_run=excluded.seen_run,missing=0",params![folder,p,entry.file_name().to_string_lossy(),entry.path().extension().unwrap_or_default().to_string_lossy().to_lowercase(),e.to_string(),visit])?;
                crate::jobs::error(core, job, &p, &e.to_string())?;
            }
        }
        db.execute("UPDATE jobs SET processed=?,failed=?,total=?,message=?,elapsed_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",params![count,failed,count,format!("发现 {count} 张 · 新增或更新 {changed} 张；总量在遍历完成后确定"),started.elapsed().as_millis() as i64,job])?;
    }
    if !checkpoint(&control) {
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
            count,
            failed,
            count,
            format!(
                "扫描完成 · {changed} 张更新 · {} 张复用 · {failed} 个错误",
                (count - changed - failed).max(0)
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
