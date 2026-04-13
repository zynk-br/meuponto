use chromiumoxide::browser::Browser;
use chromiumoxide::page::Page;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

use crate::utils::logging::emit_log;

const PORTAL_URL: &str = "https://centraldofuncionario.com.br/50911";

/// Login to centraldofuncionario.com.br
pub async fn login_to_portal(
    browser: &Browser,
    app: &AppHandle,
    folha: &str,
    senha: &str,
) -> Result<Page, String> {
    emit_log(app, "INFO", &format!("Realizando login na folha: {folha}"));

    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|e| format!("Erro ao criar página: {e}"))?;

    // Navigate to the portal
    page.goto(PORTAL_URL)
        .await
        .map_err(|e| format!("Erro ao navegar: {e}"))?;

    // Wait for the page to load
    sleep(Duration::from_secs(3)).await;

    // Fill login form
    page.find_element("#login-numero-folha")
        .await
        .map_err(|e| format!("Campo 'número da folha' não encontrado: {e}"))?
        .click()
        .await
        .map_err(|e| format!("Erro ao clicar campo folha: {e}"))?;

    page.find_element("#login-numero-folha")
        .await
        .map_err(|e| format!("Campo folha não encontrado: {e}"))?
        .type_str(folha)
        .await
        .map_err(|e| format!("Erro ao preencher folha: {e}"))?;

    page.find_element("#login-senha")
        .await
        .map_err(|e| format!("Campo 'senha' não encontrado: {e}"))?
        .click()
        .await
        .map_err(|e| format!("Erro ao clicar campo senha: {e}"))?;

    page.find_element("#login-senha")
        .await
        .map_err(|e| format!("Campo senha não encontrado: {e}"))?
        .type_str(senha)
        .await
        .map_err(|e| format!("Erro ao preencher senha: {e}"))?;

    // Click login button
    page.find_element("#login-entrar")
        .await
        .map_err(|e| format!("Botão 'Entrar' não encontrado: {e}"))?
        .click()
        .await
        .map_err(|e| format!("Erro ao clicar 'Entrar': {e}"))?;

    // Wait for navigation
    sleep(Duration::from_secs(5)).await;

    // Click on "Incluir Ponto" menu
    page.find_element("#menu-incluir-ponto")
        .await
        .map_err(|e| format!("Menu 'Incluir Ponto' não encontrado: {e}"))?
        .click()
        .await
        .map_err(|e| format!("Erro ao clicar 'Incluir Ponto': {e}"))?;

    // Wait for the punch page to load
    sleep(Duration::from_secs(3)).await;

    // Verify we're on the correct page
    let url = page.url().await.map_err(|e| format!("Erro ao obter URL: {e}"))?;
    let url_str = url.map(|u| u.to_string()).unwrap_or_default();

    if !url_str.contains("incluir-ponto") {
        // Try to verify via page content
        let content_check: Result<String, _> = page
            .evaluate(
                r#"
                const el = document.querySelector('#localizacao-incluir-ponto');
                el ? el.textContent.trim() : '';
            "#,
            )
            .await
            .map_err(|e| format!("Erro ao verificar página: {e}"))
            .and_then(|val| {
                val.into_value::<String>()
                    .map_err(|e| format!("Erro ao converter valor: {e}"))
            });

        match content_check {
            Ok(text) if text.contains("Incluir Ponto") => {
                emit_log(app, "SUCESSO", "Logado com sucesso.");
            }
            _ => {
                // Take screenshot for debugging
                let _ = take_error_screenshot(&page, app, "login").await;
                return Err("Falha no login: o painel não respondeu.".to_string());
            }
        }
    } else {
        emit_log(app, "SUCESSO", "Logado com sucesso.");
    }

    Ok(page)
}

/// Scrape existing punch entries from the portal page
pub async fn sync_initial_points(
    page: &Page,
    app: &AppHandle,
) -> Result<Vec<String>, String> {
    emit_log(app, "INFO", "Sincronizando pontos iniciais...");

    // Wait a moment for the page to be ready
    sleep(Duration::from_millis(1000)).await;

    // Get today's date string in DD/MM format
    let today = chrono::Local::now();
    let today_str = today.format("%d/%m").to_string();

    // Execute JavaScript to scrape existing punch entries
    let js = format!(
        r#"
        (() => {{
            const statusSelector = '[id^="status-processamento-"]';
            const elements = document.querySelectorAll(statusSelector);
            const entries = [];

            elements.forEach(statusEl => {{
                const timeElement = statusEl.previousElementSibling;
                if (timeElement && timeElement.textContent) {{
                    const fullText = timeElement.textContent.trim();
                    const dateMatch = fullText.match(/\d{{2}}\/\d{{2}}/);
                    const timeMatch = fullText.match(/\d{{2}}:\d{{2}}/);
                    if (dateMatch && timeMatch) {{
                        entries.push({{ date: dateMatch[0], time: timeMatch[0] }});
                    }}
                }}
            }});

            // Filter for today only
            const todayStr = "{}";
            const todayPunches = entries
                .filter(e => e.date === todayStr)
                .map(e => e.time)
                .sort();

            return JSON.stringify(todayPunches);
        }})()
    "#,
        today_str
    );

    let result: String = page
        .evaluate(js.as_str())
        .await
        .map_err(|e| format!("Erro ao executar JS: {e}"))?
        .into_value()
        .map_err(|e| format!("Erro ao converter resultado: {e}"))?;

    let punches: Vec<String> =
        serde_json::from_str(&result).unwrap_or_default();

    emit_log(
        app,
        "INFO",
        &format!(
            "Pontos encontrados para HOJE ({}): {}",
            today_str,
            if punches.is_empty() {
                "Nenhum".to_string()
            } else {
                punches.join(", ")
            }
        ),
    );

    Ok(punches)
}

/// Perform a punch (click the button to register attendance)
pub async fn perform_punch(
    page: &Page,
    app: &AppHandle,
    punch_type: &str,
    punch_time: &str,
) -> Result<(), String> {
    emit_log(
        app,
        "INFO",
        &format!("Tentando registrar ponto: {punch_type} às {punch_time}"),
    );

    // Pre-check: verify the punch isn't already registered
    let pre_check = sync_initial_points(page, app).await?;
    if time_exists_with_tolerance(&pre_check, punch_time, 5) {
        emit_log(
            app,
            "AVISO",
            &format!(
                "Ponto {punch_type} às {punch_time} JÁ ESTÁ REGISTRADO. Pulando."
            ),
        );
        return Ok(());
    }

    // Click the punch button
    page.find_element("#localizacao-incluir-ponto")
        .await
        .map_err(|e| format!("Botão de ponto não encontrado: {e}"))?
        .click()
        .await
        .map_err(|e| format!("Erro ao clicar botão de ponto: {e}"))?;

    emit_log(app, "DEBUG", "Clique para registrar o ponto efetuado. Verificando...");

    // Verify with polling
    let max_retries = 10;
    let interval = Duration::from_secs(5);
    let previous_count = pre_check.len();

    for attempt in 1..=max_retries {
        emit_log(
            app,
            "DEBUG",
            &format!("Tentativa de verificação {attempt}/{max_retries}..."),
        );

        sleep(interval).await;

        let updated_points = sync_initial_points(page, app).await?;

        // Method 1: exact match (with tolerance)
        if time_exists_with_tolerance(&updated_points, punch_time, 5) {
            emit_log(
                app,
                "SUCESSO",
                &format!(
                    "Ponto {punch_type} ({punch_time}) registrado e VERIFICADO com sucesso."
                ),
            );
            return Ok(());
        }

        // Method 2: count increased with nearby time
        if updated_points.len() > previous_count {
            if time_exists_with_tolerance(&updated_points, punch_time, 5) {
                emit_log(
                    app,
                    "SUCESSO",
                    &format!(
                        "Ponto {punch_type} ({punch_time}) verificado por contagem + proximidade."
                    ),
                );
                return Ok(());
            }
        }
    }

    // Failed after all retries
    let _ = take_error_screenshot(page, app, &format!("punch_{punch_type}")).await;

    Err(format!(
        "Verificação pós-batida falhou para {punch_type} às {punch_time}."
    ))
}

/// Check if a time exists in the list with a tolerance of ±N minutes
fn time_exists_with_tolerance(times: &[String], target: &str, tolerance_minutes: i32) -> bool {
    let target_mins = match parse_time_minutes(target) {
        Some(m) => m,
        None => return false,
    };

    times.iter().any(|t| {
        if let Some(m) = parse_time_minutes(t) {
            (m - target_mins).abs() <= tolerance_minutes
        } else {
            false
        }
    })
}

pub fn parse_time_minutes(time_str: &str) -> Option<i32> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let hours: i32 = parts[0].parse().ok()?;
    let minutes: i32 = parts[1].parse().ok()?;
    Some(hours * 60 + minutes)
}

/// Take an error screenshot and save to app data directory
async fn take_error_screenshot(
    page: &Page,
    app: &AppHandle,
    context: &str,
) -> Result<PathBuf, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("error_{context}_{timestamp}.png");
    let screenshots_dir = app
        .path()
        .app_data_dir()
        .unwrap()
        .join("screenshots");

    let _ = std::fs::create_dir_all(&screenshots_dir);
    let screenshot_path = screenshots_dir.join(&filename);

    page.save_screenshot(
        chromiumoxide::page::ScreenshotParams::builder()
            .full_page(true)
            .build(),
        &screenshot_path,
    )
    .await
    .map_err(|e| format!("Erro ao tirar screenshot: {e}"))?;

    emit_log(
        app,
        "DEBUG",
        &format!("Screenshot salvo: {filename}"),
    );

    // Clean up old screenshots (>7 days)
    cleanup_old_screenshots(&screenshots_dir).await;

    Ok(screenshot_path)
}

/// Remove screenshots older than 7 days
async fn cleanup_old_screenshots(dir: &PathBuf) {
    let seven_days = Duration::from_secs(7 * 24 * 60 * 60);

    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(age) = modified.elapsed() {
                        if age > seven_days {
                            let _ = tokio::fs::remove_file(entry.path()).await;
                        }
                    }
                }
            }
        }
    }
}
