// Arquivo agora em: src/renderer/components/Header.tsx
import React, { useState, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado

const Header: React.FC = () => {
  const [currentTime, setCurrentTime] = useState('');
  const { setIsSettingsModalOpen, toggleTheme, theme } = useAppContext();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="p-4 bg-primary-600 dark:bg-primary-800 text-white flex items-center justify-between shadow-md">
      <div className="text-xl font-semibold">
        {currentTime ? `${currentTime} (Brasília)` : 'Carregando relógio...'}
      </div>
      <div className="flex items-center space-x-4">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-primary-700 dark:hover:bg-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
        >
          {theme === 'light' ? <i className="fas fa-moon"></i> : <i className="fas fa-sun"></i>}
        </button>
        <button
          onClick={() => setIsSettingsModalOpen(true)}
          className="p-2 rounded-md hover:bg-primary-700 dark:hover:bg-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label="Abrir configurações"
        >
          <i className="fas fa-cog"></i> Configurações
        </button>
      </div>
    </header>
  );
};

export default Header;
