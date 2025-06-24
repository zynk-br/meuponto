// modules/updater.js

const { app } = require('electron');
const { updateElectronApp } = require('update-electron-app');

/**
 * Inicializa o processo de auto-update usando o sistema integrado do Electron Forge.
 * @param {function(string): void} logCallback - A função para enviar logs para a UI.
 */
function initUpdater(logCallback) {
    logCallback('[INFO] Serviço de atualização iniciado.');

    // Chama a função principal do updater do Forge.
    updateElectronApp({
        // O repositório é pego automaticamente do package.json agora.
        
        // CORREÇÃO: Adicionar o método .log ao logger
        logger: {
            log(text)   { logCallback(`[UPDATE-LOG] ${text}`); }, // <-- ADICIONE ESTA LINHA
            info(text)  { logCallback(`[UPDATE-INFO] ${text}`); },
            warn(text)  { logCallback(`[UPDATE-WARN] ${text}`); }
        },
        
        notifyUser: false
    });
    
    const { autoUpdater } = require('electron');

    autoUpdater.on('checking-for-update', () => {
        logCallback('[INFO] Verificando por atualizações...');
    });

    autoUpdater.on('update-available', () => {
        logCallback('[INFO] Nova atualização encontrada. O download começará em segundo plano.');
    });

    autoUpdater.on('update-not-available', () => {
        logCallback('[INFO] Você já está na versão mais recente.');
    });

    autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
        logCallback(`[SUCESSO] Atualização v${releaseName} baixada. Ela será instalada na próxima reinicialização.`);
    });

    autoUpdater.on('error', (error) => {
        logCallback(`[ERRO] Erro no serviço de atualização: ${error.message}`);
    });
}

module.exports = {
  initUpdater
};