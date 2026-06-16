import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { useAppContext } from '../hooks/useAppContext';
import { LogLevel } from '../types';
import * as tauriAPI from '../hooks/useTauriAPI';

const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'Registered': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    case 'Failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'Rescheduled': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    default: return 'bg-secondary-100 dark:bg-secondary-700 text-secondary-600 dark:text-secondary-300';
  }
};

const HistoryModal: React.FC = () => {
  const { isHistoryModalOpen, setIsHistoryModalOpen, addLog } = useAppContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [history, setHistory] = useState<Record<string, any> | null>(null);

  const load = useCallback(async () => {
    setHistory(null);
    try {
      const h = await tauriAPI.loadPunchHistory();
      setHistory(h || {});
    } catch (e) {
      addLog(LogLevel.ERROR, `Erro ao carregar histórico: ${e}`);
      setHistory({});
    }
  }, [addLog]);

  useEffect(() => {
    if (isHistoryModalOpen) load();
  }, [isHistoryModalOpen, load]);

  return (
    <Modal
      isOpen={isHistoryModalOpen}
      onClose={() => setIsHistoryModalOpen(false)}
      title="Histórico de Batidas"
      size="xl"
    >
      {history === null ? (
        <p className="text-sm text-secondary-500 dark:text-secondary-400">Carregando histórico...</p>
      ) : Object.keys(history).length === 0 ? (
        <p className="text-sm text-secondary-500 dark:text-secondary-400">Nenhum histórico registrado ainda.</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(history)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, plan]) => (
              <div key={date} className="border border-secondary-200 dark:border-secondary-700 rounded-md p-3">
                <div className="text-sm font-medium text-secondary-800 dark:text-secondary-200 mb-2">
                  {date} <span className="text-secondary-500 dark:text-secondary-400">({plan.dayKey})</span>
                  {plan.invalid && <span className="ml-2 text-yellow-600 dark:text-yellow-400">⚠️ dia inválido</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(plan.punches || []).map((p: { punchType: string; plannedTime: string; status: string }, i: number) => (
                    <span key={i} className={`px-3 py-1 rounded-full text-sm font-mono ${statusBadgeClass(p.status)}`}>
                      {p.punchType} {p.plannedTime}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
};

export default HistoryModal;
