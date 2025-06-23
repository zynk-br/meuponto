// modules/automation.js
const { chromium } = require('playwright');
const { getBrowserExecutablePath } = require('../dependency-manager'); // Assumindo que o dependency-manager está na raiz

// Variáveis de estado da automação, agora encapsuladas neste módulo
let dailySchedule = [];
let executionInterval = null;
let futureScheduleTimeout = null;
let isAutomationRunning = false;

// Funções utilitárias
function getAutomationStatus() {
    return { isRunning: isAutomationRunning };
}

const parseTime = (timeStr) => {
    // 'HH:MM' -> Date object for today
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
};

const formatTime = (date) => {
    // Date object -> 'HH:MM'
    return `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
    ).padStart(2, "0")}`;
};

// Automações

/**
 * Abre o navegador, faz login e retorna os pontos já registrados no dia.
 * Usada para a sincronização inicial.
 * @param {string} login 
 * @param {string} senha 
 * @returns {Promise<string[]>} Um array com os horários dos pontos encontrados.
 */
async function syncInitialPunches(login, senha, logToUI) {
    let browser = null;
    logToUI('[INFO] Realizando sincronização inicial com o site...');
    try {
        const executablePath = getBrowserExecutablePath();
        browser = await chromium.launch({ headless: true, executablePath });
        const context = await browser.newContext();
        const page = await context.newPage();

        // Lógica de login
        await page.goto("https://centraldofuncionario.com.br/50911");
        await page.fill("#login-numero-folha", login);
        await page.fill("#login-senha", senha);
        await page.click("#login-entrar");

        await page.waitForSelector("#menu-incluir-ponto");
        await page.click("#menu-incluir-ponto");

        // Lógica de raspar os dados (scraping)
        const todayDateString = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        await page.waitForSelector('[id^="status-processamento-"]', { timeout: 5000 });
        const allScrapedEntries = await page.$$eval('[id^="status-processamento-"]', (els) => els.map(el => el.previousElementSibling?.textContent?.trim() || '').filter(Boolean));
        const todaysPunches = allScrapedEntries
            .map(entry => ({ date: entry.match(/\d{2}\/\d{2}/)?.[0], time: entry.match(/\d{2}:\d{2}/)?.[0] }))
            .filter(e => e.date === todayDateString && e.time)
            .map(e => e.time);

        const scrapedPunches = todaysPunches.sort();
        logToUI(`[INFO] Sincronização inicial encontrou ${scrapedPunches.length} pontos: ${scrapedPunches.join(", ")}`);
        return scrapedPunches;

    } catch (error) {
        logToUI(`[AVISO] Não foi possível realizar a sincronização inicial: ${error.message}`);
        return []; // Retorna vazio em caso de erro
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Abre o navegador, faz login, registra o ponto e fecha o navegador.
 * Uma operação atômica e independente.
 * @param {string} login - O número de login do usuário.
 * @param {string} senha - A senha do usuário.
 * @returns {Promise<boolean>} Retorna true se o registro foi bem-sucedido, false caso contrário.
 */
async function performPointRegistration(login, senha, punchToExecute, logToUI, dailySchedule) {
    let browser = null; // Instância do navegador é local para esta função
    logToUI('[INFO] Iniciando novo processo de registro de ponto...');

    try {
        const executablePath = getBrowserExecutablePath();
        browser = await chromium.launch({
            headless: true,
            executablePath: executablePath,
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        // Usaremos uma versão local da função findElement para ter a 'page' correta.
        const findElementOnPage = async (selector, retries = 3, delay = 2000) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const element = await page.waitForSelector(selector, { timeout: 5000 });
                    logToUI(`[SUCESSO] Elemento encontrado: ${selector}`);
                    return element;
                } catch (error) {
                    logToUI(`[AVISO] Tentativa ${i + 1}/${retries} falhou para ${selector}.`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
            throw new Error(`Elemento ${selector} não encontrado.`);
        };

        logToUI("[INFO] Navegando para a página de login...");
        await page.goto("https://centraldofuncionario.com.br/50911");

        await findElementOnPage("#login-numero-folha");
        await page.fill("#login-numero-folha", login);

        await findElementOnPage("#login-senha");
        await page.fill("#login-senha", senha);

        await page.click("#login-entrar");
        logToUI('[INFO] Login realizado. Navegando para inclusão de ponto...');

        await findElementOnPage("#menu-incluir-ponto");
        await page.click("#menu-incluir-ponto");

        await findElementOnPage("#app-shell-desktop-content");
        // --- LÓGICA DE SINCRONIZAÇÃO (SEMPRE ACONTECE) ---
        logToUI("[INFO] Sincronizando com pontos já registrados...");
        try {
            const todayDateString = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
            await page.waitForSelector('[id^="status-processamento-"]', { timeout: 5000 });

            const allScrapedEntries = await page.$$eval('[id^="status-processamento-"]', (els) => els.map(el => el.previousElementSibling?.textContent?.trim() || '').filter(Boolean));

            const todaysPunches = allScrapedEntries
                .map(entry => ({ date: entry.match(/\d{2}\/\d{2}/)?.[0], time: entry.match(/\d{2}:\d{2}/)?.[0] }))
                .filter(e => e.date === todayDateString && e.time)
                .map(e => e.time);

            scrapedPunches = todaysPunches.sort();
            logToUI(`[INFO] Pontos encontrados na página: ${scrapedPunches.length > 0 ? scrapedPunches.join(", ") : "Nenhum"}`);
        } catch (error) {
            logToUI("[INFO] Nenhum ponto prévio encontrado para hoje. Continuando...");
        }

        const expectedPunchIndex = dailySchedule.findIndex(p => p.id === punchToExecute.id);
        const expectedPunchCount = expectedPunchIndex + 1; // Se o índice é 2 (entrada2), esperamos ter 3 pontos.

        // 2. Comparamos o número de pontos que encontramos na página com o número que deveríamos ter.
        if (scrapedPunches.length >= expectedPunchCount) {
            logToUI(`[AVISO] A página já tem ${scrapedPunches.length} registros, o que é igual ou maior que o esperado (${expectedPunchCount}) para o ponto '${punchToExecute.id}'. Nenhum clique será feito.`);

            // Retorna sucesso, mas indica que o clique não foi necessário.
            return { success: true, scrapedPunches, clicked: false };
        }

        // Se chegamos aqui, significa que precisamos registrar o próximo ponto.
        await findElementOnPage("#localizacao-incluir-ponto");
        logToUI(`[INFO] Registrando novo ponto...`);
        await page.click("#localizacao-incluir-ponto");

        logToUI('[SUCESSO] Clique de registro de ponto realizado com sucesso!');
        return { success: true, scrapedPunches, clicked: true }; // Retorna sucesso e que clicou

    } catch (error) {
        logToUI(`[ERRO] Falha durante a operação de registro: ${error.message}`);
        return { success: false, scrapedPunches: [] };
    } finally {
        if (browser) {
            await browser.close();
            logToUI('[INFO] Navegador fechado. Processo concluído.');
        }
    }
}

async function monitorAndExecutePunches(store, logToUI, sendTelegramNotification) {
    const nextPunch = dailySchedule.find((p) => !p.punched);
    if (!nextPunch) {
        clearInterval(executionInterval);
        executionInterval = null;
        logToUI('[INFO] Todos os pontos do dia foram processados. Verificando próximo ciclo...');

        // Inicia a verificação para o próximo dia imediatamente
        await startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, true);

        return; // Para a execução atual desta função
    }

    // A verificação de horário continua a mesma
    if (new Date() >= parseTime(nextPunch.time)) {
        logToUI(
            `[EXECUÇÃO] Hora de bater o ponto: ${nextPunch.time} (${nextPunch.id})...`
        );

        // Pega as credenciais salvas no início da automação
        const credentials = store.get("credentials");
        if (!credentials || !credentials.login || !credentials.senha) {
            logToUI('[ERRO] Credenciais não encontradas para realizar o registro. Cancelando.');
            clearInterval(executionInterval);
            return;
        }

        // CHAMA A NOVA FUNÇÃO ATÔMICA
        const { success, scrapedPunches, clicked } = await performPointRegistration(credentials.login, credentials.senha, nextPunch, logToUI, dailySchedule);

        if (success) {
            if (clicked) {
                logToUI(`[SUCESSO] Operação de registro para ${nextPunch.id} concluída.`);
                await sendTelegramNotification(`✅ Ponto de *${nextPunch.id}* registrado.`);
            }
            // Após o registro, chama o processamento diário novamente para re-sincronizar e recalcular tudo.
            const uiHorarios = store.get('schedules');
            executeDailyProcess(uiHorarios[dayName], scrapedPunches, dayName, store, logToUI, sendTelegramNotification);
        } else {
            logToUI(`[ERRO] Falha na operação de registro para ${nextPunch.id}.`);
        }
    }
}

/**
 * Função principal que encontra o próximo dia válido e agenda o monitoramento.
 * @param {object} uiHorarios - O objeto completo com os horários da semana vindos da UI.
 */
async function startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, searchFromTomorrow = false) {
    isAutomationRunning = true;

    if (executionInterval) clearInterval(executionInterval);

    const uiHorarios = store.get('schedules');
    if (!uiHorarios) {
        logToUI('[AVISO] Horários não encontrados. Automação em espera.');
        return;
    }

    const dayNames = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];
    let targetDate, targetSchedules, targetDayName;

    const startIndex = searchFromTomorrow ? 1 : 0;

    for (let i = startIndex; i < 7; i++) {
        const dateToCheck = new Date(); dateToCheck.setDate(dateToCheck.getDate() + i);
        const dayName = dayNames[dateToCheck.getDay()];
        const schedules = uiHorarios[dayName];
        if (schedules && !schedules.desativado && schedules.entrada1) {
            targetDate = dateToCheck;
            targetSchedules = schedules;
            targetDayName = dayName;
            break;
        }
    }

    if (!targetDate) {
        logToUI('[AVISO] Nenhum dia útil configurado. Parando automação.');
        cancelAutomationHandler(logToUI);
        return;
    }

    const isToday = targetDate.toDateString() === new Date().toDateString();

    if (isToday) {
        logToUI(`[INFO] Dia de trabalho válido é hoje (${targetDayName}). Iniciando sincronização.`);
        const credentials = store.get('credentials');
        const initialPunches = await syncInitialPunches(credentials.login, credentials.senha, logToUI);
        executeDailyProcess(targetSchedules, initialPunches, targetDayName, store, logToUI, sendTelegramNotification);
    } else {
        const targetStartOfDay = new Date(targetDate);
        targetStartOfDay.setHours(0, 0, 5, 0);
        const delay = targetStartOfDay.getTime() - new Date().getTime();
        logToUI(`[INFO] Próximo dia de trabalho é ${targetDayName}. Agendado para começar em ~${Math.floor(delay / 3600000)} horas.`);
        futureScheduleTimeout = setTimeout(() => {
            startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, false);
        }, delay);
        setTimeout(() => startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, false), delay); // Quando acordar, busca a partir de hoje
    }
}

function executeDailyProcess(schedulesForDay, punchesForDay, dayName, store, logToUI, sendTelegramNotification) {
    dailySchedule = []; // Reset
    const scheduleKeys = ["entrada1", "saida1", "entrada2", "saida2"];
    scheduleKeys.forEach(key => {
        if (schedulesForDay[key]) {
            dailySchedule.push({ id: key, time: schedulesForDay[key], punched: false });
        }
    });

    punchesForDay.forEach((scrapedTime, index) => {
        if (dailySchedule[index]) {
            dailySchedule[index].punched = true;
            dailySchedule[index].time = scrapedTime;
            logToUI(`[INFO] Ponto sincronizado: ${dailySchedule[index].id} às ${scrapedTime}.`);
        }
    });

    if (punchesForDay.length > 0) {
        const lastPunchedIndex = punchesForDay.length - 1;
        const lastPunchedPoint = dailySchedule[lastPunchedIndex];
        const lastPunchedTimeStr = punchesForDay[lastPunchedIndex];
        const idealAnchorTimeStr = schedulesForDay[lastPunchedPoint.id];
        const delta = parseTime(lastPunchedTimeStr).getTime() - parseTime(idealAnchorTimeStr).getTime();
        logToUI(`[INFO] Recalculando com base no último ponto (${lastPunchedTimeStr}). Delta: ${Math.round(delta / 60000)} min.`);

        for (let i = lastPunchedIndex + 1; i < dailySchedule.length; i++) {
            const futurePoint = dailySchedule[i];
            const idealFutureTime = parseTime(schedulesForDay[futurePoint.id]);
            futurePoint.time = formatTime(new Date(idealFutureTime.getTime() + delta));
            logToUI(`[INFO] Horário de ${futurePoint.id} ajustado para ${futurePoint.time}.`);
        }
    }

    const nextPunch = dailySchedule.find(p => !p.punched);
    if (nextPunch) {
        logToUI(`[SUCESSO] Sincronização concluída. Próximo ponto: ${nextPunch.id} às ${nextPunch.time}.`);
        executionInterval = setInterval(() => monitorAndExecutePunches(dayName, store, logToUI, sendTelegramNotification), 20000);
    } else {
        logToUI("[INFO] Todos os pontos do dia já foram registrados. Verificando próximo ciclo...");
        // Imediatamente verifica o próximo dia
        startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, true);
    }
}


// Função de inicialização que recebe as dependências do main.js
function initAutomation(ipcMain, store, logToUI, sendTelegramNotification, getMainWindow) {
    ipcMain.handle("start-automation", async () => {
        if (isAutomationRunning) {
            logToUI('[AVISO] Automação já está em execução.');
            return { success: false, message: "Automação já em execução." };
        }
        logToUI("[INFO] Automação iniciada pelo usuário.");
        isAutomationRunning = true;
        // Notifica a UI que a automação começou
        getMainWindow()?.webContents.send('automation-state-changed', { isRunning: true });

        await startOrScheduleNextCycle(store, logToUI, sendTelegramNotification, false);
        return { success: true, message: "Automação iniciada." };
    });

    ipcMain.on("cancel-automation", () => {
        cancelAutomationHandler(logToUI, getMainWindow);
    });

    // NOVO: Handler para o frontend consultar o estado a qualquer momento
    ipcMain.handle("get-automation-status", () => getAutomationStatus());
}

function cancelAutomationHandler(logToUI, getMainWindow) {
    if (!isAutomationRunning) return; // Não faz nada se já estiver parada

    logToUI("[INFO] Automação cancelada pelo usuário.");
    
    if (executionInterval) {
        clearInterval(executionInterval);
        executionInterval = null;
    }
    if (futureScheduleTimeout) {
        clearTimeout(futureScheduleTimeout);
        futureScheduleTimeout = null;
    }
    
    dailySchedule = [];
    isAutomationRunning = false;
    
    // Notifica a UI que a automação parou
    getMainWindow()?.webContents.send('automation-state-changed', { isRunning: false });
    logToUI("[INFO] Automação interrompida com sucesso.");
}

module.exports = { initAutomation, cancelAutomationHandler };