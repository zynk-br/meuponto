import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAppContext } from '../hooks/useAppContext';
import { LogLevel, View } from '../types';

const SettingsModal: React.FC = () => {
  const {
    settings,
    updateSettings,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    setIsTelegramTutorialModalOpen,
    addLog,
    setCurrentView,
    setCurrentUserCredentials
  } = useAppContext();

  const [localSettings, setLocalSettings] = useState(settings);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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
    updateSettings(localSettings);
    addLog(LogLevel.INFO, "Configurações atualizadas com sucesso.");
    setIsSettingsModalOpen(false);
  };

  const handleCancel = () => {
    setIsSettingsModalOpen(false);
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    addLog(LogLevel.INFO, "Usuário fez logout - voltando à tela de login.");
    setCurrentUserCredentials(null);
    setCurrentView(View.LOGIN);
    setIsSettingsModalOpen(false);
    setShowLogoutConfirm(false);
  };

  return (
    <>
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
                <label htmlFor="telegramBotToken" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
                  Bot Token
                </label>
                <input
                  type="password"
                  name="telegramBotToken"
                  id="telegramBotToken"
                  value={localSettings.telegramBotToken || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full px-3 py-2 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  placeholder="Token do seu bot Telegram"
                />
                <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
                  Crie um bot via @BotFather no Telegram para obter o token.
                </p>
              </div>
              <div>
                <label htmlFor="telegramChatId" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
                  Chat ID do Usuário
                </label>
                <input
                  type="text"
                  name="telegramChatId"
                  id="telegramChatId"
                  value={localSettings.telegramChatId || ''}
                  onChange={handleInputChange}
                  className="mt-1 block w-full px-3 py-2 bg-white dark:bg-secondary-700 border border-secondary-300 dark:border-secondary-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  placeholder="Seu ID de chat do Telegram"
                />
              </div>
              <button
                onClick={() => setIsTelegramTutorialModalOpen(true)}
                className="text-sm text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200 flex items-center"
              >
                <i className="fas fa-question-circle mr-2"></i> Como obter o Chat ID?
              </button>
            </div>
          </div>

          {/* Interface Settings */}
          <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
            <h3 className="text-lg font-semibold mb-3 text-primary-600 dark:text-primary-400">Interface</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Exibir console de logs</span>
                <label htmlFor="showLogConsoleToggle" className="inline-flex relative items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="showLogConsole"
                    id="showLogConsoleToggle"
                    className="sr-only peer"
                    checked={localSettings.showLogConsole}
                    onChange={handleInputChange}
                  />
                  <div className="w-11 h-6 bg-secondary-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-secondary-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-secondary-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Logs detalhados</span>
                  <p className="text-xs text-secondary-500 dark:text-secondary-400">Exibe informações técnicas avançadas nos logs</p>
                </div>
                <label htmlFor="detailedLogsToggle" className="inline-flex relative items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="detailedLogs"
                    id="detailedLogsToggle"
                    className="sr-only peer"
                    checked={localSettings.detailedLogs || false}
                    onChange={handleInputChange}
                  />
                  <div className="w-11 h-6 bg-secondary-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-secondary-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-secondary-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Logout Section */}
          <div className="p-4 border border-red-200 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20">
            <h3 className="text-lg font-semibold mb-3 text-red-600 dark:text-red-400">Sessão</h3>
            <div className="space-y-3">
              <p className="text-sm text-secondary-700 dark:text-secondary-300">
                Clique no botão abaixo para sair da sessão atual e voltar à tela de login.
              </p>
              <button
                onClick={handleLogout}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:bg-red-500 dark:hover:bg-red-600"
              >
                <i className="fas fa-sign-out-alt mr-2"></i>
                Sair / Fazer Logout
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Confirmar Logout"
        message="Tem certeza que deseja sair e voltar à tela de login?"
        confirmText="Sair"
        cancelText="Cancelar"
        variant="danger"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
};

export default SettingsModal;
