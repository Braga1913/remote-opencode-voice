import { EdgeTTS } from 'node-edge-tts';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'voiceLines');

const LINES = {
    'let-me-check': 'Let me check.',
    'one-sec': 'One sec.',
    'looking-into-it': 'Looking into it.',
    'hang-on': 'Hang on.',
    'give-me-a-moment': 'Give me a moment.',
    'something-went-wrong': 'Hmm, something went wrong.',
    'ran-into-issue': 'I ran into an issue.',
    'here-you-go': 'Here you go.',
    'done': 'Done.',
    'no-result': "I didn't get a result for that.",
};

async function generate() {
    if (!existsSync(OUTPUT_DIR)) {
        mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    for (const [name, text] of Object.entries(LINES)) {
        const outPath = join(OUTPUT_DIR, `${name}.mp3`);
        if (existsSync(outPath)) {
            console.log(`Skipping ${name} (already exists)`);
            continue;
        }
        console.log(`Generating: "${text}" → ${name}.mp3`);
        const tts = new EdgeTTS({
            voice: 'en-US-AriaNeural',
            lang: 'en-US',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        });
        await tts.ttsPromise(text, outPath);
        console.log(`  ✅ Saved ${name}.mp3`);
    }
    console.log('Done!');
}

generate().catch(console.error);
