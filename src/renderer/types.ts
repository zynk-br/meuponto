// Arquivo agora em: src/renderer/types.ts
export enum LogLevel {
  INFO = "INFO",
  SUCCESS = "SUCESSO",
  WARNING = "AVISO",
  ERROR = "ERRO",
  DEBUG = "DEBUG",
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export enum View {
  LOADING_PREREQUISITES = "LOADING_PREREQUISITES",
  NODE_MISSING = "NODE_MISSING", 
  LOGIN = "LOGIN",
  APP_VIEW = "APP_VIEW",
}

export enum BrowserStatus {
  LOADING = "CARREGANDO",
  OK = "OK",
  MISSING = "AUSENTE", 
}

export interface Settings {
  telegramToken: string;
  telegramChatId: string;
  showLogConsole: boolean;
  automationBrowserStatus: BrowserStatus;
  theme: 'light' | 'dark';
  saveLoginDetails: boolean;
  savedFolha: string;
}

export interface TimeEntry {
  entrada1: string;
  saida1: string;
  entrada2: string;
  saida2: string;
  feriado: boolean;
}

export type Schedule = Record<DayOfWeek, TimeEntry>;

export enum DayOfWeek {
  MONDAY = "Segunda-feira",
  TUESDAY = "Terça-feira",
  WEDNESDAY = "Quarta-feira",
  THURSDAY = "Quinta-feira",
  FRIDAY = "Sexta-feira",
}

export enum AutomationMode {
  MANUAL = "Manual",
  SEMI_AUTOMATIC = "Semi-automático",
}

export interface AutomationState {
  isRunning: boolean;
  statusMessage: string; 
  currentTask: string | null;
}

export interface UserCredentials {
  folha: string;
  senha?: string;
}

// Esta interface ElectronAPI é para o lado do Renderer (definindo o que ele espera do preload)
export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  
  loadSettings: () => Promise<Partial<Settings> | undefined>;
  saveSettings: (settings: Partial<Settings>) => void;

  getCredential: (account: string) => Promise<string | null>;
  setCredential: (account: string, password?: string) => void;
  deleteCredential: (account: string) => void;

  checkAutomationBrowser: () => Promise<BrowserStatus>;
  reinstallAutomationBrowser: () => void;
  onBrowserStatusUpdate: (callback: (status: BrowserStatus) => void) => () => void;

  startAutomation: (data: { schedule: Schedule, credentials: UserCredentials, settings: Settings }) => void;
  stopAutomation: () => void;

  onLogFromMain: (callback: (logEntry: {level: LogLevel, message: string}) => void) => () => void;
  onAutomationStatusUpdate: (callback: (statusUpdate: AutomationState) => void) => () => void;
}

// Estendendo a interface Window global para TypeScript reconhecer window.electronAPI
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
