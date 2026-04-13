use serde::{Deserialize, Serialize};
use tauri::Emitter;

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

#[tauri::command]
pub async fn start_automation(
    app: tauri::AppHandle,
    data: AutomationRequest,
) -> Result<(), String> {
    // TODO: Fase 5+6 — implementar motor de automação com chromiumoxide
    // 1. Verificar/baixar Chromium
    // 2. Lançar browser headless
    // 3. Login no portal
    // 4. Sincronizar pontos existentes
    // 5. Calcular próxima batida (com ancoragem)
    // 6. Agendar heartbeat loop
    log::info!("Automação solicitada — implementação pendente (Fase 5+6)");
    app.emit("log", serde_json::json!({
        "level": "INFO",
        "message": "Automação iniciada (stub — implementação pendente)."
    })).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn stop_automation(app: tauri::AppHandle) -> Result<(), String> {
    // TODO: Fase 6 — cancelar via CancellationToken
    log::info!("Parada da automação solicitada");
    app.emit("log", serde_json::json!({
        "level": "INFO",
        "message": "Automação interrompida (stub)."
    })).map_err(|e| e.to_string())?;
    Ok(())
}
