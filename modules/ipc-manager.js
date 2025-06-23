// modules/ipc-manager.js
const { ipcMain, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const DependencyManager = require('../dependency-manager.js');

function initIpcHandlers(store) {
    // Handlers para salvar e carregar dados do 'electron-store'
    ipcMain.handle("get-login", () => store.get("credentials"));
    ipcMain.handle("set-login", (event, credentials) => store.set("credentials", credentials));

    ipcMain.handle("get-schedules", () => store.get("schedules"));
    ipcMain.handle("set-schedules", (event, schedules) => store.set("schedules", schedules));

    ipcMain.handle("get-telegram-settings", () => store.get("telegramSettings"));
    ipcMain.handle("set-telegram-settings", (event, settings) => store.set("telegramSettings", settings));

    ipcMain.handle("check-browser", () => {
        try {
            const executablePath = DependencyManager.getBrowserExecutablePath(false); // Passa 'false' para não lançar erro
            return fs.existsSync(executablePath);
        } catch (error) {
            console.error("Erro ao verificar o status do navegador via IPC:", error);
            return false;
        }
    });

    // Handler para obter informações estáticas do App
    ipcMain.handle("get-app-info", () => {
        const appVersion = app.getVersion();
        try {
            const packageJsonPath = path.join(app.getAppPath(), 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const repoInfo = packageJson.build.publish;
            const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
            return { version: appVersion, repoUrl };
        } catch (error) {
            console.error("Falha ao ler o package.json em produção:", error);
            return { version: appVersion, repoUrl: '' };
        }
    });

    // Handler para abrir links no navegador padrão do sistema
    ipcMain.on("open-external-link", (event, url) => {
        shell.openExternal(url);
    });

}

module.exports = { initIpcHandlers };