import {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    StreamType,
} from '@discordjs/voice';
import { Readable } from 'node:stream';
import { opus } from 'prism-media';
import { existsSync } from 'node:fs';

const sessions = new Map();
const subscriptions = new Map();
const FLUSH_DELAY_MS = 10000;
const SILENCE_THRESHOLD_MS = 7000;
const SILENCE_VOLUME_THRESHOLD = 300;

function resamplePcmTo16kHz(pcm48kBuffer) {
    const input = new Int16Array(pcm48kBuffer.buffer, pcm48kBuffer.byteOffset, pcm48kBuffer.byteLength / 2);
    const outLen = Math.ceil(input.length / 3);
    const output = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
        output[i] = input[i * 3] || 0;
    }
    return Buffer.from(output.buffer);
}

function getPcmAmplitude(pcmChunk) {
    const samples = new Int16Array(pcmChunk.buffer, pcmChunk.byteOffset, pcmChunk.byteLength / 2);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += Math.abs(samples[i]);
    }
    return sum / samples.length;
}

export function joinVC(guildId, voiceChannelId, adapterCreator) {
    const existing = getVoiceConnection(guildId);
    if (existing) existing.destroy();

    const connection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId,
        adapterCreator,
        selfDeaf: false,
        selfMute: false,
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
        } catch {
            connection.destroy();
            cleanupGuild(guildId);
        }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
        cleanupGuild(guildId);
    });

    connection.on('error', (err) => {
        console.error(`[VC] Connection error for guild ${guildId}:`, err.message);
    });

    const player = createAudioPlayer();
    const subscription = connection.subscribe(player);

    sessions.set(guildId, { connection, player, subscription });
    return connection;
}

export function leaveVC(guildId) {
    const session = sessions.get(guildId);
    if (session) {
        session.connection.destroy();
        sessions.delete(guildId);
    }
    cleanupGuild(guildId);
}

export function isInVC(guildId) {
    return sessions.has(guildId);
}

export function getConnection(guildId) {
    return sessions.get(guildId)?.connection ?? null;
}

export function startListening(guildId, userId) {
    const session = sessions.get(guildId);
    if (!session) {
        console.error(`[VC] No session for guild ${guildId}`);
        return null;
    }

    console.log(`[VC] 🔊 Starting to listen to user ${userId} in guild ${guildId}`);
    stopListening(userId);

    const opusStream = session.connection.receiver.subscribe(userId);
    console.log(`[VC] 📡 Opus stream created for ${userId}`);
    const decoder = new opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });

    const pcmChunks = [];
    let chunkCount = 0;
    let flushTimer = null;
    let silenceTimer = null;
    let lastAudioTime = Date.now();
    let resolveFn = null;
    let rejectFn = null;

    const pcmPromise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });

    function flush() {
        const sub = subscriptions.get(userId);
        if (!sub || sub.flushed) return;
        sub.flushed = true;
        console.log(`[VC] 🔇 Flushing. ${pcmChunks.length} chunks collected`);

        try { clearTimeout(sub.silenceTimer); } catch {}
        try { opusStream.destroy(); } catch {}
        try { decoder.destroy(); } catch {}

        if (pcmChunks.length === 0) {
            console.log(`[VC] No audio collected, resolving null`);
            resolveFn(null);
            return;
        }

        const fullPcm48k = Buffer.concat(pcmChunks);
        const pcm16k = resamplePcmTo16kHz(fullPcm48k);
        console.log(`[VC] ✅ PCM ready: ${fullPcm48k.length} bytes → ${pcm16k.length} bytes (resampled)`);
        resolveFn(pcm16k);
    }

    decoder.on('data', (pcmChunk) => {
        chunkCount++;
        pcmChunks.push(pcmChunk);
        const amplitude = getPcmAmplitude(pcmChunk);
        if (amplitude > SILENCE_VOLUME_THRESHOLD) {
            lastAudioTime = Date.now();
        }
        if (chunkCount <= 3 || chunkCount % 50 === 0) {
            console.log(`[VC] 🎵 PCM chunk #${chunkCount}: ${pcmChunk.length} bytes, amp=${amplitude.toFixed(0)}`);
        }
    });

    decoder.on('error', (err) => {
        console.error(`[VC] ❌ Decoder error:`, err);
    });

    opusStream.pipe(decoder);

    opusStream.on('error', (err) => {
        console.error(`[VC] Opus stream error for ${userId}:`, err.message);
        try { decoder.destroy(); } catch {}
    });

    opusStream.on('close', () => {
        console.log(`[VC] Opus stream closed for ${userId}`);
        const sub = subscriptions.get(userId);
        if (sub && !sub.flushed && sub.pcmChunks.length > 0) {
            console.log(`[VC] Stream closed with ${sub.pcmChunks.length} chunks, flushing`);
            clearTimeout(sub.silenceTimer);
            sub.flush();
        }
    });

    const sub = { opusStream, decoder, pcmChunks, pcmPromise, flushTimer, silenceTimer, lastAudioTime, flushed: false, resolveFn, rejectFn, flush };
    subscriptions.set(userId, sub);

    return pcmPromise;
}

export function stopListening(userId) {
    const sub = subscriptions.get(userId);
    if (!sub) {
        console.log(`[VC] No subscription for ${userId}, nothing to stop`);
        return null;
    }

    if (sub.flushed) return sub.pcmPromise;

    console.log(`[VC] ⏹️  Stopping listening for ${userId}, monitoring for silence`);
    clearTimeout(sub.flushTimer);
    clearTimeout(sub.silenceTimer);

    sub.silenceTimer = setTimeout(function checkSilence() {
        const elapsed = Date.now() - sub.lastAudioTime;
        if (elapsed >= SILENCE_THRESHOLD_MS) {
            console.log(`[VC] 🔇 Silence detected (${elapsed}ms since last loud audio), flushing`);
            flushUser(userId);
        } else {
            const remaining = SILENCE_THRESHOLD_MS - elapsed;
            sub.silenceTimer = setTimeout(checkSilence, remaining);
        }
    }, SILENCE_THRESHOLD_MS);

    return sub.pcmPromise;
}

export function resetSilenceTimer(userId) {
    const sub = subscriptions.get(userId);
    if (!sub || sub.flushed) return;

    console.log(`[VC] 🔄 Resetting silence timer for ${userId}`);
    clearTimeout(sub.silenceTimer);

    sub.silenceTimer = setTimeout(function checkSilence() {
        const elapsed = Date.now() - sub.lastAudioTime;
        if (elapsed >= SILENCE_THRESHOLD_MS) {
            console.log(`[VC] 🔇 Silence detected (${elapsed}ms since last loud audio), flushing`);
            flushUser(userId);
        } else {
            const remaining = SILENCE_THRESHOLD_MS - elapsed;
            sub.silenceTimer = setTimeout(checkSilence, remaining);
        }
    }, SILENCE_THRESHOLD_MS);
}

function flushUser(userId) {
    const sub = subscriptions.get(userId);
    if (!sub) return;
    console.log(`[VC] 🔄 Flush timer fired for ${userId}`);
    sub.flush();
}

export function playAudio(guildId, pcmBuffer) {
    const session = sessions.get(guildId);
    if (!session) return;

    try {
        const stream = Readable.from(pcmBuffer);
        const resource = createAudioResource(stream, {
            inputType: StreamType.Raw,
        });

        session.player.removeAllListeners('error');
        session.player.on('error', (err) => {
            console.error(`[VC] Player error:`, err.message);
        });

        session.player.play(resource);
    } catch (err) {
        console.error(`[VC] Failed to play audio:`, err.message);
    }
}

export function waitForIdle(guildId, timeoutMs = 30000) {
    const session = sessions.get(guildId);
    if (!session) return Promise.resolve();

    if (session.player.state.status !== AudioPlayerStatus.Playing &&
        session.player.state.status !== AudioPlayerStatus.Buffering) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            session.player.removeListener(AudioPlayerStatus.Idle, onIdle);
            resolve();
        }, timeoutMs);

        function onIdle() {
            clearTimeout(timer);
            resolve();
        }

        session.player.once(AudioPlayerStatus.Idle, onIdle);
    });
}

export function playAudioFile(guildId, filePath) {
    const session = sessions.get(guildId);
    if (!session) return;
    if (!existsSync(filePath)) return;

    try {
        const resource = createAudioResource(filePath);
        session.player.play(resource);
    } catch (err) {
        console.error(`[VC] Failed to play audio file ${filePath}:`, err.message);
    }
}

export function onAudioEnd(guildId, callback) {
    const session = sessions.get(guildId);
    if (!session) return;

    session.player.on(AudioPlayerStatus.Idle, callback, { once: true });
}

export function isPlaying(guildId) {
    const session = sessions.get(guildId);
    return session?.player?.state?.status === AudioPlayerStatus.Playing;
}

export function stopPlayback(guildId) {
    const session = sessions.get(guildId);
    if (session?.player) {
        session.player.stop();
    }
}

function cleanupGuild(guildId) {
    for (const [userId, sub] of subscriptions) {
        try { clearTimeout(sub.flushTimer); } catch {}
        try { clearTimeout(sub.silenceTimer); } catch {}
        try { sub.opusStream?.destroy(); } catch {}
        try { sub.decoder?.destroy(); } catch {}
    }
    subscriptions.clear();
}

export function cleanup() {
    for (const [guildId] of sessions) {
        leaveVC(guildId);
    }
}
