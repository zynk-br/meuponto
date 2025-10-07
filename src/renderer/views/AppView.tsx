// Arquivo agora em: src/renderer/views/AppView.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext'; // Ajustado
import { DayOfWeek, LogLevel, TimeEntry, Schedule, AutomationMode, BrowserStatus } from '../types'; // Ajustado
import { DAYS_OF_WEEK } from '../constants'; // Ajustado

const DayRowEditor: React.FC<{ day: DayOfWeek, entry: TimeEntry, onChange: (newEntry: TimeEntry) => void, readonly: boolean }> = ({ day, entry, onChange, readonly }) => {

  // Função auxiliar para adicionar horas a um horário
  const addHoursToTime = (timeStr: string, hoursToAdd: number, minutesToAdd: number = 0): string => {
    if (!timeStr || !timeStr.includes(':')) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return '';

    let totalMinutes = hours * 60 + minutes + hoursToAdd * 60 + minutesToAdd;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
  };

  const handleTimeChange = (field: keyof Omit<TimeEntry, 'feriado'>, value: string) => {
    const updatedEntry = { ...entry, [field]: value };

    // REGRA 1: Quando preencher Entrada1, calcular automaticamente Saída2 (Entrada1 + 9h)
    if (field === 'entrada1' && value) {
      const calculatedSaida2 = addHoursToTime(value, 9, 0); // 8h de trabalho + 1h de almoço
      updatedEntry.saida2 = calculatedSaida2;
    }

    // REGRA 2: Quando preencher Saída1, calcular automaticamente Entrada2 (Saída1 + 1h)
    if (field === 'saida1' && value) {
      const calculatedEntrada2 = addHoursToTime(value, 1, 0); // 1h de almoço
      updatedEntry.entrada2 = calculatedEntrada2;
    }

    onChange(updatedEntry);
  };

  const handleFeriadoChange = (checked: boolean) => {
    onChange({ ...entry, feriado: checked, entrada1: '', saida1: '', entrada2: '', saida2: '' });
  };

  return (
    <tr className="border-b border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors">
      <td className="py-3 px-4 text-sm font-medium text-secondary-800 dark:text-secondary-200">{day}</td>
      {[ 'entrada1', 'saida1', 'entrada2', 'saida2'].map((field) => (
        <td key={field} className="py-2 px-3">
          <input
            type="time"
            value={entry[field as keyof Omit<TimeEntry, 'feriado'>]}
            onChange={(e) => handleTimeChange(field as keyof Omit<TimeEntry, 'feriado'>, e.target.value)}
            disabled={entry.feriado || readonly}
            readOnly={readonly}
            className={`w-full p-2 border rounded-md text-sm bg-white dark:bg-secondary-700 text-secondary-700 dark:text-secondary-200 border-secondary-300 dark:border-secondary-600 focus:ring-primary-500 focus:border-primary-500 ${ (entry.feriado || readonly) ? 'bg-secondary-100 dark:bg-secondary-800 cursor-not-allowed' : ''}`}
          />
        </td>
      ))}
      <td className="py-3 px-4 text-center">
        <input
          type="checkbox"
          checked={entry.feriado}
          onChange={(e) => handleFeriadoChange(e.target.checked)}
          disabled={readonly}
          className="h-5 w-5 text-primary-600 focus:ring-primary-500 border-secondary-300 dark:border-secondary-600 rounded bg-white dark:bg-secondary-700 disabled:opacity-50"
        />
      </td>
    </tr>
  );
};


const AppView: React.FC = () => {
  const { 
    addLog, 
    schedule, 
    updateScheduleEntry, 
    updateFullSchedule,
    clearSchedule,
    automationMode, 
    setAutomationMode,
    automationState,
    settings,
    currentUserCredentials
  } = useAppContext();
  
  const [initialHourSemiAuto, setInitialHourSemiAuto] = useState<string>("07:00");

  const handleModeChange = (mode: AutomationMode) => {
    setAutomationMode(mode);
    addLog(LogLevel.INFO, `Modo de operação alterado para: ${mode}`);
    if (mode === AutomationMode.SEMI_AUTOMATIC) {      
      generateSemiAutomaticSchedule(initialHourSemiAuto);
    }
  };
  
  const generateRandomMinute = (min: number = 0, max: number = 59) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const formatTime = (hours: number, minutes: number) => {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const parseTime = (timeStr: string): { hours: number, minutes: number } | null => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return { hours, minutes };
  };
  
  const addHours = (timeStr: string, hoursToAdd: number, minutesToAdd: number = 0): string => {
    const time = parseTime(timeStr);
    if (!time) return '';
    
    let totalMinutes = time.hours * 60 + time.minutes + hoursToAdd * 60 + minutesToAdd;
    const newHours = Math.floor(totalMinutes / 60) % 24; // Ensure hours wrap around 24
    const newMinutes = totalMinutes % 60;
    return formatTime(newHours, newMinutes);
  };

  const generateSemiAutomaticSchedule = useCallback((baseStartTime: string) => {
    const baseStart = parseTime(baseStartTime);
    if (!baseStart) {
      addLog(LogLevel.ERROR, `Hora inicial inválida para modo semi-automático: ${baseStartTime}`);
      return;
    }

    addLog(LogLevel.INFO, `Gerando horários semi-automáticos com base em ${baseStartTime}...`);
    const newSchedule: Schedule = { ...schedule }; 

    DAYS_OF_WEEK.forEach(day => {
      if (newSchedule[day].feriado) { 
        addLog(LogLevel.DEBUG, `Pulando ${day} (feriado) na geração semi-automática.`);
        return;
      }

      const entrada1Min = generateRandomMinute();
      const entrada1 = formatTime(baseStart.hours, entrada1Min);

      const saida1Hour = 12;
      const saida1Min = generateRandomMinute();
      const saida1 = formatTime(saida1Hour, saida1Min);
      
      const entrada2 = addHours(saida1, 1); 
      const saida2 = addHours(entrada1, 9); // Total 8h work + 1h lunch


      newSchedule[day] = {
        ...newSchedule[day], 
        entrada1,
        saida1,
        entrada2,
        saida2,
      };
    });
    updateFullSchedule(newSchedule);
    addLog(LogLevel.SUCCESS, "Grade de horários semi-automática gerada.");
  }, [addLog, updateFullSchedule, schedule]); // schedule dependency can be tricky here, might re-evaluate


  useEffect(() => {
    if (automationMode === AutomationMode.SEMI_AUTOMATIC) {
      generateSemiAutomaticSchedule(initialHourSemiAuto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHourSemiAuto, automationMode]); // generateSemiAutomaticSchedule removed from deps to avoid loop if it uses schedule directly


  const handleExecute = () => {
    if (!currentUserCredentials || !currentUserCredentials.folha || !currentUserCredentials.senha) {
        addLog(LogLevel.ERROR, "Credenciais do usuário não encontradas. Faça login novamente.");
        alert("Erro: Credenciais não encontradas. Por favor, faça login novamente.");
        return;
    }
    if (settings.automationBrowserStatus !== BrowserStatus.OK) {
        addLog(LogLevel.ERROR, "Navegador de automação não está pronto. Verifique as configurações.");
        alert("Erro: O navegador de automação não está pronto. Verifique o status nas Configurações.");
        return;
    }

    addLog(LogLevel.INFO, `Solicitando início da automação no modo: ${automationMode}`);
    if (window.electronAPI) {
        window.electronAPI.startAutomation({
            schedule,
            credentials: currentUserCredentials,
            settings
        });
    } else {
        addLog(LogLevel.ERROR, "Electron API não disponível para iniciar automação.");
    }
  };

  const handleClear = () => {
    if (window.confirm("Tem certeza que deseja limpar todos os horários da grade?")) {
      clearSchedule();
      addLog(LogLevel.WARNING, "Todos os horários foram limpos pelo usuário.");
    }
  };

  const handleInterrupt = () => {
    addLog(LogLevel.INFO, "Solicitando interrupção da automação.");
     if (window.electronAPI) {
        window.electronAPI.stopAutomation();
    } else {
        addLog(LogLevel.ERROR, "Electron API não disponível para interromper automação.");
    }
  };

  return (
    <div className="p-6 space-y-6 bg-secondary-50 bg-gradient-to-br from-primary-500 to-primary-700 dark:from-primary-700 dark:to-primary-900 flex-grow overflow-y-auto">
      <div className="bg-white dark:bg-secondary-800 p-4 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-3 text-primary-700 dark:text-primary-300">Modo de Operação</h2>
        <div className="flex space-x-2">
          {(Object.values(AutomationMode) as AutomationMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              disabled={automationState.isRunning}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-60
                ${automationMode === mode 
                  ? 'bg-primary-600 text-white shadow-md' 
                  : 'bg-secondary-200 hover:bg-secondary-300 dark:bg-secondary-700 dark:hover:bg-secondary-600 text-secondary-800 dark:text-secondary-200'}`}
            >
              {mode === AutomationMode.MANUAL ? <i className="fas fa-edit mr-2"></i> : <i className="fas fa-magic mr-2"></i>}
              {mode}
            </button>
          ))}
        </div>
         {automationMode === AutomationMode.SEMI_AUTOMATIC && (
          <div className="mt-4">
            <label htmlFor="initialHourSemiAuto" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Hora base para Entrada 1 (HH:MM):
            </label>
            <input
              type="time"
              id="initialHourSemiAuto"
              value={initialHourSemiAuto}
              disabled={automationState.isRunning}
              onChange={(e) => setInitialHourSemiAuto(e.target.value)}
              className="p-2 border rounded-md text-sm bg-white dark:bg-secondary-700 text-secondary-700 dark:text-secondary-200 border-secondary-300 dark:border-secondary-600 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60"
            />
             <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">A Entrada 1 será aleatória dentro desta hora. Outros horários serão baseados nela.</p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-secondary-800 p-4 rounded-lg shadow overflow-x-auto">
        <h2 className="text-xl font-semibold mb-3 text-primary-700 dark:text-primary-300">
          Grade de Horários ({automationMode})
        </h2>
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-secondary-200 dark:divide-secondary-700">
            <thead className="bg-secondary-100 dark:bg-secondary-700">
                <tr>
                <th className="py-3 px-4 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Dia</th>
                <th className="py-3 px-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Entrada 1</th>
                <th className="py-3 px-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Saída 1</th>
                <th className="py-3 px-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Entrada 2</th>
                <th className="py-3 px-3 text-left text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Saída 2</th>
                <th className="py-3 px-4 text-center text-xs font-medium text-secondary-500 dark:text-secondary-300 uppercase tracking-wider">Feriado</th>
                </tr>
            </thead>
            <tbody className="bg-white dark:bg-secondary-800 divide-y divide-secondary-200 dark:divide-secondary-700">
                {DAYS_OF_WEEK.map((day) => (
                <DayRowEditor
                    key={day}
                    day={day}
                    entry={schedule[day]}
                    onChange={(newEntry) => updateScheduleEntry(day, newEntry)}
                    readonly={automationState.isRunning}
                />
                ))}
            </tbody>
            </table>
        </div>
      </div>

      <div className="bg-white dark:bg-secondary-800 p-4 rounded-lg shadow flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0 sm:space-x-3">
        <div className="text-sm text-secondary-600 dark:text-secondary-400">
            Status: <span className={`font-semibold ${automationState.isRunning ? 'text-yellow-500 animate-pulse' : 'text-green-500'}`}>{automationState.statusMessage}</span>
            {automationState.isRunning && automationState.currentTask && (
                <span className="ml-2">| Tarefa: {automationState.currentTask}</span>
            )}
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleExecute}
            disabled={automationState.isRunning || settings.automationBrowserStatus !== BrowserStatus.OK}
            title={settings.automationBrowserStatus !== BrowserStatus.OK ? "Navegador de automação não está pronto. Verifique as Configurações." : "Iniciar Automação"}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 flex items-center"
          >
            <i className="fas fa-play mr-2"></i> Executar
          </button>
          <button
            onClick={handleClear}
            disabled={automationState.isRunning}
            className="px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-400 disabled:opacity-50 flex items-center"
          >
            <i className="fas fa-eraser mr-2"></i> Limpar Grade
          </button>
          <button
            onClick={handleInterrupt}
            disabled={!automationState.isRunning}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 flex items-center"
          >
            <i className="fas fa-stop mr-2"></i> Interromper
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppView;
