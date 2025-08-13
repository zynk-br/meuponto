import React, { useState, useEffect } from 'react';
import { APP_TITLE } from '../constants';

const Footer: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const getVersion = async () => {
      if (window.electronAPI) {
        try {
          const version = await window.electronAPI.getAppVersion();
          setAppVersion(version);
        } catch (error) {
          console.error('Erro ao obter versão:', error);
          setAppVersion('Erro');
        }
      } else {
        setAppVersion('N/A');
      }
      setIsLoading(false);
    };

    getVersion();
  }, []);

  return (
    <footer className="bg-secondary-50 dark:bg-secondary-900 border-t border-secondary-200 dark:border-secondary-700 px-4 py-1">
      <div className="flex justify-between items-center text-xs text-secondary-400 dark:text-secondary-500">
        <span>{APP_TITLE} © 2025 Zynk Tech</span>
        <span>
          {isLoading ? (
            <i className="fas fa-spinner fa-spin mr-1"></i>
          ) : (
            appVersion ? `v${appVersion}` : 'v?.?.?'
          )}
        </span>
      </div>
    </footer>
  );
};

export default Footer;