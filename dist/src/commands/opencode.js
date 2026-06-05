import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as dataStore from '../services/dataStore.js';
import { getOrCreateThread } from '../utils/threadHelper.js';
import { runPrompt } from '../services/executionService.js';
import { isBusy } from '../services/queueManager.js';
function getParentChannelId(interaction) {
    const channel = interaction.channel;
    if (channel?.isThread()) {
        return channel.parentId ?? interaction.channelId;
    }
    return interaction.channelId;
}
export const opencode = {
    data: new SlashCommandBuilder()
        .setName('opencode')
        .setDescription('Send a command to OpenCode')
        .addStringOption(option => option.setName('prompt')
        .setDescription('Prompt to send to OpenCode')
        .setRequired(true)),
    async execute(interaction) {
        const prompt = interaction.options.getString('prompt', true);
        const channelId = getParentChannelId(interaction);
        const isInThread = interaction.channel?.isThread() ?? false;
        const projectPath = dataStore.getChannelProjectPath(channelId);
        if (!projectPath) {
            await interaction.reply({
                content: '❌ No project set for this channel. Use `/use <alias>` to set a project.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        await interaction.deferReply();
        let thread;
        try {
            if (isInThread && interaction.channel?.isThread()) {
                thread = interaction.channel;
            }
            else {
                thread = await getOrCreateThread(interaction, prompt);
            }
        }
        catch {
            await interaction.editReply({
                content: '❌ Cannot create thread.',
            });
            return;
        }
        const threadId = thread.id;
        if (isBusy(threadId)) {
            dataStore.addToQueue(threadId, {
                prompt,
                userId: interaction.user.id,
                timestamp: Date.now()
            });
            await interaction.editReply({
                content: '📥 Prompt added to queue.',
            });
            return;
        }
        await interaction.editReply({
            content: `📌 **Prompt**: ${prompt}`
        });
        await runPrompt(thread, threadId, prompt, channelId);
    }
};
