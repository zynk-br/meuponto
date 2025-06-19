const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

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
async function installBrowser(nodePath, browserInstallPath, logCallback) {
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
  findNodeExecutable,
  installBrowser
};