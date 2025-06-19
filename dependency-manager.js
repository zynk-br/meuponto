const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execPromise = util.promisify(exec);

/**
 * Verifica se o Node.js está instalado e acessível no PATH do sistema.
 * @returns {Promise<boolean>}
 */
async function checkNodeJs() {
  try {
    await execPromise('node -v');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Instala o navegador Playwright usando npx em um diretório específico.
 * @param {string} browserPath - O caminho onde o navegador deve ser instalado.
 * @param {function(string): void} logCallback - Função para enviar logs para a UI.
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function installBrowser(browserPath, logCallback) {
  // Garante que a pasta pai exista
  fs.mkdirSync(browserPath, { recursive: true });

  logCallback('[INFO] Iniciando download do Chromium. Isso pode levar alguns minutos...');
  
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
    console.log(stdout); // Log para o terminal de desenvolvimento
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