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
  LOADING = "LOADING",
  LOGIN = "LOGIN",
  APP_VIEW = "APP_VIEW",
}

export enum BrowserStatus {
  LOADING = "CARREGANDO",
  OK = "OK",
  MISSING = "AUSENTE",
}

export interface Settings {
  telegramChatId: string;
  telegramBotToken: string;
  showLogConsole: boolean;
  theme: 'light' | 'dark';
  saveLoginDetails: boolean;
  savedFolha: string;
  detailedLogs?: boolean;
  autoRegenerateSchedules?: boolean;
  preAssignedIntervalConfig?: Record<string, boolean>;
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
