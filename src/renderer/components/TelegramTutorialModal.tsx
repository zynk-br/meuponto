// Arquivo agora em: src/renderer/components/TelegramTutorialModal.tsx
import React from 'react';
import Modal from './Modal'; // Ajustado
import { useAppContext } from '../hooks/useAppContext'; // Ajustado

const TelegramTutorialModal: React.FC = () => {
  const { isTelegramTutorialModalOpen, setIsTelegramTutorialModalOpen } = useAppContext();

  return (
    <Modal
      isOpen={isTelegramTutorialModalOpen}
      onClose={() => setIsTelegramTutorialModalOpen(false)}
      title="Configurando Notificações do Telegram"
      size="lg"
    >
      <div className="space-y-4 text-sm text-secondary-700 dark:text-secondary-300">
        <p>Para receber notificações no Telegram, você precisará de um Chat ID.</p>

        <h3 className="font-semibold text-md text-secondary-800 dark:text-secondary-100">1. Obtendo o Chat ID:</h3>
        <ol className="list-decimal list-inside space-y-1 pl-4">
          <li>Procure no Telegram por "userinfobot" ou "get id bot".</li>
          <li>Inicie uma conversa com um desses bots.</li>
          <li>Envie o comando <code>/start</code> ou simplesmente qualquer mensagem.</li>
          <li>O bot responderá com várias informações, incluindo seu "Id" ou "Chat ID". Copie este número.</li>
          <li><strong>Importante:</strong> Você precisa iniciar uma conversa com o bot "MeuPonto" (@MeuPontoRBot) antes que ele possa te enviar mensagens. Encontre-o e envie <code>/start</code> para ele.</li>
        </ol>

        <h3 className="font-semibold text-md text-secondary-800 dark:text-secondary-100">2. Configurando no Aplicativo:</h3>
        <p>
          Volte para a tela de Configurações deste aplicativo e cole o Chat ID no campo correspondente.
        </p>
      </div>
    </Modal>
  );
};

export default TelegramTutorialModal;
