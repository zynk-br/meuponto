// Arquivo agora em: src/renderer/constants.ts
import { Settings, BrowserStatus, View, DayOfWeek, TimeEntry, Schedule, LogLevel, AutomationMode } from './types'; // Ajustado

export const INITIAL_SETTINGS: Settings = {
  telegramChatId: '',
  showLogConsole: true,
  automationBrowserStatus: BrowserStatus.LOADING, 
  theme: 'light',
  saveLoginDetails: false,
  savedFolha: '',
};

export const INITIAL_VIEW: View = View.LOADING_PREREQUISITES;

export const DAYS_OF_WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
];

export const EMPTY_TIME_ENTRY: TimeEntry = {
  entrada1: '',
  saida1: '',
  entrada2: '',
  saida2: '',
  feriado: false,
};

export const INITIAL_SCHEDULE: Schedule = DAYS_OF_WEEK.reduce((acc, day) => {
  acc[day] = { ...EMPTY_TIME_ENTRY };
  return acc;
}, {} as Schedule);

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.INFO]: "text-blue-500 dark:text-blue-400",
  [LogLevel.SUCCESS]: "text-green-500 dark:text-green-400",
  [LogLevel.WARNING]: "text-yellow-500 dark:text-yellow-400",
  [LogLevel.ERROR]: "text-red-500 dark:text-red-400",
  [LogLevel.DEBUG]: "text-gray-500 dark:text-gray-400",
};

export const INITIAL_AUTOMATION_MODE = AutomationMode.WEEKLY_MANUAL;

export const NODE_DOWNLOAD_URL = "https://nodejs.org/";
export const HOMEBREW_INSTALL_COMMAND = "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
export const HOMEBREW_NODE_INSTALL_COMMAND = "brew install node";

export const APP_TITLE = "Meu Ponto";
export const KEYTAR_ACCOUNT_PREFIX = "user_";
