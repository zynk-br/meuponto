use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::automation::scheduler::{AutomationManager, AutomationConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRequest {
    pub schedule: serde_json::Value,
    pub credentials: UserCredentials,
    pub settings: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCredentials {
    pub folha: String,
    pub senha: Option<String>,
}

/// Managed state for the automation manager
pub struct AutomationManagerState(pub Arc<Mutex<AutomationManager>>);

#[tauri::command]
pub async fn start_automation(
    app: AppHandle,
    state: tauri::State<'_, AutomationManagerState>,
    data: AutomationRequest,
) -> Result<(), String> {
    let mut manager = state.0.lock().await;

    if manager.is_running().await {
        return Err("Automação já está rodando.".to_string());
    }

    let senha = data.credentials.senha.unwrap_or_default();
    if senha.is_empty() {
        return Err("Senha não fornecida.".to_string());
    }

    let pre_assigned_interval = data.settings.get("preAssignedInterval")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Gate de validação: não inicia com agenda inválida.
    let validation = crate::automation::validation::validate_schedule(&data.schedule, pre_assigned_interval);
    if !validation.valid {
        return Err(format!(
            "Agenda inválida. Corrija antes de iniciar: {}",
            crate::automation::validation::format_issues(&validation)
        ));
    }

    let config = AutomationConfig {
        schedule: data.schedule,
        folha: data.credentials.folha,
        senha,
        telegram_bot_token: data.settings.get("telegramBotToken")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        telegram_chat_id: data.settings.get("telegramChatId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        pre_assigned_interval,
    };

    manager.start(app, config).await
}

#[tauri::command]
pub async fn stop_automation(
    app: AppHandle,
    state: tauri::State<'_, AutomationManagerState>,
) -> Result<(), String> {
    let manager = state.0.lock().await;
    manager.stop().await;

    let _ = app.emit("log", serde_json::json!({
        "level": "INFO",
        "message": "Automação interrompida pelo usuário."
    }));

    Ok(())
}
