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
        .new_page(PORTAL_URL)
        .await
        .map_err(|e| format!("Erro ao navegar para o portal: {e}"))?;

    // Wait for the page to fully load
    sleep(Duration::from_secs(5)).await;

    // Fill login form using JavaScript (more reliable than type_str for SPAs)
    let fill_result: String = page
        .evaluate(format!(
            r#"
            (() => {{
                const folhaInput = document.querySelector('#login-numero-folha');
                const senhaInput = document.querySelector('#login-senha');
                const loginBtn = document.querySelector('#login-entrar');

                if (!folhaInput) return 'ERRO:Campo folha não encontrado';
                if (!senhaInput) return 'ERRO:Campo senha não encontrado';
                if (!loginBtn) return 'ERRO:Botão login não encontrado';

                // Set values using native input setter (works with React/Angular SPAs)
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;

                nativeInputValueSetter.call(folhaInput, '{folha}');
                folhaInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

                nativeInputValueSetter.call(senhaInput, '{senha}');
                senhaInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

                loginBtn.click();
                return 'OK';
            }})()
            "#
        ).as_str())
        .await
        .map_err(|e| format!("Erro ao executar JS de login: {e}"))?
        .into_value()
        .map_err(|e| format!("Erro ao converter resultado: {e}"))?;

    if fill_result.starts_with("ERRO:") {
        let _ = take_error_screenshot(&page, app, "login_fields").await;
        return Err(fill_result);
    }

    emit_log(app, "DEBUG", "Formulário preenchido, aguardando navegação...");

    // Wait for navigation after login
    sleep(Duration::from_secs(8)).await;

    // Try to click "Incluir Ponto" menu — poll for up to 15 seconds
    let mut menu_found = false;
    for attempt in 1..=5 {
        let click_result: String = page
            .evaluate(
                r#"
                (() => {
                    const menu = document.querySelector('#menu-incluir-ponto');
                    if (menu) {
                        menu.click();
                        return 'OK';
                    }
                    return 'NOT_FOUND';
                })()
                "#,
            )
            .await
            .map_err(|e| format!("Erro ao buscar menu: {e}"))?
            .into_value()
            .map_err(|e| format!("Erro ao converter: {e}"))?;

        if click_result == "OK" {
            menu_found = true;
            emit_log(app, "DEBUG", "Menu 'Incluir Ponto' clicado.");
            break;
        }

        emit_log(
            app,
            "DEBUG",
            &format!("Menu não encontrado, tentativa {attempt}/5..."),
        );
        sleep(Duration::from_secs(3)).await;
    }

    if !menu_found {
        let _ = take_error_screenshot(&page, app, "login_menu").await;
        return Err("Menu 'Incluir Ponto' não encontrado após login. Verifique credenciais.".to_string());
    }

    // Wait for the punch page to load
    sleep(Duration::from_secs(5)).await;

    // Verify we're on the correct page
    let page_check: String = page
        .evaluate(
            r#"
            (() => {
                const loc = document.querySelector('#localizacao-incluir-ponto');
                if (loc && loc.textContent.includes('Incluir Ponto')) return 'OK';
                // Fallback: check URL
                if (window.location.href.includes('incluir-ponto')) return 'OK';
                return 'FAIL:' + window.location.href;
            })()
            "#,
        )
        .await
        .map_err(|e| format!("Erro na verificação pós-login: {e}"))?
        .into_value()
        .map_err(|e| format!("Erro ao converter: {e}"))?;

    if page_check.starts_with("FAIL:") {
        let _ = take_error_screenshot(&page, app, "login_verify").await;
        return Err(format!(
            "Falha no login: página não é 'Incluir Ponto'. URL: {}",
            &page_check[5..]
        ));
    }

    emit_log(app, "SUCESSO", "Logado com sucesso.");
    Ok(page)
}

/// Scrape existing punch entries from the portal page
pub async fn sync_initial_points(
    page: &Page,
    app: &AppHandle,
) -> Result<Vec<String>, String> {
    emit_log(app, "INFO", "Sincronizando pontos iniciais...");

    let today = chrono::Local::now();
    let today_str = today.format("%d/%m").to_string();

    // Retry up to 3 times with increasing wait, because the SPA may load data async
    for attempt in 1..=3 {
        // Wait for data to render
        let wait_ms = match attempt {
            1 => 3000,
            2 => 5000,
            _ => 8000,
        };
        sleep(Duration::from_millis(wait_ms)).await;

        // First, debug: check what selectors exist on the page
        let debug_info: String = page
            .evaluate(
                r#"
                (() => {
                    const statusEls = document.querySelectorAll('[id^="status-processamento-"]');
                    const allTextEls = document.querySelectorAll('.registro-ponto, .ponto-item, [class*="ponto"], [class*="registro"]');

                    // Broader search: look for any element containing date/time patterns
                    const body = document.body ? document.body.innerText.substring(0, 2000) : 'NO BODY';

                    return JSON.stringify({
                        statusCount: statusEls.length,
                        classMatchCount: allTextEls.length,
                        bodyPreview: body.substring(0, 500),
                        url: window.location.href
                    });
                })()
                "#,
            )
            .await
            .map_err(|e| format!("Erro debug JS: {e}"))?
            .into_value()
            .map_err(|e| format!("Erro converter debug: {e}"))?;

        emit_log(app, "DEBUG", &format!("Tentativa {attempt} - DOM debug: {debug_info}"));

        // Try the original selector approach, handling both pt-BR (DD/MM 24h) and en-US (MM/DD 12h) formats
        let js = format!(
            r#"
            (() => {{
                const todayDD_MM = "{}";
                const parts = todayDD_MM.split('/');
                const todayMM_DD = parts[1] + '/' + parts[0]; // flip to MM/DD for en-US

                function parse12hTo24h(timeStr) {{
                    // Convert "7:52 AM" or "3:09 PM" to "07:52" or "15:09"
                    const match = timeStr.match(/(\d{{1,2}}):(\d{{2}})\s*(AM|PM)/i);
                    if (!match) return null;
                    let h = parseInt(match[1]);
                    const m = match[2];
                    const ampm = match[3].toUpperCase();
                    if (ampm === 'PM' && h !== 12) h += 12;
                    if (ampm === 'AM' && h === 12) h = 0;
                    return String(h).padStart(2, '0') + ':' + m;
                }}

                const entries = [];

                const statusEls = document.querySelectorAll('[id^="status-processamento-"]');
                statusEls.forEach(statusEl => {{
                    const timeElement = statusEl.previousElementSibling;
                    if (!timeElement || !timeElement.textContent) return;
                    const fullText = timeElement.textContent.trim();

                    // Try pt-BR format: "13/04 - 07:52"
                    const ptMatch = fullText.match(/(\d{{2}}\/\d{{2}})\s*-\s*(\d{{2}}:\d{{2}})/);
                    if (ptMatch) {{
                        entries.push({{ date: ptMatch[1], time: ptMatch[2], format: 'pt' }});
                        return;
                    }}

                    // Try en-US format: "04/13 - 7:52 AM"
                    const enMatch = fullText.match(/(\d{{2}}\/\d{{2}})\s*-\s*(\d{{1,2}}:\d{{2}}\s*[APap][Mm])/);
                    if (enMatch) {{
                        const converted = parse12hTo24h(enMatch[2]);
                        if (converted) {{
                            // Convert MM/DD to DD/MM
                            const mParts = enMatch[1].split('/');
                            const ddmm = mParts[1] + '/' + mParts[0];
                            entries.push({{ date: ddmm, time: converted, format: 'en' }});
                        }}
                        return;
                    }}
                }});

                const todayPunches = entries
                    .filter(e => e.date === todayDD_MM)
                    .map(e => e.time)
                    .sort();

                return JSON.stringify({{ found: todayPunches, totalEntries: entries.length }});
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

        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap_or_default();
        let punches: Vec<String> = parsed
            .get("found")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let total_entries = parsed.get("totalEntries").and_then(|v| v.as_i64()).unwrap_or(0);

        emit_log(
            app,
            "DEBUG",
            &format!("Tentativa {attempt}: {total_entries} entradas totais, {} de hoje", punches.len()),
        );

        if !punches.is_empty() || attempt == 3 {
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
            return Ok(punches);
        }

        emit_log(app, "DEBUG", &format!("Nenhum ponto encontrado na tentativa {attempt}, aguardando..."));
    }

    Ok(vec![])
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
            &format!("Ponto {punch_type} às {punch_time} JÁ ESTÁ REGISTRADO. Pulando."),
        );
        return Ok(());
    }

    // Click the punch button
    let click_result: String = page
        .evaluate(
            r#"
            (() => {
                const btn = document.querySelector('#localizacao-incluir-ponto');
                if (btn) { btn.click(); return 'OK'; }
                return 'NOT_FOUND';
            })()
            "#,
        )
        .await
        .map_err(|e| format!("Erro ao clicar botão de ponto: {e}"))?
        .into_value()
        .map_err(|e| format!("Erro: {e}"))?;

    if click_result != "OK" {
        return Err("Botão de ponto não encontrado na página.".to_string());
    }

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
                &format!("Ponto {punch_type} ({punch_time}) registrado e VERIFICADO com sucesso."),
            );
            return Ok(());
        }

        // Method 2: count increased
        if updated_points.len() > previous_count {
            emit_log(
                app,
                "SUCESSO",
                &format!("Ponto {punch_type} ({punch_time}) verificado por aumento na contagem."),
            );
            return Ok(());
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

    emit_log(app, "DEBUG", &format!("Screenshot salvo: {filename}"));

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
