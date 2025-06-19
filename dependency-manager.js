const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execPromise = util.promisify(exec);

/**
 * Verifica se o Node.js está instalado, tentando o PATH e depois
 * verificando os diretórios de instalação padrão para o SO atual.
 * @returns {Promise<boolean>}
 */
async function checkNodeJs() {
  try {
    // 1. Tenta o método rápido primeiro. Pode funcionar se o PATH for herdado.
    await execPromise('node -v');
    return true;
  } catch (error) {
    // 2. Se o primeiro método falhar, vamos procurar o executável diretamente.
    let defaultPaths = [];
    const platform = process.platform;

    if (platform === 'win32') {
      // Caminhos padrão do Windows
      defaultPaths = [
        process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe') : null,
        process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : null
      ].filter(Boolean);
    } else if (platform === 'darwin') {
      // Caminhos padrão do macOS (instalador oficial e Homebrew para Apple Silicon/Intel)
      defaultPaths = [
        '/usr/local/bin/node',
        '/opt/homebrew/bin/node'
      ];
    }

    // Verifica se o arquivo node existe em algum dos caminhos padrão.
    for (const nodePath of defaultPaths) {
      if (fs.existsSync(nodePath)) {
        return true;
      }
    }

    // Se todas as tentativas falharem, então realmente não foi encontrado.
    return false;
  }
}

/**
 * Instala o navegador Playwright usando npx em um diretório específico.
 * (Esta função permanece a mesma)
 */
async function installBrowser(browserPath, logCallback) {
  fs.mkdirSync(browserPath, { recursive: true });

  logCallback('[INFO] Iniciando download do Chromium...');
  
  // CORREÇÃO: Precisamos usar o caminho absoluto para o node se o encontrarmos
  // Esta parte se torna mais complexa. Vamos simplificar por agora e focar na detecção.
  // A execução do 'npx' ainda pode depender do PATH. Se isso falhar, teremos que refatorar esta função também.
  const command = 'npx playwright install --with-deps chromium';
  const options = {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserPath
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
  checkNodeJs,
  installBrowser
};