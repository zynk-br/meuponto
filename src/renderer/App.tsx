// Arquivo agora em: src/renderer/App.tsx
import React from 'react';
import { AppProvider } from './contexts/AppContext'; // Ajustado
import { useAppContext } from './hooks/useAppContext'; // Ajustado

//import CustomTitleBar from './components/CustomTitleBar'; // Ajustado
import Header from './components/Header'; // Ajustado
import LogConsole from './components/LogConsole'; // Ajustado
import SettingsModal from './components/SettingsModal'; // Ajustado
import TelegramTutorialModal from './components/TelegramTutorialModal'; // Ajustado

import LoadingView from './views/LoadingView'; // Ajustado
import NodeMissingView from './views/NodeMissingView'; // Ajustado
import LoginView from './views/LoginView'; // Ajustado
import AppView from './views/AppView'; // Ajustado

import { View } from './types'; // Ajustado


const ViewRenderer: React.FC = () => {
  const { currentView } = useAppContext();

  switch (currentView) {
    case View.LOADING_PREREQUISITES:
      return <LoadingView />;
    case View.NODE_MISSING:
      return <NodeMissingView />; // This view might become obsolete or less critical with electron-vite
    case View.LOGIN:
      return <LoginView />;
    case View.APP_VIEW:
      return <AppView />;
    default:
      return <div className="p-4">Visualização desconhecida. Por favor, reinicie o app.</div>;
  }
};

const AppContent: React.FC = () => {
  const { settings } = useAppContext();
  
  return (
    <div className={`flex flex-col h-screen overflow-hidden ${settings.theme}`}>
      {/* <CustomTitleBar /> */}
      <Header />
      <main className="flex-grow flex flex-col overflow-hidden bg-gradient-to-br from-primary-500 to-primary-700 dark:from-primary-700 dark:to-primary-900">
        <ViewRenderer />
      </main>
      <LogConsole isVisible={settings.showLogConsole} />
      <SettingsModal />
      <TelegramTutorialModal />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;
