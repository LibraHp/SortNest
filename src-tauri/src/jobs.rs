use crate::{
    db,
    models::{self, ModelProvider},
    scanner, Core,
};
use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Instant,
};

pub fn error(core: &Core, job: &str, path: &str, message: &str) -> Result<()> {
    core.db()?.execute(
        "INSERT INTO errors(job_id,path,message) VALUES(?,?,?)",
        params![job, path, message],
    )?;
    Ok(())
}
pub fn start(core: &Arc<Core>, args: &Value) -> Result<Value> {
    let kind = args["kind"].as_str().unwrap_or("scan");
    if !matches!(kind, "scan" | "ai") {
        bail!("未知任务类型")
    }
    let mut controls = core.controls.lock().unwrap();
    let queued = !controls.is_empty();
    let id = uuid::Uuid::new_v4().to_string();
    let mut db = core.db()?;
    let tx = db.transaction()?;
    let folder = args["folder_id"].as_i64();
    let task = args["task"].as_str().unwrap_or("");
    if kind == "scan" && folder.is_none() {
        bail!("请选择文件夹")
    }
    if kind == "ai" {
        let capability = match task {
            "image_embedding" => "image",
            "description_embedding" => "text",
            "description" | "tags" => "vision",
            _ => bail!("未知 AI 任务"),
        };
        let model = models::assigned(
            core,
            if task == "description_embedding" {
                "text_embedding"
            } else {
                task
            },
        )?;
        models::require(&model, capability)?;
    }
    let duplicate:i64=tx.query_row("SELECT count(*) FROM jobs WHERE kind=? AND folder_id IS ? AND task=? AND status IN('running','paused','queued')",params![kind,folder,task],|r|r.get(0))?;
    if duplicate > 0 {
        bail!("相同任务已在运行、暂停或排队中")
    }
    tx.execute(
        "INSERT INTO jobs(id,kind,folder_id,task,status) VALUES(?,?,?,?,?)",
        params![
            id,
            kind,
            folder,
            task,
            if queued { "queued" } else { "running" }
        ],
    )?;
    if kind == "ai" {
        if let Some(ids) = args["ids"].as_array().filter(|a| !a.is_empty()) {
            for image in ids {
                tx.execute("INSERT OR IGNORE INTO job_items(job_id,image_id) SELECT ?,id FROM images WHERE id=? AND missing=0 AND status='ready'",params![id,image.as_i64()])?;
            }
        } else {
            tx.execute("INSERT INTO job_items(job_id,image_id) SELECT ?,id FROM images WHERE missing=0 AND status='ready' AND (? IS NULL OR folder_id=?)",params![id,folder,folder])?;
        }
        tx.execute(
            "UPDATE jobs SET total=(SELECT count(*) FROM job_items WHERE job_id=?) WHERE id=?",
            params![id, id],
        )?;
    }
    tx.commit()?;
    if queued {
        return Ok(json!({"id":id,"queued":true}));
    }
    let control = Arc::new(AtomicU8::new(0));
    controls.insert(id.clone(), control.clone());
    drop(controls);
    launch(core.clone(), id.clone(), control);
    Ok(json!({"id":id,"queued":false}))
}
fn launch(core: Arc<Core>, id: String, control: Arc<AtomicU8>) {
    std::thread::spawn(move || {
        let result = (|| -> Result<()> {
            let db = core.db()?;
            let job = db::rows(&db, "SELECT * FROM jobs WHERE id=?", [&id])?
                .pop()
                .context("任务不存在")?;
            if job["kind"] == "scan" {
                scanner::scan(
                    &core,
                    &id,
                    job["folder_id"].as_i64().context("目录不存在")?,
                    control.clone(),
                )
            } else {
                analyze(&core, &id, job["task"].as_str().unwrap_or(""), &control)
            }
        })();
        if let Ok(db) = core.db() {
            let cancelled = control.load(Ordering::SeqCst) == 2;
            let (status, message) = if cancelled {
                ("cancelled", Some("任务已取消".to_owned()))
            } else if let Err(e) = result {
                let _ = error(&core, &id, "", &e.to_string());
                ("failed", Some(e.to_string()))
            } else {
                ("completed", None)
            };
            let _=db.execute("UPDATE jobs SET status=?,message=coalesce(?,message),updated_at=CURRENT_TIMESTAMP WHERE id=?",params![status,message,id]);
        }
        let mut controls = core.controls.lock().unwrap();
        controls.remove(&id);
        if let Ok(db) = core.db() {
            if let Ok(Some(next)) = db
                .query_row(
                    "SELECT id FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .optional()
            {
                if db
                    .execute("UPDATE jobs SET status='running' WHERE id=?", [&next])
                    .is_ok()
                {
                    let c = Arc::new(AtomicU8::new(0));
                    controls.insert(next.clone(), c.clone());
                    drop(controls);
                    launch(core.clone(), next, c);
                }
            }
        }
    });
}
pub fn clear_history(core: &Core, target: &str) -> Result<Value> {
    let mut db = core.db()?;
    let tx = db.transaction()?;
    match target {
        "jobs" => {
            tx.execute(
                "DELETE FROM jobs WHERE status NOT IN ('running','paused','queued')",
                [],
            )?;
        }
        "errors" => {
            tx.execute("DELETE FROM errors", [])?;
        }
        _ => bail!("未知清理范围"),
    }
    tx.commit()?;
    Ok(json!(true))
}
pub fn control(core: &Arc<Core>, id: &str, action: &str) -> Result<Value> {
    let mut controls = core.controls.lock().unwrap();
    let db = core.db()?;
    let status: String = db.query_row("SELECT status FROM jobs WHERE id=?", [id], |r| r.get(0))?;
    if !matches!(status.as_str(), "running" | "paused" | "queued") {
        bail!("此任务已结束")
    }
    match action {
        "pause" => {
            let c = controls.get(id).context("任务未运行")?;
            c.store(1, Ordering::SeqCst);
            db.execute("UPDATE jobs SET status='paused' WHERE id=?", [id])?;
        }
        "cancel" => {
            if let Some(c) = controls.get(id) {
                c.store(2, Ordering::SeqCst);
            }
            db.execute(
                "UPDATE jobs SET status='cancelled',message='任务已取消' WHERE id=?",
                [id],
            )?;
        }
        "resume" => {
            if let Some(c) = controls.get(id) {
                c.store(0, Ordering::SeqCst);
                db.execute("UPDATE jobs SET status='running' WHERE id=?", [id])?;
            } else {
                if !controls.is_empty() {
                    bail!("请先结束当前任务")
                }
                db.execute("UPDATE jobs SET status='running' WHERE id=?", [id])?;
                let c = Arc::new(AtomicU8::new(0));
                controls.insert(id.to_string(), c.clone());
                drop(controls);
                launch(core.clone(), id.to_string(), c);
            }
        }
        _ => bail!("未知任务操作"),
    };
    Ok(json!(true))
}
fn analyze(core: &Core, job: &str, task: &str, control: &AtomicU8) -> Result<()> {
    let model = models::assigned(
        core,
        if task == "description_embedding" {
            "text_embedding"
        } else {
            task
        },
    )?;
    let vision_source = model.vision_fingerprint();
    let provider = models::HttpProvider::new(model.clone())?;
    let db = core.db()?;
    let start = Instant::now();
    let categories = db::rows(&db, "SELECT id,name FROM categories", [])?;
    let taxonomy_prompt=format!("分析图片，只返回 JSON，不要 Markdown。格式：{{\"tags\":[{{\"name\":\"猫\",\"kind\":\"主体\"}}],\"category_ids\":[7]}}。tags 最多 12 个，不给置信概率。category_ids 只能从以下现有分类中选择，最多 4 个，第一个为主分类：{}",serde_json::to_string(&categories)?);
    let taxonomy_prompt = format!(
        "图片理解偏好：\n{}\n\n本次任务必须遵循以下输出格式，优先于上述偏好中的格式要求：\n{}",
        model.vision_prompt(),
        taxonomy_prompt
    );
    loop {
        if !scanner::checkpoint(control) {
            break;
        }
        // Stop if configuration changes rather than silently mixing spaces in one task.
        let current_model = models::load(core, &model.id)?;
        if current_model.fingerprint != model.fingerprint
            || (matches!(task, "description" | "tags")
                && current_model.vision_fingerprint() != vision_source)
        {
            bail!("模型配置已变化，请重新启动索引任务")
        }
        let image: Option<i64> = db
            .query_row(
                "SELECT image_id FROM job_items WHERE job_id=? AND status='pending' LIMIT 1",
                [job],
                |r| r.get(0),
            )
            .optional()?;
        let Some(id) = image else { break };
        let data: Option<(String, String)> = db
            .query_row(
                "SELECT path,hash FROM images WHERE id=? AND missing=0 AND status='ready'",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let result = (|| -> Result<()> {
            let (path, hash) = data.as_ref().context("图片已移除或不可用")?;
            if scanner::file_hash(Path::new(path))? != *hash {
                bail!("图片内容已变化，请重新扫描目录后再运行 AI 任务")
            }
            if task == "image_embedding" || task == "description_embedding" {
                let kind = if task == "image_embedding" {
                    "image"
                } else {
                    "description"
                };
                let cached:i64=db.query_row("SELECT count(*) FROM embeddings WHERE image_id=? AND model_id=? AND kind=? AND fingerprint=? AND content_hash=?",params![id,model.id,kind,model.fingerprint,hash],|r|r.get(0))?;
                if cached > 0 {
                    return Ok(());
                }
                let mut description_snapshot = None;
                let vector = if kind == "image" {
                    provider.image_embedding(Path::new(path))?
                } else {
                    let text: String = db
                        .query_row(
                            "SELECT text FROM descriptions WHERE image_id=?",
                            [id],
                            |r| r.get(0),
                        )
                        .context("请先生成或填写图片描述")?;
                    let vector = provider.text_embedding(&text, "document")?;
                    description_snapshot = Some(text);
                    vector
                };
                let expected = model.capabilities[if kind == "image" {
                    "image_dimension"
                } else {
                    "text_dimension"
                }]
                .as_u64();
                if expected != Some(vector.len() as u64) {
                    bail!("返回的向量维度与能力测试不一致")
                }
                if !scanner::checkpoint(control) {
                    return Ok(());
                }
                if scanner::file_hash(Path::new(path))? != *hash {
                    bail!("推理期间图片发生变化，请重新扫描")
                }
                let mut write = core.db()?;
                let tx =
                    write.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                if let Some(snapshot) = description_snapshot {
                    let current: String = tx.query_row(
                        "SELECT text FROM descriptions WHERE image_id=?",
                        [id],
                        |r| r.get(0),
                    )?;
                    if current != snapshot {
                        bail!("推理期间描述发生变化，请重新运行描述索引")
                    }
                }
                tx.execute("INSERT INTO embeddings(image_id,model_id,fingerprint,kind,dimension,vector,content_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(image_id,model_id,kind) DO UPDATE SET fingerprint=excluded.fingerprint,dimension=excluded.dimension,vector=excluded.vector,content_hash=excluded.content_hash,created_at=CURRENT_TIMESTAMP",params![id,model.id,model.fingerprint,kind,vector.len(),models::pack(&vector),hash])?;
                tx.commit()?;
            } else if task == "description" {
                let cached:i64=db.query_row("SELECT count(*) FROM descriptions WHERE image_id=? AND (source=? OR user_edited=1)",params![id,vision_source],|r|r.get(0))?;
                if cached > 0 {
                    return Ok(());
                }
                let text = provider.understand(Path::new(path), model.vision_prompt())?;
                if scanner::file_hash(Path::new(path))? != *hash {
                    bail!("推理期间图片发生变化，请重新扫描")
                }
                if !scanner::checkpoint(control) {
                    return Ok(());
                }
                let mut write = core.db()?;
                let tx = write.transaction()?;
                tx.execute("INSERT INTO descriptions(image_id,text,source) VALUES(?,?,?) ON CONFLICT(image_id) DO UPDATE SET text=excluded.text,source=excluded.source,created_at=CURRENT_TIMESTAMP WHERE descriptions.user_edited=0",params![id,text,vision_source])?;
                tx.execute(
                    "DELETE FROM embeddings WHERE image_id=? AND kind='description'",
                    [id],
                )?;
                tx.commit()?;
            } else {
                let cached: i64 = db.query_row(
                    "SELECT count(*) FROM image_tags WHERE image_id=? AND source=?",
                    params![id, vision_source],
                    |r| r.get(0),
                )?;
                if cached > 0 {
                    return Ok(());
                }
                let text = provider.understand(Path::new(path), &taxonomy_prompt)?;
                if scanner::file_hash(Path::new(path))? != *hash {
                    bail!("推理期间图片发生变化，请重新扫描")
                }
                let text = text
                    .trim()
                    .trim_start_matches("```json")
                    .trim_start_matches("```")
                    .trim_end_matches("```")
                    .trim();
                let result: Value =
                    serde_json::from_str(text).context("模型未返回有效的分类标签 JSON")?;
                let tags = result["tags"]
                    .as_array()
                    .context("模型响应缺少 tags 数组")?;
                let cats = result["category_ids"]
                    .as_array()
                    .context("模型响应缺少 category_ids 数组")?;
                if !scanner::checkpoint(control) {
                    return Ok(());
                }
                let mut write = core.db()?;
                let tx = write.transaction()?;
                tx.execute(
                    "DELETE FROM image_tags WHERE image_id=? AND confirmed=0",
                    [id],
                )?;
                tx.execute(
                    "DELETE FROM image_categories WHERE image_id=? AND source<>'user'",
                    [id],
                )?;
                for tag in tags.iter().take(24) {
                    let name = tag["name"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty() && s.len() <= 120)
                        .context("标签名称无效")?;
                    let kind = tag["kind"].as_str().unwrap_or("主题");
                    tx.execute(
                        "INSERT INTO tags(name,kind) VALUES(?,?) ON CONFLICT DO NOTHING",
                        params![name, kind],
                    )?;
                    tx.execute("INSERT INTO image_tags(image_id,tag_id,source) VALUES(?,(SELECT id FROM tags WHERE name=? AND kind=?),?) ON CONFLICT DO NOTHING",params![id,name,kind,vision_source])?;
                }
                let mut has_primary:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM image_categories WHERE image_id=? AND is_primary=1)",[id],|r|r.get(0))?;
                for cat in cats.iter().take(4) {
                    let cat = cat.as_i64().context("分类 ID 必须是整数")?;
                    if !categories.iter().any(|c| c["id"].as_i64() == Some(cat)) {
                        bail!("模型返回不存在的分类")
                    }
                    tx.execute("INSERT INTO image_categories(image_id,category_id,is_primary,source) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",params![id,cat,!has_primary,vision_source])?;
                    has_primary = true;
                }
                tx.commit()?;
            }
            Ok(())
        })();
        if control.load(Ordering::SeqCst) == 2 {
            break;
        }
        let status = if let Err(e) = result {
            error(
                core,
                job,
                data.as_ref().map(|d| d.0.as_str()).unwrap_or(""),
                &e.to_string(),
            )?;
            "failed"
        } else {
            "completed"
        };
        db.execute(
            "UPDATE job_items SET status=? WHERE job_id=? AND image_id=?",
            params![status, job, id],
        )?;
        db.execute("UPDATE jobs SET processed=(SELECT count(*) FROM job_items WHERE job_id=?1 AND status<>'pending'),failed=(SELECT count(*) FROM job_items WHERE job_id=?1 AND status='failed'),elapsed_ms=?2,message='AI 任务处理中；已有兼容结果自动复用',updated_at=CURRENT_TIMESTAMP WHERE id=?1",params![job,start.elapsed().as_millis() as i64])?;
    }
    db.execute(
        "UPDATE jobs SET message='AI 任务完成，详情见失败记录' WHERE id=?",
        [job],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Core;

    #[test]
    fn clear_history_keeps_active_jobs_until_errors_are_cleared() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().join("db")).unwrap();
        let db = core.db().unwrap();
        db.execute(
            "INSERT INTO jobs(id,kind,status) VALUES('done','scan','completed'),('live','scan','running')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO errors(job_id,path,message) VALUES('done','a','旧错误'),('live','b','仍在跑')",
            [],
        )
        .unwrap();
        clear_history(&core, "jobs").unwrap();
        let db = core.db().unwrap();
        let jobs: i64 = db
            .query_row("SELECT count(*) FROM jobs", [], |r| r.get(0))
            .unwrap();
        let status: String = db
            .query_row("SELECT status FROM jobs", [], |r| r.get(0))
            .unwrap();
        let errors: i64 = db
            .query_row("SELECT count(*) FROM errors", [], |r| r.get(0))
            .unwrap();
        assert_eq!(jobs, 1);
        assert_eq!(status, "running");
        assert_eq!(errors, 1);
        clear_history(&core, "errors").unwrap();
        let db = core.db().unwrap();
        let errors: i64 = db
            .query_row("SELECT count(*) FROM errors", [], |r| r.get(0))
            .unwrap();
        let jobs: i64 = db
            .query_row("SELECT count(*) FROM jobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(errors, 0);
        assert_eq!(jobs, 1);
    }
}
