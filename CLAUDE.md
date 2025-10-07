# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Meu Ponto" is an Electron desktop application that automates time clock punching on centraldofuncionario.com.br. Built with Electron, Vite, React, TypeScript, and Tailwind CSS.

## Common Commands

### Development
```bash
npm run dev          # Start dev server with HMR (Vite + Electron)
yarn dev             # Alternative using yarn
```

### Building
```bash
npm run build              # Build for all platforms (Windows, macOS, Linux)
npm run build:win          # Build for Windows (publishes to GitHub)
npm run build:mac          # Build for macOS (publishes to GitHub)
npm run build:win-local    # Build for Windows (local only)
npm run build:mac-local    # Build for macOS (local only)
```

Build process: `electron-vite build` compiles to `out/` directory, then `electron-builder` packages to `release/` directory.

### Installation
```bash
npm install    # Also runs postinstall hook: electron-builder install-app-deps
```

## Architecture

### Process Architecture (Electron)
- **Main Process** (`electron/main.js`): ~1750 lines handling automation, browser management, IPC, updates
- **Preload Script** (`electron/preload.js`): Context bridge exposing IPC APIs to renderer via `window.electronAPI`
- **Renderer Process** (`src/renderer/`): React UI with state management

### Key Components

#### Main Process (`electron/main.js`)
- **Automation Engine**: Uses Playwright (Chromium) for browser automation
- **Browser Management**: Installs/manages Playwright browsers in `userData/playwright-browsers`
- **Credential Storage**: Uses `keytar` for secure password storage in system keychain
- **Settings Storage**: Uses `electron-store` for app settings
- **Auto-Updates**: Uses `electron-updater` with GitHub as provider
- **Telegram Integration**: Sends notifications via bot token (hardcoded in main.js:18)
- **IPC Handlers**: 20+ handlers for renderer communication (settings, credentials, automation control)

#### Renderer Process Architecture (`src/renderer/`)
- **State Management**: Context API via `AppContext.tsx` - centralized state for settings, logs, schedule, automation state
- **View System**: Enum-based view routing (`types.ts:View`)
  - `LOADING_PREREQUISITES`: Initial load, checks Node.js/browser
  - `NODE_MISSING`/`NODE_INSTALL`: Node.js installation flow
  - `LOGIN`: User authentication (folha/senha)
  - `APP_VIEW`: Main automation interface
- **Components**: Header, Footer, LogConsole, SettingsModal, TelegramTutorialModal, UpdateNotification, CustomTitleBar
- **Hooks**: `useAppContext` for accessing global state

#### Automation Flow
1. User sets schedule (M-F, 4 punches/day: entrada1, saida1, entrada2, saida2)
2. Main process launches headless Chromium via Playwright
3. Scrapes existing punches from website (date/time extraction)
4. `getNextPunch()` determines next scheduled punch not yet recorded
5. `performPunch()` clicks button, waits for success/error messages
6. Retry logic: 3 attempts with 2s intervals
7. Telegram notifications on success/failure
8. Scheduling: checks every 5 minutes, attempts 5 seconds before scheduled time

#### Browser Management
- Playwright browser auto-installed to user data directory
- Complex detection logic handles multiple installation paths (NVM, Homebrew, system)
- `checkAutomationBrowser()` verifies Chromium availability
- Fallback installation via `npx playwright install chromium`
- Status tracked in settings: `LOADING` | `OK` | `MISSING`

### Configuration Files
- `electron.vite.config.ts`: Three build targets (main, preload, renderer)
  - Main: `electron/main.js` → `out/electron/main.js`
  - Preload: `electron/preload.js` → `out/electron/preload.js` (CJS format)
  - Renderer: `src/renderer/` → `out/renderer/` (with React plugin, alias `@renderer`)
- `package.json`: Build config for `electron-builder`
  - **Important**: `asarUnpack` for Playwright and Keytar native modules
  - Auto-update from GitHub repo: `zynk-br/meuponto`
  - macOS entitlements required for hardened runtime

### Type System (`src/renderer/types.ts`)
- Enums: `LogLevel`, `View`, `BrowserStatus`, `NodeStatus`, `AutomationMode`, `DayOfWeek`
- Core interfaces: `Settings`, `Schedule`, `TimeEntry`, `AutomationState`, `UserCredentials`
- `ElectronAPI` interface defines complete IPC contract between renderer/main

### IPC Communication Pattern
1. Renderer calls `window.electronAPI.methodName()`
2. Preload uses `ipcRenderer.invoke()` (async) or `ipcRenderer.send()` (fire-and-forget)
3. Main handles via `ipcMain.handle()` or `ipcMain.on()`
4. Main sends updates via `mainWindow.webContents.send()`
5. Preload exposes listeners with cleanup functions returned

### Logging System
- Dual-mode: Detailed logs (for devs) vs simplified logs (for users)
- `detailedLogs` setting controls verbosity
- `simplifyLogMessage()` in main.js maps technical messages to user-friendly text
- All logs shown in collapsible console at bottom of UI

### Theming
- Light/dark mode toggle in settings
- Tailwind CSS with custom colors defined in `tailwind.config.js`
- Theme stored in settings and applied via className

## Important Notes

- **Native Dependencies**: Playwright and Keytar must be unpacked from asar (see package.json:52-56)
- **Node.js Detection**: App checks for Node.js 18+ on startup (though bundled Electron includes Node)
- **Security**: Passwords stored in system keychain via keytar, never in plain text
- **Cross-Platform**: Different logic for macOS/Windows (PATH expansion, browser locations, NPX commands)
- **Update Strategy**: `autoDownload: false`, manual user confirmation required
- **Telegram Bot**: Token is hardcoded - consider moving to secure config
- **Schedule**: Only Monday-Friday supported, max 4 punches per day
- **Time Sync**: Scrapes existing punches to avoid duplicates, uses date/time comparison logic in `getNextPunch()`
