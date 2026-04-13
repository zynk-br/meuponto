import React, { useState, useEffect } from 'react';
import { APP_TITLE } from '../constants';
import * as tauriAPI from '../hooks/useTauriAPI';

const Footer: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    tauriAPI.getAppVersion()
      .then(version => setAppVersion(version))
      .catch(() => setAppVersion('Erro'))
      .finally(() => setIsLoading(false));
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
