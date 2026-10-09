use crate::{db, jobs, library, models, scanner, Core};
use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::Manager;

fn id(v: &Value) -> Result<i64> {
    v["id"].as_i64().context("缺少记录 ID")
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().context(format!("缺少 {key}"))
}
pub fn dispatch(
    core: &Arc<Core>,
    app: Option<&tauri::AppHandle>,
    op: &str,
    a: Value,
) -> Result<Value> {
    match op{
        "dashboard"=>library::dashboard(core),
        "images"=>library::list(core,&a),
        "detail"=>library::detail(core,id(&a)?),
        "taxonomy"=>library::taxonomy(core),
        "category"=>library::category(core,&a),
        "batch"=>library::batch(core,&a),
        "tag_save"=>{let db=core.db()?;let name=text(&a,"name")?.trim();let kind=text(&a,"kind")?.trim();if name.is_empty()||kind.is_empty(){bail!("标签名称和类型不能为空")};db.execute("UPDATE tags SET name=?,kind=? WHERE id=?",params![name,kind,id(&a)?])?;Ok(json!(true))},
        "tag_delete"=>{core.db()?.execute("DELETE FROM tags WHERE id=?",[id(&a)?])?;Ok(json!(true))},
        "folders"=>Ok(json!(db::rows(&core.db()?,"SELECT f.*,(SELECT count(*) FROM images i WHERE folder_id=f.id AND missing=0) AS count,(SELECT count(*) FROM images i WHERE folder_id=f.id AND missing=1) AS missing,(SELECT count(*) FROM images i WHERE folder_id=f.id AND status='failed' AND missing=0) AS failed FROM folders f ORDER BY added_at DESC",[])?)),
        "folder_add"=>{let path=text(&a,"path")?;let id=scanner::add_folder(core,path)?;if let Some(app)=app{app.asset_protocol_scope().allow_directory(scanner::canonical(path)?,true)?;}Ok(json!({"id":id}))},
        "folder_remove"=>{
            let controls=core.controls.lock().unwrap();if !controls.is_empty(){bail!("请先取消或完成后台任务")}
            let db=core.db()?;db.execute("DELETE FROM folders WHERE id=?",[id(&a)?])?;
            // Asset grants last for this app session. A permanent deny would also
            // block previews if the user explicitly re-adds this folder. On restart
            // the scope is rebuilt from the remaining registered folders only.
            Ok(json!(true))
        },
        "jobs"=>Ok(json!({"items":db::rows(&core.db()?,"SELECT j.*,f.path AS folder FROM jobs j LEFT JOIN folders f ON f.id=j.folder_id ORDER BY j.created_at DESC,j.rowid DESC LIMIT 30",[])?,"errors":db::rows(&core.db()?,"SELECT * FROM errors ORDER BY id DESC LIMIT 100",[])?})),
        "job_start"=>jobs::start(core,&a),
        "job_control"=>jobs::control(core,text(&a,"id")?,text(&a,"action")?),
        "models"=>{
            let db=core.db()?;let mut items=db::rows(&db,"SELECT m.*,(SELECT count(*) FROM embeddings e WHERE e.model_id=m.id) AS index_count,(SELECT count(*) FROM embeddings e WHERE e.model_id=m.id AND e.fingerprint<>m.fingerprint) AS stale_count FROM models m ORDER BY name",[])?;
            for m in &mut items{m["capabilities"]=serde_json::from_str(m["capabilities"].as_str().unwrap_or("{}"))?;m["has_key"]=json!(models::credential(m["id"].as_str().unwrap())?.get_password().is_ok());}
            Ok(json!({"items":items,"assignments":db::rows(&db,"SELECT * FROM task_models",[])?}))
        },
        "model_catalog"=>models::catalog(a),
        "model_save"=>{let controls=core.controls.lock().unwrap();if !controls.is_empty(){bail!("修改模型前请先结束后台任务")};models::save(core,a)},
        "model_delete"=>{let controls=core.controls.lock().unwrap();if !controls.is_empty(){bail!("删除模型前请先结束后台任务")};let id=text(&a,"id")?;core.db()?.execute("DELETE FROM models WHERE id=?",[id])?;let _=models::credential(id)?.delete_credential();Ok(json!(true))},
        "model_test"=>models::test(core,text(&a,"id")?,text(&a,"kind")?,a["path"].as_str()),
        "assign"=>{
            let controls=core.controls.lock().unwrap();if !controls.is_empty(){bail!("修改任务模型前请先结束后台任务")}
            let task=text(&a,"task")?;let model=text(&a,"model_id")?;
            let cap=match task{"image_embedding"=>"image","text_embedding"=>"text","description"|"tags"=>"vision",_=>bail!("未知模型任务")};
            let db=core.db()?;if model.is_empty(){db.execute("DELETE FROM task_models WHERE task=?",[task])?;}else{models::require(&models::load(core,model)?,cap)?;db.execute("INSERT INTO task_models(task,model_id) VALUES(?,?) ON CONFLICT(task) DO UPDATE SET model_id=excluded.model_id",params![task,model])?;}Ok(json!(true))
        },
        "search"=>{if let Some(path)=a["path"].as_str(){if let Some(app)=app{app.asset_protocol_scope().allow_file(scanner::canonical(path)?)?;}}library::search(core,&a)},
        "settings"=>{
            let pid=sysinfo::Pid::from_u32(std::process::id());
            let mut sys=sysinfo::System::new();sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]),true);
            let memory=sys.process(pid).map(|p|p.memory()).unwrap_or(0);
            let cache_bytes=std::fs::read_dir(&core.cache)?.filter_map(|e|e.ok()).filter_map(|e|e.metadata().ok()).map(|m|m.len()).sum::<u64>();
            Ok(json!({"database":core.db_path,"cache":core.cache,"cache_bytes":cache_bytes,"memory":memory,"values":db::rows(&core.db()?,"SELECT * FROM settings",[])?,"version":env!("CARGO_PKG_VERSION")}))
        },
        "settings_save"=>{let key=text(&a,"key")?;let value=text(&a,"value")?;if key!="read_exif"||!matches!(value,"true"|"false"){bail!("未知设置")};let db=core.db()?;db.execute("UPDATE settings SET value=? WHERE key=?",params![value,key])?;if value=="false"{db.execute("UPDATE images SET exif='{}'",[])?;}Ok(json!(true))},
        "cache_prune"=>{
            let controls=core.controls.lock().unwrap();if !controls.is_empty(){bail!("请先结束后台任务")}
            let db=core.db()?;let active:std::collections::HashSet<String>=db::rows(&db,"SELECT DISTINCT thumbnail FROM images WHERE thumbnail IS NOT NULL",[])?.iter().filter_map(|v|v["thumbnail"].as_str().map(str::to_owned)).collect();let mut count=0;
            for entry in std::fs::read_dir(&core.cache)?{let entry=entry?;if entry.file_type()?.is_file()&&!active.contains(&entry.path().to_string_lossy().to_string()){std::fs::remove_file(entry.path())?;count+=1;}}
            Ok(json!({"removed":count}))
        },
        _=>bail!("未知命令：{op}")
    }
}
