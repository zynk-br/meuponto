// modules/telegram.js
const axios = require('axios');

// A função de envio se torna interna ao módulo
async function sendTelegramNotification(store, message) {
    const settings = store.get("telegramSettings");
    if (!settings || !settings.token || !settings.chatId) {
        // Não precisamos logar daqui, o chamador pode fazer isso.
        return;
    }
    const url = `https://api.telegram.org/bot${settings.token}/sendMessage`;
    try {
        await axios.post(url, { chat_id: settings.chatId, text: message, parse_mode: "Markdown" });
        // Também não precisamos logar daqui.
    } catch (error) {
        console.error(`Falha ao enviar notificação do Telegram: ${error.message}`);
        // Lançar o erro permite que o chamador decida como lidar com ele.
        throw error;
    }
}

// Exporta um objeto que será inicializado
module.exports = function(store) {
    // Retorna um objeto com a função que pode ser chamada
    return {
        send: (message) => sendTelegramNotification(store, message)
    };
};