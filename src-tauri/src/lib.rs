mod api;
mod db;
#[cfg(test)]
mod integration_tests;
mod jobs;
mod library;
mod models;
mod scanner;

use anyhow::Result;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::AtomicU8, Arc, Mutex},
};
use tauri::Manager;

pub struct Core {
    pub db_path: PathBuf,
    pub cache: PathBuf,
    pub controls: Mutex<HashMap<String, Arc<AtomicU8>>>,
}
impl Core {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        let cache = root.join("thumbnails");
        std::fs::create_dir_all(&cache)?;
        let db_path = root.join("sortnest.sqlite3");
        db::init(&db_path)?;
        Ok(Self {
            db_path,
            cache,
            controls: Mutex::new(HashMap::new()),
        })
    }
    pub fn db(&self) -> Result<rusqlite::Connection> {
        db::open(&self.db_path)
    }
}

#[tauri::command]
async fn command(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Core>>,
    operation: String,
    args: Value,
) -> Result<Value, String> {
    let core = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        api::dispatch(&core, Some(&app), &operation, args).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = std::env::var_os("SORTNEST_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let core = Arc::new(Core::new(root)?);
            app.asset_protocol_scope()
                .allow_directory(&core.cache, true)?;
            // Only directories explicitly registered by the user enter the asset scope.
            for f in db::rows(&core.db()?, "SELECT path FROM folders", [])? {
                let _ = app
                    .asset_protocol_scope()
                    .allow_directory(f["path"].as_str().unwrap_or_default(), true);
            }
            app.manage(core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![command])
        .run(tauri::generate_context!())
        .expect("无法启动 SortNest");
}
