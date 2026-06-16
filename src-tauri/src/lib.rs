mod commands;
mod automation;
mod notifications;
mod storage;
mod utils;

use commands::{settings, credentials, calendar};
use commands::automation as automation_cmd;
use std::sync::atomic::AtomicBool;
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

    // Flag síncrona compartilhada entre o manager e o handler de fechar-janela.
    let running_flag = Arc::new(AtomicBool::new(false));

    builder
        .manage(automation_cmd::AutomationManagerState(
            Arc::new(Mutex::new(automation::scheduler::AutomationManager::new(running_flag.clone())))
        ))
        .manage(automation_cmd::AutomationRunningFlag(running_flag))
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

            // --- Bandeja (tray) + minimizar-para-bandeja — somente desktop ---
            #[cfg(desktop)]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::{Emitter, Manager};

                let abrir = MenuItemBuilder::with_id("abrir", "Abrir Meu Ponto").build(app)?;
                let sair = MenuItemBuilder::with_id("sair", "Sair").build(app)?;
                let menu = MenuBuilder::new(app).items(&[&abrir, &sair]).build()?;

                TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Meu Ponto")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "abrir" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "sair" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Fechar a janela (X) minimiza para a bandeja SE a automação estiver
                // ativa; caso contrário, deixa encerrar normalmente.
                if let Some(window) = app.get_webview_window("main") {
                    let handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            let running = handle
                                .state::<automation_cmd::AutomationRunningFlag>()
                                .0
                                .load(std::sync::atomic::Ordering::Relaxed);
                            if running {
                                api.prevent_close();
                                if let Some(w) = handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                                let _ = handle.emit("log", serde_json::json!({
                                    "level": "INFO",
                                    "message": "Janela minimizada para a bandeja — a automação continua rodando. Use o ícone na bandeja para reabrir ou sair."
                                }));
                            }
                        }
                    });
                }
            }

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
