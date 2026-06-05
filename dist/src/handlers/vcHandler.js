import { MessageFlags } from 'discord.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vcService from '../services/vcService.js';
import * as sttService from '../services/sttService.js';
import * as ttsService from '../services/ttsService.js';
import * as dataStore from '../services/dataStore.js';
import * as sessionManager from '../services/sessionManager.js';
import { runPrompt, setTtsCallback, setSessionErrorCallback } from '../services/executionService.js';
import { isBusy } from '../services/queueManager.js';
import { getInvisiblePrompt, substituteVariables } from '../utils/agentPromptLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_LINES_DIR = join(__dirname, '..', 'services', 'voiceLines');

const VOICE_LINES = {
    acknowledge: ['let-me-check', 'one-sec', 'looking-into-it', 'hang-on', 'give-me-a-moment'],
    error: ['something-went-wrong', 'ran-into-issue'],
    done: ['here-you-go', 'done'],
    noResult: ['no-result'],
};

const vcState = new Map();

function getState(guildId) {
    return vcState.get(guildId);
}

function setState(guildId, state) {
    vcState.set(guildId, state);
}

function deleteState(guildId) {
    vcState.delete(guildId);
}

function playVoiceLine(guildId, category) {
    const state = getState(guildId);
    if (!state || state.paused) return;
    const options = VOICE_LINES[category];
    if (!options || options.length === 0) return;
    const pick = options[Math.floor(Math.random() * options.length)];
    const filePath = join(VOICE_LINES_DIR, `${pick}.mp3`);
    console.log(`[VCHandler] Playing voice line: ${pick}`);
    vcService.playAudioFile(guildId, filePath);
}

setTtsCallback((text, threadId) => {
    for (const [guildId, state] of vcState) {
        if (state.threadId === threadId && vcService.isInVC(guildId)) {
            state.busy = false;
            state.listening = false;
            state.waitingForSilence = false;
            if (text && text.trim() && !state.paused) {
                speakResponse(guildId, text);
            } else if (!state.paused) {
                playVoiceLine(guildId, 'noResult');
            }
            return;
        }
    }
});

setSessionErrorCallback((threadId) => {
    for (const [guildId, state] of vcState) {
        if (state.threadId === threadId && vcService.isInVC(guildId)) {
            console.log(`[VCHandler] Session error, resetting busy for guild ${guildId}`);
            state.busy = false;
            state.listening = false;
            state.waitingForSilence = false;
            playVoiceLine(guildId, 'error');
            return;
        }
    }
});

function splitIntoChunks(text, maxLen = 200) {
    const sentences = text.replace(/([.!?])\s+/g, '$1|').split('|');
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if ((current + ' ' + sentence).trim().length > maxLen && current.trim()) {
            chunks.push(current.trim());
            current = sentence;
        } else {
            current += ' ' + sentence;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

async function speakResponse(guildId, text) {
    try {
        if (!text || !text.trim()) return;
        const chunks = splitIntoChunks(text, 500);
        for (let i = 0; i < chunks.length; i++) {
            if (!chunks[i].trim()) continue;
            if (!vcService.isInVC(guildId)) break;
            const pcm = await ttsService.speakToPcm(chunks[i]);
            if (pcm.length > 0 && vcService.isInVC(guildId)) {
                if (i > 0) await vcService.waitForIdle(guildId, 60000);
                vcService.playAudio(guildId, pcm);
            }
        }
    } catch (err) {
        console.error('[VCHandler] TTS failed:', err.message || err);
    }
}

function isUserAllowed(guildId, userId) {
    const state = getState(guildId);
    if (!state) return false;
    if (state.allowedUsers.length === 0) return true;
    return state.allowedUsers.includes(userId);
}

function setupSpeakingListener(guildId) {
    const connection = vcService.getConnection(guildId);
    if (!connection) {
        console.error('[VCHandler] No connection found for guild', guildId);
        return;
    }

    const handleStart = (userId) => {
        console.log(`[VCHandler] 🔔 Speaking START detected for user ${userId}`);
        const state = getState(guildId);
        if (!state || state.busy || state.paused) {
            console.log(`[VCHandler] Ignoring start: state=${!!state}, busy=${state?.busy}, paused=${state?.paused}`);
            return;
        }

        if (!isUserAllowed(guildId, userId)) {
            console.log(`[VCHandler] Ignoring start: user ${userId} not in whitelist`);
            return;
        }

        state.speakingUserId = userId;

        if (state.listening) {
            console.log(`[VCHandler] Already listening, just resetting silence timer`);
            vcService.resetSilenceTimer(userId);
            return;
        }

        state.listening = true;
        state.currentPcmPromise = vcService.startListening(guildId, userId);
    };

    const handleEnd = async (userId) => {
        console.log(`[VCHandler] 🔔 Speaking END detected for user ${userId}`);
        const state = getState(guildId);
        if (!state || state.busy || state.paused) {
            console.log(`[VCHandler] Ignoring end: state=${!!state}, busy=${state?.busy}, paused=${state?.paused}`);
            return;
        }

        if (!isUserAllowed(guildId, userId)) {
            console.log(`[VCHandler] Ignoring end: user ${userId} not in whitelist`);
            return;
        }

        if (state.waitingForSilence) {
            console.log(`[VCHandler] Already waiting for silence, ignoring end`);
            return;
        }

        console.log(`[VCHandler] Speech ended for ${userId}, waiting for silence threshold`);
        state.waitingForSilence = true;
        vcService.stopListening(userId);

        const pcmBuffer = await state.currentPcmPromise;
        state.waitingForSilence = false;
        state.busy = true;

        try {
            console.log(`[VCHandler] PCM buffer received: ${pcmBuffer?.length ?? 0} bytes`);
            if (!pcmBuffer || pcmBuffer.length < 2048) {
                console.log(`[VCHandler] Audio too small (${pcmBuffer?.length ?? 0} bytes), skipping`);
                state.busy = false;
                state.listening = false;
                state.waitingForSilence = false;
                return;
            }

            console.log(`[VCHandler] Transcribing ${pcmBuffer.length} bytes of PCM...`);
            const text = await sttService.transcribePcm(pcmBuffer, 16000);
            console.log(`[VCHandler] Transcript: "${text}"`);
            const cleaned = text.replace(/\[BLANK_AUDIO\]|\[silence\]/g, '').trim();
            if (!cleaned || /^\(.*\)$/.test(cleaned)) {
                console.log(`[VCHandler] Empty/silence/bracketed transcript, skipping`);
                state.busy = false;
                state.listening = false;
                state.waitingForSilence = false;
                return;
            }

            if (vcService.isPlaying(guildId)) {
                console.log(`[VCHandler] Real speech detected, stopping TTS`);
                vcService.stopPlayback(guildId);
            }

            const channel = state.textChannel;
            const threadId = channel.isThread?.() ? channel.id : null;
            const lookupChannelId = channel.isThread?.() ? channel.parentId : channel.id;

            const projectPath = dataStore.getChannelProjectPath(lookupChannelId);
            if (!projectPath) {
                await channel.send('❌ No project bound to this channel. Use `/use` first.');
                state.busy = false;
                state.listening = false;
                state.waitingForSilence = false;
                return;
            }

            state.lastTranscript = cleaned;

            const sendChannel = threadId ? channel : channel;
            await sendChannel.send(`🎤 **You said:** ${cleaned}`);

            playVoiceLine(guildId, 'acknowledge');

            let discordContext = '';
            try {
                const agentName = dataStore.getChannelAgent(lookupChannelId);
                const template = getInvisiblePrompt(agentName);
                if (template) {
                    const member = await channel.guild?.members.fetch(state.speakingUserId || channel.client.user.id);
                    const nickname = member?.nickname || member?.user?.displayName || member?.user?.username || 'Voice User';
                    const roles = member?.roles?.cache
                        ?.filter(r => r.id !== channel.guild?.id)
                        ?.map(r => r.name) || [];
                    const roleList = roles.length > 0 ? roles.join(', ') : 'none';
                    discordContext = substituteVariables(template, {
                        nickname,
                        roles: roleList,
                        userId: state.speakingUserId || '',
                        username: state.speakingUserId || '',
                    });
                    if (discordContext && !discordContext.endsWith('\n')) discordContext += '\n\n';
                }
            } catch (err) {
                console.error('[VCHandler] Failed to build invisible prompt:', err.message);
            }

            console.log(`[VCHandler] Sending prompt to OpenCode: "${cleaned.slice(0, 50)}..."`);
            await runPrompt(sendChannel, threadId || channel.id, cleaned, lookupChannelId, discordContext);
            state.busy = false;
            state.listening = false;
            state.waitingForSilence = false;
        } catch (err) {
            console.error('[VCHandler] STT or prompt failed:', err);
            const state2 = getState(guildId);
            if (state2) {
                state2.busy = false;
                state2.listening = false;
                state2.waitingForSilence = false;
            }
        }
    };

    console.log('[VCHandler] 📡 Registering speaking event listeners...');
    connection.receiver.speaking.on('start', handleStart);
    connection.receiver.speaking.on('end', handleEnd);
    console.log('[VCHandler] ✅ Listeners registered. Ready for speech.');

    return { handleStart, handleEnd };
}

export async function handleJoin(interaction) {
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
        await interaction.reply({
            content: '❌ You must be in a voice channel first.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const guildId = interaction.guildId;
    const existing = getState(guildId);
    if (existing) {
        await interaction.reply({
            content: '❌ Already connected to a voice channel. Use `/voice leave` first.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply();

    try {
        console.log(`[VCHandler] Joining voice channel ${voiceChannel.id} in guild ${guildId}...`);
        vcService.joinVC(guildId, voiceChannel.id, interaction.guild.voiceAdapterCreator);
        console.log(`[VCHandler] ✅ Voice channel joined`);

        const parentChannel = interaction.channel;
        let thread;
        let threadId;

        if (parentChannel.isThread()) {
            thread = parentChannel;
            threadId = thread.id;
            console.log(`[VCHandler] 📝 Using existing thread: ${thread.name} (${thread.id})`);
        } else {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            thread = await parentChannel.threads.create({
                name: `VC Session - ${timestamp}`,
                autoArchiveDuration: 60,
                reason: 'Voice chat session',
            });
            threadId = thread.id;
            console.log(`[VCHandler] 📝 Created thread: ${thread.name} (${thread.id})`);
        }

        setState(guildId, {
            textChannel: thread,
            parentChannel,
            guildId,
            voiceChannelId: voiceChannel.id,
            threadId,
            busy: false,
            paused: false,
            listening: false,
            waitingForSilence: false,
            lastTranscript: '',
            allowedUsers: [],
        });

        const listeners = setupSpeakingListener(guildId);

        if (listeners) {
            setState(guildId, {
                ...getState(guildId),
                ...listeners,
            });
        }

        await interaction.editReply({
            content: `✅ Joined **${voiceChannel.name}**. Voice session: <#${thread.id}>\nSpeak in VC and I'll respond there! Use \`/voice leave\` to disconnect.`,
        });
    } catch (err) {
        console.error('[VCHandler] Join failed:', err);
        await interaction.editReply({ content: `❌ Failed to join voice channel: ${err.message}` });
        deleteState(guildId);
    }
}

export async function handleLeave(interaction) {
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (!state) {
        await interaction.reply({
            content: '❌ Not connected to a voice channel.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply();

    try {
        if (state.handleStart && state.handleEnd) {
            const connection = vcService.getConnection(guildId);
            if (connection) {
                connection.receiver.speaking.off('start', state.handleStart);
                connection.receiver.speaking.off('end', state.handleEnd);
            }
        }

        vcService.leaveVC(guildId);
        deleteState(guildId);

        await interaction.editReply({ content: '👋 Left voice channel.' });
    } catch (err) {
        console.error('[VCHandler] Leave failed:', err);
        await interaction.editReply({ content: `❌ Error leaving voice channel: ${err.message}` });
    }
}

export async function handlePause(interaction) {
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (!state) {
        await interaction.reply({
            content: '❌ Not connected to a voice channel.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    state.paused = !state.paused;
    const status = state.paused ? '⏸️ Paused' : '▶️ Resumed';
    const detail = state.paused ? 'STT and TTS are paused.' : 'Listening and speaking again.';

    await interaction.reply({
        content: `${status} — ${detail}`,
        flags: MessageFlags.Ephemeral,
    });
}

export async function handleAllow(interaction) {
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (!state) {
        await interaction.reply({
            content: '❌ Not connected to a voice channel.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const user = interaction.options.getUser('user');
    if (!user) {
        await interaction.reply({
            content: '❌ No user specified.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (state.allowedUsers.includes(user.id)) {
        await interaction.reply({
            content: `⚠️ ${user.tag} is already whitelisted.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    state.allowedUsers.push(user.id);
    await interaction.reply({
        content: `✅ **${user.tag}** added to voice whitelist. Only whitelisted users will trigger STT.`,
        flags: MessageFlags.Ephemeral,
    });
}

export async function handleDisallow(interaction) {
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (!state) {
        await interaction.reply({
            content: '❌ Not connected to a voice channel.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const user = interaction.options.getUser('user');
    if (!user) {
        await interaction.reply({
            content: '❌ No user specified.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const idx = state.allowedUsers.indexOf(user.id);
    if (idx === -1) {
        await interaction.reply({
            content: `⚠️ ${user.tag} is not in the whitelist.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    state.allowedUsers.splice(idx, 1);
    await interaction.reply({
        content: `✅ **${user.tag}** removed from voice whitelist.`,
        flags: MessageFlags.Ephemeral,
    });
}

export async function handleStatus(interaction) {
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (!state) {
        await interaction.reply({
            content: '🔇 Not connected to a voice channel.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const vcName = state.voiceChannelId;
    const busyStatus = state.paused ? '⏸️ Paused' : (state.busy ? '🔄 Processing' : '👂 Listening');
    const transcript = state.lastTranscript ? `\nLast transcript: "${state.lastTranscript}"` : '';
    const stt = sttService.getStatus();
    const modelStatus = stt.modelOk ? `${stt.currentModel} (${stt.modelSize})` : `${stt.currentModel} (${stt.modelSize}) ⚠️ API key not configured`;
    const allowedList = state.allowedUsers.length > 0
        ? `\nWhitelist: ${state.allowedUsers.map(id => `<@${id}>`).join(', ')}`
        : '\nWhitelist: Everyone (open)';

    await interaction.reply({
        content: `🎙️ **Voice Chat Active**\nChannel: <#${vcName}>\nStatus: ${busyStatus}\nSTT Model: ${modelStatus}${allowedList}${transcript}`,
        flags: MessageFlags.Ephemeral,
    });
}

export function cleanupGuild(guildId) {
    const state = getState(guildId);
    if (state) {
        if (state.handleStart && state.handleEnd) {
            const connection = vcService.getConnection(guildId);
            if (connection) {
                connection.receiver.speaking.off('start', state.handleStart);
                connection.receiver.speaking.off('end', state.handleEnd);
            }
        }
        vcService.leaveVC(guildId);
        deleteState(guildId);
    }
}

export function cleanupAll() {
    for (const [guildId] of vcState) {
        cleanupGuild(guildId);
    }
}
