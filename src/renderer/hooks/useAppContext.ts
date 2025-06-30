// Arquivo agora em: src/renderer/hooks/useAppContext.ts
import { useContext } from 'react';
import { AppContext } from '../contexts/AppContext'; // Ajustado

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
