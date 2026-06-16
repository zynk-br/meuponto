mod commands;
mod automation;
mod notifications;
mod storage;
mod utils;

use commands::{settings, credentials, calendar};
use commands::automation as automation_cmd;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init());

    // Bridge para o Tauri MCP — apenas em builds de debug (testes/dev).
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .manage(automation_cmd::AutomationManagerState(
            Arc::new(Mutex::new(automation::scheduler::AutomationManager::new()))
        ))
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
            commands::validate_schedule,
            // Automation
            automation_cmd::start_automation,
            automation_cmd::stop_automation,
            // Calendar
            calendar::export_calendar,
            // Test
            commands::test_sync_points,
        ])
        .setup(|app| {
            log::info!("Meu Ponto v3 iniciado com sucesso.");
            // Retoma a automação se ela estava ativa quando o app foi fechado.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                automation_cmd::try_resume(handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação Tauri");
}
