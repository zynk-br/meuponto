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
    const manualInputsContainer = document.getElementById('manual-inputs');
    
    const loginNumeroInput = document.getElementById('login-numero');
    const loginSenhaInput = document.getElementById('login-senha');
    const btnLogin = document.getElementById('btn-login');

    const modeRadios = document.querySelectorAll('input[name="mode"]');
    const manualModeDiv = document.getElementById('manual-mode');
    const semiAutoModeDiv = document.getElementById('semi-auto-mode');

    const startTimeInput = document.getElementById('start-time');
    const btnGenerateTimes = document.getElementById('btn-generate-times');

    const btnExecutar = document.getElementById('btn-executar');
    const btnLimpar = document.getElementById('btn-limpar');
    const btnCancelar = document.getElementById('btn-cancelar');
    
    const consoleDiv = document.getElementById('console');
    const toggleConsoleBtn = document.getElementById('toggle-console');

    // --- ESTADO DA APLICAÇÃO ---
    const diasDaSemana = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];

    // --- FUNÇÕES ---

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

            loginView.classList.add('hidden');
            appView.classList.remove('hidden');
            logToConsole('[INFO] Login efetuado na interface. Configure os horários.');
        } else {
            alert('Por favor, preencha o número e a senha.');
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
    toggleConsoleBtn.addEventListener('click', () => {
        consoleDiv.classList.toggle('hidden');
        toggleConsoleBtn.textContent = consoleDiv.classList.contains('hidden') ? 'Mostrar' : 'Ocultar';
    });
    
    // API Listener para logs do processo principal
    window.api.onLogMessage(logToConsole);

    // --- INICIALIZAÇÃO ---
    setInterval(updateClock, 1000);
    updateClock();
    createManualInputs();
    logToConsole('[INFO] Aplicação pronta. Por favor, faça o login.');
    loadSavedLogin();
    loadSavedSchedules();
});