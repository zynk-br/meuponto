// Arquivo agora em: src/renderer/components/LogConsole.tsx
import React, { useRef, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { LOG_LEVEL_COLORS } from '../constants'; // Ajustado

interface LogConsoleProps {
  isVisible: boolean;
}

const LogConsole: React.FC<LogConsoleProps> = ({ isVisible }) => {
  const { logs, settings, updateSettings, clearLogs } = useAppContext();
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="h-64 flex flex-col bg-secondary-50 dark:bg-secondary-800 border-t border-secondary-300 dark:border-secondary-700 shadow-inner">
      <div className="flex justify-between items-center p-2 border-b border-secondary-200 dark:border-secondary-700 bg-secondary-100 dark:bg-secondary-700">
        <h3 className="text-sm font-semibold text-secondary-700 dark:text-secondary-200">Logs</h3>
        <div>
           <button
            onClick={clearLogs}
            className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-red-400 mr-2"
            title="Limpar Logs"
          >
            <i className="fas fa-trash-alt"></i> Limpar
          </button>
          <button
            onClick={() => updateSettings({ showLogConsole: !settings.showLogConsole })}
            className="px-2 py-1 text-xs bg-secondary-500 hover:bg-secondary-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-secondary-400"
            title={settings.showLogConsole ? "Esconder Console" : "Mostrar Console"}
          >
            <i className={settings.showLogConsole ? "fas fa-eye-slash" : "fas fa-eye"}></i> {settings.showLogConsole ? "Esconder" : "Mostrar"}
          </button>
        </div>
      </div>
      <div className="flex-grow p-2 overflow-y-auto text-xs font-mono">
        {logs.map((log, index) => (
          <div key={index} className="whitespace-pre-wrap">
            <span className="text-secondary-500 dark:text-secondary-400">{log.timestamp}</span>
            <span className={`font-bold mx-1 ${LOG_LEVEL_COLORS[log.level]}`}>[{log.level}]</span>
            <span className="text-secondary-700 dark:text-secondary-300">{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default LogConsole;
