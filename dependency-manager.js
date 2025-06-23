const { app } = require("electron");
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

function getLocalBrowserPath() {
    return path.join(app.getPath("userData"), "browsers");
}

/**
 * Encontra o caminho para o executável do Chromium.
 * @param {boolean} throwOnError - Se deve lançar um erro em caso de falha.
 * @returns {string} O caminho para o executável ou uma string vazia.
 */
function getBrowserExecutablePath(throwOnError = true) {
    const browserPath = getLocalBrowserPath();
    const platform = process.platform;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (!fs.existsSync(browserPath)) throw new Error("Pasta de navegadores não existe.");
            
            const browserFolders = fs.readdirSync(browserPath);
            const chromiumFolder = browserFolders.find((folder) => folder.startsWith("chromium-"));
            if (!chromiumFolder) throw new Error("Pasta específica do Chromium não encontrada.");

            const executablePaths = {
                darwin: path.join(browserPath, chromiumFolder, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
                win32: path.join(browserPath, chromiumFolder, "chrome-win", "chrome.exe"),
                linux: path.join(browserPath, chromiumFolder, "chrome-linux", "chrome"),
            };

            const execPath = executablePaths[platform];
            if (fs.existsSync(execPath)) return execPath;
            else throw new Error(`Executável não encontrado em: ${execPath}`);

        } catch (error) {
            if (attempt === 2) {
                if (throwOnError) throw error;
                return "";
            }
             // Aguarda um pouco antes de tentar novamente
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        }
    }
    return ""; // Fallback
}

/**
 * Procura pelo executável do Node.js em vários locais padrão e retorna seu caminho absoluto.
 * @returns {Promise<string|null>} O caminho absoluto para o executável do Node.js ou null se não for encontrado.
 */
async function findNodeExecutable() {
  console.log("Procurando pelo executável do Node.js...");

  // 1. Tenta usar o comando 'which' ou 'where' que usa o PATH. Funciona em dev.
  try {
    const command = process.platform === 'win32' ? 'where node' : 'which node';
    const { stdout } = await execPromise(command);
    const nodePath = stdout.trim().split('\n')[0]; // Pega a primeira linha
    if (fs.existsSync(nodePath)) {
      console.log(`Node.js encontrado via PATH em: ${nodePath}`);
      return nodePath;
    }
  } catch (error) {
    console.log("Node.js não encontrado no PATH, verificando diretórios padrão...");
  }

  // 2. Se falhar, procura em locais hardcoded. Essencial para o app empacotado.
  const platform = process.platform;
  let searchPaths = [];

  if (platform === 'win32') {
    searchPaths = [
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : null,
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : null,
    ];
  } else if (platform === 'darwin') { // macOS
    searchPaths = [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
    ];
    // Adiciona verificação para NVM (Node Version Manager)
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).sort().reverse(); // Pega a versão mais recente
      if (versions.length > 0) {
        searchPaths.push(path.join(nvmDir, versions[0], 'bin', 'node'));
      }
    }
  }
  
  for (const nodePath of searchPaths.filter(Boolean)) {
    if (fs.existsSync(nodePath)) {
      console.log(`Node.js encontrado em um local padrão: ${nodePath}`);
      return nodePath;
    }
  }
  
  console.log("Node.js não foi encontrado em nenhum local conhecido.");
  return null;
}

/**
 * Instala o navegador Playwright usando o caminho absoluto do Node/NPX.
 */
async function installBrowser(nodePath, logCallback) {
  const browserInstallPath = getLocalBrowserPath();
  if (!nodePath) {
    const errorMsg = "Caminho do Node.js não fornecido para a instalação.";
    logCallback(`[ERRO] ${errorMsg}`);
    return { success: false, message: errorMsg };
  }

  fs.mkdirSync(browserInstallPath, { recursive: true });
  logCallback('[INFO] Iniciando download do Chromium...');

  // Constrói o caminho absoluto para o NPX, que vive ao lado do Node
  const npxPath = path.join(path.dirname(nodePath), 'npx');

  const command = `"${npxPath}" playwright install --with-deps chromium`;
  const options = {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserInstallPath
    }
  };

  try {
    const { stdout } = await execPromise(command, options);
    logCallback(`[SUCESSO] Navegador baixado com sucesso!`);
    console.log(stdout);
    return { success: true };
  } catch (error) {
    logCallback(`[ERRO] Falha ao baixar o navegador: ${error.message}`);
    return { success: false, message: error.message };
  }
}

module.exports = {
  getBrowserExecutablePath,
  findNodeExecutable,
  installBrowser
};