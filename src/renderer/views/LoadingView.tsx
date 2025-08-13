// Arquivo agora em: src/renderer/views/LoadingView.tsx
import React, { useEffect, useState } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { View, LogLevel, BrowserStatus, NodeNpmCheck } from '../types'; // Ajustado

const LoadingView: React.FC = () => {
  const { setCurrentView, addLog, settings, updateSettings } = useAppContext();
  const [statusMessage, setStatusMessage] = useState("Iniciando aplicação...");
  const [detailedChecksDone, setDetailedChecksDone] = useState(false);
  const [nodeCheckDone, setNodeCheckDone] = useState(false);
  const [nodeCheck, setNodeCheck] = useState<NodeNpmCheck | null>(null);

  useEffect(() => {
    addLog(LogLevel.INFO, "Aplicação Electron iniciando...");
    
    // Primeiro, verifica Node.js e NPM
    const checkNodeFirst = async () => {
      if (window.electronAPI) {
        setStatusMessage("Verificando Node.js e NPM...");
        addLog(LogLevel.INFO, "Verificando Node.js e NPM...");
        
        try {
          const nodeResult = await window.electronAPI.checkNodeNpm();
          setNodeCheck(nodeResult);
          
          if (nodeResult.status === 'MISSING') {
            addLog(LogLevel.ERROR, `Node.js/NPM ausente: ${nodeResult.message}`);
            setNodeCheckDone(true);
            return; // Para aqui se Node.js está ausente
          } else if (nodeResult.status === 'OUTDATED') {
            addLog(LogLevel.WARNING, `Node.js/NPM desatualizado: ${nodeResult.message}`);
          } else {
            addLog(LogLevel.SUCCESS, `Node.js/NPM verificado: ${nodeResult.message}`);
          }
          
          setNodeCheckDone(true);
          
          // Se Node.js está OK ou OUTDATED, continua com verificação do Playwright
          setStatusMessage("Verificando navegador de automação (Playwright)...");
          addLog(LogLevel.INFO, "Verificando status do navegador de automação (Playwright)...");
          
          if (settings.automationBrowserStatus === BrowserStatus.LOADING || settings.automationBrowserStatus === BrowserStatus.MISSING) {
             const status = await window.electronAPI.checkAutomationBrowser();
             updateSettings({ automationBrowserStatus: status }, true);
             if (status === BrowserStatus.OK) {
               addLog(LogLevel.SUCCESS, "Navegador de automação (Playwright) verificado: OK.");
             } else {
               addLog(LogLevel.WARNING, `Navegador de automação (Playwright) verificado: ${status}. Requer atenção em Configurações.`);
             }
             setDetailedChecksDone(true);
          } else {
             addLog(LogLevel.INFO, `Status do navegador de automação (cache): ${settings.automationBrowserStatus}`);
             setDetailedChecksDone(true);
          }
        } catch (err) {
          addLog(LogLevel.ERROR, `Erro na verificação inicial: ${err}`);
          // Define valores padrão em caso de erro
          setNodeCheck({
            status: 'MISSING',
            nodeVersion: null,
            npmVersion: null,
            message: 'Erro na verificação'
          });
          setNodeCheckDone(true);
          setDetailedChecksDone(true);
        }
      } else {
        addLog(LogLevel.WARNING, "Electron API não disponível (rodando em browser comum?). Pulando verificações.");
        setNodeCheck({
          status: 'MISSING',
          nodeVersion: null,
          npmVersion: null,
          message: 'Electron API não disponível'
        });
        updateSettings({ automationBrowserStatus: BrowserStatus.MISSING }, false);
        setNodeCheckDone(true);
        setDetailedChecksDone(true);
      }
    };
    
    checkNodeFirst();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  useEffect(() => {
    if (nodeCheckDone && (!nodeCheck || nodeCheck.status === 'MISSING')) {
      // Se Node.js está ausente, vai direto para tela de instalação
      setStatusMessage("Node.js ausente. Redirecionando para instalação...");
      const timer = setTimeout(() => {
        setCurrentView(View.NODE_INSTALL);
      }, 1500);
      return () => clearTimeout(timer);
    }
    
    if (detailedChecksDone && nodeCheckDone) {
      // Node.js OK ou OUTDATED - continua o fluxo normal
      if (nodeCheck && nodeCheck.status === 'OUTDATED') {
        setStatusMessage("Node.js desatualizado, mas continuando...");
      } else if (settings.automationBrowserStatus === BrowserStatus.MISSING) {
        setStatusMessage("Navegador de automação ausente. Verifique as configurações.");
      } else if (settings.automationBrowserStatus === BrowserStatus.LOADING){
        setStatusMessage("Verificando navegador de automação...");
      } else {
        setStatusMessage("Pré-requisitos atendidos. Carregando tela de login...");
      }
      
      const timer = setTimeout(() => {
        setCurrentView(View.LOGIN);
      }, 1500);

      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailedChecksDone, nodeCheckDone, nodeCheck, settings.automationBrowserStatus]);


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
