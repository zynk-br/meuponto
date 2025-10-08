import React, { useState, useEffect } from 'react';
import { MonthlySchedule, MonthlyDayEntry } from '../types';

interface MonthlyCalendarProps {
  monthlySchedule: MonthlySchedule;
  onUpdateDay: (date: string, entry: MonthlyDayEntry) => void;
  readonly: boolean;
}

const MonthlyCalendar: React.FC<MonthlyCalendarProps> = ({ monthlySchedule, onUpdateDay, readonly }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Domingo, 1 = Segunda, etc.

    return { daysInMonth, startDayOfWeek, year, month };
  };

  const formatDateKey = (year: number, month: number, day: number): string => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const { daysInMonth, startDayOfWeek, year, month } = getDaysInMonth(currentMonth);

  const renderCalendarDays = () => {
    const days = [];
    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

    // Células vazias antes do primeiro dia do mês (Domingo = 0)
    const emptyCellsBefore = startDayOfWeek; // Domingo já é 0, não precisa ajustar
    for (let i = 0; i < emptyCellsBefore; i++) {
      days.push(
        <div key={`empty-${i}`} className="min-h-[120px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"></div>
      );
    }

    // Dias do mês
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = formatDateKey(year, month, day);
      const dayEntry = monthlySchedule[dateKey] || {
        date: dateKey,
        entrada1: '',
        saida1: '',
        entrada2: '',
        saida2: '',
        feriado: false
      };

      const dayOfWeek = new Date(year, month, day).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isToday = isCurrentMonth && day === today.getDate();

      days.push(
        <div
          key={dateKey}
          className={`min-h-[120px] border p-2 ${
            isToday
              ? 'border-primary-500 dark:border-primary-400 border-2 shadow-md ring-2 ring-primary-200 dark:ring-primary-800/50'
              : 'border-gray-200 dark:border-gray-700'
          } ${
            isWeekend ? 'bg-gray-100 dark:bg-gray-800' : 'bg-white dark:bg-secondary-800'
          } ${dayEntry.feriado ? 'bg-red-50 dark:bg-red-900/20' : ''}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-semibold ${
              isToday
                ? 'text-primary-600 dark:text-primary-400'
                : isWeekend ? 'text-gray-500' : 'text-gray-700 dark:text-gray-300'
            }`}>
              {day}
            </span>
            {!isWeekend && (
              <input
                type="checkbox"
                checked={dayEntry.feriado}
                onChange={(e) => onUpdateDay(dateKey, { ...dayEntry, feriado: e.target.checked, entrada1: '', saida1: '', entrada2: '', saida2: '' })}
                disabled={readonly}
                title="Feriado"
                className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
              />
            )}
          </div>

          {!isWeekend && !dayEntry.feriado && (
            <div className="space-y-1">
              <input
                type="time"
                value={dayEntry.entrada1}
                onChange={(e) => onUpdateDay(dateKey, { ...dayEntry, entrada1: e.target.value })}
                disabled={readonly}
                placeholder="E1"
                className="w-full px-1 py-0.5 text-xs border rounded bg-white dark:bg-secondary-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 disabled:opacity-50"
              />
              <input
                type="time"
                value={dayEntry.saida1}
                onChange={(e) => onUpdateDay(dateKey, { ...dayEntry, saida1: e.target.value })}
                disabled={readonly}
                placeholder="S1"
                className="w-full px-1 py-0.5 text-xs border rounded bg-white dark:bg-secondary-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 disabled:opacity-50"
              />
              <input
                type="time"
                value={dayEntry.entrada2}
                onChange={(e) => onUpdateDay(dateKey, { ...dayEntry, entrada2: e.target.value })}
                disabled={readonly}
                placeholder="E2"
                className="w-full px-1 py-0.5 text-xs border rounded bg-white dark:bg-secondary-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 disabled:opacity-50"
              />
              <input
                type="time"
                value={dayEntry.saida2}
                onChange={(e) => onUpdateDay(dateKey, { ...dayEntry, saida2: e.target.value })}
                disabled={readonly}
                placeholder="S2"
                className="w-full px-1 py-0.5 text-xs border rounded bg-white dark:bg-secondary-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 disabled:opacity-50"
              />
            </div>
          )}

          {dayEntry.feriado && !isWeekend && (
            <div className="text-xs text-red-600 dark:text-red-400 font-semibold text-center mt-2">
              Feriado
            </div>
          )}
        </div>
      );
    }

    return days;
  };

  const changeMonth = (delta: number) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(currentMonth.getMonth() + delta);
    setCurrentMonth(newMonth);
  };

  const monthName = currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => changeMonth(-1)}
          disabled={readonly}
          className="px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded-md disabled:opacity-50"
        >
          ← Anterior
        </button>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 capitalize">
          {monthName}
        </h3>
        <button
          onClick={() => changeMonth(1)}
          disabled={readonly}
          className="px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded-md disabled:opacity-50"
        >
          Próximo →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
          <div key={day} className="text-center text-sm font-semibold text-gray-600 dark:text-gray-400 py-2">
            {day}
          </div>
        ))}
        {renderCalendarDays()}
      </div>
    </div>
  );
};

export default MonthlyCalendar;
