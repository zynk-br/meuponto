// updater.js

const { autoUpdater } = require("electron-updater");

/**
 * Inicializa o processo de auto-update do Electron.
 * @param {function(string): void} logCallback - A função a ser chamada para enviar logs para a UI.
 */
function initUpdater(logCallback) {
    logCallback('[INFO] Verificando atualizações...');
    
    // Configura o autoUpdater para baixar automaticamente
    autoUpdater.autoDownload = true;
    
    // Inicia a verificação por atualizações
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on("update-available", (info) => {
        logCallback(`[INFO] Nova atualização disponível (v${info.version}). Baixando em segundo plano...`);
    });

    autoUpdater.on("update-not-available", () => {
        logCallback('[INFO] Você já está na versão mais recente.');
    });

    autoUpdater.on("update-downloaded", () => {
        logCallback(
            "[SUCESSO] Atualização baixada. Ela será instalada na próxima vez que o aplicativo for reiniciado."
        );
    });

    autoUpdater.on("error", (err) => {
        logCallback(`[ERRO] Erro no auto-updater: ${err.message || 'Erro desconhecido'}`);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = `Baixando atualização: ${progressObj.percent.toFixed(2)}%`;
        log_message = log_message + ` (${progressObj.transferred}/${progressObj.total})`;
        logCallback(`[INFO] ${log_message}`);
    });
}

module.exports = {
  initUpdater
};