import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as dataStore from '../services/dataStore.js';
function getParentChannelId(interaction) {
    const channel = interaction.channel;
    if (channel?.isThread()) {
        return channel.parentId ?? interaction.channelId;
    }
    return interaction.channelId;
}
export const autocode = {
    data: new SlashCommandBuilder()
        .setName('autocode')
        .setDescription('Toggle automatic passthrough mode for new threads in this channel\'s project'),
    async execute(interaction) {
        const channelId = getParentChannelId(interaction);
        const projectAlias = dataStore.getChannelBinding(channelId);
        if (!projectAlias) {
            await interaction.reply({
                content: '❌ No project set for this channel. Use `/use <alias>` to bind a project first.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const currentState = dataStore.getProjectAutoPassthrough(projectAlias);
        const newState = !currentState;
        const success = dataStore.setProjectAutoPassthrough(projectAlias, newState);
        if (!success) {
            await interaction.reply({
                content: `❌ Project "${projectAlias}" not found.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const emoji = newState ? '✅' : '❌';
        const status = newState ? 'enabled' : 'disabled';
        await interaction.reply({
            content: `${emoji} Auto-passthrough **${status}** for project **${projectAlias}**.\n\nNew threads will ${newState ? 'automatically enable' : 'NOT automatically enable'} passthrough mode (no slash command needed).`,
            flags: MessageFlags.Ephemeral
        });
    }
};
