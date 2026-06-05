import { MessageFlags } from 'discord.js';
import * as dataStore from '../services/dataStore.js';
import * as sessionManager from '../services/sessionManager.js';
import { runPrompt } from '../services/executionService.js';
import { isBusy } from '../services/queueManager.js';
import { isAuthorized } from '../services/configStore.js';
import { transcribe, isVoiceEnabled } from '../services/voiceService.js';
import { getInvisiblePrompt, substituteVariables } from '../utils/agentPromptLoader.js';
function parseQuestionAnswers(input, questions) {
    // Split input by commas or newlines
    const parts = input.split(/[,\n]+/).map(p => p.trim()).filter(p => p.length > 0);
    const answers = [];
    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const options = question.options || [];
        const userAnswer = parts[i] || parts[parts.length - 1] || '';
        // Try to parse as a number first
        const num = parseInt(userAnswer, 10);
        if (!isNaN(num) && num >= 1 && num <= options.length) {
            // User entered a number, map to the option label
            answers.push([options[num - 1].label]);
        }
        else {
            // Try to match text against option labels (case-insensitive)
            const lowerAnswer = userAnswer.toLowerCase();
            const matchedOption = options.find(opt => 
                opt.label.toLowerCase() === lowerAnswer ||
                opt.label.toLowerCase().includes(lowerAnswer) ||
                lowerAnswer.includes(opt.label.toLowerCase())
            );
            if (matchedOption) {
                answers.push([matchedOption.label]);
            }
            else {
                // No match found, send the raw text
                answers.push([userAnswer]);
            }
        }
    }
    // If we have fewer answers than questions, repeat the last answer
    while (answers.length < questions.length) {
        answers.push([answers[answers.length - 1]?.[0] || '']);
    }
    return answers;
}
async function safeReact(message, emoji) {
    try {
        await message.react(emoji);
    }
    catch (error) {
        console.error(`[Voice STT] Failed to react with ${emoji}:`, error instanceof Error ? error.message : error);
    }
}
async function safeRemoveReaction(message, emoji) {
    try {
        await message.reactions.cache.get(emoji)?.users.remove(message.client.user.id);
    }
    catch (error) {
        console.error(`[Voice STT] Failed to remove reaction ${emoji}:`, error instanceof Error ? error.message : error);
    }
}
export async function handleMessageCreate(message) {
    if (message.author.bot)
        return;
    if (message.system)
        return;
    const channel = message.channel;
    if (!channel.isThread())
        return;
    const threadId = channel.id;
    if (!isAuthorized(message.author.id))
        return;
    const parentChannelId = channel.parentId;
    if (!parentChannelId)
        return;
    let prompt = message.content.trim();
    // Detect voice message before busy check so we can queue attachment metadata
    const isVoiceMessage = !prompt && isVoiceEnabled() && message.flags.has(MessageFlags.IsVoiceMessage);
    const voiceAttachment = isVoiceMessage ? message.attachments.first() : undefined;
    // Detect image attachments
    const imageAttachments = message.attachments.filter(a =>
        a.contentType?.startsWith('image/')
    ).map(a => ({
        url: a.url,
        mime: a.contentType || 'image/png',
        filename: a.name || 'image',
    }));
    if (!prompt && !voiceAttachment && imageAttachments.length === 0)
        return;
    // Build invisible prompt from agent's .md frontmatter
    let discordContext = '';
    try {
        const agentName = dataStore.getChannelAgent(parentChannelId);
        const template = getInvisiblePrompt(agentName);
        if (template) {
            const member = await message.guild?.members.fetch(message.author.id);
            const nickname = member?.nickname || message.author.displayName || message.author.username;
            const roles = member?.roles?.cache
                ?.filter(r => r.id !== message.guild?.id)
                ?.map(r => r.name) || [];
            const roleList = roles.length > 0 ? roles.join(', ') : 'none';
            discordContext = substituteVariables(template, {
                nickname,
                roles: roleList,
                userId: message.author.id,
                username: message.author.username,
            });
            if (discordContext && !discordContext.endsWith('\n')) discordContext += '\n\n';
        }
    }
    catch (err) {
        console.error('[MessageHandler] Failed to build invisible prompt:', err.message);
    }
    // Check if this is a question or TUI response - if so, send it directly to the session
    const session = sessionManager.getSessionForThread(threadId);
    if (session && session.port && isBusy(threadId)) {
        // First check if there's a pending question with requestID
        const pendingQuestion = sessionManager.getPendingQuestion(threadId);
        if (pendingQuestion && pendingQuestion.requestID) {
            try {
                console.log(`[MessageHandler] Sending question response to requestID: ${pendingQuestion.requestID}`);
                const questions = pendingQuestion.questions || [];
                const answers = parseQuestionAnswers(prompt, questions);
                console.log(`[MessageHandler] Parsed answers:`, JSON.stringify(answers));
                const success = await sessionManager.replyToQuestion(session.port, pendingQuestion.requestID, answers);
                console.log(`[MessageHandler] Question reply success: ${success}`);
                if (success) {
                    sessionManager.clearPendingQuestion(threadId);
                    try {
                        await message.delete();
                    }
                    catch (error) {
                        console.error('[MessageHandler] Failed to delete answer message (may need MANAGE_MESSAGES permission):', error.message);
                    }
                    return;
                }
            }
            catch (error) {
                console.log(`[MessageHandler] Failed to send directly, will queue: ${error}`);
            }
        }
        // No pending question - try responding to a pending TUI request instead
        try {
            const tuiRequest = await sessionManager.getNextTuiRequest(session.port);
            if (tuiRequest && tuiRequest.path) {
                console.log(`[MessageHandler] Sending TUI response: ${prompt}`);
                const success = await sessionManager.respondToTuiRequest(session.port, { response: prompt });
                if (success) {
                    try {
                        await message.delete();
                    }
                    catch (error) {
                        console.error('[MessageHandler] Failed to delete TUI answer message:', error.message);
                    }
                    return;
                }
            }
        }
        catch (error) {
            console.log(`[MessageHandler] Failed to send TUI response, will queue: ${error}`);
        }
    }
    // Check busy BEFORE STT — queue voice/image attachment metadata if busy
    if (isBusy(threadId)) {
        if (voiceAttachment) {
            dataStore.addToQueue(threadId, {
                prompt: '',
                userId: message.author.id,
                timestamp: Date.now(),
                voiceAttachmentUrl: voiceAttachment.url,
                voiceAttachmentSize: voiceAttachment.size,
                discordContext,
                imageAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
            });
        }
        else {
            dataStore.addToQueue(threadId, {
                prompt,
                userId: message.author.id,
                timestamp: Date.now(),
                discordContext,
                imageAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
            });
        }
        await safeReact(message, '📥');
        return;
    }
    // If only images (no text prompt), set a default display prompt
    if (!prompt && imageAttachments.length > 0) {
        prompt = imageAttachments.length === 1
            ? `[Image: ${imageAttachments[0].filename}]`
            : `[${imageAttachments.length} images]`;
    }
    if (imageAttachments.length > 0) {
        await safeReact(message, '📷');
    }
    // Perform STT only when not busy (our turn to execute)
    if (voiceAttachment) {
        await safeReact(message, '🎙️');
        try {
            prompt = await transcribe(voiceAttachment.url, voiceAttachment.size);
            await safeRemoveReaction(message, '🎙️');
        }
        catch (error) {
            console.error('[Voice STT] Transcription failed:', error instanceof Error ? error.message : error);
            await safeReact(message, '❌');
            if (error instanceof Error && error.message === 'AUTH_FAILURE') {
                await message.reply({ content: '❌ Transcription failed. Please check your API key with `/voice status`.' }).catch(() => { });
            }
            else {
                await message.reply({ content: '❌ Voice transcription failed. Check server logs for details.' }).catch(() => { });
            }
            return;
        }
        if (!prompt.trim()) {
            await safeReact(message, '❌');
            return;
        }
    }
    await runPrompt(channel, threadId, prompt, parentChannelId, discordContext, imageAttachments.length > 0 ? imageAttachments : undefined);
}
