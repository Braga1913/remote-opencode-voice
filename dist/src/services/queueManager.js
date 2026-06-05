import * as dataStore from './dataStore.js';
import { runPrompt } from './executionService.js';
import * as sessionManager from './sessionManager.js';
import { transcribe } from './voiceService.js';
export async function processNextInQueue(channel, threadId, parentChannelId) {
    const settings = dataStore.getQueueSettings(threadId);
    if (settings.paused)
        return;
    const next = dataStore.popFromQueue(threadId);
    if (!next)
        return;
    let prompt = next.prompt;
    // Handle queued voice messages — perform STT now that it's our turn
    if (!prompt && next.voiceAttachmentUrl) {
        try {
            prompt = await transcribe(next.voiceAttachmentUrl, next.voiceAttachmentSize);
            if (!prompt.trim()) {
                console.error('[Voice STT] Queued voice message transcription returned empty');
                // Skip this item and process next
                await processNextInQueue(channel, threadId, parentChannelId);
                return;
            }
        }
        catch (error) {
            console.error('[Voice STT] Queued voice transcription failed:', error instanceof Error ? error.message : error);
            // Skip this item and process next
            await processNextInQueue(channel, threadId, parentChannelId);
            return;
        }
    }
    if (!prompt)
        return;
    // Visual indication that we are starting the next one
    if ('send' in channel) {
        const imageIndicator = next.imageAttachments?.length ? ' 📷' : '';
        await channel.send(`🔄 **Queue**: Starting next task...${imageIndicator}\n> ${prompt}`);
    }
    await runPrompt(channel, threadId, prompt, parentChannelId, next.discordContext || '', next.imageAttachments || []);
}
export function isBusy(threadId) {
    const sseClient = sessionManager.getSseClient(threadId);
    return !!(sseClient && sseClient.isConnected());
}
