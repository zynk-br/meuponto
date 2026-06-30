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

    // JSON-encode credentials antes de embutir no JS: gera literais de string
    // devidamente escapados, evitando injeção e quebra de login quando a senha
    // contém aspas/barras/caracteres especiais.
    let folha_js = serde_json::to_string(folha).unwrap_or_else(|_| "\"\"".to_string());
    let senha_js = serde_json::to_string(senha).unwrap_or_else(|_| "\"\"".to_string());

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

                nativeInputValueSetter.call(folhaInput, {folha_js});
                folhaInput.dispatchEvent(new Event('input', {{ bubbles: true }}));

                nativeInputValueSetter.call(senhaInput, {senha_js});
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
        // Campos de login ausentes: quase sempre porque já existe uma sessão
        // ativa (cookies de um ciclo anterior) e o portal já caiu na área
        // logada. NÃO falha aqui — segue para o menu/verificação. Se de fato
        // não estiver logado, o page_check no final acusa o erro.
        emit_log(
            app,
            "DEBUG",
            &format!("Formulário de login ausente ({fill_result}); assumindo sessão ativa e seguindo..."),
        );
    } else {
        emit_log(app, "DEBUG", "Formulário preenchido, aguardando navegação...");
        // Wait for navigation after login
        sleep(Duration::from_secs(8)).await;
    }

    // Try to click "Incluir Ponto" menu — poll for up to 15 seconds.
    // Se já estivermos na página (sessão ativa), o menu é opcional.
    for attempt in 1..=5 {
        let click_result: String = page
            .evaluate(
                r#"
                (() => {
                    const menu = document.querySelector('#menu-incluir-ponto');
                    if (menu) { menu.click(); return 'OK'; }
                    // Já está na página de Incluir Ponto?
                    const loc = document.querySelector('#localizacao-incluir-ponto');
                    if (loc || window.location.href.includes('incluir-ponto')) return 'ALREADY';
                    return 'NOT_FOUND';
                })()
                "#,
            )
            .await
            .map_err(|e| format!("Erro ao buscar menu: {e}"))?
            .into_value()
            .map_err(|e| format!("Erro ao converter: {e}"))?;

        if click_result == "OK" {
            emit_log(app, "DEBUG", "Menu 'Incluir Ponto' clicado.");
            break;
        }
        if click_result == "ALREADY" {
            emit_log(app, "DEBUG", "Já na página de Incluir Ponto (sessão ativa).");
            break;
        }

        emit_log(
            app,
            "DEBUG",
            &format!("Menu não encontrado, tentativa {attempt}/5..."),
        );
        sleep(Duration::from_secs(3)).await;
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

/// Reaproveita uma página já aberta: re-navega para a tela de Incluir Ponto
/// SEM reenviar credenciais. Enquanto a sessão do portal continua válida
/// (cookies do navegador persistente), isto é bem mais rápido que um login
/// completo — não há formulário, redirecionamento de auth nem espera longa.
///
/// Retorna `Ok(true)` = sessão ativa e tela pronta; `Ok(false)` = sessão
/// expirou (caller deve refazer login limpo); `Err` = portal indisponível.
pub async fn reuse_session(page: &Page, app: &AppHandle) -> Result<bool, String> {
    emit_log(app, "INFO", "Reaproveitando sessão ativa (sem novo login)...");

    page.goto(PORTAL_URL)
        .await
        .map_err(|e| format!("Erro ao re-navegar para o portal: {e}"))?;

    // A SPA precisa de um instante para reidratar a partir dos cookies.
    sleep(Duration::from_secs(3)).await;

    // Detecta o estado atual: formulário de login (expirou), menu (logado, a
    // clicar) ou já na tela de Incluir Ponto.
    let state: String = page
        .evaluate(
            r#"
            (() => {
                if (document.querySelector('#login-numero-folha')) return 'LOGIN';
                const menu = document.querySelector('#menu-incluir-ponto');
                if (menu) { menu.click(); return 'MENU'; }
                const loc = document.querySelector('#localizacao-incluir-ponto');
                if (loc || window.location.href.includes('incluir-ponto')) return 'READY';
                return 'UNKNOWN';
            })()
            "#,
        )
        .await
        .map_err(|e| format!("Erro ao verificar estado da sessão: {e}"))?
        .into_value()
        .map_err(|e| format!("Erro ao converter estado: {e}"))?;

    match state.as_str() {
        // Caiu no formulário de login → a sessão expirou.
        "LOGIN" => {
            emit_log(app, "INFO", "Sessão do portal expirou — refazendo login.");
            Ok(false)
        }
        // Logado: ou clicamos no menu, ou já estávamos na tela. Confirma.
        "MENU" | "READY" => {
            sleep(Duration::from_secs(3)).await;
            let check: String = page
                .evaluate(
                    r#"
                    (() => {
                        const loc = document.querySelector('#localizacao-incluir-ponto');
                        if (loc && loc.textContent.includes('Incluir Ponto')) return 'OK';
                        if (window.location.href.includes('incluir-ponto')) return 'OK';
                        return 'FAIL';
                    })()
                    "#,
                )
                .await
                .map_err(|e| format!("Erro na verificação da sessão: {e}"))?
                .into_value()
                .map_err(|e| format!("Erro ao converter verificação: {e}"))?;
            if check == "OK" {
                emit_log(app, "SUCESSO", "Sessão ativa reaproveitada (login pulado).");
                Ok(true)
            } else {
                // Logado mas em tela inesperada → força login limpo por segurança.
                emit_log(app, "DEBUG", "Sessão ativa mas tela inesperada; forçando novo login.");
                Ok(false)
            }
        }
        // Estado desconhecido (página em transição / layout estranho): por
        // segurança, trata como expirada e refaz o login.
        _ => {
            emit_log(
                app,
                "DEBUG",
                &format!("Estado de sessão desconhecido ({state}); forçando novo login."),
            );
            Ok(false)
        }
    }
}

/// Faz uma única varredura do DOM e retorna os horários de HOJE já registrados
/// (sem espera/retry). Reutilizado pelo sync (com retry) e pelo re-check rápido.
async fn scrape_today_points(page: &Page, today_str: &str) -> Result<Vec<String>, String> {
    let js = format!(
        r#"
        (() => {{
            const todayDD_MM = "{}";

            function parse12hTo24h(timeStr) {{
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

                const ptMatch = fullText.match(/(\d{{2}}\/\d{{2}})\s*-\s*(\d{{2}}:\d{{2}})/);
                if (ptMatch) {{ entries.push({{ date: ptMatch[1], time: ptMatch[2] }}); return; }}

                const enMatch = fullText.match(/(\d{{2}}\/\d{{2}})\s*-\s*(\d{{1,2}}:\d{{2}}\s*[APap][Mm])/);
                if (enMatch) {{
                    const converted = parse12hTo24h(enMatch[2]);
                    if (converted) {{
                        const mParts = enMatch[1].split('/');
                        entries.push({{ date: mParts[1] + '/' + mParts[0], time: converted }});
                    }}
                    return;
                }}
            }});

            const todayPunches = entries.filter(e => e.date === todayDD_MM).map(e => e.time).sort();
            return JSON.stringify({{ found: todayPunches }});
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
    Ok(parsed
        .get("found")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default())
}

/// Varredura RÁPIDA usada imediatamente antes de clicar, para detectar uma
/// batida recém-feita (ex.: manual pelo usuário) sem pagar o retry completo do
/// sync. Faz até 2 passadas curtas (a SPA pode levar alguns segundos para
/// renderizar) e retorna os horários de hoje ([] em erro). Para assim que
/// encontra `target`.
async fn quick_scrape_points(page: &Page, target: &str) -> Vec<String> {
    let today_str = chrono::Local::now().format("%d/%m").to_string();
    let mut last: Vec<String> = Vec::new();
    for wait_ms in [2000u64, 2500] {
        sleep(Duration::from_millis(wait_ms)).await;
        if let Ok(pts) = scrape_today_points(page, &today_str).await {
            if time_exists_with_tolerance(&pts, target, 5) {
                return pts;
            }
            last = pts;
        }
    }
    last
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

        let punches = scrape_today_points(page, &today_str).await?;

        emit_log(
            app,
            "DEBUG",
            &format!("Tentativa {attempt}: {} ponto(s) de hoje", punches.len()),
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
    known_points: Option<&[String]>,
) -> Result<(), String> {
    emit_log(
        app,
        "INFO",
        &format!("Tentando registrar ponto: {punch_type} às {punch_time}"),
    );

    // Skip rápido: se os pontos já conhecidos (sync do heartbeat) mostram a
    // batida registrada, nem sincroniza de novo.
    if let Some(k) = known_points {
        if time_exists_with_tolerance(k, punch_time, 5) {
            emit_log(
                app,
                "AVISO",
                &format!("Ponto {punch_type} às {punch_time} JÁ ESTÁ REGISTRADO. Pulando."),
            );
            return Ok(());
        }
    }

    // Re-check RÁPIDO imediatamente antes de clicar. Crucial: pega uma batida
    // MANUAL recém-feita pelo usuário que ainda não estava no sync do heartbeat
    // (a janela de corrida que fazia o app registrar a entrada1 em duplicidade).
    // Nunca confiamos só no `known` para decidir clicar.
    let pre_check = quick_scrape_points(page, punch_time).await;
    if time_exists_with_tolerance(&pre_check, punch_time, 5) {
        emit_log(
            app,
            "AVISO",
            &format!("Ponto {punch_type} às {punch_time} já consta no portal (verificação imediata). Pulando."),
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

/// Take an error screenshot and save to app data directory.
/// Público para o scheduler poder capturar a tela e anexar no Telegram.
pub async fn take_error_screenshot(
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
