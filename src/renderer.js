document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DO DOM ---
    // NOVO: Controles da janela
    const minimizeBtn = document.getElementById('minimize-btn');
    const maximizeBtn = document.getElementById('maximize-btn');
    const closeBtn = document.getElementById('close-btn');

    // NOVO: Checkbox de salvar login
    const saveLoginCheckbox = document.getElementById('save-login-checkbox');
    // --- ELEMENTOS DO DOM ---
    const clockElement = document.getElementById('clock');
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    // NOVO: Settings
    const loadingView = document.getElementById('loading-view');
    const loadingText = document.getElementById('loading-text');
    const loadingError = document.getElementById('loading-error');
    const browserStatusSetting = document.getElementById('browser-status-setting');
    const settingsView = document.getElementById('settings-view');
    const btnShowSettings = document.getElementById('btn-show-settings');
    const btnSaveAndCloseSettings = document.getElementById('btn-save-and-close-settings');
    const versionDisplay = document.getElementById('version-display');
    const toggleConsoleCheckbox = document.getElementById('toggle-console-checkbox');
    const consoleWrapper = document.getElementById('console-wrapper');
    const tutorialModal = document.getElementById('tutorial-modal');

    const manualInputsContainer = document.getElementById('manual-inputs');
    
    const loginNumeroInput = document.getElementById('login-numero');
    const loginSenhaInput = document.getElementById('login-senha');
    const btnLogin = document.getElementById('btn-login');

    // --- TELEGRAM ---
    const telegramTokenInput = document.getElementById('telegram-token');
    const telegramChatIdInput = document.getElementById('telegram-chat-id');
    // const btnSaveTelegram = document.getElementById('btn-save-telegram');

    const modeRadios = document.querySelectorAll('input[name="mode"]');
    const manualModeDiv = document.getElementById('manual-mode');
    const semiAutoModeDiv = document.getElementById('semi-auto-mode');

    const startTimeInput = document.getElementById('start-time');
    const btnGenerateTimes = document.getElementById('btn-generate-times');

    const btnExecutar = document.getElementById('btn-executar');
    const btnLimpar = document.getElementById('btn-limpar');
    const btnCancelar = document.getElementById('btn-cancelar');
    
    const consoleDiv = document.getElementById('console');
    // const toggleConsoleBtn = document.getElementById('toggle-console');

    // NOVO: Navegador
    const browserStatusDiv = document.getElementById('browser-status');
    const btnDownloadBrowser = document.getElementById('btn-download-browser');
    const downloadProgress = document.getElementById('download-progress');

    // --- ESTADO DA APLICAÇÃO ---
    const diasDaSemana = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];

    // --- FUNÇÕES ---


    // --- LÓGICA DE NAVEGAÇÃO ENTRE TELAS ---
    function showView(viewElement) {
        loadingView.classList.add('hidden');
        loginView.classList.add('hidden');
        appView.classList.add('hidden');
        settingsView.classList.add('hidden');
        viewElement.classList.remove('hidden');
    }

    // --- LÓGICA DO FLUXO DE INICIALIZAÇÃO ---
    window.api.onInitFlow(({ status }) => {
        if (status === 'login') {
            showView(loginView);
        } else if (status === 'download') {
            loadingText.textContent = 'Baixando navegador (~300 MB)...';
            // A tela de loading já está visível por padrão
        }
    });

    window.api.onDownloadComplete(({ success, message }) => {
        if (success) {
            showView(loginView);
        } else {
            loadingText.textContent = 'Falha no Download';
            loadingError.textContent = `Erro: ${message}. Por favor, reinicie o aplicativo e tente novamente.`;
            loadingError.classList.remove('hidden');
        }
    });

    // NOVO: Função para carregar o login salvo
    async function loadSavedLogin() {
        const credentials = await window.api.getLogin();
        if (credentials && credentials.login) {
            loginNumeroInput.value = credentials.login;
            loginSenhaInput.value = credentials.senha;
            saveLoginCheckbox.checked = true;
            logToConsole('[INFO] Credenciais carregadas.');
        } else {
            logToConsole('[INFO] Nenhuma credencial salva encontrada.');
        }
    }

    async function loadTelegramSettings() {
        const telegramSettings = await window.api.getTelegramSettings();
        if (telegramSettings) {
            telegramTokenInput.value = telegramSettings.token || '';
            telegramChatIdInput.value = telegramSettings.chatId || '';
            logToConsole('[INFO] Configurações do Telegram carregadas.');
        } else {
            logToConsole('[INFO] Nenhuma configuração do Telegram encontrada.');
        }
        
    }

    // NOVO: Função para carregar os horários salvos
    async function loadSavedSchedules() {
        const savedSchedules = await window.api.getSchedules();
        if (savedSchedules) {
            logToConsole('[INFO] Carregando horários salvos na interface.');
            diasDaSemana.forEach(dia => {
                const daySchedule = savedSchedules[dia];
                if (daySchedule) {
                    // Preenche os inputs de tempo
                    Object.keys(daySchedule).forEach(type => {
                        if (type !== 'desativado') {
                            const input = document.querySelector(`input[data-day="${dia}"][data-type="${type}"]`);
                            if (input) input.value = daySchedule[type];
                        }
                    });
                    
                    // Ajusta o switch de feriado/desativado
                    const holidaySwitch = document.querySelector(`.holiday-switch[data-day="${dia}"]`);
                    const inputsDiv = document.querySelector(`.day-inputs[data-day-inputs="${dia}"]`);
                    if (holidaySwitch && daySchedule.desativado) {
                        holidaySwitch.checked = true;
                        inputsDiv.classList.add('disabled');
                    }
                }
            });
        }
    }

    // Atualiza o relógio
    function updateClock() {
        // Horário de Brasília (UTC-3)
        const now = new Date();
        const brasiliaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        clockElement.textContent = brasiliaTime.toLocaleTimeString('pt-BR');
    }

    // Cria os inputs para o modo manual
    function createManualInputs() {
        manualInputsContainer.innerHTML = '';
        diasDaSemana.forEach(dia => {
            const card = document.createElement('div');
            card.className = 'day-card';
            card.innerHTML = `
                <div class="day-header">
                    <h4>${dia}</h4>
                    <label>
                        <input type="checkbox" class="holiday-switch" data-day="${dia}"> Feriado/Desativado
                    </label>
                </div>
                <div class="day-inputs" data-day-inputs="${dia}">
                    <div>
                        <label>Entrada 1</label>
                        <input type="time" class="time-input" data-day="${dia}" data-type="entrada1">
                    </div>
                    <div>
                        <label>Saída 1</label>
                        <input type="time" class="time-input" data-day="${dia}" data-type="saida1">
                    </div>
                    <div>
                        <label>Entrada 2</label>
                        <input type="time" class="time-input" data-day="${dia}" data-type="entrada2">
                    </div>
                    <div>
                        <label>Saída 2</label>
                        <input type="time" class="time-input" data-day="${dia}" data-type="saida2">
                    </div>
                </div>
            `;
            manualInputsContainer.appendChild(card);
        });

        document.querySelectorAll('.holiday-switch').forEach(sw => {
            sw.addEventListener('change', (e) => {
                const day = e.target.dataset.day;
                const inputsDiv = document.querySelector(`.day-inputs[data-day-inputs="${day}"]`);
                inputsDiv.classList.toggle('disabled', e.target.checked);
            });
        });
    }

    // Função para gerar horários aleatórios do modo semi-automático
    function generateSemiAutoTimes() {
        const startTime = startTimeInput.value;
        if (!startTime) {
            alert('Por favor, informe o horário de início.');
            return;
        }

        const [startHour, startMinute] = startTime.split(':').map(Number);

        diasDaSemana.forEach(dia => {
            const randMinuteEntrada1 = Math.floor(Math.random() * 60);
            const entrada1 = new Date();
            entrada1.setHours(startHour, randMinuteEntrada1, 0, 0);

            const randMinuteSaida1 = Math.floor(Math.random() * 60);
            const saida1 = new Date();
            saida1.setHours(12, randMinuteSaida1, 0, 0);

            const entrada2 = new Date(saida1.getTime() + 60 * 60 * 1000); // 1h de almoço
            const saida2 = new Date(entrada1.getTime() + 9 * 60 * 60 * 1000); // 9h totais

            const formatTime = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            
            // Preenche os campos na UI
            document.querySelector(`input[data-day="${dia}"][data-type="entrada1"]`).value = formatTime(entrada1);
            document.querySelector(`input[data-day="${dia}"][data-type="saida1"]`).value = formatTime(saida1);
            document.querySelector(`input[data-day="${dia}"][data-type="entrada2"]`).value = formatTime(entrada2);
            document.querySelector(`input[data-day="${dia}"][data-type="saida2"]`).value = formatTime(saida2);
            
            // Garante que o dia não está desativado
            const holidaySwitch = document.querySelector(`.holiday-switch[data-day="${dia}"]`);
            if (holidaySwitch.checked) {
                holidaySwitch.click();
            }
        });
        
        logToConsole('Horários gerados com sucesso!');
    }
    
    // Função para limpar todos os inputs
    function clearAllInputs() {
        if(confirm('Tem certeza que deseja limpar todos os horários?')) {
            document.querySelectorAll('.time-input').forEach(input => input.value = '');
            document.querySelectorAll('.holiday-switch:checked').forEach(sw => sw.click());
            startTimeInput.value = '';
            logToConsole('Campos limpos.');
        }
    }

    // Coleta todos os dados da UI para enviar para automação
    function collectData() {
        const horarios = {};
        diasDaSemana.forEach(dia => {
            const desativado = document.querySelector(`.holiday-switch[data-day="${dia}"]`).checked;
            horarios[dia] = {
                desativado,
                entrada1: document.querySelector(`input[data-day="${dia}"][data-type="entrada1"]`).value,
                saida1:   document.querySelector(`input[data-day="${dia}"][data-type="saida1"]`).value,
                entrada2: document.querySelector(`input[data-day="${dia}"][data-type="entrada2"]`).value,
                saida2:   document.querySelector(`input[data-day="${dia}"][data-type="saida2"]`).value,
            };
        });
        return {
            login: loginNumeroInput.value,
            senha: loginSenhaInput.value,
            horarios
        };
    }

    function logToConsole(message) {
        const logType = message.match(/\[(.*?)\]/)?.[1] || 'INFO';
        const cleanMessage = message.replace(/\[.*?\]\s*/, '');
        
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${cleanMessage}`;
        logEntry.className = `log-${logType}`;
        
        consoleDiv.appendChild(logEntry);
        consoleDiv.scrollTop = consoleDiv.scrollHeight; // Auto-scroll
    }


    // --- EVENT LISTENERS ---
    // NOVO: Listeners para os botões da janela
    minimizeBtn.addEventListener('click', () => window.api.minimizeWindow());
    maximizeBtn.addEventListener('click', () => window.api.maximizeWindow());
    closeBtn.addEventListener('click', () => window.api.closeWindow());
    // ALTERADO: Lógica do botão de login
    btnLogin.addEventListener('click', async () => {
        if (loginNumeroInput.value && loginSenhaInput.value) {
            // Salvar ou limpar credenciais
            if (saveLoginCheckbox.checked) {
                await window.api.setLogin({
                    login: loginNumeroInput.value,
                    senha: loginSenhaInput.value
                });
            } else {
                await window.api.setLogin({ login: '', senha: '' }); // Limpa se desmarcado
            }
            showView(appView);
            logToConsole('[INFO] Login efetuado na interface. Configure os horários.');
        } else {
            alert('Por favor, preencha o número e a senha.');
        }
    });

    // NOVA FUNÇÃO para gerenciar a UI do navegador
    // async function browserStatusDiv() {
    //     logToConsole('[INFO] Verificando status do navegador...');
    //     const browserExists = await window.api.checkBrowser();
        
    //     browserStatusDiv.classList.toggle('hidden', browserExists);
    //     btnExecutar.disabled = !browserExists;
        
    //     if (browserExists) {
    //         logToConsole('[SUCESSO] Navegador encontrado e pronto para uso.');
    //     } else {
    //         logToConsole('[AVISO] Navegador não encontrado. Download necessário.');
    //     }
    // }
    // Listener para o botão de download
    // btnDownloadBrowser.addEventListener('click', async () => {
    //     btnDownloadBrowser.classList.add('hidden');
    //     downloadProgress.classList.remove('hidden');
    //     logToConsole('[INFO] Requisição de download do navegador enviada...');
        
    //     const result = await window.api.downloadBrowser();
        
    //     if (result.success) {
    //         logToConsole('[SUCESSO] Download concluído! Verificando status novamente...');
    //         // Chama a verificação novamente para atualizar a UI
    //         await checkBrowserAndSetupUI(); 
    //     } else {
    //         logToConsole(`[ERRO] Falha no download. Tente novamente. ${result.message}`);
    //         downloadProgress.classList.add('hidden');
    //         btnDownloadBrowser.classList.remove('hidden');
    //     }
    // });

    // btnSaveTelegram.addEventListener('click', async () => {
    //     const settings = { token: telegramTokenInput.value, chatId: telegramChatIdInput.value };
    //     await window.api.setTelegramSettings(settings);
    //     alert('Configurações do Telegram salvas!');
    // });

    btnSaveAndCloseSettings.addEventListener('click', async () => {
        // Salva as configurações do Telegram antes de fechar
        const settings = { token: telegramTokenInput.value, chatId: telegramChatIdInput.value };
        await window.api.setTelegramSettings(settings);
        alert('Configurações salvas!');
        showView(appView);
    });

    // --- LÓGICA DA VERSÃO DO APP ---
    async function displayAppVersion() {
        const { version, repoUrl } = await window.api.getAppInfo();
        const releaseUrl = `${repoUrl}/releases/tag/v${version}`;
        versionDisplay.innerHTML = `<a id="version-link" href="#">v.${version}</a>`;
        
        document.getElementById('version-link').addEventListener('click', (e) => {
            e.preventDefault();
            window.api.openExternalLink(releaseUrl);
        });
    }

    // --- LÓGICA DO CONSOLE LOG ---
    toggleConsoleCheckbox.addEventListener('change', () => {
        consoleWrapper.classList.toggle('hidden', !toggleConsoleCheckbox.checked);
    });
    // Garante que o estado inicial seja respeitado
    consoleWrapper.classList.toggle('hidden', !toggleConsoleCheckbox.checked);

    // --- LÓGICA DA MODAL ---
    document.querySelectorAll('.info-icon').forEach(icon => {
        icon.addEventListener('click', () => tutorialModal.classList.remove('hidden'));
    });
    document.querySelector('.modal-close-btn').addEventListener('click', () => tutorialModal.classList.add('hidden'));
    tutorialModal.addEventListener('click', (e) => {
        if (e.target === tutorialModal) { // Fecha só se clicar no fundo
            tutorialModal.classList.add('hidden');
        }
    });

    // Troca de modo
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const isManual = e.target.value === 'manual';
            manualModeDiv.classList.toggle('hidden', !isManual);
            semiAutoModeDiv.classList.toggle('hidden', isManual);
        });
    });

    // Botões
    btnGenerateTimes.addEventListener('click', generateSemiAutoTimes);
    btnLimpar.addEventListener('click', clearAllInputs);
    btnExecutar.addEventListener('click', async () => {
        const data = collectData();
        logToConsole('[INFO] Salvando horários configurados...');
        await window.api.setSchedules(data.horarios); // Salva os horários
        logToConsole('[INFO] Enviando dados para o processo principal...');
        btnExecutar.disabled = true;
        btnExecutar.textContent = 'Executando...';
        const result = await window.api.startAutomation(data);
        if (result.success) {
            logToConsole(`[SUCESSO] ${result.message}`);
        } else {
            logToConsole(`[ERRO] ${result.message}`);
        }
        btnExecutar.disabled = false;
        btnExecutar.textContent = 'Executar';
    });
    btnCancelar.addEventListener('click', () => {
        window.api.cancelAutomation();
    });
    // toggleConsoleBtn.addEventListener('click', () => {
    //     consoleDiv.classList.toggle('hidden');
    //     toggleConsoleBtn.textContent = consoleDiv.classList.contains('hidden') ? 'Mostrar' : 'Ocultar';
    // });

    btnShowSettings.addEventListener('click', async () => {
        showView(settingsView);
        
        // Atualiza o status do navegador sempre que abrir as configurações
        const browserStatusEl = browserStatusSetting.querySelector('.status-indicator');
        browserStatusEl.textContent = 'Verificando...';
        browserStatusEl.className = 'status-indicator loading';

        const browserExists = await window.api.checkBrowser();
        
        if (browserExists) {
            browserStatusEl.textContent = 'Instalado';
            browserStatusEl.className = 'status-indicator installed';
        } else {
            browserStatusEl.textContent = 'Não Instalado';
            browserStatusEl.className = 'status-indicator missing';
        }
    });

    // API Listener para logs do processo principal
    window.api.onLogMessage(logToConsole);

    // --- INICIALIZAÇÃO ---
    setInterval(updateClock, 1000);
    updateClock();
    createManualInputs();
    displayAppVersion();
    logToConsole('[INFO] Aplicação pronta. Por favor, faça o login.');
    loadSavedLogin();
    loadTelegramSettings();
    loadSavedSchedules();
});