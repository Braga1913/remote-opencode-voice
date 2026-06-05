import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { commands } from '../src/commands/index.js';
const commandsData = Array.from(commands.values()).map(c => c.data.toJSON());
const rest = new REST({ version: '10' }).setToken(config.discordToken);
(async () => {
    try {
        console.log(`Started refreshing ${commandsData.length} application (/) commands.`);
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandsData });
        console.log(`Successfully reloaded ${commandsData.length} application (/) commands.`);
    }
    catch (error) {
        console.error(error);
    }
})();
