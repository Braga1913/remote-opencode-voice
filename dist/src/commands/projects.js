import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as dataStore from '../services/dataStore.js';
export const projects = {
    data: new SlashCommandBuilder()
        .setName('projects')
        .setDescription('List registered projects'),
    async execute(interaction) {
        const projectList = dataStore.getProjects();
        if (projectList.length === 0) {
            await interaction.reply('📭 No projects registered. Use `/setpath` to register a project.');
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle('📁 Registered Projects')
            .setColor(0x00ff00)
            .addFields(projectList.map(p => ({
            name: p.alias,
            value: p.path,
            inline: false
        })));
        await interaction.reply({ embeds: [embed] });
    }
};
