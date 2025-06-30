// Arquivo agora em: src/renderer/components/CustomTitleBar.tsx
import React from 'react';
import { APP_TITLE } from '../constants'; // Ajustado

const CustomTitleBar: React.FC = () => {
  const handleMinimize = () => {
    if (window.electronAPI && window.electronAPI.minimizeWindow) {
      window.electronAPI.minimizeWindow();
    } else {
      console.log("Minimize clicked (Electron API not available)");
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI && window.electronAPI.maximizeWindow) {
      window.electronAPI.maximizeWindow();
    } else {
      console.log("Maximize clicked (Electron API not available)");
    }
  };

  const handleClose = () => {
    if (window.electronAPI && window.electronAPI.closeWindow) {
      window.electronAPI.closeWindow();
    } else {
      console.log("Close clicked (Electron API not available)");
    }
  };

  // Adicionar classes para Electron drag regions (para Windows/Linux)
  // No macOS, a barra de título padrão com botões de semáforo pode ser preferível se não for totalmente customizada
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const titleBarClass = `h-8 bg-secondary-200 dark:bg-secondary-800 flex items-center justify-between px-2 select-none ${!isMac ? 'drag-region' : ''}`;


  return (
    <div className={titleBarClass}>
      <div className={`text-sm font-semibold text-secondary-700 dark:text-secondary-300 ${isMac ? 'pl-16' : ''}`}> {/* Padding para botões do macOS se não escondidos */}
        {APP_TITLE}
      </div>
      <div className={`flex space-x-2 ${!isMac ? 'no-drag-region' : ''}`}>
        <button onClick={handleMinimize} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-secondary-300 dark:hover:bg-secondary-700 focus:outline-none" aria-label="Minimizar">
          <i className="fas fa-window-minimize text-xs text-secondary-700 dark:text-secondary-300"></i>
        </button>
        <button onClick={handleMaximize} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-secondary-300 dark:hover:bg-secondary-700 focus:outline-none" aria-label="Maximizar/Restaurar">
          <i className="far fa-window-maximize text-xs text-secondary-700 dark:text-secondary-300"></i>
        </button>
        <button onClick={handleClose} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-500 dark:hover:bg-red-600 focus:outline-none" aria-label="Fechar">
          <i className="fas fa-times text-xs text-secondary-700 dark:text-secondary-300 hover:text-white"></i>
        </button>
      </div>
    </div>
  );
};

export default CustomTitleBar;
