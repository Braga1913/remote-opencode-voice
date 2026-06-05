import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleJoin, handleLeave, handlePause, handleAllow, handleDisallow, handleStatus } from '../handlers/vcHandler.js';

export const voice = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Voice chat control and status')
        .addSubcommand(subcommand => subcommand
            .setName('join')
            .setDescription('Join your voice channel for voice chat'))
        .addSubcommand(subcommand => subcommand
            .setName('leave')
            .setDescription('Leave the voice channel'))
        .addSubcommand(subcommand => subcommand
            .setName('pause')
            .setDescription('Toggle pause — stops STT and TTS'))
        .addSubcommand(subcommand => subcommand
            .setName('status')
            .setDescription('Show voice chat status'))
        .addSubcommand(subcommand => subcommand
            .setName('allow')
            .setDescription('Whitelist a user for STT')
            .addUserOption(option => option
                .setName('user')
                .setDescription('User to whitelist')
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('disallow')
            .setDescription('Remove a user from STT whitelist')
            .addUserOption(option => option
                .setName('user')
                .setDescription('User to remove')
                .setRequired(true))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'join') {
            await handleJoin(interaction);
        }
        else if (subcommand === 'leave') {
            await handleLeave(interaction);
        }
        else if (subcommand === 'pause') {
            await handlePause(interaction);
        }
        else if (subcommand === 'allow') {
            await handleAllow(interaction);
        }
        else if (subcommand === 'disallow') {
            await handleDisallow(interaction);
        }
        else if (subcommand === 'status') {
            await handleStatus(interaction);
        }
    }
};
