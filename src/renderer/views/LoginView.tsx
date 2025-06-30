// Arquivo agora em: src/renderer/views/LoginView.tsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { View, LogLevel } from '../types'; // Ajustado
import { APP_TITLE, KEYTAR_ACCOUNT_PREFIX } from '../constants'; // Ajustado

const LoginView: React.FC = () => {
  const { setCurrentView, addLog, settings, updateSettings, setCurrentUserCredentials } = useAppContext();
  const [folha, setFolha] = useState('');
  const [senha, setSenha] = useState('');
  const [salvarLoginDetails, setSalvarLoginDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings.saveLoginDetails && settings.savedFolha) {
      setFolha(settings.savedFolha);
      setSalvarLoginDetails(true);
      // addLog(LogLevel.DEBUG, "Preferência de login carregada."); // Evitar addLog em useEffect sem deps corretas
      if (window.electronAPI) {
        window.electronAPI.getCredential(`${KEYTAR_ACCOUNT_PREFIX}${settings.savedFolha}`).then(savedPassword => {
          if (savedPassword) {
            setSenha(savedPassword);
            // addLog(LogLevel.DEBUG, "Senha carregada do armazenamento seguro.");
          }
        });
      }
    }
  }, [settings.saveLoginDetails, settings.savedFolha]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    addLog(LogLevel.INFO, `Tentativa de login para folha: ${folha}. Salvar login: ${salvarLoginDetails}`);

    if (!window.electronAPI) {
        setError("Electron API não está disponível. Não é possível fazer login.");
        addLog(LogLevel.ERROR, "Electron API não disponível para login.");
        setIsLoading(false);
        return;
    }

    // A automação real de login acontecerá no processo principal via Playwright
    // Aqui, apenas validamos e passamos para a próxima view.
    // A simulação de MOCK_LOGIN_SUCCESS pode ser removida ou simplificada
    // se o objetivo for apenas coletar as credenciais para o main process.
    // Para este exemplo, manteremos uma validação básica para simular o fluxo.
    if (!folha || !senha) {
        setError("Número da folha e senha são obrigatórios.");
        addLog(LogLevel.WARNING, "Tentativa de login com campos vazios.");
        setIsLoading(false);
        return;
    }

    // A "validação" real do login agora será a tentativa de automação.
    // Para este ponto, consideramos que as credenciais são válidas para prosseguir.
    addLog(LogLevel.SUCCESS, `Credenciais coletadas para folha: ${folha}.`);
    setCurrentUserCredentials({folha, senha}); // Armazena no contexto para AppView usar

    updateSettings({ saveLoginDetails: salvarLoginDetails, savedFolha: salvarLoginDetails ? folha : '' });

    if (salvarLoginDetails) {
      await window.electronAPI.setCredential(`${KEYTAR_ACCOUNT_PREFIX}${folha}`, senha);
      addLog(LogLevel.INFO, "Preferência de salvar credenciais ativada. Enviando para armazenamento seguro.");
    } else {
      if (settings.savedFolha === folha) { // Se estava salvo para este usuário
         await window.electronAPI.deleteCredential(`${KEYTAR_ACCOUNT_PREFIX}${folha}`);
         addLog(LogLevel.INFO, `Credenciais para ${folha} removidas do armazenamento seguro pois "Salvar login" foi desmarcado.`);
      }
    }
    
    // Sucesso - avançar para a próxima tela
    // A verdadeira validação do login ocorrerá quando a automação tentar usar as credenciais.
    // Se falhar lá, o usuário será notificado pelos logs e status da automação.
    setCurrentView(View.APP_VIEW);
    setIsLoading(false);
  };
  
  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-secondary-800 shadow-2xl rounded-xl p-8 space-y-6 transform transition-all duration-500 ease-in-out">
        <div className="text-center">
          <i className="fas fa-fingerprint fa-3x text-primary-600 dark:text-primary-400 mb-4"></i>
          <h1 className="text-3xl font-bold text-secondary-900 dark:text-secondary-100">{APP_TITLE}</h1>
          <p className="text-secondary-600 dark:text-secondary-400 mt-1">Acesse para automatizar seu ponto.</p>
        </div>

        {error && (
          <div className="bg-red-100 dark:bg-red-700 border-l-4 border-red-500 dark:border-red-300 text-red-700 dark:text-red-200 p-4 rounded-md" role="alert">
            <p className="font-bold">Atenção</p>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="folha" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
              Número da Folha
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <i className="fas fa-id-card text-secondary-400"></i>
              </div>
              <input
                id="folha"
                name="folha"
                type="text"
                required
                value={folha}
                onChange={(e) => setFolha(e.target.value)}
                className="appearance-none block w-full px-3 py-3 pl-10 border border-secondary-300 dark:border-secondary-600 rounded-md placeholder-secondary-400 dark:placeholder-secondary-500 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-secondary-700 text-secondary-900 dark:text-secondary-100"
                placeholder="Seu número da folha"
              />
            </div>
          </div>

          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
              Senha
            </label>
             <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <i className="fas fa-lock text-secondary-400"></i>
              </div>
              <input
                id="senha"
                name="senha"
                type="password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="appearance-none block w-full px-3 py-3 pl-10 border border-secondary-300 dark:border-secondary-600 rounded-md placeholder-secondary-400 dark:placeholder-secondary-500 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm bg-white dark:bg-secondary-700 text-secondary-900 dark:text-secondary-100"
                placeholder="Sua senha"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="salvarLoginDetails"
                name="salvarLoginDetails"
                type="checkbox"
                checked={salvarLoginDetails}
                onChange={(e) => setSalvarLoginDetails(e.target.checked)}
                className="h-4 w-4 text-primary-600 dark:text-primary-500 focus:ring-primary-500 dark:focus:ring-offset-secondary-800 border-secondary-300 dark:border-secondary-600 rounded bg-secondary-50 dark:bg-secondary-700"
              />
              <label htmlFor="salvarLoginDetails" className="ml-2 block text-sm text-secondary-900 dark:text-secondary-200">
                Lembrar detalhes do login
              </label>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-primary-500 dark:hover:bg-primary-600 dark:focus:ring-offset-secondary-800 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Acessando...
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt mr-2 self-center"></i>
                  Entrar
                </>
              )}
            </button>
          </div>
        </form>
        <p className="text-xs text-center text-secondary-500 dark:text-secondary-400">
          Suas credenciais são usadas apenas para login no portal do funcionário e podem ser salvas localmente de forma segura se você optar.
        </p>
      </div>
    </div>
  );
};

export default LoginView;
