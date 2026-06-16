use reqwest;
use std::path::Path;

/// Token fixo do bot do Meu Ponto (o mesmo da versão Electron). O usuário só
/// configura o Chat ID; o token não é exposto na UI.
pub const DEFAULT_BOT_TOKEN: &str = "7391147858:AAFt8DP14NgxZin3Bgr9i5q2FZO1-i7gcAk";

/// Send a text message via Telegram Bot API
pub async fn send_text(token: &str, chat_id: &str, message: &str) -> Result<(), String> {
    if chat_id.is_empty() {
        return Ok(()); // Silently skip if no chat_id configured
    }

    let url = format!("https://api.telegram.org/bot{token}/sendMessage");

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": message,
        }))
        .send()
        .await
        .map_err(|e| format!("Erro ao enviar mensagem Telegram: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Telegram API error: {status} - {body}"));
    }

    Ok(())
}

/// Send a photo via Telegram Bot API
pub async fn send_photo(
    token: &str,
    chat_id: &str,
    photo_path: &Path,
    caption: &str,
) -> Result<(), String> {
    if chat_id.is_empty() {
        return Ok(());
    }

    let url = format!("https://api.telegram.org/bot{token}/sendPhoto");

    let file_bytes = tokio::fs::read(photo_path)
        .await
        .map_err(|e| format!("Erro ao ler arquivo de foto: {e}"))?;

    let file_name = photo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("screenshot.png")
        .to_string();

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("image/png")
        .map_err(|e| format!("Erro ao criar part: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string())
        .text("caption", caption.to_string())
        .part("photo", part);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Erro ao enviar foto Telegram: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Telegram sendPhoto error: {status} - {body}"));
    }

    Ok(())
}
