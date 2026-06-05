import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { execSync } from 'node:child_process';
import * as dataStore from '../services/dataStore.js';
function getEffectiveChannelId(interaction) {
    const channel = interaction.channel;
    if (channel?.isThread()) {
        return channel.parentId ?? interaction.channelId;
    }
    return interaction.channelId;
}
function getBuiltInAgents() {
    try {
        const output = execSync('opencode agent list', { encoding: 'utf-8', timeout: 5000 });
        return output.split('\n')
            .map(l => l.trim())
            .filter(l => /^[\w-]+/.test(l))
            .map(l => l.replace(/ .*/, ''));
    }
    catch {
        return ['plan', 'build', 'architect', 'debugger', 'ask'];
    }
}
export const agent = {
    data: new SlashCommandBuilder()
        .setName('agent')
        .setDescription('Manage OpenCode agents for the current channel')
        .addSubcommand(subcommand => subcommand
        .setName('list')
        .setDescription('List all available agents'))
        .addSubcommand(subcommand => subcommand
        .setName('set')
        .setDescription('Set the agent to use in this channel')
        .addStringOption(option => option.setName('name')
        .setDescription('The agent name (e.g., plan, build, architect)')
        .setRequired(true)
        .setAutocomplete(true)))
        .addSubcommand(subcommand => subcommand
        .setName('clear')
        .setDescription('Clear the agent setting (use default agent)')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'list') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const agents = getBuiltInAgents();
            let response = '### Available Agents\n';
            for (const a of agents) {
                response += `• \`${a}\`\n`;
            }
            await interaction.editReply(response);
        }
        else if (subcommand === 'set') {
            const agentName = interaction.options.getString('name', true);
            const channelId = getEffectiveChannelId(interaction);
            const projectAlias = dataStore.getChannelBinding(channelId);
            if (!projectAlias) {
                await interaction.reply({
                    content: '❌ No project bound to this channel. Use `/use <alias>` first.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            dataStore.setChannelAgent(channelId, agentName.toLowerCase());
            await interaction.reply({
                content: `✅ Agent for this channel set to \`${agentName}\`.\nSubsequent prompts will use this agent.`,
                flags: MessageFlags.Ephemeral
            });
        }
        else if (subcommand === 'clear') {
            const channelId = getEffectiveChannelId(interaction);
            dataStore.setChannelAgent(channelId, '');
            await interaction.reply({
                content: '✅ Agent cleared. Will use the default agent.',
                flags: MessageFlags.Ephemeral
            });
        }
    },
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const agents = getBuiltInAgents();
        const filtered = agents.filter(a => a.toLowerCase().includes(focused)).slice(0, 25);
        try {
            await interaction.respond(filtered.map(a => ({ name: a, value: a })));
        }
        catch { }
    }
};
