// Arquivo agora em: src/renderer/views/LoadingView.tsx
import React, { useEffect, useState } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { View, LogLevel, BrowserStatus } from '../types'; // Ajustado

const LoadingView: React.FC = () => {
  const { setCurrentView, addLog, settings, updateSettings } = useAppContext();
  const [statusMessage, setStatusMessage] = useState("Iniciando aplicação...");
  const [detailedChecksDone, setDetailedChecksDone] = useState(false);

  useEffect(() => {
    addLog(LogLevel.INFO, "Aplicação Electron iniciando...");
    setStatusMessage("Carregando ambiente..."); // Simplified message for Vite context
    
    // With electron-vite, Node.js and Chromium for UI are guaranteed.
    // The main check is for the Playwright automation browser.
    if (window.electronAPI) {
      setStatusMessage("Verificando navegador de automação (Playwright)...");
      addLog(LogLevel.INFO, "Verificando status do navegador de automação (Playwright)...");
      
      if (settings.automationBrowserStatus === BrowserStatus.LOADING || settings.automationBrowserStatus === BrowserStatus.MISSING) {
         window.electronAPI.checkAutomationBrowser().then(status => {
            updateSettings({ automationBrowserStatus: status }, true);
            if (status === BrowserStatus.OK) {
              addLog(LogLevel.SUCCESS, "Navegador de automação (Playwright) verificado: OK.");
            } else {
              addLog(LogLevel.WARNING, `Navegador de automação (Playwright) verificado: ${status}. Requer atenção em Configurações.`);
            }
            setDetailedChecksDone(true);
        }).catch(err => {
            addLog(LogLevel.ERROR, `Erro ao verificar navegador de automação: ${err.message}`);
            updateSettings({ automationBrowserStatus: BrowserStatus.MISSING }, true);
            setDetailedChecksDone(true);
        });
      } else {
         addLog(LogLevel.INFO, `Status do navegador de automação (cache): ${settings.automationBrowserStatus}`);
         setDetailedChecksDone(true);
      }
    } else {
      addLog(LogLevel.WARNING, "Electron API não disponível (rodando em browser comum?). Pulando verificação do navegador de automação.");
      updateSettings({ automationBrowserStatus: BrowserStatus.MISSING }, false);
      setDetailedChecksDone(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  useEffect(() => {
    if (detailedChecksDone) {
      if (settings.automationBrowserStatus === BrowserStatus.MISSING) {
        setStatusMessage("Navegador de automação ausente. Verifique as configurações.");
      } else if (settings.automationBrowserStatus === BrowserStatus.LOADING){
        setStatusMessage("Verificando navegador de automação...");
      } else {
        setStatusMessage("Pré-requisitos atendidos. Carregando tela de login...");
      }
      
      const timer = setTimeout(() => {
        setCurrentView(View.LOGIN);
      }, 1500); // Shorter delay now

      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailedChecksDone, settings.automationBrowserStatus]);


  return (
    <div className="flex flex-col items-center justify-center h-full bg-secondary-100 dark:bg-secondary-900 p-8">
      <div className="text-center">
        <div className="mb-6">
          <i className={`fas fa-cogs fa-4x text-primary-500 dark:text-primary-400 ${settings.automationBrowserStatus === BrowserStatus.LOADING ? 'animate-spin-slow' : ''}`}></i>
        </div>
        <h1 className="text-2xl font-semibold text-secondary-800 dark:text-secondary-100 mb-3">Carregando Aplicação</h1>
        <p className="text-secondary-600 dark:text-secondary-400 min-h-[2em]">{statusMessage}</p>
        {settings.automationBrowserStatus === BrowserStatus.MISSING && detailedChecksDone && (
            <p className="mt-2 text-sm text-red-500 dark:text-red-400">
                <i className="fas fa-exclamation-triangle mr-1"></i>
                O navegador para automação (Playwright) não foi encontrado.
                Vá para Configurações para tentar instalá-lo.
            </p>
        )}
      </div>
    </div>
  );
};

export default LoadingView;
