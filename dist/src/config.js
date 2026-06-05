import { getBotConfig } from './services/configStore.js';
function loadConfig() {
    const bot = getBotConfig();
    if (!bot) {
        throw new Error('Bot configuration not found.\n' +
            'Run "remote-opencode setup" to configure your Discord bot.');
    }
    return {
        discordToken: bot.discordToken,
        clientId: bot.clientId,
        guildId: bot.guildId,
    };
}
export const config = loadConfig();
