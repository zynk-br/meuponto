// ALTERADO: Adicionar as novas funções da API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Funções da janela
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),

    // Funções de login
    getLogin: () => ipcRenderer.invoke('get-login'),
    setLogin: (credentials) => ipcRenderer.invoke('set-login', credentials),

    // NOVO: Funções de horários
    getSchedules: () => ipcRenderer.invoke('get-schedules'),
    setSchedules: (schedules) => ipcRenderer.invoke('set-schedules', schedules),

    // Funções de automação
    startAutomation: (data) => ipcRenderer.invoke('start-automation', data),
    cancelAutomation: () => ipcRenderer.send('cancel-automation'),
    onLogMessage: (callback) => ipcRenderer.on('log-message', (event, ...args) => callback(...args)),

    // NOVO: Handlers de configuração do Telegram
    getTelegramSettings: () => ipcRenderer.invoke('get-telegram-settings'),
    setTelegramSettings: (settings) => ipcRenderer.invoke('set-telegram-settings', settings),

    // NOVO: Handlers de Versão
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
});