// src/renderer/components/UpdateNotification.tsx
import React, { useState, useEffect } from 'react';

const UpdateNotification: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;

    // Listener para quando uma atualização está disponível
    const removeUpdateAvailableListener = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setIsDownloaded(false);
      setIsDownloading(false);
      setIsVisible(true);
    });

    // Listener para o progresso do download
    const removeUpdateProgressListener = window.electronAPI.onUpdateProgress((progress) => {
      setIsDownloading(true);
      setDownloadProgress(progress.percent);
    });

    // Listener para quando o download termina
    const removeUpdateDownloadedListener = window.electronAPI.onUpdateDownloaded(() => {
      setIsDownloading(false);
      setIsDownloaded(true);
    });

    return () => {
      removeUpdateAvailableListener();
      removeUpdateProgressListener();
      removeUpdateDownloadedListener();
    };
  }, []);

  const handleDownload = () => {
    if (window.electronAPI) {
      window.electronAPI.downloadUpdate();
      setIsDownloading(true);
    }
  };

  const handleInstall = () => {
    if (window.electronAPI) {
      window.electronAPI.installUpdate();
    }
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
        {isDownloaded ? (
          <p>A versão {updateInfo?.version} foi baixada e está pronta para ser instalada.</p>
        ) : isDownloading ? (
          <>
            <p>Baixando versão {updateInfo?.version}...</p>
            <ProgressBar progress={downloadProgress} />
            <p className="text-xs text-center">{Math.round(downloadProgress)}%</p>
          </>
        ) : (
          <p>Uma nova versão ({updateInfo?.version}) do {app.productName} está disponível.</p>
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