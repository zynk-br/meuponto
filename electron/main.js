// Arquivo agora em: electron/main.js
const { app, BrowserWindow, ipcMain, dialog, Notification, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const keytar = require('keytar');
const { expect } = require('playwright/test');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const { exec, fork, execSync, spawn } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);
const LOCAL_BROWSERS_PATH = path.join(app.getPath('userData'), 'playwright-browsers');

const store = new Store();
const KEYTAR_SERVICE_NAME = 'MeuPontoAutomatizado';
const TELEGRAM_BOT_TOKEN = '7391147858:AAFt8DP14NgxZin3Bgr9i5q2FZO1-i7gcAk';

const POSSIBLE_BROWSER_PATHS = [];
let activeBrowserExecutablePath = null;
let playwrightBrowser = null;

let mainWindow;
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
  // Se logs detalhados estão desabilitados, filtra logs DEBUG
  if (!getDetailedLogsEnabled() && level === 'DEBUG') {
    return;
  }
  
  // Para usuários comuns, simplifica mensagens técnicas
  let displayMessage = message;
  if (!getDetailedLogsEnabled()) {
    displayMessage = simplifyLogMessage(level, message);
  }
  
  if (mainWindow) {
    mainWindow.webContents.send('log-from-main', { level, message: displayMessage });
  }
  console.log(`[${level}] ${displayMessage}`);
}

// Função para simplificar mensagens de log para usuários comuns
function simplifyLogMessage(level, message) {
  // Mapeamento de mensagens técnicas para mensagens amigáveis
  const simplifications = {
    'Iniciando busca abrangente por instalações do Playwright...': 'Procurando navegador...',
    'PATH atual:': 'Verificando sistema...',
    'PATH expandido:': 'Configurando ambiente...',
    'NPX encontrado em:': 'Navegador encontrado.',
    'Executando instalação do Chromium via spawn...': 'Instalando navegador...',
    'Tentando instalação via execPromise...': 'Tentando método alternativo...',
    'Spawn falhou:': 'Tentando método alternativo...',
    'Node.js não encontrado no PATH': 'Node.js não foi encontrado no sistema.',
    'NPM não encontrado no PATH': 'NPM não foi encontrado no sistema.',
    'Erro ao buscar versões NVM:': 'Verificando instalações do Node.js...',
    'Iniciando verificação completa do navegador Chromium...': 'Verificando navegador...',
    'Fazendo busca manual em': 'Procurando navegador nos diretórios do sistema...',
    'Nenhuma instalação válida do Chromium foi encontrada em todos os locais verificados': 'Navegador não encontrado. Será necessário instalar.',
    'Verificando Node.js e NPM...': 'Verificando dependências do sistema...',
    'Iniciando processo de instalação autocontida do navegador...': 'Preparando instalação do navegador...',
    'Página de download do Node.js aberta no navegador padrão.': 'Abrindo página de download do Node.js.',
    'Instalação via spawn bem-sucedida': 'Navegador instalado com sucesso!',
    'Instalação via execPromise concluída': 'Navegador instalado com sucesso!',
    'Navegador instalado e verificado com sucesso!': 'Navegador pronto para uso!',
    'Todos os métodos de instalação falharam:': 'Falha na instalação do navegador.',
    'Navegador previamente conhecido ainda válido:': 'Navegador encontrado.',
    'Playwright reportou navegador ativo em:': 'Navegador encontrado.',
    'Chromium encontrado via busca manual:': 'Navegador encontrado.',
    'Instalação via spawn concluída': 'Navegador instalado com sucesso!',
    'Instalação manual via spawn concluída com sucesso': 'Navegador instalado com sucesso!',
    'Localização:': 'Navegador configurado.',
  };
  
  // Verifica se a mensagem tem uma simplificação definida
  for (const [technical, simple] of Object.entries(simplifications)) {
    if (message.includes(technical)) {
      return simple;
    }
  }
  
  // Simplificações por padrão
  if (level === 'DEBUG') {
    if (message.includes('PATH') || message.includes('caminho')) return 'Configurando sistema...';
    if (message.includes('spawn') || message.includes('exec')) return 'Executando instalação...';
    if (message.includes('stdout') || message.includes('stderr')) return 'Processando instalação...';
    if (message.includes('Caminhos adicionais incluídos')) return 'Configurando caminhos do sistema...';
  }
  
  // Simplificações para mensagens SUCESSO com versões
  if (level === 'SUCESSO') {
    if (message.includes('Node.js') && message.includes('encontrado')) {
      return 'Node.js encontrado.';
    }
    if (message.includes('NPM') && message.includes('encontrado')) {
      return 'NPM encontrado.';
    }
  }
  
  // Simplificações para mensagens INFO com caminhos/localizações
  if (level === 'INFO') {
    if (message.includes('Pontos encontrados para HOJE')) {
      // Extrai os horários após o último ": "
      const afterColon = message.split('): ')[1];
      if (!afterColon || afterColon === 'Nenhum') {
        return 'Nenhum ponto registrado hoje.';
      }
      // Conta quantos horários existem (separados por vírgula)
      const count = afterColon.split(',').length;
      return `${count} ponto(s) registrado(s) hoje.`;
    }
  }
  
  // Se não há simplificação específica, retorna a mensagem original
  return message;
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

// --- Schedule Persistence ---
ipcMain.handle('load-schedule', async () => {
  return store.get('userSchedule');
});

ipcMain.on('save-schedule', (event, schedule) => {
  store.set('userSchedule', schedule);
});

// Configuração padrão para logs detalhados
function getDetailedLogsEnabled() {
  const userSettings = store.get('userSettings', {});
  return userSettings.detailedLogs || false; // Padrão: desativado
}

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

// Função para encontrar todos os possíveis caminhos do Playwright/Chromium
function findAllPossibleBrowserPaths() {
    const paths = [];
    const platform = process.platform;
    
    logToRenderer('DEBUG', 'Iniciando busca abrangente por instalações do Playwright...');
    
    // 1. Pasta local da aplicação (prioridade máxima)
    const localPath = path.join(app.getPath('userData'), 'playwright-browsers');
    paths.push(localPath);
    
    // 2. Pasta de cache padrão do Playwright (varia por OS)
    if (platform === 'win32') {
        // Windows: %USERPROFILE%\AppData\Local\ms-playwright
        const windowsPath = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
        if (windowsPath) paths.push(windowsPath);
        
        // Windows também pode usar %LOCALAPPDATA%
        const localAppDataPath = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
        if (localAppDataPath) paths.push(localAppDataPath);
    } else if (platform === 'darwin') {
        // macOS: ~/Library/Caches/ms-playwright
        const macPath = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
        if (macPath) paths.push(macPath);
        
        // macOS alternativo: ~/.cache/ms-playwright (usado por algumas versões)
        const macAltPath = path.join(process.env.HOME || '', '.cache', 'ms-playwright');
        if (macAltPath) paths.push(macAltPath);
    } else {
        // Linux: ~/.cache/ms-playwright
        const linuxPath = path.join(process.env.HOME || '', '.cache', 'ms-playwright');
        if (linuxPath) paths.push(linuxPath);
    }
    
    // 3. Variável de ambiente personalizada PLAYWRIGHT_BROWSERS_PATH
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        paths.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
    }
    
    // 4. Tenta usar o Playwright para descobrir o caminho padrão
    try {
        const playwright = require('playwright');
        if (playwright.chromium && playwright.chromium.executablePath) {
            const playwrightDefaultPath = playwright.chromium.executablePath();
            if (playwrightDefaultPath) {
                // Extrai o diretório de browsers a partir do executável
                const browsersDir = path.dirname(path.dirname(path.dirname(playwrightDefaultPath)));
                paths.push(browsersDir);
                logToRenderer('DEBUG', `Playwright informou diretório de browsers: ${browsersDir}`);
            }
        }
    } catch (e) {
        logToRenderer('DEBUG', `Não foi possível consultar Playwright para caminho padrão: ${e.message}`);
    }
    
    // 5. Instalação global do npm (se existir)
    try {
        const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const globalPlaywrightPath = path.join(npmRoot, 'playwright-chromium', '.local-browsers');
        paths.push(globalPlaywrightPath);
        
        // Também verifica se há uma instalação global direta
        const globalMsPlaywrightPath = path.join(npmRoot, 'ms-playwright');
        paths.push(globalMsPlaywrightPath);
    } catch (e) {
        logToRenderer('DEBUG', 'npm não disponível ou falhou na busca global');
    }
    
    // 6. Dentro do próprio app (se bundled)
    if (app.isPackaged) {
        const appPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright', '.local-browsers');
        paths.push(appPath);
        
        // Também verifica se há browsers no diretório de recursos
        const resourcesPath = path.join(process.resourcesPath, 'ms-playwright');
        paths.push(resourcesPath);
    }
    
    // 7. Caminhos específicos do projeto em desenvolvimento
    if (!app.isPackaged) {
        const projectPath = path.join(process.cwd(), 'node_modules', 'playwright', '.local-browsers');
        paths.push(projectPath);
    }
    
    const uniquePaths = [...new Set(paths)]; // Remove duplicatas
    logToRenderer('DEBUG', `Encontrados ${uniquePaths.length} caminhos possíveis para busca: ${uniquePaths.join(', ')}`);
    
    return uniquePaths;
}

// Função para encontrar o executável do Chromium em um diretório
function findChromiumExecutable(browserPath) {
    if (!fs.existsSync(browserPath)) return null;
    
    const platform = process.platform;
    const possibleExecutables = [];
    
    // Procura por diferentes versões do Chromium
    try {
        const dirs = fs.readdirSync(browserPath);
        const chromiumDirs = dirs.filter(dir => dir.startsWith('chromium-'));
        
        for (const chromiumDir of chromiumDirs) {
            const fullPath = path.join(browserPath, chromiumDir);
            
            if (platform === 'win32') {
                possibleExecutables.push(
                    path.join(fullPath, 'chrome-win', 'chrome.exe'),
                    path.join(fullPath, 'chrome-win64', 'chrome.exe'),
                    path.join(fullPath, 'chrome.exe')
                );
            } else if (platform === 'darwin') {
                possibleExecutables.push(
                    path.join(fullPath, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                    path.join(fullPath, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                    path.join(fullPath, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
                );
            } else {
                possibleExecutables.push(
                    path.join(fullPath, 'chrome-linux', 'chrome'),
                    path.join(fullPath, 'chrome'),
                    path.join(fullPath, 'chromium')
                );
            }
        }
    } catch (e) {
        logToRenderer('DEBUG', `Erro ao listar diretório ${browserPath}: ${e.message}`);
    }
    
    // Retorna o primeiro executável válido encontrado
    for (const exec of possibleExecutables) {
        if (fs.existsSync(exec)) {
            try {
                fs.accessSync(exec, fs.constants.X_OK); // Verifica se é executável
                return exec;
            } catch (e) {
                // Arquivo existe mas não é executável, continua procurando
            }
        }
    }
    
    return null;
}

// Função principal de verificação do navegador
async function checkPlaywrightBrowser(silentMode = false) {
    if (!silentMode) {
        logToRenderer('INFO', 'Iniciando verificação completa do navegador Chromium...');
    }
    activeBrowserExecutablePath = null;
    
    // Primeiro, verifica se já temos um caminho salvo que ainda é válido
    const lastKnown = store.get('lastKnownBrowserPath');
    if (lastKnown && fs.existsSync(lastKnown)) {
        if (!silentMode) {
            logToRenderer('SUCESSO', `Navegador previamente conhecido ainda válido: ${lastKnown}`);
        }
        activeBrowserExecutablePath = lastKnown;
        // Define variável de ambiente baseada no caminho conhecido
        process.env.PLAYWRIGHT_BROWSERS_PATH = path.dirname(path.dirname(lastKnown));
        return 'OK';
    }
    
    // Tenta usar a API do Playwright primeiro (mais confiável)
    try {
        const playwright = require('playwright');
        const browserPath = playwright.chromium.executablePath();
        
        if (browserPath && fs.existsSync(browserPath)) {
            if (!silentMode) {
                logToRenderer('SUCESSO', `Playwright reportou navegador ativo em: ${browserPath}`);
            }
            activeBrowserExecutablePath = browserPath;
            store.set('lastKnownBrowserPath', browserPath);
            // Define variável de ambiente baseada no caminho do Playwright
            process.env.PLAYWRIGHT_BROWSERS_PATH = path.dirname(path.dirname(path.dirname(browserPath)));
            return 'OK';
        } else if (browserPath) {
            if (!silentMode) {
                logToRenderer('AVISO', `Playwright reportou caminho, mas arquivo não existe: ${browserPath}`);
            }
        }
    } catch (e) {
        if (!silentMode) {
            logToRenderer('DEBUG', `Playwright não conseguiu fornecer caminho do executável: ${e.message}`);
        }
    }
    
    // Se o Playwright não conseguiu, faz busca manual em todos os caminhos
    const searchPaths = findAllPossibleBrowserPaths();
    if (!silentMode) {
        logToRenderer('INFO', `Fazendo busca manual em ${searchPaths.length} locais possíveis...`);
    }
    
    for (const searchPath of searchPaths) {
        if (!silentMode) {
            logToRenderer('DEBUG', `Verificando diretório: ${searchPath}`);
        }
        
        if (!fs.existsSync(searchPath)) {
            if (!silentMode) {
                logToRenderer('DEBUG', `Diretório não existe: ${searchPath}`);
            }
            continue;
        }
        
        const executable = findChromiumExecutable(searchPath);
        if (executable) {
            if (!silentMode) {
                logToRenderer('SUCESSO', `Chromium encontrado via busca manual: ${executable}`);
            }
            activeBrowserExecutablePath = executable;
            
            // Salva o caminho encontrado para uso futuro
            store.set('lastKnownBrowserPath', executable);
            
            // Define a variável de ambiente para o Playwright usar este caminho
            process.env.PLAYWRIGHT_BROWSERS_PATH = searchPath;
            
            return 'OK';
        }
    }
    
    // Se chegou aqui, não encontrou nada
    if (!silentMode) {
        logToRenderer('AVISO', 'Nenhuma instalação válida do Chromium foi encontrada em todos os locais verificados');
    }
    if (!silentMode) {
        logToRenderer('DEBUG', `Locais verificados: ${searchPaths.join(', ')}`);
    }
    
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

// Função para encontrar Node.js/NPM com PATH expandido
function getExpandedPath() {
  let pathEnv = process.env.PATH || '';
  
  // Adiciona caminhos comuns onde Node.js pode estar instalado
  let commonPaths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin', // Homebrew no Apple Silicon
    '/usr/local/Cellar/node/*/bin', // Homebrew Intel
    process.env.HOME + '/.nvm/current/bin', // NVM current
    process.env.NVM_BIN, // NVM_BIN variable
    '/usr/local/lib/nodejs/node-*/bin', // Manual install Linux
    process.env.HOME + '/.local/bin', // Local user installs
    '/snap/bin', // Snap packages (Linux)
  ].filter(Boolean); // Remove null/undefined entries
  
  // Caminhos adicionais específicos para macOS
  if (process.platform === 'darwin') {
    const macPaths = [
      '/opt/homebrew/lib/node_modules/.bin', // Homebrew global npm packages
      '/usr/local/lib/node_modules/.bin', // Intel Homebrew global npm packages  
      '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers',
      process.env.HOME + '/.npm-global/bin', // npm global config prefix
      '/Applications/Node.js/bin', // Node.js installer
    ];
    commonPaths.push(...macPaths);
  }
  
  // Procura por versões específicas do NVM se existirem
  try {
    const nvmDir = process.env.NVM_DIR || (process.env.HOME + '/.nvm');
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir);
      for (const version of versions) {
        const versionBinPath = path.join(versionsDir, version, 'bin');
        if (fs.existsSync(versionBinPath)) {
          commonPaths.push(versionBinPath);
        }
      }
    }
  } catch (e) {
    // Ignora erros na busca por versões NVM
    logToRenderer('DEBUG', `Erro ao buscar versões NVM: ${e.message}`);
  }
  
  // No Windows
  if (process.platform === 'win32') {
    commonPaths.push(
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      process.env.APPDATA + '\\npm',
      process.env.USERPROFILE + '\\AppData\\Roaming\\npm',
      process.env.USERPROFILE + '\\scoop\\apps\\nodejs\\current', // Scoop
      'C:\\tools\\nodejs' // Chocolatey
    );
  }
  
  // Adiciona os caminhos comuns ao PATH se não estiverem lá
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const existingPaths = pathEnv.split(pathSeparator);
  
  for (const commonPath of commonPaths) {
    if (commonPath && !existingPaths.includes(commonPath)) {
      pathEnv += pathSeparator + commonPath;
    }
  }
  
  logToRenderer('DEBUG', `Caminhos adicionais incluídos: ${commonPaths.join(', ')}`);
  return pathEnv;
}

// Função para verificar Node.js e NPM
async function checkNodeAndNpm() {
  logToRenderer('INFO', 'Verificando Node.js e NPM...');
  logToRenderer('DEBUG', `PATH atual: ${process.env.PATH}`);
  
  // Expande o PATH para incluir locais comuns do Node.js
  const expandedPath = getExpandedPath();
  logToRenderer('DEBUG', `PATH expandido: ${expandedPath}`);
  
  try {
    // Verifica Node.js com PATH expandido
    const nodeVersion = await new Promise((resolve, reject) => {
      exec('node --version', { 
        env: { ...process.env, PATH: expandedPath },
        timeout: 10000 // 10 segundos de timeout
      }, (error, stdout, stderr) => {
        if (error) {
          logToRenderer('DEBUG', `Erro node --version: ${error.message}, stderr: ${stderr}`);
          reject(new Error('Node.js não encontrado no PATH'));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    // Verifica NPM com PATH expandido
    const npmVersion = await new Promise((resolve, reject) => {
      exec('npm --version', { 
        env: { ...process.env, PATH: expandedPath },
        timeout: 10000 // 10 segundos de timeout
      }, (error, stdout, stderr) => {
        if (error) {
          logToRenderer('DEBUG', `Erro npm --version: ${error.message}, stderr: ${stderr}`);
          reject(new Error('NPM não encontrado no PATH'));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    logToRenderer('SUCESSO', `Node.js ${nodeVersion} encontrado`);
    logToRenderer('SUCESSO', `NPM ${npmVersion} encontrado`);

    // Verifica se as versões são compatíveis (Node.js >= 18.0.0)
    const nodeMajorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
    if (nodeMajorVersion < 18) {
      logToRenderer('AVISO', `Node.js ${nodeVersion} está desatualizado. Recomendado: v18 ou superior.`);
      return {
        status: 'OUTDATED',
        nodeVersion,
        npmVersion,
        message: `Node.js ${nodeVersion} está desatualizado. Recomendado: v18 ou superior.`
      };
    }

    return {
      status: 'OK',
      nodeVersion,
      npmVersion,
      message: `Node.js ${nodeVersion} e NPM ${npmVersion} estão OK`
    };

  } catch (error) {
    logToRenderer('ERRO', `Erro na verificação: ${error.message}`);
    
    // Tenta uma abordagem alternativa - verifica arquivos executáveis diretamente
    logToRenderer('DEBUG', 'Tentando verificação alternativa...');
    return await alternativeNodeCheck(expandedPath);
  }
}

// Função alternativa para verificar Node.js diretamente nos caminhos
async function alternativeNodeCheck(pathEnv) {
  const paths = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  const npmExe = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  
  let nodeFound = false;
  let npmFound = false;
  let nodeVersion = null;
  let npmVersion = null;
  
  for (const dir of paths) {
    if (!dir) continue;
    
    try {
      const nodePath = path.join(dir, nodeExe);
      const npmPath = path.join(dir, npmExe);
      
      // Verifica se os arquivos existem
      if (!nodeFound && fs.existsSync(nodePath)) {
        try {
          const version = await new Promise((resolve, reject) => {
            exec(`"${nodePath}" --version`, { timeout: 5000 }, (error, stdout) => {
              if (error) reject(error);
              else resolve(stdout.trim());
            });
          });
          nodeVersion = version;
          nodeFound = true;
          logToRenderer('DEBUG', `Node.js encontrado em: ${nodePath} (${version})`);
        } catch (e) {
          logToRenderer('DEBUG', `Node.js existe em ${nodePath} mas falhou ao executar: ${e.message}`);
        }
      }
      
      if (!npmFound && fs.existsSync(npmPath)) {
        try {
          const version = await new Promise((resolve, reject) => {
            exec(`"${npmPath}" --version`, { timeout: 5000 }, (error, stdout) => {
              if (error) reject(error);
              else resolve(stdout.trim());
            });
          });
          npmVersion = version;
          npmFound = true;
          logToRenderer('DEBUG', `NPM encontrado em: ${npmPath} (${version})`);
        } catch (e) {
          logToRenderer('DEBUG', `NPM existe em ${npmPath} mas falhou ao executar: ${e.message}`);
        }
      }
      
      if (nodeFound && npmFound) break;
      
    } catch (e) {
      // Ignora erros de path inválido
      continue;
    }
  }
  
  if (!nodeFound || !npmFound) {
    return {
      status: 'MISSING',
      nodeVersion,
      npmVersion,
      message: `${!nodeFound ? 'Node.js' : ''}${!nodeFound && !npmFound ? ' e ' : ''}${!npmFound ? 'NPM' : ''} não encontrado${!nodeFound || !npmFound ? ' no sistema' : ''}`
    };
  }
  
  // Verifica versão do Node.js
  const nodeMajorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
  if (nodeMajorVersion < 18) {
    return {
      status: 'OUTDATED',
      nodeVersion,
      npmVersion,
      message: `Node.js ${nodeVersion} está desatualizado. Recomendado: v18 ou superior.`
    };
  }
  
  return {
    status: 'OK',
    nodeVersion,
    npmVersion,
    message: `Node.js ${nodeVersion} e NPM ${npmVersion} estão OK`
  };
}

// Handler para verificação do Node.js/NPM
ipcMain.handle('check-node-npm', async () => {
  return await checkNodeAndNpm();
});

// Função para abrir a página de download do Node.js
async function openNodeJSDownloadPage() {
  const { shell } = require('electron');
  const url = 'https://nodejs.org/en/download/';
  
  try {
    await shell.openExternal(url);
    logToRenderer('INFO', 'Página de download do Node.js aberta no navegador padrão.');
    return { success: true, message: 'Página aberta com sucesso' };
  } catch (error) {
    logToRenderer('ERRO', `Erro ao abrir página de download: ${error.message}`);
    return { success: false, message: error.message };
  }
}

// Handler para abrir página de download do Node.js
ipcMain.handle('open-nodejs-download', async () => {
  return await openNodeJSDownloadPage();
});

// Handler para obter a versão da aplicação
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-automation-browser', async () => {
  return await checkPlaywrightBrowser(true); // modo silencioso para evitar logs duplicados
});

// Handler para obter o caminho atual do navegador
ipcMain.handle('get-browser-path', () => {
    return activeBrowserExecutablePath || 'Não encontrado';
});

ipcMain.on('reinstall-automation-browser', async () => {
    logToRenderer('INFO', 'Iniciando processo de instalação autocontida do navegador...');
    updateAutomationStatusInRenderer('Instalando navegador de automação...', null, false);
    if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'CARREGANDO');

    // Define o caminho local para instalação
    const LOCAL_BROWSERS_PATH = path.join(app.getPath('userData'), 'playwright-browsers');

    try {
        // Cria o diretório se não existir
        fs.mkdirSync(LOCAL_BROWSERS_PATH, { recursive: true });
        
        // Define a variável de ambiente ANTES da instalação
        process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS_PATH;

        logToRenderer('INFO', `Instalando Chromium em: ${LOCAL_BROWSERS_PATH}`);
        
        // Método 1: Usar spawn direto (mais confiável, evita problemas de exports)
        let installationSuccess = false;
        
        try {
            logToRenderer('INFO', 'Tentando instalação via spawn do npx...');
            await installChromiumViaSpawn(LOCAL_BROWSERS_PATH);
            installationSuccess = true;
            logToRenderer('SUCESSO', 'Instalação via spawn concluída');
            
        } catch (spawnError) {
            logToRenderer('AVISO', `Spawn falhou: ${spawnError.message}, tentando método alternativo...`);
            
            // Método 2: Tentar com execPromise
            try {
                logToRenderer('INFO', 'Tentando instalação via execPromise...');
                
                const npxPath = findNpxExecutable();
                const expandedPath = getExpandedPath();
                const command = `"${npxPath}" playwright install chromium`;
                
                const { stdout, stderr } = await execPromise(command, {
                    env: { 
                        ...process.env, 
                        PLAYWRIGHT_BROWSERS_PATH: LOCAL_BROWSERS_PATH,
                        PATH: expandedPath
                    },
                    cwd: app.isPackaged ? process.resourcesPath : process.cwd()
                });
                
                if (stdout) logToRenderer('DEBUG', `execPromise output: ${stdout}`);
                if (stderr && !stderr.includes('warning')) logToRenderer('DEBUG', `execPromise stderr: ${stderr}`);
                
                installationSuccess = true;
                logToRenderer('SUCESSO', 'Instalação via execPromise concluída');
                
            } catch (execError) {
                logToRenderer('ERRO', `Todos os métodos de instalação falharam: ${execError.message}`);
                throw new Error(`Falha na instalação do Chromium: ${execError.message}`);
            }
        }
        
        // Aguarda a instalação ser finalizada
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Re-verifica após instalação (vai procurar em todos os lugares novamente)
        const status = await checkPlaywrightBrowser();
        
        if (status === 'OK') {
            logToRenderer('SUCESSO', `Navegador instalado e verificado com sucesso!`);
            logToRenderer('INFO', `Localização: ${activeBrowserExecutablePath}`);
            
            if (mainWindow) {
                mainWindow.webContents.send('update-browser-status-from-main', 'OK');
                
                // Notifica o sucesso
                new Notification({
                    title: 'Instalação Concluída',
                    body: 'O navegador foi instalado com sucesso!',
                    icon: path.join(__dirname, '../assets/icon.png')
                }).show();
            }
            
            updateAutomationStatusInRenderer('Navegador de automação pronto.', null, false);
        } else {
            throw new Error('Instalação concluída mas o navegador não foi encontrado');
        }
        
    } catch (error) {
        logToRenderer('ERRO', `Falha na instalação: ${error.message}`);
        
        if (mainWindow) mainWindow.webContents.send('update-browser-status-from-main', 'FALTANDO');
        updateAutomationStatusInRenderer('Falha ao instalar navegador.', null, false);
        
        // Oferece opções ao usuário
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Instalação do Navegador',
            message: 'Não foi possível instalar o navegador automaticamente',
            detail: error.message,
            buttons: ['Tentar Novamente', 'Instalar Manualmente', 'Cancelar'],
            defaultId: 0
        });
        
        if (result.response === 0) {
            // Tentar novamente
            setTimeout(() => {
                mainWindow.webContents.send('retry-browser-installation');
            }, 1000);
        } else if (result.response === 1) {
            // Instruções manuais
            showManualInstallInstructions();
        }
    }
});

// Função removida - findPlaywrightCLI causava problemas com exports
// Agora usamos apenas spawn direto do npx playwright, que é mais confiável

// Função para encontrar npx com PATH expandido
function findNpxExecutable() {
    const expandedPath = getExpandedPath();
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    const paths = expandedPath.split(pathSeparator);
    
    const npxNames = process.platform === 'win32' ? ['npx.cmd', 'npx'] : ['npx'];
    
    for (const searchPath of paths) {
        for (const npxName of npxNames) {
            const fullPath = path.join(searchPath, npxName);
            if (fs.existsSync(fullPath)) {
                logToRenderer('DEBUG', `NPX encontrado em: ${fullPath}`);
                return fullPath;
            }
        }
    }
    
    // Fallback: verifica caminhos específicos do macOS
    if (process.platform === 'darwin') {
        const macSpecificPaths = [
            '/usr/local/bin/npx',
            '/opt/homebrew/bin/npx',
            process.env.HOME + '/.nvm/current/bin/npx'
        ];
        
        for (const npmPath of macSpecificPaths) {
            if (fs.existsSync(npmPath)) {
                logToRenderer('DEBUG', `NPX encontrado em caminho específico macOS: ${npmPath}`);
                return npmPath;
            }
        }
    }
    
    logToRenderer('DEBUG', 'NPX não encontrado, usando fallback');
    return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

// Função para instalação via spawn (método primário)
async function installChromiumViaSpawn(installPath) {
    logToRenderer('INFO', 'Executando instalação do Chromium via spawn...');
    
    return new Promise((resolve, reject) => {
        const npmCommand = findNpxExecutable();
        const expandedPath = getExpandedPath();
        
        const child = spawn(npmCommand, ['playwright', 'install', 'chromium'], {
            env: { 
                ...process.env, 
                PLAYWRIGHT_BROWSERS_PATH: installPath,
                PATH: expandedPath
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: app.isPackaged ? process.resourcesPath : process.cwd()
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            logToRenderer('DEBUG', `Spawn stdout: ${output.trim()}`);
        });
        
        child.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            if (output.toLowerCase().includes('error')) {
                logToRenderer('ERRO', `Spawn stderr: ${output.trim()}`);
            } else {
                logToRenderer('DEBUG', `Spawn info: ${output.trim()}`);
            }
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                logToRenderer('SUCESSO', 'Instalação via spawn bem-sucedida');
                resolve();
            } else {
                const errorMsg = `Spawn falhou (código ${code}). stderr: ${stderr.trim()}`;
                logToRenderer('ERRO', errorMsg);
                reject(new Error(errorMsg));
            }
        });
        
        child.on('error', (error) => {
            const errorMsg = `Erro no spawn: ${error.message}`;
            logToRenderer('ERRO', errorMsg);
            reject(new Error(errorMsg));
        });
    });
}

// Função para instalação manual do Chromium como último recurso
async function installChromiumManually(installPath) {
    logToRenderer('INFO', 'Iniciando instalação manual do Chromium via spawn...');
    
    return new Promise((resolve, reject) => {
        // Usa spawn diretamente, que é mais confiável que fork com CLIs
        const npmCommand = findNpxExecutable();
        const expandedPath = getExpandedPath();
        
        const child = spawn(npmCommand, ['playwright', 'install', 'chromium'], {
            env: { 
                ...process.env, 
                PLAYWRIGHT_BROWSERS_PATH: installPath,
                PATH: expandedPath
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            logToRenderer('DEBUG', `Instalação stdout: ${output.trim()}`);
        });
        
        child.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            // Não loga como erro se for apenas warning/info
            if (output.toLowerCase().includes('error')) {
                logToRenderer('ERRO', `Instalação stderr: ${output.trim()}`);
            } else {
                logToRenderer('DEBUG', `Instalação info: ${output.trim()}`);
            }
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                logToRenderer('SUCESSO', 'Instalação manual via spawn concluída com sucesso');
                resolve();
            } else {
                const errorMsg = `Instalação falhou (código ${code}). stderr: ${stderr.trim()}`;
                logToRenderer('ERRO', errorMsg);
                reject(new Error(errorMsg));
            }
        });
        
        child.on('error', (error) => {
            const errorMsg = `Erro ao executar npx: ${error.message}`;
            logToRenderer('ERRO', errorMsg);
            reject(new Error(errorMsg));
        });
    });
}

// Função para mostrar instruções de instalação manual
function showManualInstallInstructions() {
    const instructions = process.platform === 'win32'
        ? `1. Abra o Prompt de Comando (cmd)\n2. Execute: npm install -g playwright\n3. Execute: npx playwright install chromium\n4. Reinicie o aplicativo`
        : `1. Abra o Terminal\n2. Execute: npm install -g playwright\n3. Execute: npx playwright install chromium\n4. Reinicie o aplicativo`;
    
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Instalação Manual',
        message: 'Siga estas instruções para instalar manualmente:',
        detail: instructions,
        buttons: ['OK']
    });
}


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
    
    // Verifica novamente o caminho (pode ter sido instalado enquanto o app estava rodando)
    if (!activeBrowserExecutablePath) {
        await checkPlaywrightBrowser();
    }
    
    if (!activeBrowserExecutablePath) {
        throw new Error("Navegador Chromium não encontrado. Por favor, instale-o nas configurações.");
    }
    
    try {
        const playwright = require('playwright');
        logToRenderer('DEBUG', `Tentando iniciar o navegador em: ${activeBrowserExecutablePath}`);

        playwrightBrowser = await playwright.chromium.launch({
            headless: true,
            executablePath: activeBrowserExecutablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        logToRenderer('SUCESSO', 'Playwright browser iniciado com sucesso.');
        return playwrightBrowser;

    } catch (launchError) {
        logToRenderer('ERRO', `Falha ao iniciar Playwright browser: ${launchError.message}`);

        // Tenta encontrar em outro lugar
        logToRenderer('INFO', 'Tentando localizar navegador em outros diretórios...');
        await checkPlaywrightBrowser();

        if (activeBrowserExecutablePath) {
          // Tenta novamente com o novo caminho
          return launchPlaywright();
        }

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

  // 0. Verificação PREVENTIVA: Antes de tentar registrar, verifica se já existe
  logToRenderer('INFO', 'Verificando se o ponto já foi registrado anteriormente...');
  const preCheckPoints = await syncInitialPoints(page);
  if (preCheckPoints.includes(punchDetails.time)) {
    logToRenderer('AVISO', `Ponto ${punchDetails.type} às ${punchDetails.time} JÁ ESTÁ REGISTRADO. Pulando para evitar duplicata.`);
    try {
      await sendTelegramNotification(
        TELEGRAM_BOT_TOKEN,
        currentAutomationSettings.telegramChatId,
        `⚠️ Ponto ${punchDetails.type} às ${punchDetails.time} já estava registrado. Nenhuma ação necessária.`
      );
    } catch (err) {
      logToRenderer('AVISO', `Falha ao enviar notificação Telegram: ${err.message}`);
    }
    return 'success'; // Retorna sucesso pois o ponto já existe
  }

  // 1. Clicar no botão para registrar o ponto
  await page.locator('#localizacao-incluir-ponto').click({ timeout: 15000 });
  logToRenderer('DEBUG', 'Clique para registrar o ponto efetuado. Iniciando verificação...');

  // 2. Lógica de verificação com retentativas (Polling)
  const maxVerificationRetries = 10; // AUMENTADO: Tentar verificar 10 vezes (50 segundos total)
  const verificationInterval = 5000; // Esperar 5 segundos entre cada tentativa
  let punchVerified = false;
  let previousPointsCount = preCheckPoints.length;

  for (let i = 1; i <= maxVerificationRetries; i++) {
    logToRenderer('DEBUG', `Tentativa de verificação ${i}/${maxVerificationRetries}...`);

    // Sincroniza a lista de pontos da página.
    const updatedPoints = await syncInitialPoints(page);

    // MÉTODO 1: Checa se a batida esperada está na lista atualizada.
    if (updatedPoints.includes(punchDetails.time)) {
      punchVerified = true;
      logToRenderer('DEBUG', 'Ponto verificado: encontrado na lista por horário exato.');
      break; // Sucesso! Sai do loop de verificação.
    }

    // MÉTODO 2: Checa se a QUANTIDADE de pontos aumentou (fallback para sites lentos)
    // Isso ajuda quando o site salva mas não atualiza a lista imediatamente
    if (updatedPoints.length > previousPointsCount) {
      logToRenderer('DEBUG', `Aumento na quantidade de pontos detectado: ${previousPointsCount} → ${updatedPoints.length}`);

      // Verifica se algum dos novos pontos está próximo do horário esperado (tolerância de ±2 minutos)
      const [expectedHour, expectedMinute] = punchDetails.time.split(':').map(Number);
      const hasNearbyPunch = updatedPoints.some(timeStr => {
        const [h, m] = timeStr.split(':').map(Number);
        const timeDiffMinutes = Math.abs((h * 60 + m) - (expectedHour * 60 + expectedMinute));
        return timeDiffMinutes <= 2; // Tolerância de 2 minutos
      });

      if (hasNearbyPunch) {
        punchVerified = true;
        logToRenderer('DEBUG', 'Ponto verificado: novo registro próximo do horário esperado detectado.');
        break;
      }
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
        `✅ Ponto ${punchDetails.type} às ${punchDetails.time} registrado com sucesso!`
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
        `🔴 Falha ao registrar ponto ${punchDetails.type} às ${punchDetails.time}. Verifique e faça o registro manualmente se necessário!`
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