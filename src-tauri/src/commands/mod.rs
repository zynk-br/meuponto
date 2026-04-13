pub mod settings;
pub mod credentials;
pub mod automation;
pub mod calendar;

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
