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

  // Credentials (Keytar)
  getCredential: (account) => ipcRenderer.invoke('get-credential', account),
  setCredential: (account, password) => ipcRenderer.send('set-credential', { account, password }),
  deleteCredential: (account) => ipcRenderer.send('delete-credential', account),

  // Automation Browser (Playwright) Management
  checkAutomationBrowser: () => ipcRenderer.invoke('check-automation-browser'),
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
});
