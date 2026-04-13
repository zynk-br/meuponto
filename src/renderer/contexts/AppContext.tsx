import React, { createContext, useState, useCallback, useRef, ReactNode, useEffect } from 'react';
import { LogEntry, View, Settings, LogLevel, Schedule, AutomationMode, AutomationState, UserCredentials } from '../types';
import { INITIAL_SETTINGS, INITIAL_VIEW, INITIAL_SCHEDULE, INITIAL_AUTOMATION_MODE, MAX_LOG_ENTRIES } from '../constants';
import * as tauriAPI from '../hooks/useTauriAPI';

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
    setLogs(prevLogs => {
      const newLogs = [...prevLogs, { timestamp, level, message: `${logSource}${message}` }];
      // Cap logs at MAX_LOG_ENTRIES to prevent memory leaks
      if (newLogs.length > MAX_LOG_ENTRIES) {
        return newLogs.slice(newLogs.length - MAX_LOG_ENTRIES);
      }
      return newLogs;
    });
  }, []);

  const updateSettingsCallback = useCallback((newSettings: Partial<Settings>, saveToStore: boolean = true) => {
    setSettingsState(prev => {
      const updated = { ...prev, ...newSettings };
      if (saveToStore) {
        tauriAPI.saveSettings(updated).catch(err => {
          console.error('Erro ao salvar settings:', err);
        });
      }
      return updated;
    });
  }, []);

  // Initialization: load settings + schedule (run once, guarded by ref)
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;

    tauriAPI.loadSettings().then(storedSettings => {
      if (storedSettings) {
        addLogCallback(LogLevel.INFO, "Configurações carregadas do armazenamento.");
        const mergedSettings = { ...INITIAL_SETTINGS, ...storedSettings };
        setSettingsState(mergedSettings);
        setTheme(mergedSettings.theme);
      } else {
        addLogCallback(LogLevel.INFO, "Nenhuma configuração armazenada encontrada, usando padrões.");
        tauriAPI.saveSettings(INITIAL_SETTINGS).catch(console.error);
      }
    }).catch(err => {
      addLogCallback(LogLevel.ERROR, `Erro ao carregar settings: ${err}`);
    });

    tauriAPI.loadSchedule().then(storedSchedule => {
      if (storedSchedule) {
        addLogCallback(LogLevel.INFO, "Grade de horários carregada do armazenamento.");
        setSchedule(storedSchedule);
      }
    }).catch(err => {
      addLogCallback(LogLevel.ERROR, `Erro ao carregar schedule: ${err}`);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Event listeners: must properly cleanup on StrictMode remount
  useEffect(() => {
    let aborted = false;
    let unlistenLog: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;

    tauriAPI.onLogFromMain(({ level, message }) => {
      if (!aborted) addLogCallback(level, message, true);
    }).then(fn => {
      if (aborted) { fn(); } else { unlistenLog = fn; }
    });

    tauriAPI.onAutomationStatusUpdate((statusUpdate) => {
      if (!aborted) setAutomationStateInternal(prev => ({ ...prev, ...statusUpdate }));
    }).then(fn => {
      if (aborted) { fn(); } else { unlistenStatus = fn; }
    });

    return () => {
      aborted = true;
      unlistenLog?.();
      unlistenStatus?.();
    };
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
      updateSettingsCallback({ theme: newTheme });
      return newTheme;
    });
  }, [updateSettingsCallback]);

  const updateScheduleEntryCallback = useCallback((day: keyof Schedule, entry: Partial<typeof INITIAL_SCHEDULE[keyof Schedule]>) => {
    setSchedule(prevSchedule => {
      const updatedSchedule = {
        ...prevSchedule,
        [day]: { ...prevSchedule[day], ...entry },
      };
      tauriAPI.saveSchedule(updatedSchedule).catch(console.error);
      return updatedSchedule;
    });
  }, []);

  const updateFullScheduleCallback = useCallback((newSchedule: Schedule) => {
    setSchedule(newSchedule);
    tauriAPI.saveSchedule(newSchedule).catch(console.error);
  }, []);

  const clearScheduleCallback = useCallback(() => {
    setSchedule(INITIAL_SCHEDULE);
    addLogCallback(LogLevel.INFO, "Grade de horários limpa.");
  }, [addLogCallback]);

  const setAutomationStateCallback = useCallback((stateUpdate: Partial<AutomationState>) => {
    setAutomationStateInternal(prevState => ({ ...prevState, ...stateUpdate }));
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
