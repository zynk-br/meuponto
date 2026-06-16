import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  Settings,
  Schedule,
  LogLevel,
  AutomationState,
  UserCredentials,
} from '../types';

// ---- Settings ----

export async function loadSettings(): Promise<Partial<Settings> | undefined> {
  const result = await invoke<Partial<Settings> | null>('load_settings');
  return result ?? undefined;
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await invoke('save_settings', { settings });
}

// ---- Schedule ----

export async function loadSchedule(): Promise<Schedule | undefined> {
  const result = await invoke<Schedule | null>('load_schedule');
  return result ?? undefined;
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
  await invoke('save_schedule', { schedule });
}

// ---- Credentials ----

export async function getCredential(account: string): Promise<string | null> {
  return invoke<string | null>('get_credential', { account });
}

export async function setCredential(account: string, password: string): Promise<void> {
  await invoke('set_credential', { account, password });
}

export async function deleteCredential(account: string): Promise<void> {
  await invoke('delete_credential', { account });
}

// ---- App Info ----

export async function getAppVersion(): Promise<string> {
  return invoke<string>('get_app_version');
}

// ---- Automation ----

export async function startAutomation(data: {
  schedule: Schedule;
  credentials: UserCredentials;
  settings: Settings;
  dryRun?: boolean;
  simulateFailure?: string;
}): Promise<void> {
  await invoke('start_automation', { data });
}

export async function stopAutomation(): Promise<void> {
  await invoke('stop_automation');
}

// ---- Calendar ----

export async function exportCalendar(
  schedule: Schedule
): Promise<{ success: boolean; path?: string; error?: string }> {
  return invoke('export_calendar', { schedule });
}

// ---- Test (somente leitura) ----

export async function testSyncPoints(
  folha: string,
  senha: string
): Promise<string[]> {
  return invoke<string[]>('test_sync_points', { folha, senha });
}

// ---- Update (stub — Fase 9) ----

export async function downloadUpdate(): Promise<void> {
  // TODO: Fase 9 — usar @tauri-apps/plugin-updater
}

export async function installUpdate(): Promise<void> {
  // TODO: Fase 9 — usar @tauri-apps/plugin-updater
}

// ---- Event Listeners ----

export async function onLogFromMain(
  callback: (entry: { level: LogLevel; message: string }) => void
): Promise<UnlistenFn> {
  return listen<{ level: string; message: string }>('log', (event) => {
    callback({ level: event.payload.level as LogLevel, message: event.payload.message });
  });
}

export async function onAutomationStatusUpdate(
  callback: (status: AutomationState) => void
): Promise<UnlistenFn> {
  return listen<AutomationState>('automation-status', (event) => {
    callback(event.payload);
  });
}

export async function onUpdateAvailable(
  callback: (info: { version: string }) => void
): Promise<UnlistenFn> {
  return listen<{ version: string }>('update-available', (event) => {
    callback(event.payload);
  });
}

export async function onUpdateProgress(
  callback: (progress: { percent: number }) => void
): Promise<UnlistenFn> {
  return listen<{ percent: number }>('update-progress', (event) => {
    callback(event.payload);
  });
}

export async function onUpdateDownloaded(
  callback: () => void
): Promise<UnlistenFn> {
  return listen('update-downloaded', () => {
    callback();
  });
}
