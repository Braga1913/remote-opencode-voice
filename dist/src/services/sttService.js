import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSonioxApiKey } from './configStore.js';

const SONIOX_API_BASE = 'https://api.soniox.com/v1';
const SONIOX_MODEL = 'stt-async-preview';
const TMP_DIR = 'D:\\remote-opencode\\tmp';
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const TRANSCRIPTION_POLL_INTERVAL_MS = 500;

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

function pcmToWav(pcmBuffer, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.byteLength;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++)
            view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    new Uint8Array(buffer, headerSize).set(new Uint8Array(pcmBuffer));
    return Buffer.from(buffer);
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function uploadFile(wavBuffer, filename) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) throw new Error('Soniox API key is not configured');

    const formData = new FormData();
    const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', audioBlob, filename);

    const response = await fetchWithTimeout(`${SONIOX_API_BASE}/files`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
    }, 30_000);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Soniox file upload failed (${response.status}): ${error}`);
    }

    return response.json();
}

async function createTranscription(fileId) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) throw new Error('Soniox API key is not configured');

    const response = await fetchWithTimeout(`${SONIOX_API_BASE}/transcriptions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: SONIOX_MODEL,
            file_id: fileId,
            language_hints: ['en'],
        }),
    }, 30_000);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Soniox transcription create failed (${response.status}): ${error}`);
    }

    return response.json();
}

async function getTranscriptionStatus(transcriptionId) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) throw new Error('Soniox API key is not configured');

    const response = await fetchWithTimeout(`${SONIOX_API_BASE}/transcriptions/${transcriptionId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
    }, 30_000);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Soniox transcription status failed (${response.status}): ${error}`);
    }

    return response.json();
}

async function getTranscriptionResult(transcriptionId) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) throw new Error('Soniox API key is not configured');

    const response = await fetchWithTimeout(`${SONIOX_API_BASE}/transcriptions/${transcriptionId}/transcript`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
    }, 30_000);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Soniox transcript fetch failed (${response.status}): ${error}`);
    }

    return response.json();
}

async function deleteFile(fileId) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) return;

    try {
        await fetchWithTimeout(`${SONIOX_API_BASE}/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiKey}` },
        }, 10_000);
    } catch {}
}

async function deleteTranscription(transcriptionId) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) return;

    try {
        await fetchWithTimeout(`${SONIOX_API_BASE}/transcriptions/${transcriptionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiKey}` },
        }, 10_000);
    } catch {}
}

async function transcribePcm(pcmBuffer, sampleRate = 16000) {
    const apiKey = getSonioxApiKey();
    if (!apiKey) {
        throw new Error('Soniox API key is not configured. Set SONIOX_API_KEY or use /setkey soniox');
    }

    const tmpWav = join(TMP_DIR, `stt_${Date.now()}.wav`);
    const wavBuffer = pcmToWav(pcmBuffer, sampleRate);
    writeFileSync(tmpWav, wavBuffer);

    let fileId = null;
    let transcriptionId = null;

    try {
        console.log(`[STT] Uploading ${wavBuffer.length} bytes to Soniox...`);
        const uploadResult = await uploadFile(wavBuffer, 'audio.wav');
        fileId = uploadResult.id;
        console.log(`[STT] File uploaded: ${fileId}`);

        console.log(`[STT] Creating transcription...`);
        const transcriptionResult = await createTranscription(fileId);
        transcriptionId = transcriptionResult.id;
        console.log(`[STT] Transcription created: ${transcriptionId}`);

        const startTime = Date.now();
        while (Date.now() - startTime < TRANSCRIPTION_TIMEOUT_MS) {
            const status = await getTranscriptionStatus(transcriptionId);

            if (status.status === 'completed') {
                console.log(`[STT] Transcription completed`);
                const transcript = await getTranscriptionResult(transcriptionId);
                const text = transcript.text || '';
                console.log(`[STT] Transcript: "${text.slice(0, 100)}..."`);
                return text;
            }

            if (status.status === 'error') {
                throw new Error(`Soniox transcription failed: ${status.error_message || 'Unknown error'}`);
            }

            console.log(`[STT] Transcription status: ${status.status}, waiting...`);
            await new Promise(resolve => setTimeout(resolve, TRANSCRIPTION_POLL_INTERVAL_MS));
        }

        throw new Error('Soniox transcription timed out');
    } finally {
        try { unlinkSync(tmpWav); } catch {}
        if (fileId) deleteFile(fileId);
        if (transcriptionId) deleteTranscription(transcriptionId);
    }
}

function getStatus() {
    const apiKey = getSonioxApiKey();
    return {
        modelOk: !!apiKey,
        currentModel: 'soniox-stt-async',
        modelSize: 'cloud',
        modelLang: 'Multilingual (60+ languages)',
        availableModels: ['soniox-stt-async'],
    };
}

function getCurrentModel() {
    return 'soniox-stt-async';
}

function setModel(modelName) {}

function cleanup() {}

export { transcribePcm, getStatus, getCurrentModel, setModel, cleanup };
