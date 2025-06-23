// src/renderer.js
import { setupEventListeners, setupApiListeners, updateButtonStates } from './ui/event-listeners.js';
import { updateClock, displayAppVersion, logToConsole } from './ui/dom-manager.js';

document.addEventListener('DOMContentLoaded', async () => {

    // PASSO 1: Coletar todos os elementos do DOM em um único objeto central.
    // Isso é feito apenas uma vez, no início.
    const elements = {
        // Controles da janela
        minimizeBtn: document.getElementById('minimize-btn'),
        maximizeBtn: document.getElementById('maximize-btn'),
        closeBtn: document.getElementById('close-btn'),

        // Objeto com todas as "telas" para fácil gerenciamento
        views: {
            loading: document.getElementById('loading-view'),
            login: document.getElementById('login-view'),
            app: document.getElementById('app-view'),
            settings: document.getElementById('settings-view'),
            nodeMissing: document.getElementById('node-missing-view'),
        },

        // Elementos de Loading/Status
        loadingText: document.getElementById('loading-text'),
        loadingError: document.getElementById('loading-error'),
        browserStatusSetting: document.getElementById('browser-status-setting'),

        // Elementos de Login
        loginNumeroInput: document.getElementById('login-numero'),
        loginSenhaInput: document.getElementById('login-senha'),
        saveLoginCheckbox: document.getElementById('save-login-checkbox'),
        btnLogin: document.getElementById('btn-login'),

        // Elementos da Tela Principal
        appView: document.getElementById('app-view'),
        manualInputsContainer: document.getElementById('manual-inputs'),
        modeRadios: document.querySelectorAll('input[name="mode"]'),
        manualModeDiv: document.getElementById('manual-mode'),
        semiAutoModeDiv: document.getElementById('semi-auto-mode'),
        startTimeInput: document.getElementById('start-time'),
        btnGenerateTimes: document.getElementById('btn-generate-times'),
        btnExecutar: document.getElementById('btn-executar'),
        btnLimpar: document.getElementById('btn-limpar'),
        btnCancelar: document.getElementById('btn-cancelar'),

        // Elementos de Configurações
        settingsView: document.getElementById('settings-view'),
        btnShowSettings: document.getElementById('btn-show-settings'),
        btnSaveSettings: document.getElementById('btn-save-settings'),
        btnCloseSettings: document.getElementById('btn-close-settings'),
        telegramTokenInput: document.getElementById('telegram-token'),
        telegramChatIdInput: document.getElementById('telegram-chat-id'),

        // Elementos do Console, Relógio e Versão
        clockElement: document.getElementById('clock'),
        consoleWrapper: document.getElementById('console-wrapper'),
        consoleDiv: document.getElementById('console'),
        toggleConsoleCheckbox: document.getElementById('toggle-console-checkbox'),
        versionDisplay: document.getElementById('version-display'),

        // Modal e Links
        tutorialModal: document.getElementById('tutorial-modal'),
        btnOpenNodeLink: document.getElementById('btn-open-node-link'),
    };

    // PASSO 2: Inicializar os listeners, passando o objeto 'elements' como dependência.
    // Agora os outros módulos não precisam fazer `getElementById`.
    setupEventListeners(elements);
    setupApiListeners(elements);

    // PASSO 3: Executar a lógica de inicialização da UI.

    // Inicia o relógio
    setInterval(() => updateClock(elements.clockElement), 1000);

    // Exibe a versão do app
    await displayAppVersion(elements.versionDisplay);

    // Carrega dados salvos (login e telegram) que podem ser exibidos imediatamente
    const credentials = await window.api.getLogin();
    if (credentials && credentials.login) {
        elements.loginNumeroInput.value = credentials.login;
        elements.loginSenhaInput.value = credentials.senha;
        elements.saveLoginCheckbox.checked = true;
    }

    const telegramSettings = await window.api.getTelegramSettings();
    if (telegramSettings) {
        elements.telegramTokenInput.value = telegramSettings.token || '';
        elements.telegramChatIdInput.value = telegramSettings.chatId || '';
    }

    // CONSULTA INICIAL DO ESTADO
    // Verifica como a automação estava quando o app foi aberto
    const status = await window.api.getAutomationStatus();
    updateButtonStates(elements, status.isRunning);

    logToConsole(elements.consoleDiv, '[INFO] Interface pronta. Aguardando status do backend...');
});