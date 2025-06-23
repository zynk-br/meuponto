// src/ui/dom-manager.js

/**
 * Mostra uma "view" (tela) e esconde as outras.
 */
export function showView(viewId, views) {
    // Esconde todas as views passadas no objeto
    Object.values(views).forEach(view => view?.classList.add('hidden'));
    // Mostra a view alvo
    if (views[viewId]) {
        views[viewId].classList.remove('hidden');
    }
}

/**
 * Adiciona uma mensagem de log ao console da UI.
 * @param {HTMLElement} consoleDiv - O elemento do console onde o log será adicionado.
 * @param {string} message - A mensagem de log.
 */
export function logToConsole(consoleDiv, message) {
    if (!consoleDiv) return;
    const logType = message.match(/\[(.*?)\]/)?.[1] || 'INFO';
    const cleanMessage = message.replace(/\[.*?\]\s*/, '');

    const logEntry = document.createElement('div');
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${cleanMessage}`;
    logEntry.className = `log-${logType}`; // Supondo que você tenha classes CSS

    consoleDiv.appendChild(logEntry);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

/**
 * Atualiza o relógio da UI.
 * @param {HTMLElement} clockElement - O elemento do DOM que exibe o relógio.
 */
export function updateClock(clockElement) {
    if (!clockElement) return;
    const brasiliaTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    clockElement.textContent = brasiliaTime.toLocaleTimeString('pt-BR');
}

/**
 * Cria a estrutura de inputs para os dias da semana.
 * @param {HTMLElement} container - O elemento onde os cards dos dias serão inseridos.
 */
export function createManualInputs(container) {
    if (!container) return;
    const diasDaSemana = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];
    container.innerHTML = ''; // Limpa o container antes de adicionar
    diasDaSemana.forEach(dia => {
        const card = document.createElement('div');
        card.className = 'day-card';
        card.innerHTML = `
            <div class="day-header">
                <h4>${dia}</h4>
                <label><input type="checkbox" class="holiday-switch" data-day="${dia}"> Desativado</label>
            </div>
            <div class="day-inputs" data-day-inputs="${dia}">
                <div><label>Entrada 1</label><input type="time" class="time-input" data-day="${dia}" data-type="entrada1"></div>
                <div><label>Saída 1</label><input type="time" class="time-input" data-day="${dia}" data-type="saida1"></div>
                <div><label>Entrada 2</label><input type="time" class="time-input" data-day="${dia}" data-type="entrada2"></div>
                <div><label>Saída 2</label><input type="time" class="time-input" data-day="${dia}" data-type="saida2"></div>
            </div>`;
        container.appendChild(card);
    });
}

/**
 * Gera horários semi-automáticos e os preenche na UI.
 * @param {HTMLElement} startTimeInput - O input de onde pegar o horário de início.
 */
export function generateSemiAutoTimes(startTimeInput) {
    if (!startTimeInput || !startTimeInput.value) {
        alert('Por favor, informe o horário de início.');
        return;
    }

    const [startHour] = startTimeInput.value.split(':').map(Number);
    const diasDaSemana = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira"];

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

        const holidaySwitch = document.querySelector(`.holiday-switch[data-day="${dia}"]`);
        if (holidaySwitch && holidaySwitch.checked) {
            holidaySwitch.checked = false; // Desmarca o checkbox
            // Dispara um evento de 'change' para que o listener em event-listeners.js possa reagir
            holidaySwitch.dispatchEvent(new Event('change')); 
        }
    });
}

/**
 * Exibe a versão do app na UI.
 */
export async function displayAppVersion(versionDisplay) {
    if (!versionDisplay) return;
    const { version, repoUrl } = await window.api.getAppInfo();
    const releaseUrl = `${repoUrl}/releases/tag/v${version}`;
    versionDisplay.innerHTML = `<a href="#">v.${version}</a>`;
    versionDisplay.querySelector('a')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.api.openExternalLink(releaseUrl);
    });
}