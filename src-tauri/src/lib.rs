mod commands;
mod automation;
mod notifications;
mod storage;
mod utils;

use commands::{settings, credentials, calendar};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // Settings
            settings::load_settings,
            settings::save_settings,
            settings::load_schedule,
            settings::save_schedule,
            // Credentials
            credentials::get_credential,
            credentials::set_credential,
            credentials::delete_credential,
            // App info
            commands::get_app_version,
            // Automation
            commands::automation::start_automation,
            commands::automation::stop_automation,
            // Calendar
            calendar::export_calendar,
        ])
        .setup(|_app| {
            // TODO: Fase 9 — configurar updater
            // TODO: Fase 5 — verificar/baixar Chromium no primeiro uso
            log::info!("Meu Ponto v3 iniciado com sucesso.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação Tauri");
}
