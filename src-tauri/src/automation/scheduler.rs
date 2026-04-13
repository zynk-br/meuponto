use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use chrono::Datelike;

use crate::automation::browser;
use crate::automation::portal;
use crate::utils::logging::emit_log;
use crate::utils::time;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub entrada1: String,
    pub saida1: String,
    pub entrada2: String,
    pub saida2: String,
    pub feriado: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationConfig {
    pub schedule: serde_json::Value,
    pub folha: String,
    pub senha: String,
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub pre_assigned_interval: bool,
}

#[derive(Debug, Clone)]
pub struct NextPunch {
    pub day_key: String,
    pub punch_type: String,
    pub time: String,
    pub datetime: chrono::NaiveDateTime,
}

pub struct AutomationManager {
    cancel_token: CancellationToken,
    is_running: Arc<Mutex<bool>>,
}

impl AutomationManager {
    pub fn new() -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            is_running: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.is_running.lock().await
    }

    pub async fn start(
        &mut self,
        app: AppHandle,
        config: AutomationConfig,
    ) -> Result<(), String> {
        let mut running = self.is_running.lock().await;
        if *running {
            return Err("Automação já está rodando.".to_string());
        }
        *running = true;
        drop(running);

        // Reset cancel token
        self.cancel_token = CancellationToken::new();
        let token = self.cancel_token.clone();
        let is_running = self.is_running.clone();

        emit_status(&app, true, "Iniciando automação...", Some("Preparando..."));
        emit_log(&app, "INFO", "--- Automação Iniciada ---");

        // Spawn the automation loop
        tokio::spawn(async move {
            if let Err(e) = run_automation_loop(&app, &config, &token).await {
                emit_log(&app, "ERRO", &format!("Erro na automação: {e}"));
            }

            // Cleanup
            let mut running = is_running.lock().await;
            *running = false;
            emit_status(&app, false, "Automação interrompida.", None);
            emit_log(&app, "INFO", "--- Automação Efetivamente Parada ---");
        });

        Ok(())
    }

    pub async fn stop(&self) {
        self.cancel_token.cancel();
        emit_log_static("INFO", "Solicitação de parada recebida.");
    }
}

async fn run_automation_loop(
    app: &AppHandle,
    config: &AutomationConfig,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    // Step 1: Ensure Chromium is available
    let chromium_path = match browser::get_chromium_path(app) {
        Some(path) => {
            emit_log(app, "SUCESSO", "Chromium encontrado.");
            path
        }
        None => {
            emit_log(app, "INFO", "Chromium não encontrado. Iniciando download...");
            emit_status(app, true, "Baixando navegador...", Some("Download"));
            browser::download_chromium(app).await?
        }
    };

    if cancel_token.is_cancelled() {
        return Ok(());
    }

    // Step 2: Launch browser
    emit_status(app, true, "Iniciando navegador...", Some("Browser"));
    let (mut browser_instance, handler) = browser::launch_browser(chromium_path).await?;
    emit_log(app, "SUCESSO", "Navegador iniciado com sucesso.");

    // Step 3: Main automation loop
    let result = automation_heartbeat_loop(app, &browser_instance, config, cancel_token).await;

    // Cleanup: close browser
    emit_log(app, "INFO", "Fechando navegador...");
    let _ = browser_instance.close().await;
    handler.abort();
    emit_log(app, "INFO", "Navegador fechado.");

    result
}

async fn automation_heartbeat_loop(
    app: &AppHandle,
    browser: &chromiumoxide::browser::Browser,
    config: &AutomationConfig,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    loop {
        if cancel_token.is_cancelled() {
            return Ok(());
        }

        // Login and sync points
        emit_status(app, true, "Sincronizando pontos...", Some("Sync"));

        let page = portal::login_to_portal(browser, app, &config.folha, &config.senha).await;
        let page = match page {
            Ok(p) => p,
            Err(e) => {
                emit_log(app, "ERRO", &format!("Falha no login: {e}"));
                emit_log(app, "INFO", "Tentando novamente em 5 minutos...");
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(300)).await;
                continue;
            }
        };

        let existing_points = portal::sync_initial_points(&page, app)
            .await
            .unwrap_or_default();

        // Determine next punch
        let next_punch = get_next_punch(&config.schedule, &existing_points, config.pre_assigned_interval);

        // Close the page after sync
        let _ = page.close().await;

        match next_punch {
            None => {
                emit_log(app, "INFO", "Nenhuma batida próxima encontrada. Verificando novamente em 30 minutos.");
                emit_status(app, true, "Sem batidas pendentes. Aguardando...", None);
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(1800)).await;

                if cancel_token.is_cancelled() {
                    return Ok(());
                }
                continue;
            }
            Some(punch) => {
                let now = chrono::Local::now().naive_local();
                let time_until = punch.datetime.signed_duration_since(now);
                let secs_until = time_until.num_seconds();

                if secs_until < -10 {
                    // Already passed
                    emit_log(
                        app,
                        "AVISO",
                        &format!("Batida {} às {} já passou. Pulando.", punch.punch_type, punch.time),
                    );
                    continue;
                }

                if secs_until > 10 {
                    // Wait until punch time
                    let wait_secs = calc_heartbeat_interval(secs_until);
                    emit_status(
                        app,
                        true,
                        &format!("Aguardando {} às {}", punch.punch_type, punch.time),
                        None,
                    );
                    emit_log(
                        app,
                        "INFO",
                        &format!(
                            "Próxima verificação em {}s para {} @ {}",
                            wait_secs, punch.punch_type, punch.time
                        ),
                    );

                    wait_or_cancel(cancel_token, std::time::Duration::from_secs(wait_secs as u64)).await;

                    if cancel_token.is_cancelled() {
                        return Ok(());
                    }
                    continue; // Re-sync and re-check
                }

                // Time to punch!
                emit_log(
                    app,
                    "INFO",
                    &format!("Hora de bater o ponto: {} às {}!", punch.punch_type, punch.time),
                );
                emit_status(app, true, &format!("Registrando {}...", punch.punch_type), Some("Punch"));

                // Open a new page for the punch
                let punch_page = portal::login_to_portal(browser, app, &config.folha, &config.senha).await;

                match punch_page {
                    Ok(page) => {
                        let punch_result = portal::perform_punch(&page, app, &punch.punch_type, &punch.time).await;

                        match punch_result {
                            Ok(()) => {
                                // Notify via Telegram
                                if let (Some(token), Some(chat_id)) = (&config.telegram_bot_token, &config.telegram_chat_id) {
                                    if !token.is_empty() && !chat_id.is_empty() {
                                        let msg = format!("✅ Ponto {} às {} registrado com sucesso!", punch.punch_type, punch.time);
                                        let _ = crate::notifications::telegram::send_text(token, chat_id, &msg).await;
                                    }
                                }
                            }
                            Err(e) => {
                                emit_log(app, "ERRO", &format!("Falha ao registrar ponto: {e}"));
                                // Notify failure via Telegram
                                if let (Some(token), Some(chat_id)) = (&config.telegram_bot_token, &config.telegram_chat_id) {
                                    if !token.is_empty() && !chat_id.is_empty() {
                                        let msg = format!("🔴 Falha ao registrar ponto {} às {}: {}", punch.punch_type, punch.time, e);
                                        let _ = crate::notifications::telegram::send_text(token, chat_id, &msg).await;
                                    }
                                }
                            }
                        }

                        let _ = page.close().await;
                    }
                    Err(e) => {
                        emit_log(app, "ERRO", &format!("Falha no login para punch: {e}"));
                    }
                }

                // Wait a bit before next cycle
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(60)).await;
            }
        }
    }
}

/// Calculate adaptive heartbeat interval
fn calc_heartbeat_interval(secs_remaining: i64) -> i64 {
    if secs_remaining > 300 {
        300 // 5 minutes
    } else if secs_remaining > 60 {
        60 // 1 minute
    } else {
        secs_remaining.max(5) // At least 5 seconds
    }
}

/// Wait for a duration, but return early if cancelled
async fn wait_or_cancel(token: &CancellationToken, duration: std::time::Duration) {
    tokio::select! {
        _ = token.cancelled() => {}
        _ = tokio::time::sleep(duration) => {}
    }
}

/// Determine the next punch to make
pub fn get_next_punch(
    schedule: &serde_json::Value,
    existing_points: &[String],
    pre_assigned_interval: bool,
) -> Option<NextPunch> {
    let now = chrono::Local::now();

    // Iterate through next 7 days (including today)
    for day_offset in 0..7 {
        let check_date = now.date_naive() + chrono::Duration::days(day_offset);
        let weekday = check_date.weekday();

        // Skip weekends
        if !time::is_weekday(weekday) {
            continue;
        }

        let day_key = time::weekday_pt(weekday).to_string();

        // Get schedule entry for this day
        let day_entry = match schedule.get(&day_key) {
            Some(entry) => entry,
            None => continue,
        };

        // Check if it's a holiday
        if day_entry.get("feriado").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }

        // Get punch order
        let punch_order: Vec<&str> = if pre_assigned_interval {
            vec!["entrada1", "saida2"]
        } else {
            vec!["entrada1", "saida1", "entrada2", "saida2"]
        };

        for punch_type in punch_order {
            let time_str = match day_entry.get(punch_type).and_then(|v| v.as_str()) {
                Some(t) if !t.is_empty() => t,
                _ => continue,
            };

            let parts: Vec<&str> = time_str.split(':').collect();
            if parts.len() != 2 {
                continue;
            }
            let hours: u32 = parts[0].parse().unwrap_or(0);
            let minutes: u32 = parts[1].parse().unwrap_or(0);

            let punch_datetime = check_date
                .and_hms_opt(hours, minutes, 0)
                .unwrap_or_else(|| check_date.and_hms_opt(0, 0, 0).unwrap());

            // Skip if time already passed today
            if day_offset == 0 && punch_datetime < now.naive_local() {
                continue;
            }

            // Skip if this punch is already registered (with ±5 min tolerance)
            if day_offset == 0 {
                let target_mins = (hours * 60 + minutes) as i32;
                let already_exists = existing_points.iter().any(|ep| {
                    if let Some(ep_mins) = crate::automation::portal::parse_time_minutes(ep) {
                        (ep_mins - target_mins).abs() <= 5
                    } else {
                        false
                    }
                });
                if already_exists {
                    continue;
                }
            }

            return Some(NextPunch {
                day_key,
                punch_type: punch_type.to_string(),
                time: time_str.to_string(),
                datetime: punch_datetime,
            });
        }
    }

    None
}

fn emit_status(app: &AppHandle, is_running: bool, message: &str, task: Option<&str>) {
    let _ = app.emit(
        "automation-status",
        serde_json::json!({
            "isRunning": is_running,
            "statusMessage": message,
            "currentTask": task,
        }),
    );
}

fn emit_log_static(level: &str, message: &str) {
    match level {
        "ERRO" => log::error!("{message}"),
        "AVISO" => log::warn!("{message}"),
        _ => log::info!("{message}"),
    }
}
