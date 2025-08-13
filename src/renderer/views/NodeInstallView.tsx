import React, { useState, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext';
import { LogLevel, View, NodeNpmCheck } from '../types';

const NodeInstallView: React.FC = () => {
  const { addLog, setCurrentView } = useAppContext();
  const [nodeCheck, setNodeCheck] = useState<NodeNpmCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    checkNodeStatus();
  }, []);

  const checkNodeStatus = async () => {
    if (!window.electronAPI) {
      addLog(LogLevel.ERROR, "Electron API não disponível");
      return;
    }

    setIsChecking(true);
    try {
      const result = await window.electronAPI.checkNodeNpm();
      setNodeCheck(result);
      addLog(LogLevel.INFO, `Verificação Node.js/NPM: ${result.message}`);
    } catch (error) {
      addLog(LogLevel.ERROR, `Erro ao verificar Node.js/NPM: ${error}`);
    }
    setIsChecking(false);
  };

  const handleContinue = () => {
    addLog(LogLevel.INFO, "Usuário escolheu continuar mesmo com Node.js ausente/desatualizado");
    setCurrentView(View.LOGIN);
  };

  const handleRetryCheck = () => {
    checkNodeStatus();
  };

  const handleOpenDownloadPage = async () => {
    if (!window.electronAPI) {
      addLog(LogLevel.ERROR, "Electron API não disponível");
      return;
    }

    try {
      const result = await window.electronAPI.openNodeJSDownload();
      if (result.success) {
        addLog(LogLevel.SUCCESS, "Página de download do Node.js aberta no navegador");
      } else {
        addLog(LogLevel.ERROR, `Erro ao abrir página: ${result.message}`);
      }
    } catch (error) {
      addLog(LogLevel.ERROR, `Erro ao abrir download: ${error}`);
    }
  };

  const getInstructions = () => {
    const platform = navigator.platform.toLowerCase();
    
    if (platform.includes('win')) {
      return {
        title: 'Instalação no Windows',
        steps: [
          '1. Acesse https://nodejs.org/',
          '2. Baixe a versão LTS (recomendada)',
          '3. Execute o instalador baixado',
          '4. Siga o assistente de instalação',
          '5. Reinicie o computador após a instalação',
          '6. Clique em "Verificar Novamente" abaixo'
        ]
      };
    } else if (platform.includes('mac')) {
      return {
        title: 'Instalação no macOS',
        steps: [
          '1. Opção 1 - Site oficial:',
          '   • Acesse https://nodejs.org/',
          '   • Baixe a versão LTS (recomendada)',
          '   • Execute o instalador .pkg',
          '',
          '2. Opção 2 - Homebrew (se instalado):',
          '   • Abra o Terminal',
          '   • Execute: brew install node',
          '',
          '3. Após a instalação, clique em "Verificar Novamente"'
        ]
      };
    } else {
      return {
        title: 'Instalação no Linux',
        steps: [
          '1. Ubuntu/Debian:',
          '   • sudo apt update',
          '   • sudo apt install nodejs npm',
          '',
          '2. CentOS/RHEL/Fedora:',
          '   • sudo yum install nodejs npm',
          '   • (ou sudo dnf install nodejs npm)',
          '',
          '3. Arch Linux:',
          '   • sudo pacman -S nodejs npm',
          '',
          '4. Após a instalação, clique em "Verificar Novamente"'
        ]
      };
    }
  };

  const instructions = getInstructions();

  const getStatusIcon = () => {
    if (!nodeCheck || isChecking) {
      return <i className="fas fa-spinner fa-spin text-yellow-500"></i>;
    }
    
    switch (nodeCheck.status) {
      case 'OK':
        return <i className="fas fa-check-circle text-green-500"></i>;
      case 'OUTDATED':
        return <i className="fas fa-exclamation-triangle text-yellow-500"></i>;
      case 'MISSING':
        return <i className="fas fa-times-circle text-red-500"></i>;
      default:
        return <i className="fas fa-question-circle text-gray-400"></i>;
    }
  };

  const getStatusMessage = () => {
    if (isChecking) return "Verificando Node.js e NPM...";
    if (!nodeCheck) return "Carregando verificação...";
    return nodeCheck.message;
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-yellow-50 dark:bg-yellow-900 p-8 text-secondary-800 dark:text-secondary-100">
      <div className="text-center max-w-4xl bg-white dark:bg-secondary-800 p-8 rounded-lg shadow-xl">
        <div className="mb-6">
          {getStatusIcon()}
        </div>
        
        <h1 className="text-3xl font-bold mb-4">Node.js e NPM Necessários</h1>
        
        <div className="mb-6 p-4 bg-secondary-100 dark:bg-secondary-700 rounded-lg">
          <p className="text-lg font-semibold">Status atual:</p>
          <p className="text-secondary-600 dark:text-secondary-300">{getStatusMessage()}</p>
          {nodeCheck && nodeCheck.nodeVersion && (
            <div className="mt-2 text-sm">
              <p>Node.js: {nodeCheck.nodeVersion}</p>
              <p>NPM: {nodeCheck.npmVersion}</p>
            </div>
          )}
        </div>

        {(!nodeCheck || nodeCheck.status !== 'OK') && (
          <>
            <p className="mb-6 text-lg">
              Este aplicativo requer Node.js e NPM para funcionar corretamente. 
              Por favor, instale-os seguindo as instruções abaixo:
            </p>

            <div className="bg-secondary-50 dark:bg-secondary-700 p-6 rounded-lg mb-6 text-left">
              <h2 className="text-xl font-semibold mb-4">{instructions.title}</h2>
              <div className="space-y-2">
                {instructions.steps.map((step, index) => (
                  <div key={index} className={`${step === '' ? 'h-2' : ''}`}>
                    {step && (
                      <p className={`${step.startsWith('   ') ? 'ml-6 text-sm' : ''} ${step.startsWith('1.') || step.startsWith('2.') || step.startsWith('3.') ? 'font-semibold' : ''}`}>
                        {step}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {(!nodeCheck || nodeCheck.status !== 'OK') && (
            <button
              onClick={handleOpenDownloadPage}
              className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:bg-green-500 dark:hover:bg-green-600"
            >
              <i className="fas fa-download mr-2"></i>
              Baixar Node.js
            </button>
          )}
          
          <button
            onClick={handleRetryCheck}
            disabled={isChecking}
            className="px-6 py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50"
          >
            <i className={`fas ${isChecking ? 'fa-spinner fa-spin' : 'fa-sync-alt'} mr-2`}></i>
            Verificar Novamente
          </button>
          
          {nodeCheck?.status === 'OK' && (
            <button
              onClick={handleContinue}
              className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:bg-green-500 dark:hover:bg-green-600"
            >
              <i className="fas fa-arrow-right mr-2"></i>
              Continuar
            </button>
          )}
          
          {nodeCheck && nodeCheck.status !== 'OK' && (
            <button
              onClick={handleContinue}
              className="px-6 py-3 bg-yellow-600 text-white font-semibold rounded-lg hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 dark:bg-yellow-500 dark:hover:bg-yellow-600"
            >
              <i className="fas fa-exclamation-triangle mr-2"></i>
              Continuar Mesmo Assim
            </button>
          )}
        </div>

        {nodeCheck && nodeCheck.status !== 'OK' && (
          <div className="mt-4 p-4 bg-yellow-100 dark:bg-yellow-800 border border-yellow-300 dark:border-yellow-600 rounded-md">
            <p className="text-sm text-yellow-800 dark:text-yellow-100">
              <i className="fas fa-info-circle mr-2"></i>
              <strong>Aviso:</strong> Continuar sem Node.js/NPM atualizado pode causar problemas 
              na funcionalidade de automação do aplicativo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeInstallView;