import React, { useEffect, useState } from 'react';
import { useAppContext } from '../hooks/useAppContext';
import { View, LogLevel } from '../types';

const LoadingView: React.FC = () => {
  const { setCurrentView, addLog } = useAppContext();
  const [statusMessage, setStatusMessage] = useState("Iniciando aplicação...");

  useEffect(() => {
    addLog(LogLevel.INFO, "Iniciando MeuPonto...");

    const initialize = async () => {
      setStatusMessage("Verificando configurações...");

      // TODO: Fase 5 — verificar se Chromium está disponível
      // Por enquanto, pula direto para o login
      setStatusMessage("Pré-requisitos atendidos. Carregando tela de login...");

      const timer = setTimeout(() => {
        setCurrentView(View.LOGIN);
      }, 1000);

      return () => clearTimeout(timer);
    };

    initialize();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-secondary-100 dark:bg-secondary-900 p-8">
      <div className="text-center">
        <div className="mb-6">
          <i className="fas fa-cogs fa-4x text-primary-500 dark:text-primary-400 animate-spin-slow"></i>
        </div>
        <h1 className="text-2xl font-semibold text-secondary-800 dark:text-secondary-100 mb-3">Carregando Aplicação</h1>
        <p className="text-secondary-600 dark:text-secondary-400 min-h-[2em]">{statusMessage}</p>
      </div>
    </div>
  );
};

export default LoadingView;
