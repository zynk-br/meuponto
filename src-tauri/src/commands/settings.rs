use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILENAME: &str = "settings.json";

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    Ok(store.get("userSettings"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    store.set("userSettings", settings);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_schedule(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    Ok(store.get("userSchedule"))
}

#[tauri::command]
pub fn save_schedule(app: AppHandle, schedule: serde_json::Value) -> Result<(), String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    store.set("userSchedule", schedule);
    store.save().map_err(|e| e.to_string())
}

/// Histórico de batidas por dia (mapa "YYYY-MM-DD" → plano do dia).
#[tauri::command]
pub fn load_punch_history(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
    Ok(store.get("punchHistory"))
}
