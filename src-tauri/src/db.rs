use anyhow::Result;
use rusqlite::{types::ValueRef, Connection, Params};
use serde_json::{Map, Value};
use std::{path::Path, time::Duration};

pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(15))?;
    db.execute_batch("PRAGMA foreign_keys=ON;")?;
    Ok(db)
}

pub fn init(path: &Path) -> Result<()> {
    let db = open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        db.execute_batch(include_str!("schema.sql"))?;
    }
    if version < 2 {
        db.execute_batch(
            "BEGIN IMMEDIATE;
            ALTER TABLE models ADD COLUMN vision_prompt TEXT NOT NULL DEFAULT '';
            ALTER TABLE models ADD COLUMN vision_max_tokens INTEGER NOT NULL DEFAULT 4096;
            PRAGMA user_version=2;
            COMMIT;",
        )?;
    }
    if version < 3 {
        db.execute_batch(
            "BEGIN IMMEDIATE;
            UPDATE models
            SET provider='embeddinggemma',
                model='EmbeddingGemma-2',
                name=CASE WHEN name IN ('本地 WeMM 2B','本地 WeMM') THEN '本地 EmbeddingGemma 2' ELSE name END,
                revision='',
                fingerprint='migrated-from-wemm',
                capabilities='{}',
                last_test=NULL,
                test_result=NULL
            WHERE provider='wemm';
            PRAGMA user_version=3;
            COMMIT;",
        )?;
    }
    db.execute("UPDATE jobs SET status='paused',message='应用重启，点击继续恢复任务' WHERE status IN ('running','queued')",[])?;
    Ok(())
}

pub fn rows(db: &Connection, sql: &str, args: impl Params) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let result = stmt
        .query_map(args, |r| {
            let mut item = Map::new();
            for (i, name) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => Value::from(v),
                    ValueRef::Real(v) => Value::from(v),
                    ValueRef::Text(v) => Value::from(String::from_utf8_lossy(v).to_string()),
                    ValueRef::Blob(_) => Value::Null,
                };
                item.insert(name.clone(), v);
            }
            Ok(Value::Object(item))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrades_existing_model_without_changing_saved_data() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("db");
        let db = open(&path).unwrap();
        db.execute_batch(include_str!("schema.sql")).unwrap();
        db.execute("INSERT INTO models(id,name,provider,base_url,model,fingerprint,capabilities) VALUES('old','Old','openai','http://localhost','fixture','original','{\"vision\":true}')", []).unwrap();
        init(&path).unwrap();
        init(&path).unwrap();
        let model = rows(
            &open(&path).unwrap(),
            "SELECT * FROM models WHERE id='old'",
            [],
        )
        .unwrap()
        .pop()
        .unwrap();
        assert_eq!(model["fingerprint"], "original");
        assert_eq!(model["capabilities"], "{\"vision\":true}");
        assert_eq!(model["vision_prompt"], "");
        assert_eq!(model["vision_max_tokens"], 4096);
    }
    #[test]
    fn replaces_saved_wemm_configuration_and_clears_its_capabilities() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("db");
        let db = open(&path).unwrap();
        db.execute_batch(include_str!("schema.sql")).unwrap();
        db.execute("INSERT INTO models(id,name,provider,base_url,model,revision,fingerprint,capabilities) VALUES('local','本地 WeMM 2B','wemm','http://127.0.0.1:8787','WeMM-Embedding-2B','old-rev','old-fp','{\"image\":true,\"text\":true,\"image_dimension\":256}')", []).unwrap();
        init(&path).unwrap();
        init(&path).unwrap();
        let model = rows(&open(&path).unwrap(), "SELECT * FROM models WHERE id='local'", [])
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(model["provider"], "embeddinggemma");
        assert_eq!(model["model"], "EmbeddingGemma-2");
        assert_eq!(model["name"], "本地 EmbeddingGemma 2");
        assert_eq!(model["revision"], "");
        assert_eq!(model["capabilities"], "{}");
        assert_eq!(model["fingerprint"], "migrated-from-wemm");
        assert_eq!(
            open(&path)
                .unwrap()
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
    #[test]
    fn migration_is_repeatable_and_recovers_jobs() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("db");
        init(&p).unwrap();
        open(&p)
            .unwrap()
            .execute(
                "INSERT INTO jobs(id,kind,status) VALUES('j','scan','running')",
                [],
            )
            .unwrap();
        init(&p).unwrap();
        assert_eq!(
            rows(&open(&p).unwrap(), "SELECT status FROM jobs", []).unwrap()[0]["status"],
            "paused"
        );
    }
}
