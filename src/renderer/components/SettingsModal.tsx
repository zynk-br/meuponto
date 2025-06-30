// Arquivo agora em: src/renderer/components/SettingsModal.tsx
import React, { useState, useEffect } from 'react';
import Modal from './Modal'; // Ajustado
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { BrowserStatus, LogLevel } from '../types'; // Ajustado

const SettingsModal: React.FC = () => {
  const {
    settings,
    updateSettings,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    setIsTelegramTutorialModalOpen,
    addLog
  } = useAppContext();

  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    if (isSettingsModalOpen) {
      setLocalSettings(settings);
    }
  }, [isSettingsModalOpen, settings]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
        const { checked } = e.target as HTMLInputElement;
        setLocalSettings(prev => ({ ...prev, [name]: checked }));
    } else {
        setLocalSettings(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSave = () => {
    // Agora sim, enviamos o estado local para o contexto global para ser salvo.
    updateSettings(localSettings);
    addLog(LogLevel.INFO, "Configurações atualizadas com sucesso.");
    setIsSettingsModalOpen(false); // Fecha o modal
  };

  const handleCancel = () => {
    // Simplesmente fecha o modal. O useEffect cuidará de resetar o estado local na próxima vez.
    setIsSettingsModalOpen(false);
  };

  const handleReinstallBrowser = () => {
    addLog(LogLevel.INFO, "Solicitando reinstalação do navegador de automação (Playwright)...");
    if (window.electronAPI) {
        updateSettings({ automationBrowserStatus: BrowserStatus.LOADING }, true);
        window.electronAPI.reinstallAutomationBrowser();
    } else {
        addLog(LogLevel.ERROR, "Electron API não disponível para reinstalar o navegador.");
         updateSettings({ automationBrowserStatus: BrowserStatus.MISSING }, true);
    }
  };
  
  const getBrowserStatusIcon = () => {
    switch (settings.automationBrowserStatus) {
      case BrowserStatus.LOADING:
        return <i className="fas fa-spinner fa-spin text-yellow-500"></i>;
      case BrowserStatus.OK:
        return <i className="fas fa-check-circle text-green-500"></i>;
      case BrowserStatus.MISSING:
        return <i className="fas fa-times-circle text-red-500"></i>;
      default:
        return <i className="fas fa-question-circle text-gray-400"></i>;
    }
  };


  return (
    <Modal
      isOpen={isSettingsModalOpen}
      onClose={handleCancel}
      title="Configurações"
      size="lg"
      footer={
        <div className="flex justify-end space-x-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium bg-secondary-200 text-secondary-800 hover:bg-secondary-300 dark:bg-secondary-700 dark:text-secondary-200 dark:hover:bg-secondary-600 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary-500"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            Salvar
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Telegram Settings */}
        <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-primary-600 dark:text-primary-400">Notificações do Telegram</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="telegramToken" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
                Token do Bot
              </label>
              <input
                type="password"
                name="telegramToken"
                id="telegramToken"
                value={localSettings.telegramToken}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Seu token do BotFather"
              />
            </div>
            <div>
              <label htmlFor="telegramChatId" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
                Chat ID do Usuário
              </label>
              <input
                type="text"
                name="telegramChatId"
                id="telegramChatId"
                value={localSettings.telegramChatId}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="Seu ID de chat do Telegram"
              />
            </div>
            <button
              onClick={() => setIsTelegramTutorialModalOpen(true)}
              className="text-sm text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200 flex items-center"
            >
              <i className="fas fa-question-circle mr-2"></i> Como obter o Token e Chat ID?
            </button>
          </div>
        </div>

        {/* Interface Settings */}
        <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-primary-600 dark:text-primary-400">Interface</h3>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Exibir console de logs</span>
            <label htmlFor="showLogConsoleToggle" className="inline-flex relative items-center cursor-pointer">
              <input
                type="checkbox"
                name="showLogConsole"
                id="showLogConsoleToggle"
                className="sr-only peer"
                checked={settings.showLogConsole}
                onChange={handleInputChange}
              />
              <div className="w-11 h-6 bg-secondary-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-secondary-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-secondary-600 peer-checked:bg-primary-600"></div>
            </label>
          </div>
        </div>

        {/* Components Settings (Automation Browser) */}
        <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-primary-600 dark:text-primary-400">Navegador de Automação (Playwright)</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Status:</span>
              <div className="flex items-center space-x-2 text-sm text-secondary-700 dark:text-secondary-300">
                {getBrowserStatusIcon()}
                <span>{settings.automationBrowserStatus}</span>
              </div>
            </div>
            {settings.automationBrowserStatus === BrowserStatus.MISSING && (
               <p className="text-xs text-red-600 dark:text-red-400">O navegador de automação parece estar ausente ou corrompido. Tente reinstalá-lo.</p>
            )}
             {settings.automationBrowserStatus === BrowserStatus.LOADING && (
               <p className="text-xs text-yellow-600 dark:text-yellow-400">O navegador de automação está sendo verificado/instalado...</p>
            )}
            <button
              onClick={handleReinstallBrowser}
              disabled={settings.automationBrowserStatus === BrowserStatus.LOADING}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50"
            >
             <i className="fas fa-sync-alt mr-2"></i> 
             {settings.automationBrowserStatus === BrowserStatus.MISSING ? "Instalar Navegador" : "Reinstalar/Verificar Navegador"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default SettingsModal;
