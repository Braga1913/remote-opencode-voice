import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as dataStore from '../services/dataStore.js';
function getParentChannelId(interaction) {
    const channel = interaction.channel;
    if (channel?.isThread()) {
        return channel.parentId ?? interaction.channelId;
    }
    return interaction.channelId;
}
export const autowork = {
    data: new SlashCommandBuilder()
        .setName('autowork')
        .setDescription('Toggle automatic worktree creation for this channel\'s project'),
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
        const currentState = dataStore.getProjectAutoWorktree(projectAlias);
        const newState = !currentState;
        const success = dataStore.setProjectAutoWorktree(projectAlias, newState);
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
            content: `${emoji} Auto-worktree **${status}** for project **${projectAlias}**.\n\nNew sessions will ${newState ? 'automatically create' : 'NOT create'} isolated worktrees.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
