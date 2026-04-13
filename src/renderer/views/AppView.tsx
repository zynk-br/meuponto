import React, { useState, useCallback, useEffect } from 'react';
import { useAppContext } from '../hooks/useAppContext';
import { DayOfWeek, LogLevel, TimeEntry, Schedule, AutomationMode, MonthlySchedule, MonthlyDayEntry } from '../types';
import { DAYS_OF_WEEK } from '../constants';
import MonthlyCalendar from '../components/MonthlyCalendar';
import ConfirmDialog from '../components/ConfirmDialog';
import * as tauriAPI from '../hooks/useTauriAPI';

const DayRowEditor: React.FC<{ day: DayOfWeek, entry: TimeEntry, onChange: (newEntry: TimeEntry) => void, readonly: boolean, preAssignedInterval?: boolean }> = ({ day, entry, onChange, readonly, preAssignedInterval }) => {

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
      {['entrada1', 'saida1', 'entrada2', 'saida2'].map((field) => (
        <td key={field} className="py-2 px-3">
          <input
            type="time"
            value={
              (preAssignedInterval && field === 'saida1') ? '12:00' :
                (preAssignedInterval && field === 'entrada2') ? '13:00' :
                  entry[field as keyof Omit<TimeEntry, 'feriado'>]
            }
            onChange={(e) => handleTimeChange(field as keyof Omit<TimeEntry, 'feriado'>, e.target.value)}
            disabled={entry.feriado || readonly || (preAssignedInterval && (field === 'saida1' || field === 'entrada2'))}
            readOnly={readonly}
            className={`w-full p-2 border rounded-md text-sm bg-white dark:bg-secondary-700 text-secondary-700 dark:text-secondary-200 border-secondary-300 dark:border-secondary-600 focus:ring-primary-500 focus:border-primary-500 ${(entry.feriado || readonly || (preAssignedInterval && (field === 'saida1' || field === 'entrada2'))) ? 'bg-secondary-100 dark:bg-secondary-800 cursor-not-allowed text-secondary-400' : ''}`}
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
    automationMode,
    setAutomationMode,
    automationState,
    settings,
    currentUserCredentials,
    updateSettings
  } = useAppContext();

  const renderPreAssignedIntervalToggle = (mode: AutomationMode, compact = false) => (
    <div className={compact ? "flex-1" : "mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-700"}>
      <div className={compact ? "" : "flex items-center justify-between bg-white dark:bg-secondary-800 p-3 rounded-md border border-secondary-200 dark:border-secondary-700"}>
        {!compact && (
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400 mr-3">
              <i className="fas fa-utensils"></i>
            </div>
            <div>
              <span className="block text-sm font-medium text-secondary-900 dark:text-secondary-100">
                Pré-assinalação de Intervalo
              </span>
              <span className="block text-xs text-secondary-500 dark:text-secondary-400">
                Pula Saída 1 e Entrada 2 (12:00 - 13:00) para o modo <strong>{mode}</strong>.
              </span>
            </div>
          </div>
        )}
        {compact && (
          <span className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
            <i className="fas fa-utensils mr-2"></i>
            Pré-assinalação de Intervalo
          </span>
        )}

        <label htmlFor={`preAssignedIntervalToggle_${mode}`} className={`flex items-center ${compact ? 'justify-between px-3 py-2 bg-white dark:bg-secondary-800 border border-secondary-300 dark:border-secondary-600 rounded-md cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-700/30' : 'cursor-pointer'}`}>
          <span className={`text-sm ${compact ? 'text-secondary-600 dark:text-secondary-400' : 'mr-3 font-medium text-secondary-700 dark:text-secondary-300'}`}>
            {(settings.preAssignedIntervalConfig && settings.preAssignedIntervalConfig[mode]) ? 'Ativado' : 'Desativado'}
          </span>
          <div className="relative inline-flex items-center">
            <input
              type="checkbox"
              id={`preAssignedIntervalToggle_${mode}`}
              className="sr-only peer"
              checked={(settings.preAssignedIntervalConfig && settings.preAssignedIntervalConfig[mode]) || false}
              disabled={automationState.isRunning}
              onChange={(e) => {
                const newValue = e.target.checked;
                const currentConfig = settings.preAssignedIntervalConfig || {};
                const newConfig = { ...currentConfig, [mode]: newValue };
                updateSettings({ preAssignedIntervalConfig: newConfig });
                addLog(LogLevel.INFO, `Pré-assinalação de intervalo ${newValue ? 'ativada' : 'desativada'} para ${mode}.`);
              }}
            />
            <div className="w-11 h-6 bg-secondary-200 dark:bg-secondary-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 peer-disabled:opacity-50"></div>
          </div>
        </label>
      </div>
    </div>
  );

  // Estados separados para cada modo (não se influenciam)
  const [weeklyManualSchedule, setWeeklyManualSchedule] = useState<Schedule>({
    [DayOfWeek.MONDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.TUESDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.WEDNESDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.THURSDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.FRIDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
  });
  const [weeklyAutoSchedule, setWeeklyAutoSchedule] = useState<Schedule>({
    [DayOfWeek.MONDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.TUESDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.WEDNESDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.THURSDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
    [DayOfWeek.FRIDAY]: { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false },
  });
  const [monthlyAutoSchedule, setMonthlyAutoSchedule] = useState<MonthlySchedule>({});

  const [initialHourWeeklyAuto, setInitialHourWeeklyAuto] = useState<string>("07:00");
  const [initialHourMonthlyAuto, setInitialHourMonthlyAuto] = useState<string>("07:00");

  const handleModeChange = (mode: AutomationMode) => {
    setAutomationMode(mode);
    addLog(LogLevel.INFO, `Modo de operação alterado para: ${mode}`);
    if (mode === AutomationMode.WEEKLY_AUTO) {
      generateWeeklyAutoSchedule(initialHourWeeklyAuto);
    } else if (mode === AutomationMode.MONTHLY_AUTO) {
      generateMonthlyAutoSchedule(initialHourMonthlyAuto);
    }
  };

  const handleUpdateMonthlyDay = useCallback((date: string, entry: MonthlyDayEntry) => {
    setMonthlyAutoSchedule(prev => ({
      ...prev,
      [date]: entry
    }));
  }, []);

  const generateMonthlyAutoSchedule = useCallback((baseStartTime: string) => {
    addLog(LogLevel.INFO, 'Gerando calendário mensal automático com horários variados...');
    const newMonthlySchedule: MonthlySchedule = {};
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const baseStart = parseTime(baseStartTime);
    if (!baseStart) {
      addLog(LogLevel.ERROR, `Hora inicial inválida: ${baseStartTime}`);
      return;
    }

    // Armazena horários já usados para garantir que não se repitam
    const usedTimes = new Set<string>();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dayOfWeek = date.getDay(); // 0 = Domingo, 1 = Segunda, etc.
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Pula finais de semana
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      // Gera horários únicos para este dia
      const entrada1Min = generateUniqueRandomMinute(usedTimes);
      const entrada1 = formatTime(baseStart.hours, entrada1Min);
      usedTimes.add(entrada1);

      const saida1Hour = 12;
      const saida1Min = generateUniqueRandomMinute(usedTimes);
      const saida1 = formatTime(saida1Hour, saida1Min);
      usedTimes.add(saida1);

      const entrada2 = addHours(saida1, 1);
      usedTimes.add(entrada2);

      const saida2 = addHours(entrada1, 9); // Total 8h trabalho + 1h almoço
      usedTimes.add(saida2);

      newMonthlySchedule[dateKey] = {
        date: dateKey,
        entrada1,
        saida1,
        entrada2,
        saida2,
        feriado: false
      };
    }

    setMonthlyAutoSchedule(newMonthlySchedule);
    addLog(LogLevel.SUCCESS, `Calendário mensal gerado com ${Object.keys(newMonthlySchedule).length} dias únicos.`);
  }, [addLog]);

  const generateRandomMinute = (min: number = 0, max: number = 59) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const generateUniqueRandomMinute = (usedTimes: Set<string>, baseHour?: number) => {
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      const minute = generateRandomMinute();
      const timeStr = baseHour !== undefined ? formatTime(baseHour, minute) : minute.toString();

      if (!usedTimes.has(timeStr)) {
        return minute;
      }
      attempts++;
    }

    // Fallback: retorna qualquer minuto se não conseguir único após 60 tentativas
    return generateRandomMinute();
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

  const generateWeeklyAutoSchedule = useCallback((baseStartTime: string) => {
    const baseStart = parseTime(baseStartTime);
    if (!baseStart) {
      addLog(LogLevel.ERROR, `Hora inicial inválida para modo semanal automático: ${baseStartTime}`);
      return;
    }

    addLog(LogLevel.INFO, `Gerando horários semanais automáticos com base em ${baseStartTime}...`);
    const newSchedule: Schedule = { ...weeklyAutoSchedule };

    DAYS_OF_WEEK.forEach(day => {
      if (newSchedule[day].feriado) {
        addLog(LogLevel.DEBUG, `Pulando ${day} (feriado) na geração semanal automática.`);
        return;
      }

      const entrada1Min = generateRandomMinute();
      const entrada1 = formatTime(baseStart.hours, entrada1Min);

      const saida1Hour = 12;
      const saida1Min = generateRandomMinute();
      const saida1 = formatTime(saida1Hour, saida1Min);

      const entrada2 = addHours(saida1, 1);
      const saida2 = addHours(entrada1, 9); // Total 8h trabalho + 1h almoço

      newSchedule[day] = {
        ...newSchedule[day],
        entrada1,
        saida1,
        entrada2,
        saida2,
      };
    });
    setWeeklyAutoSchedule(newSchedule);
    addLog(LogLevel.SUCCESS, "Grade de horários semanais automáticos gerada.");
  }, [addLog, weeklyAutoSchedule]);

  useEffect(() => {
    if (automationMode === AutomationMode.WEEKLY_AUTO) {
      generateWeeklyAutoSchedule(initialHourWeeklyAuto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHourWeeklyAuto, automationMode]);

  useEffect(() => {
    if (automationMode === AutomationMode.MONTHLY_AUTO) {
      generateMonthlyAutoSchedule(initialHourMonthlyAuto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHourMonthlyAuto, automationMode]);

  // Regeneração automática de horários ao fim do ciclo (semana/mês)
  useEffect(() => {
    // Só ativa se a opção estiver habilitada nas configurações
    if (!settings.autoRegenerateSchedules) return;

    const checkAndRegenerate = () => {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Domingo, 6 = Sábado
      const dayOfMonth = now.getDate();

      // Semanal Automático: regenera toda segunda-feira (dia 1)
      if (automationMode === AutomationMode.WEEKLY_AUTO && dayOfWeek === 1) {
        // Verifica se já regenerou hoje
        const lastRegenKey = 'lastWeeklyRegen';
        const lastRegen = localStorage.getItem(lastRegenKey);
        const todayKey = now.toDateString();

        if (lastRegen !== todayKey) {
          addLog(LogLevel.INFO, '📅 Início de nova semana detectado! Regenerando horários semanais automáticos...');
          generateWeeklyAutoSchedule(initialHourWeeklyAuto);
          localStorage.setItem(lastRegenKey, todayKey);
        }
      }

      // Mensal Automático: regenera todo dia 1º do mês
      if (automationMode === AutomationMode.MONTHLY_AUTO && dayOfMonth === 1) {
        // Verifica se já regenerou este mês
        const lastRegenKey = 'lastMonthlyRegen';
        const lastRegen = localStorage.getItem(lastRegenKey);
        const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

        if (lastRegen !== monthKey) {
          addLog(LogLevel.INFO, '📅 Início de novo mês detectado! Regenerando horários mensais automáticos...');
          generateMonthlyAutoSchedule(initialHourMonthlyAuto);
          localStorage.setItem(lastRegenKey, monthKey);
        }
      }
    };

    // Verifica a cada hora (3600000 ms)
    const interval = setInterval(checkAndRegenerate, 3600000);

    // Verifica imediatamente ao montar
    checkAndRegenerate();

    return () => clearInterval(interval);
  }, [settings.autoRegenerateSchedules, automationMode, initialHourWeeklyAuto, initialHourMonthlyAuto, generateWeeklyAutoSchedule, generateMonthlyAutoSchedule, addLog]);

  // Converte o schedule mensal para o formato semanal esperado pela automação
  const convertMonthlyToWeeklySchedule = (monthlySchedule: MonthlySchedule): Schedule => {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayEntry = monthlySchedule[dateKey];

    // Se não houver entrada para hoje, retorna schedule vazio
    if (!todayEntry) {
      return DAYS_OF_WEEK.reduce((acc, day) => {
        acc[day] = { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false };
        return acc;
      }, {} as Schedule);
    }

    // Determina o dia da semana atual (0 = Domingo, 1 = Segunda, ..., 6 = Sábado)
    const dayOfWeek = today.getDay();

    // Mapeia índice do dia da semana para DayOfWeek enum (apenas dias úteis)
    const dayMap: { [key: number]: DayOfWeek } = {
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY
    };

    const currentDayName = dayMap[dayOfWeek];

    // Cria schedule com os horários de hoje apenas no dia correto
    const weeklySchedule = DAYS_OF_WEEK.reduce((acc, day) => {
      acc[day] = { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false };
      return acc;
    }, {} as Schedule);

    // Aplica os horários de hoje no dia da semana correspondente (se for dia útil)
    if (currentDayName && weeklySchedule[currentDayName] !== undefined) {
      weeklySchedule[currentDayName] = {
        entrada1: todayEntry.entrada1,
        saida1: todayEntry.saida1,
        entrada2: todayEntry.entrada2,
        saida2: todayEntry.saida2,
        feriado: todayEntry.feriado
      };
    }

    return weeklySchedule;
  };

  const handleExecute = () => {
    if (!currentUserCredentials || !currentUserCredentials.folha || !currentUserCredentials.senha) {
      addLog(LogLevel.ERROR, "Credenciais do usuário não encontradas. Faça login novamente.");
      return;
    }

    // Determina qual schedule usar baseado no modo ativo
    let scheduleToUse: Schedule;
    if (automationMode === AutomationMode.WEEKLY_MANUAL) {
      scheduleToUse = weeklyManualSchedule;
    } else if (automationMode === AutomationMode.WEEKLY_AUTO) {
      scheduleToUse = weeklyAutoSchedule;
    } else {
      scheduleToUse = convertMonthlyToWeeklySchedule(monthlyAutoSchedule);
    }

    // Validar horários antes de iniciar (fix bug #15)
    const preAssigned = settings.preAssignedIntervalConfig?.[automationMode] || false;
    for (const [day, entry] of Object.entries(scheduleToUse)) {
      if (entry.feriado || !entry.entrada1) continue;
      const parseMin = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      const e1 = parseMin(entry.entrada1);
      const s2 = parseMin(entry.saida2);
      if (!preAssigned) {
        const s1 = parseMin(entry.saida1);
        const e2 = parseMin(entry.entrada2);
        if (e1 >= s1 || s1 >= e2 || e2 >= s2) {
          addLog(LogLevel.ERROR, `Horários inválidos em ${day}: os horários devem ser E1 < S1 < E2 < S2.`);
          return;
        }
      } else {
        if (e1 >= s2) {
          addLog(LogLevel.ERROR, `Horários inválidos em ${day}: Entrada 1 deve ser antes da Saída 2.`);
          return;
        }
      }
    }

    addLog(LogLevel.INFO, `Solicitando início da automação no modo: ${automationMode}`);
    const effectiveSettings = {
      ...settings,
      preAssignedInterval: settings.preAssignedIntervalConfig?.[automationMode] || false
    };

    tauriAPI.startAutomation({
      schedule: scheduleToUse,
      credentials: currentUserCredentials,
      settings: effectiveSettings
    }).catch(err => {
      addLog(LogLevel.ERROR, `Erro ao iniciar automação: ${err}`);
    });
  };

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    const emptyEntry = { entrada1: '', saida1: '', entrada2: '', saida2: '', feriado: false };
    if (automationMode === AutomationMode.WEEKLY_MANUAL) {
      setWeeklyManualSchedule({
        [DayOfWeek.MONDAY]: { ...emptyEntry },
        [DayOfWeek.TUESDAY]: { ...emptyEntry },
        [DayOfWeek.WEDNESDAY]: { ...emptyEntry },
        [DayOfWeek.THURSDAY]: { ...emptyEntry },
        [DayOfWeek.FRIDAY]: { ...emptyEntry },
      });
    } else if (automationMode === AutomationMode.WEEKLY_AUTO) {
      setWeeklyAutoSchedule({
        [DayOfWeek.MONDAY]: { ...emptyEntry },
        [DayOfWeek.TUESDAY]: { ...emptyEntry },
        [DayOfWeek.WEDNESDAY]: { ...emptyEntry },
        [DayOfWeek.THURSDAY]: { ...emptyEntry },
        [DayOfWeek.FRIDAY]: { ...emptyEntry },
      });
    } else if (automationMode === AutomationMode.MONTHLY_AUTO) {
      setMonthlyAutoSchedule({});
    }
    addLog(LogLevel.WARNING, `Todos os horários do modo ${automationMode} foram limpos pelo usuário.`);
    setShowClearConfirm(false);
  };

  const handleInterrupt = () => {
    addLog(LogLevel.INFO, "Solicitando interrupção da automação.");
    tauriAPI.stopAutomation().catch(err => {
      addLog(LogLevel.ERROR, `Erro ao interromper automação: ${err}`);
    });
  };

  const handleExportCalendar = async () => {
    addLog(LogLevel.INFO, "Exportando horários para calendário...");

    let scheduleToExport: Schedule;
    if (automationMode === AutomationMode.WEEKLY_MANUAL) {
      scheduleToExport = weeklyManualSchedule;
    } else if (automationMode === AutomationMode.WEEKLY_AUTO) {
      scheduleToExport = weeklyAutoSchedule;
    } else {
      scheduleToExport = convertMonthlyToWeeklySchedule(monthlyAutoSchedule);
    }

    try {
      const result = await tauriAPI.exportCalendar(scheduleToExport);
      if (result.success) {
        addLog(LogLevel.SUCCESS, `Calendário exportado com sucesso: ${result.path}`);
      } else {
        addLog(LogLevel.ERROR, `Falha ao exportar calendário: ${result.error}`);
      }
    } catch (error) {
      addLog(LogLevel.ERROR, `Erro ao exportar calendário: ${error}`);
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
              {mode === AutomationMode.WEEKLY_MANUAL && <i className="fas fa-edit mr-2"></i>}
              {mode === AutomationMode.WEEKLY_AUTO && <i className="fas fa-magic mr-2"></i>}
              {mode === AutomationMode.MONTHLY_AUTO && <i className="fas fa-calendar-alt mr-2"></i>}
              {mode}
            </button>
          ))}
        </div>

        {automationMode === AutomationMode.WEEKLY_MANUAL && (
          renderPreAssignedIntervalToggle(AutomationMode.WEEKLY_MANUAL, false)
        )}

        {automationMode === AutomationMode.WEEKLY_AUTO && (
          <div className="mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-700">
            <div className="flex items-end gap-6">
              {/* Campo de Hora Base */}
              <div className="flex-1">
                <label htmlFor="initialHourWeeklyAuto" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  <i className="fas fa-clock mr-2"></i>
                  Hora base para Entrada 1
                </label>
                <input
                  type="time"
                  id="initialHourWeeklyAuto"
                  value={initialHourWeeklyAuto}
                  disabled={automationState.isRunning}
                  onChange={(e) => setInitialHourWeeklyAuto(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 border border-secondary-300 dark:border-secondary-600 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Toggle de Regeneração Automática */}
              <div className="flex-1">
                <span className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  <i className="fas fa-sync-alt mr-2"></i>
                  Regenerar automaticamente
                </span>
                <label htmlFor="autoRegenerateToggleWeekly" className="flex items-center justify-between px-3 py-2 bg-white dark:bg-secondary-800 border border-secondary-300 dark:border-secondary-600 rounded-md cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-700/30">
                  <span className="text-sm text-secondary-600 dark:text-secondary-400">
                    {settings.autoRegenerateSchedules ? 'Ativado' : 'Desativado'}
                  </span>
                  <div className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      id="autoRegenerateToggleWeekly"
                      className="sr-only peer"
                      checked={settings.autoRegenerateSchedules || false}
                      disabled={automationState.isRunning}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        updateSettings({ autoRegenerateSchedules: newValue });
                        addLog(LogLevel.INFO, `Regeneração automática ${newValue ? 'ativada' : 'desativada'}.`);
                      }}
                    />
                    <div className="w-11 h-6 bg-secondary-200 dark:bg-secondary-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 peer-disabled:opacity-50"></div>
                  </div>
                </label>
              </div>
              {renderPreAssignedIntervalToggle(AutomationMode.WEEKLY_AUTO, true)}
            </div>

            {/* Descrições abaixo */}
            <div className="flex gap-6 mt-2">
              <p className="flex-1 text-xs text-secondary-500 dark:text-secondary-400">
                A Entrada 1 será aleatória dentro desta hora. Outros horários serão baseados nela.
              </p>
              <p className="flex-1 text-xs text-secondary-500 dark:text-secondary-400">
                Toda segunda-feira, novos horários serão gerados automaticamente.
              </p>
            </div>
          </div>
        )}
        {automationMode === AutomationMode.MONTHLY_AUTO && (
          <div className="mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-700">
            <div className="flex items-end gap-6">
              {/* Campo de Hora Base */}
              <div className="flex-1">
                <label htmlFor="initialHourMonthlyAuto" className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  <i className="fas fa-clock mr-2"></i>
                  Hora base para Entrada 1
                </label>
                <input
                  type="time"
                  id="initialHourMonthlyAuto"
                  value={initialHourMonthlyAuto}
                  disabled={automationState.isRunning}
                  onChange={(e) => setInitialHourMonthlyAuto(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-100 border border-secondary-300 dark:border-secondary-600 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Toggle de Regeneração Automática */}
              <div className="flex-1">
                <span className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-2">
                  <i className="fas fa-sync-alt mr-2"></i>
                  Regenerar automaticamente
                </span>
                <label htmlFor="autoRegenerateToggleMonthly" className="flex items-center justify-between px-3 py-2 bg-white dark:bg-secondary-800 border border-secondary-300 dark:border-secondary-600 rounded-md cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-700/30">
                  <span className="text-sm text-secondary-600 dark:text-secondary-400">
                    {settings.autoRegenerateSchedules ? 'Ativado' : 'Desativado'}
                  </span>
                  <div className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      id="autoRegenerateToggleMonthly"
                      className="sr-only peer"
                      checked={settings.autoRegenerateSchedules || false}
                      disabled={automationState.isRunning}
                      onChange={(e) => {
                        const newValue = e.target.checked;
                        updateSettings({ autoRegenerateSchedules: newValue });
                        addLog(LogLevel.INFO, `Regeneração automática ${newValue ? 'ativada' : 'desativada'}.`);
                      }}
                    />
                    <div className="w-11 h-6 bg-secondary-200 dark:bg-secondary-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 peer-disabled:opacity-50"></div>
                  </div>
                </label>
              </div>
              {renderPreAssignedIntervalToggle(AutomationMode.MONTHLY_AUTO, true)}
            </div>

            {/* Descrições abaixo */}
            <div className="flex gap-6 mt-2">
              <p className="flex-1 text-xs text-secondary-500 dark:text-secondary-400">
                Todos os horários do mês serão gerados automaticamente sem repetições, baseados nesta hora.
              </p>
              <p className="flex-1 text-xs text-secondary-500 dark:text-secondary-400">
                Todo dia 1º do mês, novos horários serão gerados automaticamente.
              </p>
            </div>
          </div>
        )
        }
      </div >

      <div className="bg-white dark:bg-secondary-800 p-4 rounded-lg shadow overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold text-primary-700 dark:text-primary-300">
            {automationMode === AutomationMode.MONTHLY_AUTO ? 'Calendário Mensal' : 'Grade de Horários'} ({automationMode})
          </h2>
          <button
            onClick={handleExportCalendar}
            disabled={automationState.isRunning}
            title="Exportar horários para o calendário (Google Calendar, Apple Calendar, etc.)"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 flex items-center"
          >
            <i className="fas fa-calendar-plus mr-2"></i> Exportar Calendário
          </button>
        </div>

        {automationMode === AutomationMode.MONTHLY_AUTO ? (
          <MonthlyCalendar
            monthlySchedule={monthlyAutoSchedule}
            onUpdateDay={handleUpdateMonthlyDay}
            readonly={automationState.isRunning}
            preAssignedInterval={settings.preAssignedIntervalConfig?.[automationMode]}
          />
        ) : (
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
                    entry={automationMode === AutomationMode.WEEKLY_MANUAL ? weeklyManualSchedule[day] : weeklyAutoSchedule[day]}
                    onChange={(newEntry) => {
                      if (automationMode === AutomationMode.WEEKLY_MANUAL) {
                        setWeeklyManualSchedule(prev => ({ ...prev, [day]: newEntry }));
                      } else {
                        setWeeklyAutoSchedule(prev => ({ ...prev, [day]: newEntry }));
                      }
                    }}
                    readonly={automationState.isRunning || automationMode === AutomationMode.WEEKLY_AUTO}
                    preAssignedInterval={settings.preAssignedIntervalConfig?.[automationMode]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-secondary-800 p-4 rounded-lg shadow flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0 sm:space-x-3">
        <div className="text-sm text-secondary-600 dark:text-secondary-400">
          Status: <span className={`font-semibold ${automationState.isRunning ? 'text-yellow-500 animate-pulse' : 'text-green-500'}`}>{automationState.statusMessage}</span>
          {automationState.isRunning && automationState.currentTask && (
            <span className="ml-2">| Tarefa: {automationState.currentTask}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExecute}
            disabled={automationState.isRunning}
            title="Iniciar Automação"
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
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Limpar Grade"
        message="Tem certeza que deseja limpar todos os horários da grade?"
        confirmText="Limpar"
        cancelText="Cancelar"
        variant="danger"
        onConfirm={confirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};

export default AppView;