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

fn fit_window_to_screen(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    if scale <= f64::EPSILON {
        return;
    }
    let area = monitor.work_area().size;
    let available_width = area.width as f64 / scale;
    let available_height = area.height as f64 / scale;
    let max_width = (available_width - 32.0).max(640.0);
    let max_height = (available_height - 32.0).max(480.0);
    let width = (available_width * 0.86).clamp(800.0_f64.min(max_width), max_width);
    let height = (available_height * 0.9).clamp(560.0_f64.min(max_height), max_height);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = window.center();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            fit_window_to_screen(app);
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
