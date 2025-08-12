// Arquivo agora em: src/renderer/contexts/AppContext.tsx
import React, { createContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { LogEntry, View, Settings, LogLevel, Schedule, AutomationMode, AutomationState, UserCredentials } from '../types'; // Ajustado
import { INITIAL_SETTINGS, INITIAL_VIEW, INITIAL_SCHEDULE, INITIAL_AUTOMATION_MODE } from '../constants'; // Ajustado

interface AppContextType {
  currentView: View;
  setCurrentView: (view: View) => void;
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>, saveToStore?: boolean) => void;
  logs: LogEntry[];
  addLog: (level: LogLevel, message: string, fromMain?: boolean) => void;
  clearLogs: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  schedule: Schedule;
  updateScheduleEntry: (day: keyof Schedule, entry: Partial<typeof INITIAL_SCHEDULE[keyof Schedule]>) => void;
  updateFullSchedule: (newSchedule: Schedule) => void;
  clearSchedule: () => void;
  automationMode: AutomationMode;
  setAutomationMode: (mode: AutomationMode) => void;
  automationState: AutomationState;
  setAutomationState: (state: Partial<AutomationState>) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (isOpen: boolean) => void;
  isTelegramTutorialModalOpen: boolean;
  setIsTelegramTutorialModalOpen: (isOpen: boolean) => void;
  currentUserCredentials: UserCredentials | null;
  setCurrentUserCredentials: (credentials: UserCredentials | null) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [currentView, setCurrentView] = useState<View>(INITIAL_VIEW);
  const [settings, setSettingsState] = useState<Settings>(INITIAL_SETTINGS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(INITIAL_SETTINGS.theme);
  const [schedule, setSchedule] = useState<Schedule>(INITIAL_SCHEDULE);
  const [automationMode, setAutomationMode] = useState<AutomationMode>(INITIAL_AUTOMATION_MODE);
  const [automationState, setAutomationStateInternal] = useState<AutomationState>({
    isRunning: false,
    statusMessage: "Ocioso",
    currentTask: null,
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTelegramTutorialModalOpen, setIsTelegramTutorialModalOpen] = useState(false);
  const [currentUserCredentials, setCurrentUserCredentials] = useState<UserCredentials | null>(null);


  const addLogCallback = useCallback((level: LogLevel, message: string, fromMain: boolean = false) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const logSource = fromMain ? "[MAIN] " : "";
    setLogs(prevLogs => [...prevLogs, { timestamp, level, message: `${logSource}${message}` }]);
  }, []);

  const updateSettingsCallback = useCallback((newSettings: Partial<Settings>, saveToStore: boolean = true) => {
    setSettingsState(prev => {
      const updated = { ...prev, ...newSettings };
      if (saveToStore && window.electronAPI) {
        window.electronAPI.saveSettings(updated);
      }
      return updated;
    });
  }, [addLogCallback]);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.loadSettings().then(storedSettings => {
        if (storedSettings) {
          addLogCallback(LogLevel.INFO, "Configurações carregadas do armazenamento.");
          const mergedSettings = {...INITIAL_SETTINGS, ...storedSettings};
          setSettingsState(mergedSettings);
          setTheme(mergedSettings.theme);
        } else {
          addLogCallback(LogLevel.INFO, "Nenhuma configuração armazenada encontrada, usando padrões.");
          window.electronAPI.saveSettings(INITIAL_SETTINGS);
        }
      });

      const removeLogListener = window.electronAPI.onLogFromMain(({level, message}) => {
        addLogCallback(level, message, true);
      });
      
      const removeStatusListener = window.electronAPI.onAutomationStatusUpdate((statusUpdate) => {
        setAutomationStateInternal(prev => ({...prev, ...statusUpdate}));
      });

      const removeBrowserStatusListener = window.electronAPI.onBrowserStatusUpdate((status) => {
        addLogCallback(LogLevel.INFO, `Status do navegador de automação atualizado para: ${status}`);
        updateSettingsCallback({ automationBrowserStatus: status }, true);
      });

      return () => {
        removeLogListener();
        removeStatusListener();
        removeBrowserStatusListener();
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLogCallback]);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);
  
  const clearLogsCallback = useCallback(() => {
    setLogs([]);
    addLogCallback(LogLevel.INFO, "Logs limpos.");
  }, [addLogCallback]);

  const toggleThemeCallback = useCallback(() => {
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      updateSettingsCallback({theme: newTheme});
      return newTheme;
    });
  }, [updateSettingsCallback]);

  const updateScheduleEntryCallback = useCallback((day: keyof Schedule, entry: Partial<typeof INITIAL_SCHEDULE[keyof Schedule]>) => {
    setSchedule(prevSchedule => ({
      ...prevSchedule,
      [day]: { ...prevSchedule[day], ...entry },
    }));
  }, []);

  const updateFullScheduleCallback = useCallback((newSchedule: Schedule) => {
    setSchedule(newSchedule);
  }, []);
  
  const clearScheduleCallback = useCallback(() => {
    setSchedule(INITIAL_SCHEDULE);
    addLogCallback(LogLevel.INFO, "Grade de horários limpa.");
  }, [addLogCallback]);

  const setAutomationStateCallback = useCallback((stateUpdate: Partial<AutomationState>) => {
    setAutomationStateInternal(prevState => ({...prevState, ...stateUpdate}));
  }, []);


  return (
    <AppContext.Provider value={{
      currentView,
      setCurrentView,
      settings,
      updateSettings: updateSettingsCallback,
      logs,
      addLog: addLogCallback,
      clearLogs: clearLogsCallback,
      theme,
      toggleTheme: toggleThemeCallback,
      schedule,
      updateScheduleEntry: updateScheduleEntryCallback,
      updateFullSchedule: updateFullScheduleCallback,
      clearSchedule: clearScheduleCallback,
      automationMode,
      setAutomationMode,
      automationState,
      setAutomationState: setAutomationStateCallback,
      isSettingsModalOpen,
      setIsSettingsModalOpen,
      isTelegramTutorialModalOpen,
      setIsTelegramTutorialModalOpen,
      currentUserCredentials,
      setCurrentUserCredentials,
    }}>
      {children}
    </AppContext.Provider>
  );
};
