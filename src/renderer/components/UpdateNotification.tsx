import React, { useState, useEffect, useCallback } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { APP_TITLE } from '../constants';

// Intervalo de verificação de atualização em segundo plano (30 min).
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

const UpdateNotification: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setIsDownloaded(false);
        setIsDownloading(false);
        setIsVisible(true);
      }
    } catch (e) {
      // Sem release/endpoint indisponível (ex.: dev) — silencioso.
      console.debug('Verificação de atualização falhou (ignorado):', e);
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
    const id = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  const handleDownload = async () => {
    if (!update) return;
    setErrorMsg(null);
    setIsDownloading(true);
    setDownloadProgress(0);

    let total = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setDownloadProgress(total > 0 ? (downloaded / total) * 100 : 0);
            break;
          case 'Finished':
            setDownloadProgress(100);
            break;
        }
      });
      setIsDownloading(false);
      setIsDownloaded(true);
    } catch (e) {
      setIsDownloading(false);
      setErrorMsg(String(e));
    }
  };

  const handleInstall = async () => {
    // O update já foi instalado por downloadAndInstall; basta reiniciar.
    await relaunch();
  };

  if (!isVisible) {
    return null;
  }

  const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => (
    <div className="w-full bg-secondary-200 dark:bg-secondary-700 rounded-full h-2 my-2">
      <div
        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
        style={{ width: `${progress}%` }}
      ></div>
    </div>
  );

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-secondary-800 shadow-lg rounded-lg p-4 w-80 z-50 border border-secondary-200 dark:border-secondary-700 animate-fade-in-up">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold text-secondary-800 dark:text-secondary-100">Atualização Disponível</h4>
        <button onClick={() => setIsVisible(false)} className="text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200">
          <i className="fas fa-times"></i>
        </button>
      </div>

      <div className="mt-2 text-sm text-secondary-600 dark:text-secondary-300">
        {errorMsg ? (
          <p className="text-red-600 dark:text-red-400">Falha ao atualizar: {errorMsg}</p>
        ) : isDownloaded ? (
          <p>A versão {update?.version} foi baixada e está pronta para ser instalada.</p>
        ) : isDownloading ? (
          <>
            <p>Baixando versão {update?.version}...</p>
            <ProgressBar progress={downloadProgress} />
            <p className="text-xs text-center">{Math.round(downloadProgress)}%</p>
          </>
        ) : (
          <p>Uma nova versão do {APP_TITLE} está disponível: ({update?.version})</p>
        )}
      </div>

      <div className="mt-4 flex justify-end space-x-2">
        {isDownloaded ? (
          <button
            onClick={handleInstall}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md focus:outline-none"
          >
            Reiniciar e Instalar
          </button>
        ) : isDownloading ? (
          <button
            disabled
            className="px-4 py-2 text-sm font-medium text-white bg-gray-400 rounded-md cursor-not-allowed"
          >
            Baixando...
          </button>
        ) : (
          <button
            onClick={handleDownload}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md focus:outline-none"
          >
            Baixar Agora
          </button>
        )}
      </div>
    </div>
  );
};

export default UpdateNotification;
