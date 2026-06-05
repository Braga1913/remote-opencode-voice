import { EdgeTTS } from 'node-edge-tts';
import { spawn } from 'node:child_process';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_VOICE = 'en-US-MichelleNeural';
const SPEECH_RATE = '+10%';
const TTS_DIR = 'D:\\remote-opencode\\tts';

let tts = null;

function getTTS() {
    if (!tts) {
        if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });
        tts = new EdgeTTS({
            voice: DEFAULT_VOICE,
            lang: 'en-US',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            rate: SPEECH_RATE,
        });
    }
    return tts;
}

function parseTables(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        if (/^\|(.+)\|$/.test(lines[i]) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
            const headers = lines[i].split('|').map(c => c.trim()).filter(Boolean);
            i += 2;
            while (i < lines.length && /^\|(.+)\|$/.test(lines[i])) {
                const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
                const parts = [];
                for (let j = 0; j < headers.length; j++) {
                    if (cells[j]) parts.push(`${headers[j]}: ${cells[j]}`);
                }
                result.push(parts.join('. ') + '.');
                i++;
            }
        } else {
            result.push(lines[i]);
            i++;
        }
    }
    return result.join('\n');
}

export function stripMarkdown(text) {
    if (!text) return '';
    let t = parseTables(text);

    t = t.replace(/```\w*\n?([\s\S]*?)```/g, (_, code) => ' Code: ' + code.trim() + ' ');
    t = t.replace(/`([^`]+)`/g, '$1');

    t = t.replace(/^#{1,6}\s+(.+)$/gm, '$1.');

    t = t.replace(/\*\*(.+?)\*\*/g, ', $1,');
    t = t.replace(/\*(.+?)\*/g, ', $1,');
    t = t.replace(/__(.+?)__/g, ', $1,');
    t = t.replace(/_(.+?)_/g, ', $1,');
    t = t.replace(/~~(.+?)~~/g, '$1');

    t = t.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
    t = t.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
    t = t.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
    t = t.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
    t = t.replace(/[\u{2600}-\u{26FF}]/gu, '');
    t = t.replace(/[\u{2700}-\u{27BF}]/gu, '');
    t = t.replace(/[\u{FE00}-\u{FE0F}]/gu, '');
    t = t.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
    t = t.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '');
    t = t.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '');
    t = t.replace(/[\u{200D}]/gu, '');
    t = t.replace(/[\u{20E3}]/gu, '');
    t = t.replace(/[\u{E0020}-\u{E007F}]/gu, '');
    t = t.replace(/[\u{1F100}-\u{1F1FF}]/gu, '');

    t = t.replace(/!\[.*?\]\(.*?\)/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    t = t.replace(/^[\s]*[-*+]\s+/gm, '');
    t = t.replace(/^[\s]*\d+\.\s+/gm, '');

    t = t.replace(/^>\s+/gm, '');

    t = t.replace(/^[-*_]{3,}\s*$/gm, '');

    t = t.replace(/https?:\/\/\S+/g, 'link');

    t = t.replace(/\n{2,}/g, '. ');
    t = t.replace(/\n/g, ', ');

    t = t.replace(/\.{2,}/g, '.');
    t = t.replace(/,\s*\./g, '.');
    t = t.replace(/\.\s*\./g, '.');
    t = t.replace(/,,+/g, ',');
    t = t.replace(/,(\s*,)*/g, ',');
    t = t.replace(/^\s*,\s*/, '');
    t = t.replace(/\s*,\s*$/, '');
    t = t.replace(/\s{2,}/g, ' ').trim();

    return t;
}

export function cleanupFile(filePath) {
    try { unlinkSync(filePath); } catch {}
}

export async function speak(text, retries = 2) {
    const engine = getTTS();
    const clean = stripMarkdown(text);
    if (!clean.trim()) return null;
    const truncated = clean.slice(0, 3000);
    for (let attempt = 0; attempt <= retries; attempt++) {
        const tmpFile = join(TTS_DIR, `_tts_${Date.now()}.mp3`);
        try {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), 60000));
            await Promise.race([engine.ttsPromise(truncated, tmpFile), timeout]);
            return tmpFile;
        } catch (err) {
            cleanupFile(tmpFile);
            if (attempt === retries) throw err;
            console.log(`[TTS] Attempt ${attempt + 1} failed, retrying...`);
        }
    }
}

export function decodeMp3ToPcm(inputPath) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const ffmpeg = spawn('ffmpeg', [
            '-i', inputPath,
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.on('close', (code) => {
            cleanupFile(inputPath);
            if (code === 0) {
                resolve(Buffer.concat(chunks));
            } else {
                reject(new Error(`FFmpeg decode failed with code ${code}`));
            }
        });
        ffmpeg.on('error', (err) => {
            cleanupFile(inputPath);
            reject(err);
        });
    });
}

export async function speakToPcm(text) {
    const filePath = await speak(text);
    return decodeMp3ToPcm(filePath);
}
