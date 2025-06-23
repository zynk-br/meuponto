// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require('fs');
const Store = require("electron-store");
const DependencyManager = require('./dependency-manager.js'); // Importa o gerenciador de dependências

// Importa os novos módulos de lógica
const { initUpdater } = require('./modules/updater.js');
const { initIpcHandlers } = require('./modules/ipc-manager.js');
const { initAutomation, cancelAutomationHandler } = require('./modules/automation.js');
const initTelegram = require('./modules/telegram.js');

const store = new Store();
let mainWindow;

// Função para enviar logs para a UI
const logToUI = (message) => {
    if (mainWindow) {
        mainWindow.webContents.send("log-message", message);
    }
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 765,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    //mainWindow.webContents.openDevTools();

    mainWindow.webContents.on('did-finish-load', async () => {
        try {
            const nodePath = await DependencyManager.findNodeExecutable();
            if (!nodePath) {
                mainWindow.webContents.send('init-flow', { status: 'node-missing' });
                return;
            }

            const browserExists = fs.existsSync(DependencyManager.getBrowserExecutablePath(false));
            if (browserExists) {
                mainWindow.webContents.send('init-flow', { status: 'login' });
            } else {
                mainWindow.webContents.send('init-flow', { status: 'download' });
                const result = await DependencyManager.installBrowser(nodePath, logToUI);
                mainWindow.webContents.send('download-complete', result);
            }
        } catch (error) {
            logToUI(`[ERRO] Falha no fluxo de inicialização: ${error.message}`);
        }
    });

    mainWindow.loadFile("src/index.html");
}

const getMainWindow = () => mainWindow;

app.whenReady().then(() => {
    createWindow();

    // Primeiro, inicialize o módulo do telegram com o store
    const telegram = initTelegram(store);

    // Inicializa todos os módulos, passando as dependências necessárias
    initUpdater(logToUI);
    initIpcHandlers(store);
    initAutomation(ipcMain, store, logToUI, telegram.send, getMainWindow);

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Handlers do ciclo de vida do app
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
    cancelAutomationHandler(logToUI, getMainWindow); // Chama a função de limpeza do módulo de automação
});

// Handlers para os controles da janela customizada
ipcMain.on("minimize-window", () => mainWindow?.minimize());
ipcMain.on("maximize-window", () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});
ipcMain.on('close-window', () => app.quit());