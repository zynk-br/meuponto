// Arquivo agora em: src/renderer/views/NodeMissingView.tsx
import React from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { LogLevel } from '../types'; // Ajustado
// import { NODE_DOWNLOAD_URL, HOMEBREW_INSTALL_COMMAND, HOMEBREW_NODE_INSTALL_COMMAND } from '../constants'; // Ajustado - Unused imports removed

// Esta View é largamente obsoleta no contexto de um app Electron empacotado,
// pois o Node.js é parte do runtime do Electron.
// Pode ser útil se houver alguma verificação de versão específica do Node.js,
// mas a simples ausência do Node.js não deve ocorrer.
const NodeMissingView: React.FC = () => {
  const { addLog } = useAppContext();

  const handleRestartApp = () => {
    addLog(LogLevel.INFO, "Usuário instruído a reiniciar o app (NodeMissingView).");
    alert("Por favor, feche e reabra o aplicativo.");
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-yellow-50 dark:bg-yellow-900 p-8 text-secondary-800 dark:text-secondary-100">
      <div className="text-center max-w-2xl bg-white dark:bg-secondary-800 p-8 rounded-lg shadow-xl">
        <i className="fas fa-info-circle fa-3x text-yellow-500 dark:text-yellow-400 mb-6"></i>
        <h1 className="text-2xl font-bold mb-4">Aviso sobre Ambiente Node.js</h1>
        <p className="mb-6">
          Este aplicativo é executado utilizando o ambiente Node.js que vem embutido com o Electron.
          Se você está vendo esta tela, pode haver um problema inesperado com a configuração do Electron.
        </p>
        <p className="mb-6">
          Normalmente, você não precisaria instalar o Node.js separadamente para executar este aplicativo.
          Se os problemas persistirem, tente reinstalar o aplicativo ou contatar o suporte.
        </p>

        <div className="mt-8 p-4 bg-yellow-100 dark:bg-yellow-700 dark:text-yellow-50 border border-yellow-300 dark:border-yellow-600 rounded-md">
          <p>Se você é um desenvolvedor e está tentando rodar o código-fonte, certifique-se de que o Electron está instalado corretamente no projeto.</p>
        </div>

        <button
          onClick={handleRestartApp}
          className="mt-8 px-6 py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          Entendido
        </button>
      </div>
    </div>
  );
};

export default NodeMissingView;
