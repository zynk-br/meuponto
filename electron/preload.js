// Arquivo agora em: electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),

  // Schedule
  loadSchedule: () => ipcRenderer.invoke('load-schedule'),
  saveSchedule: (schedule) => ipcRenderer.send('save-schedule', schedule),

  // Credentials (Keytar)
  getCredential: (account) => ipcRenderer.invoke('get-credential', account),
  setCredential: (account, password) => ipcRenderer.send('set-credential', { account, password }),
  deleteCredential: (account) => ipcRenderer.send('delete-credential', account),

  // Node.js and NPM verification
  checkNodeNpm: () => ipcRenderer.invoke('check-node-npm'),
  openNodeJSDownload: () => ipcRenderer.invoke('open-nodejs-download'),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Automation Browser (Playwright) Management
  checkAutomationBrowser: () => ipcRenderer.invoke('check-automation-browser'),
  getBrowserPath: () => ipcRenderer.invoke('get-browser-path'),
  reinstallAutomationBrowser: () => ipcRenderer.send('reinstall-automation-browser'),
  onBrowserStatusUpdate: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update-browser-status-from-main', handler);
    return () => {
      ipcRenderer.removeListener('update-browser-status-from-main', handler);
    };
  },


  // Automation Control
  startAutomation: (data) => ipcRenderer.send('start-automation', data), // data: { schedule, credentials, settings }
  stopAutomation: () => ipcRenderer.send('stop-automation'),

  // Listeners for Main Process Events
  onLogFromMain: (callback) => {
    const handler = (_event, logEntry) => callback(logEntry);
    ipcRenderer.on('log-from-main', handler);
    return () => {
      ipcRenderer.removeListener('log-from-main', handler);
    };
  },
  onAutomationStatusUpdate: (callback) => {
    const handler = (_event, statusUpdate) => callback(statusUpdate);
    ipcRenderer.on('automation-status-update', handler);
    return () => {
      ipcRenderer.removeListener('automation-status-update', handler);
    };
  },

  // ===============================================
  // NOVOS MÉTODOS E LISTENERS DE ATUALIZAÇÃO
  // ===============================================
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),

  onUpdateAvailable: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (event, progress) => callback(progress);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  }
});
