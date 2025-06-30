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
        <p>Para receber notificações no Telegram, você precisará de um Token de Bot e um Chat ID.</p>
        
        <h3 className="font-semibold text-md text-secondary-800 dark:text-secondary-100">1. Obtendo o Token do Bot:</h3>
        <ol className="list-decimal list-inside space-y-1 pl-4">
          <li>Abra o Telegram e procure por "BotFather".</li>
          <li>Inicie uma conversa com o BotFather enviando o comando <code>/newbot</code>.</li>
          <li>Siga as instruções para dar um nome e um username ao seu bot. O username deve terminar com "bot" (ex: <code>MeuPontoBot</code>).</li>
          <li>Após a criação, o BotFather fornecerá um token de acesso. Copie este token.</li>
        </ol>

        <h3 className="font-semibold text-md text-secondary-800 dark:text-secondary-100">2. Obtendo o Chat ID:</h3>
        <ol className="list-decimal list-inside space-y-1 pl-4">
          <li>Procure no Telegram por "userinfobot" ou "get id bot".</li>
          <li>Inicie uma conversa com um desses bots.</li>
          <li>Envie o comando <code>/start</code> ou simplesmente qualquer mensagem.</li>
          <li>O bot responderá com várias informações, incluindo seu "Id" ou "Chat ID". Copie este número.</li>
          <li><strong>Importante:</strong> Você precisa iniciar uma conversa com o SEU BOT (criado no passo 1) antes que ele possa te enviar mensagens. Encontre seu bot pelo username e envie <code>/start</code> para ele.</li>
        </ol>

        <h3 className="font-semibold text-md text-secondary-800 dark:text-secondary-100">3. Configurando no Aplicativo:</h3>
        <p>
          Volte para a tela de Configurações deste aplicativo e cole o Token do Bot e o Chat ID nos campos correspondentes.
        </p>
        <div className="p-3 bg-yellow-100 dark:bg-yellow-700 dark:text-yellow-50 border border-yellow-300 dark:border-yellow-600 rounded-md">
          <p className="font-medium"><i className="fas fa-exclamation-triangle mr-2"></i>Dica: Mantenha seu Token de Bot em segurança, pois ele permite controlar seu bot.</p>
        </div>
      </div>
    </Modal>
  );
};

export default TelegramTutorialModal;
