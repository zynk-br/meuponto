// Arquivo agora em: src/renderer/components/Modal.tsx
import React, { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md', footer }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-secondary-800 rounded-lg shadow-xl w-full ${sizeClasses[size]} flex flex-col max-h-[90vh]`}>
        <div className="flex justify-between items-center p-4 border-b border-secondary-200 dark:border-secondary-700">
          <h2 className="text-xl font-semibold text-secondary-800 dark:text-secondary-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-secondary-500 hover:text-secondary-700 dark:text-secondary-400 dark:hover:text-secondary-200"
            aria-label="Fechar modal"
          >
            <i className="fas fa-times fa-lg"></i>
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 bg-secondary-50 dark:bg-secondary-900 border-t border-secondary-200 dark:border-secondary-700 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
