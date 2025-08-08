// Arquivo agora em: electron/main.js
const { app, BrowserWindow, ipcMain, dialog, Notification, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const keytar = require('keytar');
const { expect } = require('playwright/test');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const { exec, fork } = require('child_process');
const util = require('util');

const store = new Store();
const KEYTAR_SERVICE_NAME = 'MeuPontoAutomatizado';
const TELEGRAM_BOT_TOKEN = '7391147858:AAFt8DP14NgxZin3Bgr9i5q2FZO1-i7gcAk';

const LOCAL_BROWSERS_PATH = path.join(app.getPath('userData'), 'playwright-browsers');
let activeBrowserExecutablePath = null; // Caminho para o executável que será usado

let mainWindow;
let playwrightBrowser;
let automationTimers = [];
let automationIsRunning = false;
let automationCurrentRetries = 0;
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 2000;
const CINCO_MINUTOS = 5 * 60 * 1000;
const UM_MINUTO = 60 * 1000;
const CINCO_SEGUNDOS = 5 * 1000;

autoUpdater.autoDownload = false; // MUITO IMPORTANTE: Desativa o download automático.
autoUpdater.autoInstallOnAppQuit = true; // Instala na próxima vez que o app for fechado.

// --- Helper Functions ---
function logToRenderer(level, message) {
  if (mainWindow) {
    mainWindow.webContents.send('log-from-main', { level, message });
  }
  console.log(`[${level}] ${message}`);
}

function updateAutomationStatusInRenderer(statusMessage, currentTask = null, isRunning = automationIsRunning) {
  if (mainWindow) {
    mainWindow.webContents.send('automation-status-update', { isRunning, statusMessage, currentTask });
  }
}

// --- Settings Persistence ---
ipcMain.handle('load-settings', async () => {
  return store.get('userSettings');
});

ipcMain.on('save-settings', (event, settings) => {
  store.set('userSettings', settings);
});

// --- Credential Management ---
ipcMain.handle('get-credential', async (event, account) => {
  try {
    return await keytar.getPassword(KEYTAR_SERVICE_NAME, account);
  } catch (error) {
    logToRenderer('ERRO', `Erro ao obter credenciais para ${account}: ${error.message}`);
    return null;
  }
});

ipcMain.on('set-credential', async (event, { account, password }) => {
  try {
    await keytar.setPassword(KEYTAR_SERVICE_NAME, account, password);
    logToRenderer('INFO', `Credencial salva para ${account}.`);
  } catch (error) {
    logToRenderer('ERRO', `Erro ao salvar credenciais para ${account}: ${error.message}`);
  }
});

ipcMain.on('delete-credential', async (event, account) => {
  try {
    await keytar.deletePassword(KEYTAR_SERVICE_NAME, account);
    logToRenderer('INFO', `Credencial apagada para ${account}.`);
  } catch (error) {
    logToRenderer('ERRO', `Erro excluindo credencial para ${account}: ${error.message}`);
  }
});


// --- Automation Browser Management (Playwright) ---

// Função auxiliar para usar glob sem dependência adicional
function findChromiumDir() {
    if (!fs.existsSync(LOCAL_BROWSERS_PATH)) return null;
    
    const dirs = fs.readdirSync(LOCAL_BROWSERS_PATH);
    for (const dir of dirs) {
        if (dir.startsWith('chromium-')) {
            return path.join(LOCAL_BROWSERS_PATH, dir);
        }
    }
    return null;
}

async function checkPlaywrightBrowser() {
    logToRenderer('INFO', 'Iniciando verificação inteligente do navegador de automação...');
    activeBrowserExecutablePath = null;

    try {
        const playwright = require('playwright');
        
        // 1. Verifica instalação local primeiro
        const chromiumDir = findChromiumDir();
        if (chromiumDir) {
            logToRenderer('DEBUG', `Diretório Chromium encontrado: ${chromiumDir}`);
            
            let execPath;
            if (process.platform === 'win32') {
                execPath = path.join(chromiumDir, 'chrome-win', 'chrome.exe');
            } else if (process.platform === 'darwin') {
                execPath = path.join(chromiumDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
            } else {
                execPath = path.join(chromiumDir, 'chrome-linux', 'chrome');
            }
            
            if (fs.existsSync(execPath)) {
                logToRenderer('SUCESSO', `Navegador encontrado localmente: ${execPath}`);
                activeBrowserExecutablePath = execPath;
                process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_PATH;
                return 'OK';
            }
        }
        
        // 2. Verifica instalação global
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
        const globalPath = playwright.chromium.executablePath();
        if (fs.existsSync(globalPath)) {
            logToRenderer('SUCESSO', `Navegador encontrado globalmente: ${globalPath}`);
            activeBrowserExecutablePath = globalPath;
            return 'OK';
        }
        
    } catch (e) {
        logToRenderer('ERRO', `Erro na verificação: ${e.message}`);
    }

    logToRenderer('ERRO', 'Nenhuma instalação do Playwright detectada.');
    return 'MISSING';
}

// NOVA FUNÇÃO AUXILIAR
function findExecutableInPath(command) {
  return new Promise((resolve) => {
    // 'which' (no macOS/Linux) e 'where' (no Windows) são comandos do sistema
    // para encontrar executáveis no PATH.
    const checkCommand = process.platform === 'win32' ? `where ${command}` : `which ${command}`;

    exec(checkCommand, (error, stdout) => {
      if (!error && stdout) {
        // Pega a primeira linha da saída e remove espaços em branco.
        const executablePath = stdout.trim().split('\n')[0];
        resolve(executablePath);
      } else {
        resolve(null); // Não encontrado
      }
    });
  });
}

ipcMain.handle('check-automation-browser', async () => {
  return await checkPlaywrightBrowser();
});

ipcMain.on('reinstall-automation-browser', async () => {
    logToRenderer('INFO', 'Iniciando processo de instalação autocontida do navegador...');
    updateAutomationStatusInRenderer('Instalando navegador de automação...', null, false);
    if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'CARREGANDO');

    try {
        // Cria o diretório se não existir
        fs.mkdirSync(LOCAL_BROWSERS_PATH, { recursive: true });
        
        // Define a variável de ambiente ANTES da instalação
        process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_PATH;
        
        // Busca o CLI do Playwright
        const playwrightCliPath = require.resolve('playwright/cli.js');
        if (!fs.existsSync(playwrightCliPath)) {
            throw new Error(`CLI do Playwright não encontrado em: ${playwrightCliPath}`);
        }
        
        logToRenderer('DEBUG', `Instalando em: ${LOCAL_BROWSERS_PATH}`);
        logToRenderer('DEBUG', `Usando CLI: ${playwrightCliPath}`);
        
        await new Promise((resolve, reject) => {
            const child = fork(
                playwrightCliPath,
                ['install', 'chromium', '--with-deps'],
                { 
                    stdio: 'pipe', 
                    env: { 
                        ...process.env, 
                        PLAYWRIGHT_BROWSERS_PATH: LOCAL_BROWSERS_PATH 
                    } 
                }
            );
            
            child.stdout.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) logToRenderer('DEBUG', `[Install]: ${msg}`);
            });
            
            child.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) logToRenderer('DEBUG', `[Install Error]: ${msg}`);
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    logToRenderer('SUCESSO', 'Instalação do Chromium concluída.');
                    resolve();
                } else {
                    reject(new Error(`Instalação falhou com código ${code}`));
                }
            });
            
            child.on('error', reject);
        });

        // Aguarda um momento para garantir que os arquivos foram escritos
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Re-verifica após instalação
        const status = await checkPlaywrightBrowser();
        
        if (status === 'OK') {
            logToRenderer('SUCESSO', 'Navegador instalado e verificado com sucesso!');
            if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'OK');
            updateAutomationStatusInRenderer('Navegador de automação pronto.', null, false);
        } else {
            throw new Error('Instalação concluída mas verificação falhou');
        }

    } catch (error) {
        logToRenderer('ERRO', `Falha na instalação: ${error.message}`);
        if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'FALTANDO');
        updateAutomationStatusInRenderer('Falha ao instalar navegador.', null, false);
        dialog.showErrorBox("Erro de Instalação", `Não foi possível instalar o navegador: ${error.message}`);
    }
});


// --- Telegram Notification ---
async function sendTelegramNotification(token, chatId, message) {
  if (!chatId) {
    logToRenderer('AVISO', 'Chat ID do Telegram não foi fornecido. Pulando notificação.');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const data = JSON.stringify({ chat_id: chatId, text: message });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // use Buffer.byteLength para contar bytes UTF-8
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logToRenderer('SUCESSO', 'Notificação do Telegram enviada com sucesso.');
          resolve(JSON.parse(responseBody));
        } else {
          logToRenderer('ERRO', `Telegram API error: ${res.statusCode} - ${responseBody}`);
          reject(new Error(`Telegram API error: ${res.statusCode}`));
        }
      });
    });
    req.on('error', (error) => {
      logToRenderer('ERRO', `Falha ao enviar notificação no Telegram: ${error.message}`);
      reject(error);
    });
    req.write(data);
    req.end();
  });
}

// --- Playwright Automation Logic ---
let automationSchedule = {};
let userCredentials = {};
let currentAutomationSettings = {};
let nextPunchTimer = null;

async function runAutomationStep(stepFunction, ...args) {
  if (!automationIsRunning) {
    logToRenderer('INFO', 'A automação foi cancelada, pulando passo.');
    return { success: false, critical: false, stopRequest: true };
  }
  try {
    const result = await stepFunction(...args); // Capture result for existingPoints
    automationCurrentRetries = 0;
    return { success: true, data: result }; // Pass data back
  } catch (error) {
    logToRenderer('ERRO', `O passo da automação falhou: ${error.message}`);
    automationCurrentRetries++;
    if (automationCurrentRetries > MAX_RETRIES) {
      logToRenderer('ERRO', `Máximo de tentativas alcançado. Parando automação.`);
      updateAutomationStatusInRenderer('Erro crítico, automação parada.', 'Falha Max. Tentativas');
      await stopAutomationLogic();
      return { success: false, critical: true };
    } else {
      logToRenderer('AVISO', `tentando novamente (${automationCurrentRetries}/${MAX_RETRIES})...`);
      updateAutomationStatusInRenderer(`Falha, tentando novamente (${automationCurrentRetries}/${MAX_RETRIES})...`, error.message.substring(0, 50));
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL * automationCurrentRetries));
      return runAutomationStep(stepFunction, ...args);
    }
  }
}


async function launchPlaywright() {
    if (playwrightBrowser) return playwrightBrowser;
    logToRenderer('INFO', 'Iniciando navegador de automação...');
    updateAutomationStatusInRenderer('Iniciando navegador de automação...');
    
    // Re-verifica o caminho caso tenha sido instalado após o início do app
    await checkPlaywrightBrowser(); 

    if (!activeBrowserExecutablePath) {
        throw new Error("Nenhum executável do navegador Playwright foi encontrado.");
    }
    
    try {
        const playwright = require('playwright');
        logToRenderer('DEBUG', `Tentando iniciar o navegador em: ${activeBrowserExecutablePath}`);

        // Se estamos usando a instalação local, garante que a variável está definida
        if (activeBrowserExecutablePath.includes(LOCAL_BROWSERS_PATH)) {
            process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_PATH;
        }

        playwrightBrowser = await playwright.chromium.launch({
            headless: true,
            executablePath: activeBrowserExecutablePath
        });
        logToRenderer('SUCESSO', 'Playwright browser iniciado com sucesso.');
        return playwrightBrowser;
    } catch (launchError) {
        logToRenderer('ERRO', `Falha ao iniciar Playwright browser: ${launchError.message}`);
        if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'FALTANDO');
        throw launchError;
    }
}

async function closePlaywright() {
  if (playwrightBrowser) {
    logToRenderer('INFO', 'Fechando Playwright browser...');
    try {
      await playwrightBrowser.close();
    } catch (closeError) {
      logToRenderer('AVISO', `Erro ao fechar Playwright browser: ${closeError.message}. Já pode estar fechado ou não está respondendo.`);
    } finally {
      playwrightBrowser = null;
      logToRenderer('INFO', 'Instância do Playwright browser finalizada.');
    }
  }
}

async function loginToPortal(page, folha, senha) {
  logToRenderer('INFO', `Realizando login na folha: ${folha}`);
  updateAutomationStatusInRenderer('Realizando login no portal...');
  await page.goto('https://centraldofuncionario.com.br/50911', { waitUntil: 'domcontentloaded' });

  //await findElement('#login-numero-folha');
  await page.locator('#login-numero-folha').fill(folha);
  //await page.fill('#login-numero-folha', folha);

  //await findElement('#login-senha');
  await page.locator('#login-senha').fill(senha);
  //await page.fill('#login-senha', senha);

  await page.locator('#login-entrar').click();
  //await page.click('#login-entrar');

  //await findElement('#menu-incluir-ponto');
  await page.waitForLoadState();
  await page.locator('#menu-incluir-ponto').click();
  //await page.click('#menu-incluir-ponto');

  await expect(page.locator('#localizacao-incluir-ponto')).toContainText('Incluir Ponto');
  // await findElement('#app-shell-desktop-content');
  // await findElement('#localizacao-incluir-ponto');


  try {
    await page.waitForURL('**/incluir-ponto', { timeout: 10000 });
    logToRenderer('SUCESSO', 'Logado com sucesso.');
  } catch (e) {
    logToRenderer('ERRO', 'Falha no login. Não foi possível verificar a navegação no painel.');
    if (page && !page.isClosed()) {
      try {
        const screenshotPath = `error_login_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        logToRenderer('DEBUG', `Screenshot taken: ${screenshotPath}`);
      } catch (ssError) {
        logToRenderer('ERRO', `Failed to take screenshot during login error: ${ssError.message}`);
      }
    }
    throw new Error('Falha no login: o painel não respondeu.');
  }
}

function calcHeartbeatInterval(ms) {
  console.log('TEMPO RESTANTE: ', ms);

  // Se falta mais de 1 minuto, use intervalos fixos e mais longos.
  if (ms > CINCO_MINUTOS) {
    return CINCO_MINUTOS;
  }
  if (ms > UM_MINUTO) {
    return UM_MINUTO;
  }

  // Se falta menos de 1 minuto, o próximo check deve ser mais preciso.
  // Pode ser o tempo restante, mas não menos que 5 segundos para evitar spam.
  return Math.max(ms, CINCO_SEGUNDOS);
}

async function syncInitialPoints(page) {
  logToRenderer('INFO', 'Sincronizando pontos iniciais...');
  updateAutomationStatusInRenderer('Sincronizando pontos existentes...');
  try {
    const todayDateString = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    });

    const statusSelector = '[id^="status-processamento-"]';
    //await page.locator(statusSelector).waitFor();   // espera os elementos aparecerem
    await page.waitForSelector(statusSelector);
    // Opção 1 – page.evaluate (serve para Playwright ou Puppeteer)
    const allScrapedEntries = await page.evaluate(selector => {
      return Array.from(document.querySelectorAll(selector))
        .map(statusEl => {
          const timeElement = statusEl.previousElementSibling;

          if (timeElement && timeElement.textContent) {
            const fullText = timeElement.textContent.trim();      // "17/06 - 23:14"
            const dateMatch = fullText.match(/\d{2}\/\d{2}/);
            const timeMatch = fullText.match(/\d{2}:\d{2}/);

            if (dateMatch && timeMatch) {
              return { date: dateMatch[0], time: timeMatch[0] };
            }
          }
          return null;
        })
        .filter(Boolean);   // remove nulos
    }, statusSelector);

    // Passo 2: Filtra a lista para manter apenas os registros de hoje.
    const todaysPunches = allScrapedEntries
      .filter(entry => entry.date === todayDateString)
      .map(entry => entry.time);

    // Passo 3: Ordena os horários de hoje para garantir a ordem cronológica.
    const sortedPunches = [...todaysPunches].sort();

    logToRenderer('INFO', `Pontos encontrados para HOJE (${todayDateString}): ${sortedPunches.length > 0 ? sortedPunches.join(', ') : 'Nenhum'}`);
    return sortedPunches;
  } catch (error) {
    if (error.name === 'TimeoutError') {
      logToRenderer('INFO', 'Nenhum ponto registrado foi encontrado na página.');
      return [];
    }
    logToRenderer('INFO', 'Erro não crítico ao tentar sincronizar pontos: ' + error.message);
    return [];
  }
}

function getNextPunch(currentSchedule, existingPoints) {
  logToRenderer('INFO', 'Determinando próxima batida...');
  console.log('EXISTENTE EM getNextPunch: ', existingPoints);
  const now = new Date();
  const dayOfWeekPT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const todayPT = now.toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase();

  // Encontra o índice de hoje para começar a busca
  let currentDayIndex = dayOfWeekPT.indexOf(todayPT);
  if (currentDayIndex === -1) { // Fallback se toLocaleDateString não for esperado
    currentDayIndex = now.getDay(); // 0 (Sun) - 6 (Sat)
  }

  // Mapeia chaves normalizadas para as chaves originais para eficiência
  const scheduleKeyMap = Object.keys(currentSchedule).reduce((map, key) => {
    const normalizedKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    map[normalizedKey] = key;
    return map;
  }, {});

  // Iterar pelos próximos 7 dias (incluindo hoje)
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + i);
    const checkDayPT = checkDate.toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase();

    // Normaliza o dia da semana gerado para corresponder ao formato das chaves
    const normalizedDay = checkDayPT.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const originalScheduleKey = scheduleKeyMap[normalizedDay];

    if (originalScheduleKey && currentSchedule[originalScheduleKey] && !currentSchedule[originalScheduleKey].feriado) {
      const daySchedule = currentSchedule[originalScheduleKey];
      const punchOrder = ['entrada1', 'saida1', 'entrada2', 'saida2'];

      for (const punchType of punchOrder) {
        if (daySchedule[punchType]) {
          const [hours, minutes] = daySchedule[punchType].split(':').map(Number);

          console.log('RETORNO ', hours, minutes)

          let punchDateTime = new Date(checkDate);
          punchDateTime.setHours(hours, minutes, 0, 0);

          // Pula se o horário já passou NO DIA DE HOJE
          if (i === 0 && punchDateTime.getTime() < now.getTime()) {
            continue;
          }

          // Check if this punch already exists for this specific punchDateTime
          const isExisting = existingPoints.some(ep => {
            // 1. Normaliza entrada ---------------------------------------------
            // Se vier só string "07:00", converte para objeto usando a data do punch
            if (typeof ep === 'string') {
              ep = { date: '', time: ep };
            }

            // Se ainda faltar date ou time, ignora o item
            if (!ep || !ep.time) return false;

            /* ------------------ PARSE DA DATA ------------------ */
            const [dayStr = '', monthStr = '', yearStr = ''] = (ep.date || '').split('/');
            const [hourStr, minuteStr] = ep.time.split(':');

            // Usa data/hora do punch se algum campo estiver faltando
            const base = punchDateTime;

            const year = yearStr
              ? (yearStr.length === 2 ? 2000 + +yearStr : +yearStr)
              : base.getFullYear();

            const month = monthStr ? +monthStr - 1 : base.getMonth(); // 0-based
            const day = dayStr ? +dayStr : base.getDate();

            const hour = hourStr ? +hourStr : base.getHours();
            const minute = minuteStr ? +minuteStr : base.getMinutes();

            const epDateObj = new Date(year, month, day, hour, minute);

            /* ------------- COMPARA COM punchDateTime ------------ */
            return epDateObj.getFullYear() === base.getFullYear() &&
              epDateObj.getMonth() === base.getMonth() &&
              epDateObj.getDate() === base.getDate() &&
              epDateObj.getHours() === base.getHours() &&
              epDateObj.getMinutes() === base.getMinutes();
          });

          if (!isExisting) {
            logToRenderer('INFO', `Próxima batida agendada: ${originalScheduleKey} - ${punchType} às ${daySchedule[punchType]} em ${punchDateTime.toLocaleDateString('pt-BR')}`);
            return { day: originalScheduleKey, type: punchType, time: daySchedule[punchType], dateTime: punchDateTime };
          }
        }
      }
    }
  }
  logToRenderer('INFO', 'Nenhuma batida próxima encontrada ou todas já realizadas.');
  return null;
}

async function performPunch(page, punchDetails) {
  logToRenderer('INFO', `Tentando registrar ponto: ${punchDetails.day} - ${punchDetails.type} às ${punchDetails.time}`);
  updateAutomationStatusInRenderer(`Registrando ${punchDetails.type}...`);

  // 1. Clicar no botão para registrar o ponto
  await page.locator('#localizacao-incluir-ponto').click({ timeout: 15000 });
  logToRenderer('DEBUG', 'Clique para registrar o ponto efetuado. Iniciando verificação...');

  // 2. Lógica de verificação com retentativas (Polling)
  const maxVerificationRetries = 5; // Tentar verificar 5 vezes
  const verificationInterval = 5000; // Esperar 5 segundos entre cada tentativa
  let punchVerified = false;

  for (let i = 1; i <= maxVerificationRetries; i++) {
    logToRenderer('DEBUG', `Tentativa de verificação ${i}/${maxVerificationRetries}...`);

    // Sincroniza a lista de pontos da página.
    const updatedPoints = await syncInitialPoints(page);

    // Checa se a batida esperada está na lista atualizada.
    if (updatedPoints.includes(punchDetails.time)) {
      punchVerified = true;
      break; // Sucesso! Sai do loop de verificação.
    }

    // Se não encontrou e não é a última tentativa, espera antes de tentar de novo.
    if (i < maxVerificationRetries) {
      await new Promise(resolve => setTimeout(resolve, verificationInterval));
    }
  }

  // 3. Avaliar o resultado da verificação
  if (punchVerified) {
    logToRenderer('SUCESSO', `Ponto ${punchDetails.type} (${punchDetails.time}) registrado e VERIFICADO com sucesso.`);
    try {
      await sendTelegramNotification(
        TELEGRAM_BOT_TOKEN,
        currentAutomationSettings.telegramChatId,
        `Ponto ${punchDetails.type} às ${punchDetails.time} registrado com sucesso! 🟢`
      );
    } catch (err) {
      logToRenderer('AVISO', `Falha ao enviar notificação Telegram: ${err.message}`);
    }
    return 'success';
  } else {
    // Se após todas as tentativas o ponto não foi encontrado, aí sim é uma falha.
    logToRenderer('ERRO', `Falha na verificação do ponto ${punchDetails.type} (${punchDetails.time}). O ponto não apareceu na lista após várias tentativas.`);

    try {
      const screenshotPath = `error_verification_failed_${Date.now()}.png`;
      await page.screenshot({ path: path.join(app.getPath('userData'), screenshotPath) });
      logToRenderer('DEBUG', `Screenshot da falha de verificação salvo em: ${screenshotPath}`);
    } catch (ssError) {
      logToRenderer('ERRO', `Falha ao tirar screenshot: ${ssError.message}`);
    }

    try {
      await sendTelegramNotification(
        TELEGRAM_BOT_TOKEN,
        currentAutomationSettings.telegramChatId,
        `Falha ao registrar ponto ${punchDetails.type} às ${punchDetails.time} 🔴 Verifique e faça o registro manualmente!`
      );
    } catch (err) {
      logToRenderer('AVISO', `Falha ao enviar notificação Telegram: ${err.message}`);
    }

    // Lança um erro para que a lógica de retry de 'runAutomationStep' seja acionada.
    throw new Error(`Verificação pós-batida falhou para o horário ${punchDetails.time}.`);
  }
}

function scheduleNextAutomationHeartbeat(nextPunch) {

  clearTimeout(nextPunchTimer);
  nextPunchTimer = null; // Clear previous timer explicitly

  if (!nextPunch || !automationIsRunning) {
    logToRenderer('INFO', 'Nenhuma próxima batida para agendar ou automação parada.');
    updateAutomationStatusInRenderer('Automação concluída ou sem próximas tarefas.', null, false);
    stopAutomationLogic(); // Call this to ensure browser closes if no more tasks
    return;
  }

  const timeToPunch = nextPunch.dateTime.getTime() - Date.now();
  const tolerance = 10 * 1000; // 10 segundos de tolerância para bater

  if (timeToPunch < -tolerance) { // Já passou muito da hora
    logToRenderer('AVISO', `Batida ${nextPunch.type} às ${nextPunch.time} em ${nextPunch.dateTime.toLocaleDateString('pt-BR')} já passou. Pulando e reagendando.`);
    syncAndGetNext().then(newNextPunch => scheduleNextAutomationHeartbeat(newNextPunch));
    return;
  }

  // Heartbeat a cada 5 minutos, ou mais perto se a batida estiver próxima
  // Se timeToPunch é negativo mas dentro da tolerância, bater imediatamente (heartbeat=0)
  // const heartbeatInterval = Math.max(0, Math.min(timeToPunch, 5 * 60 * 1000));
  const heartbeatInterval = calcHeartbeatInterval(timeToPunch);

  logToRenderer('INFO', `Próxima verificação/batida em ${Math.round(heartbeatInterval / 1000)}s para ${nextPunch.type} @ ${nextPunch.time} de ${nextPunch.dateTime.toLocaleDateString('pt-BR')}`);
  updateAutomationStatusInRenderer(`Aguardando ${nextPunch.type} às ${nextPunch.time} de ${nextPunch.dateTime.toLocaleDateString('pt-BR')}`);

  nextPunchTimer = setTimeout(async () => {
    if (!automationIsRunning) return;

    const currentTime = Date.now();
    if (currentTime >= nextPunch.dateTime.getTime() && currentTime <= nextPunch.dateTime.getTime() + tolerance) {
      logToRenderer('INFO', `Hora de bater o ponto para ${nextPunch.type}!`);
      const context = await playwrightBrowser.newContext(
        {
          // Spoof properties to appear more human
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          locale: 'pt-BR', // Match the target application's language
          timezoneId: 'America/Sao_Paulo',
        }
      );
      const page = await context.newPage();
      let punchSuccessful = false;
      try {
        await runAutomationStep(loginToPortal, page, userCredentials.folha, userCredentials.senha);
        const punchResult = await runAutomationStep(performPunch, page, nextPunch);
        punchSuccessful = punchResult.success && punchResult.data === 'success';
      } catch (e) {
        logToRenderer('ERRO', `Erro crítico durante o processo de batida ${nextPunch.type}: ${e.message}`);
      } finally {
        if (page && !page.isClosed()) await page.close();
      }
      // Só reagenda se o ponto foi batido com sucesso, para pegar novos pontos existentes.
      // Se falhou, a lógica de retry em runAutomationStep já tentou. Se esgotou, a automação parou.
      // Se não foi crítico, mas falhou (ex: performPunch retornou 'failed'), precisa decidir se reagenda ou para.
      // Por agora, reagendaremos para reavaliar a situação.
      const newNextPunch = await syncAndGetNext();
      scheduleNextAutomationHeartbeat(newNextPunch);

    } else if (currentTime < nextPunch.dateTime.getTime()) { // Ainda não é hora, reagendar heartbeat
      scheduleNextAutomationHeartbeat(nextPunch);
    } else { // Passou da janela de tolerância
      logToRenderer('AVISO', `Janela de tolerância para ${nextPunch.type} @ ${nextPunch.time} perdida.`);
      const newNextPunch = await syncAndGetNext();
      scheduleNextAutomationHeartbeat(newNextPunch);
    }
  }, heartbeatInterval);
  automationTimers.push(nextPunchTimer); // Keep track of active timers for cleanup
}

async function syncAndGetNext() {
  if (!playwrightBrowser || !automationIsRunning) return null;
  const context = await playwrightBrowser.newContext(
    {
      // Spoof properties to appear more human
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'pt-BR', // Match the target application's language
      timezoneId: 'America/Sao_Paulo',
    }
  );
  const page = await context.newPage();
  let nextPunchData = null;
  try {
    await runAutomationStep(loginToPortal, page, userCredentials.folha, userCredentials.senha);
    const existingPointsResult = await runAutomationStep(syncInitialPoints, page);

    // Se runAutomationStep parou a automação devido a retentativas críticas, existingPointsResult.critical será true
    if (existingPointsResult.success === false && existingPointsResult.critical) {
      return null; // A automação já foi parada
    }

    console.log(existingPointsResult.success);
    console.log('PONTOS EXISTENTES ', existingPointsResult.data);

    nextPunchData = getNextPunch(automationSchedule, existingPointsResult.success ? existingPointsResult.data : []);
  } catch (e) {
    logToRenderer('ERRO', `Erro durante syncAndGetNext: ${e.message}`);
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
  return nextPunchData;
}


ipcMain.on('start-automation', async (event, { schedule, credentials, settings }) => {
  if (automationIsRunning) {
    logToRenderer('AVISO', 'A automação já está rodando.');
    return;
  }
  automationIsRunning = true;
  automationCurrentRetries = 0;
  automationSchedule = schedule;
  userCredentials = credentials;
  currentAutomationSettings = settings;

  logToRenderer('INFO', '--- Automação Iniciada ---');
  updateAutomationStatusInRenderer('Iniciando automação...', 'Preparando...');

  try {
    await launchPlaywright(); // launchPlaywright agora atualiza o status se o browser estiver faltando
    if (!playwrightBrowser) {
      // launchPlaywright já teria enviado status 'MISSING' se o erro fosse 'Executable doesn't exist'
      // Este throw é para outros erros de lançamento não tratados especificamente em launchPlaywright
      throw new Error("Falha ao iniciar o navegador Playwright após tentativas.");
    }

    const nextPunch = await syncAndGetNext();
    scheduleNextAutomationHeartbeat(nextPunch);

  } catch (error) {
    logToRenderer('ERRO', `Erro crítico ao inicar automação: ${error.message}`);
    // A mensagem de status para o renderer já deve ter sido atualizada por launchPlaywright se o erro foi específico de browser faltando
    // Caso contrário, atualizamos aqui.
    if (!error.message.includes("Executable doesn't exist")) {
      updateAutomationStatusInRenderer(`Erro crítico: ${error.message}`, 'Falha Inicialização', false);
    }
    await stopAutomationLogic();
  }
});


async function stopAutomationLogic() {
  if (!automationIsRunning && automationTimers.length === 0 && !playwrightBrowser) {
    logToRenderer('DEBUG', 'stopAutomationLogic called, but nothing to stop.');
    return;
  }

  logToRenderer('INFO', `--- Interrompendo Automação (isRunning: ${automationIsRunning}) ---`);
  automationIsRunning = false; // Garante que novas operações não iniciem

  automationTimers.forEach(timerId => clearTimeout(timerId));
  automationTimers = [];
  if (nextPunchTimer) {
    clearTimeout(nextPunchTimer);
    nextPunchTimer = null;
  }

  updateAutomationStatusInRenderer('Automação interrompida.', null, false);
  await closePlaywright(); // Garante que o navegador seja fechado
  logToRenderer('INFO', '--- Automação Efetivamente Parada ---');
}

ipcMain.on('stop-automation', async () => {
  await stopAutomationLogic();
});


const IS_PACKAGED = app.isPackaged;

// --- Electron App Lifecycle ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 1000,
    minWidth: 1000,
    minHeight: 900,
    frame: true,
    webPreferences: {
      preload: process.env.ELECTRON_PRELOAD_URL || path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));


  ipcMain.on('minimize-window', () => mainWindow && mainWindow.minimize());
  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });
  ipcMain.on('close-window', () => mainWindow && mainWindow.close());

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Não chame stopAutomationLogic aqui diretamente, pois 'will-quit' já cuida disso.
    // Chamar aqui pode levar a tentativas de fechar um browser já fechado ou em processo de fechamento.
  });
}

let blockerId = null;

function startNoSleep() {
  if (blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
    logToRenderer('DEBUG', `powerSaveBlocker ativo, id = ${blockerId}`);
  }
}

function stopNoSleep() {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
    logToRenderer('DEBUG', 'powerSaveBlocker encerrado');
    blockerId = null;
  }
}

// Inicie quando a automação começar:
app.whenReady().then(() => {
  startNoSleep();
  createWindow();
  // ===============================================
  // LÓGICA DO AUTO-UPDATER
  // ===============================================
  // Após a janela ser criada, verifique por atualizações.
  // Não use checkForUpdatesAndNotify() pois ele mostra uma notificação nativa.
  // Queremos controle total da UI.
  autoUpdater.checkForUpdates();

  // Adicione um log para o updater
  autoUpdater.logger = {
    info: (msg) => logToRenderer('INFO', `[Updater] ${msg}`),
    warn: (msg) => logToRenderer('AVISO', `[Updater] ${msg}`),
    error: (msg) => logToRenderer('ERRO', `[Updater] ${msg}`),
  };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Encerre ao terminar a automação ou ao sair:
app.on('before-quit', stopNoSleep);

app.on('will-quit', async () => { // Tornar async para aguardar stopAutomationLogic
  logToRenderer('INFO', 'Evento will-quit recebido. Encerrando automação e navegador...');
  await stopAutomationLogic();
  logToRenderer('INFO', 'Recursos da automação liberados. Aplicativo encerrando.');
});


app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('uncaughtException', (error, origin) => {
  const message = `Ocorreu um erro não tratado no processo principal:
  Origem: ${origin}
  Nome: ${error.name}
  Mensagem: ${error.message}
  Stack: ${error.stack}`;

  console.error(message);

  // No ambiente de produção, mostra um diálogo para o usuário.
  // Verificamos se 'app' e 'dialog' estão disponíveis para evitar erros durante a inicialização.
  if (app && dialog && app.isPackaged) {
    dialog.showErrorBox('Erro Crítico Inesperado', message);
  }

  // É importante encerrar o processo após um erro não tratado para evitar estado instável.
  process.exit(1);
});

// ===============================================
// LISTENERS DE EVENTOS DO AUTO-UPDATER
// ===============================================

// Evento: Nova atualização encontrada.
autoUpdater.on('update-available', (info) => {
  logToRenderer('SUCESSO', `Nova versão encontrada: ${info.version}`);
  // Envia a informação para a UI para mostrar a notificação.
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

// Evento: Nenhuma atualização encontrada.
autoUpdater.on('update-not-available', () => {
  logToRenderer('INFO', 'Nenhuma nova atualização disponível.');
});

// Evento: Erro durante a atualização.
autoUpdater.on('error', (err) => {
  logToRenderer('ERRO', `Erro no auto-updater: ${err.message}`);
});

// Evento: Progresso do download.
autoUpdater.on('download-progress', (progressObj) => {
  const logMessage = `Velocidade: ${Math.round(progressObj.bytesPerSecond / 1024)} KB/s - Baixado ${Math.round(progressObj.percent)}% (${Math.round(progressObj.transferred / 1024)}/${Math.round(progressObj.total / 1024)} KB)`;
  // Envia o progresso para a UI para atualizar a barra.
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', progressObj);
  }
});

// Evento: Download da atualização concluído.
autoUpdater.on('update-downloaded', (info) => {
  logToRenderer('SUCESSO', `Versão ${info.version} baixada. Pronta para instalar.`);
  // Envia para a UI para mostrar o botão "Reiniciar e Instalar".
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
});

// ===============================================
// HANDLERS IPC PARA AÇÕES DO USUÁRIO
// ===============================================

// Usuário clicou no botão "Baixar"
ipcMain.on('download-update', () => {
  logToRenderer('INFO', 'Usuário iniciou o download da atualização.');
  autoUpdater.downloadUpdate();
});

// Usuário clicou no botão "Reiniciar e Instalar"
ipcMain.on('install-update', () => {
  logToRenderer('INFO', 'Usuário iniciou a instalação da atualização.');
  autoUpdater.quitAndInstall();
});