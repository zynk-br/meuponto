// afterSign.js
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const platform = packager.platform.name;

  if (platform !== 'mac') {
    return;
  }

  console.log('afterSign: Limpando assinaturas conflitantes do Chromium no macOS...');

  const appPath = path.join(appOutDir, `${appName}.app`);
  const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');

  const frameworkPaths = [
    path.join(frameworksPath, 'Chromium Framework.framework'),
  ];
  
  // Lista de binários que podem causar conflito dentro dos frameworks
  const binariesToClean = [
    'Chromium Framework',
    'libffmpeg.dylib',
    'libEGL.dylib',
    'libGLESv2.dylib',
    // Adicione outros helpers/binários se necessário
  ];
  
  for (const frameworkPath of frameworkPaths) {
      for (const binary of binariesToClean) {
          const binaryPath = path.join(frameworkPath, 'Versions', 'A', binary);
          if (fs.existsSync(binaryPath)) {
              try {
                  console.log(`Limpando assinatura de: ${binaryPath}`);
                  execSync(`codesign --remove-signature "${binaryPath}"`);
              } catch (error) {
                  console.error(`Falha ao limpar assinatura de ${binaryPath}: ${error}`);
              }
          }
      }
  }

  console.log('afterSign: Limpeza de assinaturas concluída.');
};