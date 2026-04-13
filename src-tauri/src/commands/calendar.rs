use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn export_calendar(
    _app: tauri::AppHandle,
    _schedule: serde_json::Value,
) -> Result<ExportResult, String> {
    // TODO: Fase 8 — implementar com crate icalendar
    Ok(ExportResult {
        success: false,
        path: None,
        error: Some("Exportação de calendário — implementação pendente (Fase 8)".to_string()),
    })
}
