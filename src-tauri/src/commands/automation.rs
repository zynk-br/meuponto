use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::automation::scheduler::{AutomationManager, AutomationConfig};

const STORE_FILENAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRequest {
    pub schedule: serde_json::Value,
    pub credentials: UserCredentials,
    pub settings: serde_json::Value,
    /// Inicia em modo simulação (dry-run) — não registra ponto de verdade.
    #[serde(default)]
    pub dry_run: bool,
    /// (Dry-run) tipo de batida a falhar de propósito, p/ ver o reagendamento.
    #[serde(default)]
    pub simulate_failure: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCredentials {
    pub folha: String,
    pub senha: Option<String>,
}

/// Managed state for the automation manager
pub struct AutomationManagerState(pub Arc<Mutex<AutomationManager>>);

/// Espelho síncrono do estado "rodando", para o handler de fechar-janela
/// decidir entre minimizar-para-bandeja (rodando) ou encerrar (ocioso).
pub struct AutomationRunningFlag(pub Arc<std::sync::atomic::AtomicBool>);

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
        // Token fixo (não vem da UI) — usuário só configura o Chat ID.
        telegram_bot_token: Some(crate::notifications::telegram::DEFAULT_BOT_TOKEN.to_string()),
        telegram_chat_id: data.settings.get("telegramChatId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        pre_assigned_interval,
        dry_run: data.dry_run,
        simulate_failure: data.simulate_failure,
    };

    // Persiste contexto de retomada (apenas automação real, não simulação).
    if !config.dry_run {
        persist_resume_context(&app, &config);
    }

    manager.start(app, config).await
}

/// Persiste o que é preciso para retomar a automação após reinício do app.
/// A senha NÃO é persistida — fica no keyring do SO (buscada por folha).
fn persist_resume_context(app: &AppHandle, config: &AutomationConfig) {
    if let Ok(store) = app.store(STORE_FILENAME) {
        store.set("automationWasRunning", serde_json::json!(true));
        store.set(
            "resumeConfig",
            serde_json::json!({
                "schedule": config.schedule,
                "folha": config.folha,
                "telegramBotToken": config.telegram_bot_token,
                "telegramChatId": config.telegram_chat_id,
                "preAssignedInterval": config.pre_assigned_interval,
            }),
        );
        let _ = store.save();
    }
}

/// Limpa a flag de retomada (parada explícita pelo usuário).
fn clear_resume_flag(app: &AppHandle) {
    if let Ok(store) = app.store(STORE_FILENAME) {
        store.set("automationWasRunning", serde_json::json!(false));
        let _ = store.save();
    }
}

/// Retoma a automação no início do app, se ela estava ativa quando foi fechado.
/// Reconstrói o config a partir do `resumeConfig` persistido + senha do keyring.
/// O loop recarrega o `dayPlan` de hoje (se houver) e continua de onde parou.
pub async fn try_resume(app: AppHandle) {
    let store = match app.store(STORE_FILENAME) {
        Ok(s) => s,
        Err(_) => return,
    };

    if !store.get("automationWasRunning").and_then(|v| v.as_bool()).unwrap_or(false) {
        return;
    }
    let resume = match store.get("resumeConfig") {
        Some(v) => v,
        None => return,
    };

    let folha = resume.get("folha").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if folha.is_empty() {
        return;
    }

    let senha = match crate::commands::credentials::get_credential(folha.clone()) {
        Ok(Some(s)) if !s.is_empty() => s,
        _ => {
            let _ = app.emit("log", serde_json::json!({
                "level": "AVISO",
                "message": "Automação estava ativa, mas a senha não está salva; não foi possível retomar automaticamente."
            }));
            return;
        }
    };

    let config = AutomationConfig {
        schedule: resume.get("schedule").cloned().unwrap_or_else(|| serde_json::json!({})),
        folha,
        senha,
        telegram_bot_token: Some(crate::notifications::telegram::DEFAULT_BOT_TOKEN.to_string()),
        telegram_chat_id: resume.get("telegramChatId").and_then(|v| v.as_str()).map(String::from),
        pre_assigned_interval: resume.get("preAssignedInterval").and_then(|v| v.as_bool()).unwrap_or(false),
        dry_run: false,
        simulate_failure: None,
    };

    let state = app.state::<AutomationManagerState>();
    let mut manager = state.0.lock().await;
    if manager.is_running().await {
        return;
    }
    let _ = app.emit("log", serde_json::json!({
        "level": "INFO",
        "message": "Retomando automação após reinício do app..."
    }));
    let _ = manager.start(app.clone(), config).await;
}

#[tauri::command]
pub async fn stop_automation(
    app: AppHandle,
    state: tauri::State<'_, AutomationManagerState>,
) -> Result<(), String> {
    let manager = state.0.lock().await;
    manager.stop().await;

    // Parada explícita: não retomar no próximo boot.
    clear_resume_flag(&app);

    let _ = app.emit("log", serde_json::json!({
        "level": "INFO",
        "message": "Automação interrompida pelo usuário."
    }));

    Ok(())
}
