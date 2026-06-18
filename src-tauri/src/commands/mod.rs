pub mod settings;
pub mod credentials;
pub mod automation;
pub mod calendar;

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Valida a agenda semanal e retorna pendências por-dia (sem efeitos colaterais).
#[tauri::command]
pub fn validate_schedule(
    schedule: serde_json::Value,
    pre_assigned_interval: bool,
) -> crate::automation::validation::ValidationResult {
    crate::automation::validation::validate_schedule(&schedule, pre_assigned_interval)
}

/// Comando de teste seguro: apenas lê os pontos do dia, sem registrar nada.
#[tauri::command]
pub async fn test_sync_points(
    app: tauri::AppHandle,
    folha: String,
    senha: String,
) -> Result<Vec<String>, String> {
    use crate::automation::{browser, portal};
    use crate::utils::logging::emit_log;

    emit_log(&app, "INFO", "=== TESTE: Sincronização de pontos (somente leitura) ===");

    // 1. Garantir que Chromium está disponível
    let chromium_path = match browser::get_chromium_path(&app) {
        Some(path) => {
            emit_log(&app, "SUCESSO", &format!("Chromium encontrado: {}", path.display()));
            path
        }
        None => {
            emit_log(&app, "INFO", "Chromium não encontrado. Baixando...");
            browser::download_chromium(&app).await?
        }
    };

    // 2. Lançar browser (perfil persistente → reaproveita sessão se houver)
    emit_log(&app, "INFO", "Lançando navegador headless...");
    let profile = browser::profile_dir(&app);
    let (mut browser_instance, handler) = browser::launch_browser(chromium_path, profile).await?;
    emit_log(&app, "SUCESSO", "Navegador iniciado.");

    // 3. Login
    let result = async {
        let page = portal::login_to_portal(&browser_instance, &app, &folha, &senha).await?;

        // 4. Scrape pontos (SOMENTE LEITURA)
        let points = portal::sync_initial_points(&page, &app).await?;

        emit_log(&app, "SUCESSO", &format!(
            "=== TESTE CONCLUÍDO: {} ponto(s) encontrado(s) hoje ===",
            points.len()
        ));

        // 5. Fechar página
        let _ = page.close().await;

        Ok::<Vec<String>, String>(points)
    }.await;

    // 6. Fechar browser
    emit_log(&app, "INFO", "Fechando navegador...");
    let _ = browser_instance.close().await;
    handler.abort();

    result
}
