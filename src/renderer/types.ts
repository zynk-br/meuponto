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
  NODE_INSTALL = "NODE_INSTALL",
  LOGIN = "LOGIN",
  APP_VIEW = "APP_VIEW",
}

export enum BrowserStatus {
  LOADING = "CARREGANDO",
  OK = "OK",
  MISSING = "AUSENTE", 
}

export enum NodeStatus {
  LOADING = "CARREGANDO",
  OK = "OK",
  OUTDATED = "DESATUALIZADO",
  MISSING = "AUSENTE",
}

export interface NodeNpmCheck {
  status: 'OK' | 'OUTDATED' | 'MISSING';
  nodeVersion: string | null;
  npmVersion: string | null;
  message: string;
}

export interface Settings {
  telegramChatId: string;
  showLogConsole: boolean;
  automationBrowserStatus: BrowserStatus;
  theme: 'light' | 'dark';
  saveLoginDetails: boolean;
  savedFolha: string;
  detailedLogs?: boolean;
}

export interface TimeEntry {
  entrada1: string;
  saida1: string;
  entrada2: string;
  saida2: string;
  feriado: boolean;
}

export type Schedule = Record<DayOfWeek, TimeEntry>;

export interface MonthlyDayEntry extends TimeEntry {
  date: string; // formato: "YYYY-MM-DD"
}

export type MonthlySchedule = Record<string, MonthlyDayEntry>; // key: "YYYY-MM-DD"

export enum DayOfWeek {
  MONDAY = "Segunda-feira",
  TUESDAY = "Terça-feira",
  WEDNESDAY = "Quarta-feira",
  THURSDAY = "Quinta-feira",
  FRIDAY = "Sexta-feira",
}

export enum AutomationMode {
  WEEKLY_MANUAL = "Semanal Manual",
  WEEKLY_AUTO = "Semanal Automático",
  MONTHLY_AUTO = "Mensal Automático",
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

  loadSchedule: () => Promise<Schedule | undefined>;
  saveSchedule: (schedule: Schedule) => void;

  getCredential: (account: string) => Promise<string | null>;
  setCredential: (account: string, password?: string) => void;
  deleteCredential: (account: string) => void;

  checkNodeNpm: () => Promise<NodeNpmCheck>;
  openNodeJSDownload: () => Promise<{success: boolean, message: string}>;
  
  getAppVersion: () => Promise<string>;
  
  checkAutomationBrowser: () => Promise<BrowserStatus>;
  getBrowserPath: () => Promise<string>;
  reinstallAutomationBrowser: () => void;
  onBrowserStatusUpdate: (callback: (status: BrowserStatus) => void) => () => void;

  startAutomation: (data: { schedule: Schedule, credentials: UserCredentials, settings: Settings }) => void;
  stopAutomation: () => void;

  exportCalendar: (schedule: Schedule) => Promise<{ success: boolean, path?: string, error?: string }>;

  onLogFromMain: (callback: (logEntry: {level: LogLevel, message: string}) => void) => () => void;
  onAutomationStatusUpdate: (callback: (statusUpdate: AutomationState) => void) => () => void;

  // Novas funções de atualização
  downloadUpdate: () => void;
  installUpdate: () => void;
  onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateProgress: (callback: (progress: { percent: number }) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
}

// Estendendo a interface Window global para TypeScript reconhecer window.electronAPI
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
