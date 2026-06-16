import React from 'react';
import { AppProvider } from './contexts/AppContext';
import { useAppContext } from './hooks/useAppContext';

import Header from './components/Header';
import Footer from './components/Footer';
import LogConsole from './components/LogConsole';
import SettingsModal from './components/SettingsModal';
import HistoryModal from './components/HistoryModal';
import TelegramTutorialModal from './components/TelegramTutorialModal';
import UpdateNotification from './components/UpdateNotification';

import LoadingView from './views/LoadingView';
import LoginView from './views/LoginView';
import AppView from './views/AppView';

import { View } from './types';


const ViewRenderer: React.FC = () => {
  const { currentView } = useAppContext();

  switch (currentView) {
    case View.LOADING:
      return <LoadingView />;
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
      <Header />
      <main className="flex-grow flex flex-col overflow-hidden bg-gradient-to-br from-primary-500 to-primary-700 dark:from-primary-700 dark:to-primary-900">
        <ViewRenderer />
      </main>
      <LogConsole isVisible={settings.showLogConsole} />
      <Footer />
      <SettingsModal />
      <HistoryModal />
      <TelegramTutorialModal />
      <UpdateNotification />
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
