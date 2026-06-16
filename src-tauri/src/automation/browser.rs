use std::path::PathBuf;
use chromiumoxide::browser::{Browser, BrowserConfig};
use futures::StreamExt;
use reqwest;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;

/// Platform identifier for Chrome for Testing downloads
fn platform_id() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "mac-arm64"
        } else {
            "mac-x64"
        }
    } else if cfg!(target_os = "windows") {
        "win64"
    } else {
        "linux64"
    }
}

/// Returns the directory where Chromium is stored
fn chromium_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("chromium")
}

/// Returns the expected path to the Chromium executable
fn chromium_executable(base_dir: &PathBuf) -> PathBuf {
    if cfg!(target_os = "macos") {
        base_dir.join("chrome-headless-shell")
    } else if cfg!(target_os = "windows") {
        base_dir.join("chrome-headless-shell.exe")
    } else {
        base_dir.join("chrome-headless-shell")
    }
}

/// Get path to the Chromium executable, or None if not available
pub fn get_chromium_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = chromium_dir(app);
    let exe = chromium_executable(&dir);
    if exe.exists() {
        Some(exe)
    } else {
        None
    }
}

/// Download Chromium using the Chrome for Testing API
pub async fn download_chromium(app: &AppHandle) -> Result<PathBuf, String> {
    let platform = platform_id();
    let dir = chromium_dir(app);

    // Create directory if it doesn't exist
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Erro ao criar diretório: {e}"))?;

    emit_progress(app, 0.0, "Buscando versão mais recente do Chromium...");

    // Fetch the latest stable version from Chrome for Testing
    let client = reqwest::Client::new();
    let versions_url =
        "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

    let versions_resp: serde_json::Value = client
        .get(versions_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar versões: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear versões: {e}"))?;

    // Get the chrome-headless-shell download URL for our platform
    let download_url = versions_resp["channels"]["Stable"]["downloads"]["chrome-headless-shell"]
        .as_array()
        .and_then(|arr| {
            arr.iter().find(|entry| {
                entry["platform"].as_str() == Some(platform)
            })
        })
        .and_then(|entry| entry["url"].as_str())
        .ok_or_else(|| format!("Nenhum download disponível para plataforma: {platform}"))?
        .to_string();

    let version = versions_resp["channels"]["Stable"]["version"]
        .as_str()
        .unwrap_or("unknown");

    emit_progress(
        app,
        5.0,
        &format!("Baixando Chromium v{version} para {platform}..."),
    );

    // Download the zip file
    let zip_path = dir.join("chromium-download.zip");
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao iniciar download: {e}"))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file_bytes: Vec<u8> = Vec::with_capacity(total_size as usize);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Erro durante download: {e}"))?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);

        if total_size > 0 {
            let percent = 5.0 + (downloaded as f64 / total_size as f64) * 80.0;
            emit_progress(
                app,
                percent,
                &format!(
                    "Baixando... {:.1}MB / {:.1}MB",
                    downloaded as f64 / 1_048_576.0,
                    total_size as f64 / 1_048_576.0
                ),
            );
        }
    }

    fs::write(&zip_path, &file_bytes)
        .await
        .map_err(|e| format!("Erro ao salvar arquivo: {e}"))?;

    emit_progress(app, 88.0, "Extraindo Chromium...");

    // Extract the zip
    let dir_clone = dir.clone();
    let zip_path_clone = zip_path.clone();
    tokio::task::spawn_blocking(move || {
        extract_zip(&zip_path_clone, &dir_clone)
    })
    .await
    .map_err(|e| format!("Erro no task de extração: {e}"))?
    .map_err(|e| format!("Erro ao extrair: {e}"))?;

    // Clean up the zip
    let _ = fs::remove_file(&zip_path).await;

    emit_progress(app, 95.0, "Verificando instalação...");

    // Find the executable (it's inside a subdirectory)
    let exe = find_executable_in_dir(&dir).await?;

    emit_progress(app, 100.0, "Chromium instalado com sucesso!");

    Ok(exe)
}

/// Find the chrome-headless-shell executable in the extraction directory
async fn find_executable_in_dir(base_dir: &PathBuf) -> Result<PathBuf, String> {
    // After extraction, the executable is in a subdirectory like:
    // chromium/chrome-headless-shell-<platform>/chrome-headless-shell
    let mut entries = fs::read_dir(base_dir)
        .await
        .map_err(|e| format!("Erro ao ler diretório: {e}"))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("chrome-headless-shell") {
                // Look for the executable inside
                let exe_name = if cfg!(target_os = "windows") {
                    "chrome-headless-shell.exe"
                } else {
                    "chrome-headless-shell"
                };
                let exe_path = path.join(exe_name);
                if exe_path.exists() {
                    // Move it to the base dir for simpler access
                    let target = base_dir.join(exe_name);
                    if target != exe_path {
                        // Copy all files from subdirectory to base
                        copy_dir_contents(&path, base_dir).await?;
                    }
                    let final_exe = base_dir.join(exe_name);
                    // Make executable on Unix
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let perms = std::fs::Permissions::from_mode(0o755);
                        let _ = std::fs::set_permissions(&final_exe, perms);
                    }
                    return Ok(final_exe);
                }
            }
        }
    }

    // Fallback: check directly in the base directory
    let exe = chromium_executable(base_dir);
    if exe.exists() {
        return Ok(exe);
    }

    Err("Executável do Chromium não encontrado após extração".to_string())
}

/// Copy contents of a directory to another directory
async fn copy_dir_contents(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    let mut entries = fs::read_dir(src)
        .await
        .map_err(|e| format!("Erro ao ler diretório fonte: {e}"))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if src_path.is_file() {
            fs::copy(&src_path, &dst_path)
                .await
                .map_err(|e| format!("Erro ao copiar {}: {e}", file_name.to_string_lossy()))?;
        }
    }

    Ok(())
}

/// Extract a zip file to a directory
fn extract_zip(zip_path: &PathBuf, dest: &PathBuf) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Erro ao abrir zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Erro ao ler zip: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("Erro ao ler entrada {i}: {e}"))?;

        let outpath = dest.join(
            entry.enclosed_name()
                .ok_or_else(|| "Nome de arquivo inválido no zip".to_string())?
        );

        if entry.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("Erro ao criar diretório: {e}"))?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Erro ao criar diretório pai: {e}"))?;
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Erro ao criar arquivo: {e}"))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Erro ao extrair arquivo: {e}"))?;
        }
    }

    Ok(())
}

fn emit_progress(app: &AppHandle, percent: f64, message: &str) {
    let _ = app.emit(
        "chromium-download-progress",
        serde_json::json!({ "percent": percent, "message": message }),
    );
}

/// Launch a headless Chromium browser
pub async fn launch_browser(executable_path: PathBuf) -> Result<(Browser, tokio::task::JoinHandle<()>), String> {
    let config = BrowserConfig::builder()
        .chrome_executable(executable_path)
        .arg("--no-sandbox")
        .arg("--disable-setuid-sandbox")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--lang=pt-BR")
        .arg("--accept-lang=pt-BR")
        .build()
        .map_err(|e| format!("Erro na configuração do browser: {e}"))?;

    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("Erro ao lançar browser: {e}"))?;

    // Spawn the CDP event handler
    let handle = tokio::spawn(async move {
        while let Some(_event) = handler.next().await {
            // Process CDP events
        }
    });

    Ok((browser, handle))
}
