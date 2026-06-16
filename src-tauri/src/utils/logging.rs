use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub level: String,
    pub message: String,
}

/// Envia log para o frontend via evento Tauri
pub fn emit_log(app: &AppHandle, level: &str, message: &str) {
    let entry = LogEntry {
        level: level.to_string(),
        message: message.to_string(),
    };

    if let Err(e) = app.emit("log", &entry) {
        eprintln!("[LOG EMIT ERROR] {e}: [{level}] {message}");
    }

    // Também loga no console do backend
    match level {
        "ERRO" => log::error!("{message}"),
        "AVISO" => log::warn!("{message}"),
        "SUCESSO" => log::info!("[OK] {message}"),
        "DEBUG" => log::debug!("{message}"),
        _ => log::info!("{message}"),
    }
}
