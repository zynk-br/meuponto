// src/ui/event-listeners.js
import { showView, generateSemiAutoTimes, logToConsole, createManualInputs } from './dom-manager.js';


// Função auxiliar para coletar dados, que pertence a este escopo
function collectData(elements) {
    const horarios = {};
    const diasDaSemana = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];
    diasDaSemana.forEach(dia => {
        const desativado = document.querySelector(`.holiday-switch[data-day="${dia}"]`)?.checked || false;
        // CORREÇÃO: Preenche todos os campos de horário.
        horarios[dia] = {
            desativado,
            entrada1: document.querySelector(`input[data-day="${dia}"][data-type="entrada1"]`)?.value || '',
            saida1: document.querySelector(`input[data-day="${dia}"][data-type="saida1"]`)?.value || '',
            entrada2: document.querySelector(`input[data-day="${dia}"][data-type="entrada2"]`)?.value || '',
            saida2: document.querySelector(`input[data-day="${dia}"][data-type="saida2"]`)?.value || '',
        };
    });
    return {
        login: elements.loginNumeroInput.value,
        senha: elements.loginSenhaInput.value,
        horarios
    };
}

function clearAllInputs(elements) {
    if (confirm('Tem certeza que deseja limpar todos os horários?')) {
        document.querySelectorAll('.time-input').forEach(input => input.value = '');
        document.querySelectorAll('.holiday-switch:checked').forEach(sw => sw.click());
        if (elements.startTimeInput) elements.startTimeInput.value = '';
        logToConsole(elements.consoleDiv, '[INFO] Campos limpos.');
    }
}

// NOVO: Função para atualizar a aparência dos botões
export function updateButtonStates(elements, isRunning) {
    const { btnExecutar, btnCancelar } = elements;
    if (isRunning) {
        btnExecutar.textContent = 'Executando...';
        btnExecutar.disabled = true;
        btnCancelar.disabled = false;
    } else {
        btnExecutar.textContent = 'Executar';
        btnExecutar.disabled = false;
        btnCancelar.disabled = true;
    }
}


// Esta função recebe um objeto com todos os elementos do DOM necessários
export function setupEventListeners(elements) {
    const {
        minimizeBtn, maximizeBtn, closeBtn, btnLogin, btnExecutar, btnCancelar, btnGenerateTimes, btnLimpar,
        saveLoginCheckbox, loginNumeroInput, loginSenhaInput, manualInputsContainer,
        startTimeInput, toggleConsoleCheckbox, consoleWrapper, views, consoleDiv,
        btnShowSettings, btnSaveSettings, btnCloseSettings, btnOpenNodeLink,
        telegramTokenInput, telegramChatIdInput, tutorialModal, browserStatusSetting, modeRadios, manualModeDiv, semiAutoModeDiv
    } = elements;

    // --- Listeners da Janela ---
    minimizeBtn?.addEventListener('click', () => window.api.minimizeWindow());
    maximizeBtn?.addEventListener('click', () => window.api.maximizeWindow());
    closeBtn?.addEventListener('click', () => window.api.closeWindow());

    // Listener do Login
    btnLogin?.addEventListener('click', async () => {
        if (loginNumeroInput.value && loginSenhaInput.value) {
            await window.api.setLogin(saveLoginCheckbox.checked ? { login: loginNumeroInput.value, senha: loginSenhaInput.value } : null);
            showView('app', views);
            createManualInputs(manualInputsContainer);

            document.querySelectorAll('.holiday-switch').forEach(sw => {
                sw.addEventListener('change', (e) => {
                    const day = e.target.dataset.day;
                    document.querySelector(`.day-inputs[data-day-inputs="${day}"]`)?.classList.toggle('disabled', e.target.checked);
                });
            });

            // CORREÇÃO: Lógica para carregar horários agora está completa.
            const savedSchedules = await window.api.getSchedules();
            if (savedSchedules) {
                logToConsole(consoleDiv, '[INFO] Carregando horários salvos...');
                const dias = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];
                dias.forEach(dia => {
                    const daySchedule = savedSchedules[dia];
                    if (daySchedule) {
                        Object.keys(daySchedule).forEach(type => {
                            if (type !== 'desativado') {
                                const input = document.querySelector(`input[data-day="${dia}"][data-type="${type}"]`);
                                if (input) input.value = daySchedule[type];
                            }
                        });
                        const holidaySwitch = document.querySelector(`.holiday-switch[data-day="${dia}"]`);
                        if (holidaySwitch && daySchedule.desativado) {
                            holidaySwitch.checked = true;
                            document.querySelector(`.day-inputs[data-day-inputs="${dia}"]`)?.classList.add('disabled');
                        }
                    }
                });
            }
        } else {
            alert('Por favor, preencha o número e a senha.');
        }
    });

    // --- Listeners da Tela Principal ---
    btnGenerateTimes?.addEventListener('click', () => {
        generateSemiAutoTimes(startTimeInput);
        logToConsole(consoleDiv, '[INFO] Horários gerados com sucesso!');
    });

    btnLimpar?.addEventListener('click', () => clearAllInputs(elements));

    btnExecutar?.addEventListener('click', async () => {
        const data = collectData(elements);
        logToConsole(consoleDiv, '[INFO] Salvando horários e iniciando automação...');
        await window.api.setSchedules(data.horarios);

        await window.api.startAutomation(data);
    });

    btnCancelar?.addEventListener('click', () => window.api.cancelAutomation());

    // --- Listeners da Tela de Configurações e Outros ---

    btnShowSettings?.addEventListener('click', async () => {
        showView('settings', views);
        const browserStatusEl = browserStatusSetting?.querySelector('.status-indicator');
        if (browserStatusEl) {
            browserStatusEl.textContent = 'Verificando...';
            browserStatusEl.className = 'status-indicator loading';
            const browserExists = await window.api.checkBrowser();
            browserStatusEl.textContent = browserExists ? 'Instalado' : 'Não Instalado';
            browserStatusEl.className = `status-indicator ${browserExists ? 'installed' : 'missing'}`;
        }
    });

    btnSaveSettings?.addEventListener('click', async () => {
        await window.api.setTelegramSettings({ token: telegramTokenInput.value, chatId: telegramChatIdInput.value });
        alert('Configurações salvas!');
        showView('app', views);
    });

    btnCloseSettings?.addEventListener('click', () => showView('app', views));

    // Troca de modo
    modeRadios.forEach(radio => {
        radio?.addEventListener('change', (e) => {
            const isManual = e.target.value === 'manual';
            // Usa os elementos passados no objeto 'elements'
            manualModeDiv?.classList.toggle('hidden', !isManual);
            semiAutoModeDiv?.classList.toggle('hidden', isManual);
        });
    });

    // --- Listener do Console ---

    toggleConsoleCheckbox?.addEventListener('change', () => consoleWrapper?.classList.toggle('hidden', !toggleConsoleCheckbox.checked));
    consoleWrapper?.classList.toggle('hidden', !toggleConsoleCheckbox.checked); // Estado inicial

    btnOpenNodeLink?.addEventListener('click', () => window.api.openExternalLink('https://nodejs.org/'));


    // --- Listeners da Modal ---
    document.querySelectorAll('.info-icon').forEach(icon => {
        icon.addEventListener('click', () => tutorialModal?.classList.remove('hidden'));
    });
    document.querySelector('.modal-close-btn')?.addEventListener('click', () => tutorialModal?.classList.add('hidden'));
    tutorialModal?.addEventListener('click', (e) => {
        if (e.target === tutorialModal) tutorialModal.classList.add('hidden');
    });
}

export function setupApiListeners(elements) {
    const { views, loadingText, loadingError, consoleDiv } = elements;

    window.api.onLogMessage((message) => {
        logToConsole(consoleDiv, message);
    });

    window.api.onInitFlow(({ status }) => {
        if (status === 'login') showView('login', views);
        else if (status === 'download') loadingText.textContent = 'Baixando navegador...';
        else if (status === 'node-missing') showView('nodeMissing', views);
    });

    window.api.onDownloadComplete(({ success, message }) => {
        if (success) showView('login', views);
        else {
            loadingText.textContent = 'Falha no Download';
            loadingError.textContent = `Erro: ${message}.`;
            loadingError.classList.remove('hidden');
        }
    });

    // NOVO: Listener para quando o estado da automação mudar
    window.api.onAutomationStateChanged(({ isRunning }) => {
        logToConsole(elements.consoleDiv, `[INFO] Estado da automação alterado. Rodando: ${isRunning}`);
        updateButtonStates(elements, isRunning);
    });
}