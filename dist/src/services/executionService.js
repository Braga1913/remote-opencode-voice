import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as dataStore from './dataStore.js';
import * as sessionManager from './sessionManager.js';
import * as serveManager from './serveManager.js';
import * as worktreeManager from './worktreeManager.js';
import { SSEClient } from './sseClient.js';
import { formatOutput, formatOutputForMobile, buildContextHeader } from '../utils/messageFormatter.js';
import { processNextInQueue } from './queueManager.js';

let _ttsCallback = null;
export function setTtsCallback(fn) { _ttsCallback = fn; }

let _sessionErrorCallback = null;
export function setSessionErrorCallback(fn) { _sessionErrorCallback = fn; }

export async function runPrompt(channel, threadId, prompt, parentChannelId, discordContext = '', imageAttachments = []) {
    const projectPath = dataStore.getChannelProjectPath(parentChannelId);
    if (!projectPath) {
        await channel.send('❌ No project bound to parent channel.');
        return;
    }
    let worktreeMapping = dataStore.getWorktreeMapping(threadId);
    // Auto-create worktree if enabled and no mapping exists for this thread
    if (!worktreeMapping) {
        const projectAlias = dataStore.getChannelBinding(parentChannelId);
        if (projectAlias && dataStore.getProjectAutoWorktree(projectAlias)) {
            try {
                const branchName = worktreeManager.sanitizeBranchName(`auto/${threadId.slice(0, 8)}-${Date.now()}`);
                const worktreePath = await worktreeManager.createWorktree(projectPath, branchName);
                const newMapping = {
                    threadId,
                    branchName,
                    worktreePath,
                    projectPath,
                    description: prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
                    createdAt: Date.now()
                };
                dataStore.setWorktreeMapping(newMapping);
                worktreeMapping = newMapping;
                const embed = new EmbedBuilder()
                    .setTitle(`🌳 Auto-Worktree: ${branchName}`)
                    .setDescription('Automatically created for this session')
                    .addFields({ name: 'Branch', value: branchName, inline: true }, { name: 'Path', value: worktreePath, inline: true })
                    .setColor(0x2ecc71);
                const worktreeButtons = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder()
                    .setCustomId(`delete_${threadId}`)
                    .setLabel('Delete')
                    .setStyle(ButtonStyle.Danger), new ButtonBuilder()
                    .setCustomId(`pr_${threadId}`)
                    .setLabel('Create PR')
                    .setStyle(ButtonStyle.Primary));
                await channel.send({ embeds: [embed], components: [worktreeButtons] });
            }
            catch (error) {
                console.error('Auto-worktree creation failed:', error);
            }
        }
    }
    const effectivePath = worktreeMapping?.worktreePath ?? projectPath;
    const preferredModel = dataStore.getChannelModel(parentChannelId);
    const preferredAgent = dataStore.getChannelAgent(parentChannelId);
    const modelDisplay = preferredModel ? `${preferredModel}` : (preferredAgent || 'default');
    const branchName = worktreeMapping?.branchName ?? await worktreeManager.getCurrentBranch(effectivePath) ?? 'main';
    const contextHeader = buildContextHeader(branchName, modelDisplay);
    const buttons = new ActionRowBuilder()
        .addComponents(new ButtonBuilder()
        .setCustomId(`interrupt_${threadId}`)
        .setLabel('⏸️ Interrupt')
        .setStyle(ButtonStyle.Secondary));
    let streamMessage;
    try {
        streamMessage = await channel.send({
            content: `${contextHeader}\n📌 **Prompt**: ${prompt}\n\n🚀 Starting OpenCode server...`,
            components: [buttons]
        });
    }
    catch {
        return;
    }
    let port;
    let sessionId;
    let updateInterval = null;
    let tuiPollInterval = null;
    let accumulatedText = '';
    let toolUsageText = '';
    let thinkingText = '';
    let lastContent = '';
    let tick = 0;
    let promptSent = false;
    let hasSessionError = false;
    let questionMessages = [];
    let lastPresentedTuiKey = null;
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const updateStreamMessage = async (content, components) => {
        try {
            await streamMessage.edit({ content, components });
            return true;
        }
        catch (error) {
            console.error('Failed to edit stream message:', error instanceof Error ? error.message : error);
            return false;
        }
    };
    const safeSend = async (content) => {
        try {
            await channel.send({ content });
            return true;
        }
        catch (error) {
            console.error('Failed to send message:', error instanceof Error ? error.message : error);
            return false;
        }
    };
    const pollTuiRequest = async () => {
        try {
            const tuiRequest = await sessionManager.getNextTuiRequest(port);
            if (!tuiRequest || !tuiRequest.path) return;
            const tuiKey = JSON.stringify({ path: tuiRequest.path, body: tuiRequest.body });
            if (tuiKey === lastPresentedTuiKey) return;
            lastPresentedTuiKey = tuiKey;
            const body = tuiRequest.body || {};
            const messageText = body.message || body.text || body.prompt || '';
            const options = body.options || body.choices || [];
            if (options.length > 0 && options.length <= 5) {
                const optionRows = [];
                let currentRow = new ActionRowBuilder();
                options.forEach((option, index) => {
                    const label = (typeof option === 'string' ? option : option.label || option.name || String(option)).slice(0, 80);
                    if (currentRow.components.length >= 5) {
                        optionRows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                    currentRow.addComponents(new ButtonBuilder()
                        .setCustomId(`tui_${threadId}_${index}`)
                        .setLabel(label)
                        .setStyle(ButtonStyle.Secondary));
                });
                if (currentRow.components.length > 0) {
                    optionRows.push(currentRow);
                }
                const header = messageText ? `❓ **${messageText}**\n\nSelect an option below:` : '❓ **Select an option**';
                await channel.send({ content: header, components: optionRows });
            }
            else if (messageText.toLowerCase().includes('confirm') || messageText.toLowerCase().includes('approve') || messageText.toLowerCase().includes('are you sure') || options.length === 0) {
                const content = messageText ? `❓ **${messageText}**` : '❓ **Confirmation Required**';
                const row = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder()
                    .setCustomId(`tui_${threadId}_confirm`)
                    .setLabel('✅ Yes')
                    .setStyle(ButtonStyle.Success), new ButtonBuilder()
                    .setCustomId(`tui_${threadId}_cancel`)
                    .setLabel('❌ No')
                    .setStyle(ButtonStyle.Danger));
                await channel.send({ content, components: [row] });
            }
            else {
                const content = messageText ? `❓ **${messageText}**` : '❓ **Input Required**';
                const row = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder()
                    .setCustomId(`tui_${threadId}_confirm`)
                    .setLabel('✅ Confirm')
                    .setStyle(ButtonStyle.Success), new ButtonBuilder()
                    .setCustomId(`tui_${threadId}_custom`)
                    .setLabel('✏️ Custom')
                    .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                    .setCustomId(`tui_${threadId}_cancel`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger));
                await channel.send({ content, components: [row] });
            }
        }
        catch (error) {
            console.error('Error polling TUI request:', error instanceof Error ? error.message : error);
        }
    };
    try {
        port = await serveManager.spawnServe(effectivePath, preferredModel);
        await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n⏳ Waiting for OpenCode server...`, [buttons]);
        await serveManager.waitForReady(port, 30000, effectivePath, preferredModel);
        const settings = dataStore.getQueueSettings(threadId);
        // If fresh context is enabled, we always clear the session before starting
        if (settings.freshContext) {
            sessionManager.clearSessionForThread(threadId);
        }
        sessionId = await sessionManager.ensureSessionForThread(threadId, effectivePath, port);
        const sseClient = new SSEClient();
        sseClient.connect(`http://127.0.0.1:${port}`);
        sessionManager.setSseClient(threadId, sseClient);
        sseClient.onPartUpdated((part) => {
            if (part.sessionID !== sessionId)
                return;
            accumulatedText = part.text;
        });
        sseClient.onToolUpdated((toolPart) => {
            if (toolPart.sessionID !== sessionId)
                return;
            const status = toolPart.state?.status || 'unknown';
            const toolName = toolPart.tool || 'unknown';
            console.log(`[Execution] Tool update: ${toolName}, status: ${status}, callID: ${toolPart.callID}`);
            let display = '';
            if (toolName === 'question' && status === 'running') {
                // Question tool is waiting for response - present each question as a separate message
                const input = toolPart.state?.input || {};
                const questions = input.questions || [];
                if (questions.length > 0) {
                    (async () => {
                        try {
                            // Send header message
                            const headerMsg = await channel.send({ content: `❓ **Questions** (${questions.length} total)` });
                            questionMessages.push(headerMsg);
                            // Send each question as a separate message
                            for (let qIndex = 0; qIndex < questions.length; qIndex++) {
                                const q = questions[qIndex];
                                const questionText = q.question || q.header || 'Question';
                                const header = q.header || '';
                                const options = q.options || [];
                                let content = `**${qIndex + 1}. ${header || questionText}**\n`;
                                if (header && questionText !== header) {
                                    content += `${questionText}\n`;
                                }
                                if (options.length > 0) {
                                    options.forEach((option, index) => {
                                        const label = option.label || option.name || option.text || String(option);
                                        const description = option.description || option.hint || '';
                                        content += `    ${index + 1}. ${label}`;
                                        if (description) {
                                            content += ` — ${description}`;
                                        }
                                        content += '\n';
                                    });
                                }
                                const msg = await channel.send({ content });
                                questionMessages.push(msg);
                            }
                        }
                        catch (error) {
                            console.error('Error presenting question:', error);
                        }
                    })();
                }
                display = `📝 Waiting for answer...`;
            }
            else if (toolName === 'question') {
                display = `📝 Question asked`;
            }
            else if (toolName === 'glob' || toolName === 'grep' || toolName === 'read' || toolName === 'write' || toolName === 'edit') {
                // Format file operations nicely
                const input = toolPart.state?.input || {};
                const filePath = input.path || input.file || '';
                const pattern = input.pattern || '';
                if (toolName === 'glob') {
                    display = `🔍 Searching ${pattern || 'files'} in ${filePath || '.'}`;
                }
                else if (toolName === 'grep') {
                    display = `🔍 Searching for "${input.pattern || input.query || ''}" in ${filePath || '.'}`;
                }
                else if (toolName === 'read') {
                    display = `📖 Reading ${filePath}`;
                }
                else if (toolName === 'write') {
                    display = `✏️ Writing to ${filePath}`;
                }
                else if (toolName === 'edit') {
                    display = `✏️ Editing ${filePath}`;
                }
            }
            else {
                // Generic format
                const input = toolPart.state?.input ? JSON.stringify(toolPart.state.input).slice(0, 80) : '';
                display = `${toolName}`;
                if (input) {
                    display += `: ${input}`;
                }
            }
            // Add status indicator
            const statusIcon = status === 'completed' ? '✅' : status === 'running' ? '⏳' : status === 'error' ? '❌' : '⏳';
            toolUsageText += `${statusIcon} ${display}\n`;
            // Delete question messages when question tool completes
            if (toolName === 'question' && status !== 'running' && questionMessages.length > 0) {
                console.log(`[Execution] Question tool status changed to ${status}, deleting ${questionMessages.length} question messages`);
                (async () => {
                    try {
                        for (const msg of questionMessages) {
                            await msg.delete();
                        }
                        console.log(`[Execution] Deleted question messages`);
                        questionMessages = [];
                    }
                    catch (error) {
                        console.error('[Execution] Failed to delete question messages (may need MANAGE_MESSAGES permission):', error.message);
                    }
                })();
            }
        });
        sseClient.onReasoningUpdated((reasoningPart) => {
            if (reasoningPart.sessionID !== sessionId)
                return;
            thinkingText += reasoningPart.text + '\n';
        });
        sseClient.onPermissionUpdated((permission) => {
            if (permission.sessionID !== sessionId)
                return;
            (async () => {
                try {
                    const title = permission.title || 'Unknown permission request';
                    const permType = permission.type || 'unknown';
                    const pattern = permission.pattern ? (Array.isArray(permission.pattern) ? permission.pattern.join(', ') : permission.pattern) : '';
                    let content = `🔐 **Permission Required**\n\n**${title}**`;
                    if (permType) {
                        content += `\nType: \`${permType}\``;
                    }
                    if (pattern) {
                        content += `\nPattern: \`${pattern}\``;
                    }
                    const permButtons = new ActionRowBuilder()
                        .addComponents(new ButtonBuilder()
                        .setCustomId(`perm_${threadId}_${permission.id}_once`)
                        .setLabel('✅ Allow (Once)')
                        .setStyle(ButtonStyle.Success), new ButtonBuilder()
                        .setCustomId(`perm_${threadId}_${permission.id}_always`)
                        .setLabel('🔁 Allow (Always)')
                        .setStyle(ButtonStyle.Primary), new ButtonBuilder()
                        .setCustomId(`perm_${threadId}_${permission.id}_reject`)
                        .setLabel('❌ Reject')
                        .setStyle(ButtonStyle.Danger));
                    await channel.send({ content, components: [permButtons] });
                }
                catch (error) {
                    console.error('Error handling permission event:', error);
                }
            })();
        });
        sseClient.onQuestionAsked((question) => {
            if (question.sessionID !== sessionId)
                return;
            console.log(`[Execution] Question asked: ${question.id}`);
            sessionManager.setPendingQuestion(threadId, question.id, question.questions);
        });
        sseClient.onSessionIdle((idleSessionId) => {
            console.log(`[Execution] Session idle: ${idleSessionId}, expected: ${sessionId}, promptSent: ${promptSent}`);
            if (idleSessionId !== sessionId)
                return;
            if (!promptSent)
                return;
            console.log(`[Execution] Processing session idle...`);
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            if (tuiPollInterval) {
                clearInterval(tuiPollInterval);
                tuiPollInterval = null;
            }
            (async () => {
                try {
                    if (hasSessionError) {
                        console.log(`[Execution] Session had error, cleaning up`);
                        if (_sessionErrorCallback) {
                            _sessionErrorCallback(threadId);
                        }
                        sseClient.disconnect();
                        sessionManager.clearSseClient(threadId);
                        sessionManager.clearPendingQuestion(threadId);
                        return;
                    }
                    const disabledButtons = new ActionRowBuilder()
                        .addComponents(new ButtonBuilder()
                        .setCustomId(`interrupt_${threadId}`)
                        .setLabel('⏸️ Interrupt')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true));
                    if (!accumulatedText.trim()) {
                        console.log(`[Execution] No accumulated text`);
                        const edited = await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n⚠️ No output received — the model may have encountered an issue.`, [disabledButtons]);
                        if (!edited) {
                            await safeSend('⚠️ No output received — the model may have encountered an issue.');
                        }
                        await safeSend('⚠️ Done (no output received)');
                    }
                    else {
                        console.log(`[Execution] Has accumulated text, length: ${accumulatedText.length}`);
                        const result = formatOutputForMobile(accumulatedText);
                        const editSuccess = await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n${result.chunks[0]}`, [disabledButtons]);
                        // If edit failed (e.g., content exceeds Discord's 2000-char limit), send all chunks as new messages
                        const startIndex = editSuccess ? 1 : 0;
                        for (let i = startIndex; i < result.chunks.length; i++) {
                            await safeSend(result.chunks[i]);
                        }
                        await safeSend('✅ Done');
                    }
                    if (_ttsCallback && accumulatedText.trim()) {
                        _ttsCallback(accumulatedText.trim(), threadId);
                    }
                    console.log(`[Execution] Cleaning up SSE client`);
                    sseClient.disconnect();
                    sessionManager.clearSseClient(threadId);
                    sessionManager.clearPendingQuestion(threadId);
                    await processNextInQueue(channel, threadId, parentChannelId);
                    console.log(`[Execution] Session idle processing complete`);
                }
                catch (error) {
                    console.error('Error in onSessionIdle:', error);
                    await safeSend('❌ An unexpected error occurred while processing the response.');
                }
            })();
        });
        sseClient.onSessionError((errorSessionId, errorInfo) => {
            console.log(`[Execution] Session error: ${errorSessionId}`, errorInfo);
            if (errorSessionId !== sessionId)
                return;
            if (!promptSent)
                return;
            hasSessionError = true;
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            if (tuiPollInterval) {
                clearInterval(tuiPollInterval);
                tuiPollInterval = null;
            }
            (async () => {
                try {
                    const errorMsg = errorInfo.data?.message || errorInfo.name || 'Unknown error';
                    const disabledButtons = new ActionRowBuilder()
                        .addComponents(new ButtonBuilder()
                        .setCustomId(`interrupt_${threadId}`)
                        .setLabel('⏸️ Interrupt')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true));
                    const edited = await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n❌ **Error**: ${errorMsg}`, [disabledButtons]);
                    if (!edited) {
                        await safeSend(`❌ **Error**: ${errorMsg}`);
                    }
                    sseClient.disconnect();
                    sessionManager.clearSseClient(threadId);
                    sessionManager.clearPendingQuestion(threadId);
                    const settings = dataStore.getQueueSettings(threadId);
                    if (settings.continueOnFailure) {
                        await processNextInQueue(channel, threadId, parentChannelId);
                    }
                    else {
                        dataStore.clearQueue(threadId);
                        await safeSend('❌ Execution failed. Queue cleared. Use `/queue settings` to change this behavior.');
                    }
                }
                catch (error) {
                    console.error('Error in onSessionError:', error);
                    await safeSend('❌ An unexpected error occurred while handling a session error.');
                }
            })();
        });
        sseClient.onError((error) => {
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            if (tuiPollInterval) {
                clearInterval(tuiPollInterval);
                tuiPollInterval = null;
            }
            (async () => {
                try {
                    const edited = await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n❌ Connection error: ${error.message}`, []);
                    if (!edited) {
                        await safeSend(`❌ Connection error: ${error.message}`);
                    }
                    sseClient.disconnect();
                    sessionManager.clearSseClient(threadId);
                    const settings = dataStore.getQueueSettings(threadId);
                    if (settings.continueOnFailure) {
                        await processNextInQueue(channel, threadId, parentChannelId);
                    }
                    else {
                        dataStore.clearQueue(threadId);
                        await safeSend('❌ Execution failed. Queue cleared. Use `/queue settings` to change this behavior.');
                    }
                }
                catch (handlerError) {
                    console.error('Error in SSE onError handler:', handlerError);
                    await safeSend('❌ An unexpected connection error occurred.');
                }
            })();
        });
        tuiPollInterval = setInterval(pollTuiRequest, 3000);
        updateInterval = setInterval(async () => {
            tick++;
            try {
                const formatted = formatOutput(accumulatedText);
                const spinnerChar = spinner[tick % spinner.length];
                let displayContent = formatted || 'Processing...';
                // Append tool usage if any
                if (toolUsageText.trim()) {
                    const toolLines = toolUsageText.trim().split('\n');
                    const recentToolLines = toolLines.slice(-5); // last 5 lines
                    displayContent += '\n\n🔧 **Tools used**:\n' + recentToolLines.join('\n');
                }
                // Append thinking if any
                if (thinkingText.trim()) {
                    const thinkLines = thinkingText.trim().split('\n');
                    const recentThinkLines = thinkLines.slice(-3); // last 3 lines
                    displayContent += '\n\n💭 **Thinking**:\n' + recentThinkLines.join('\n');
                }
                // Truncate if too long (Discord limit 2000, we leave some margin)
                if (displayContent.length > 1900) {
                    displayContent = displayContent.slice(0, 1897) + '...';
                }
                if (displayContent !== lastContent || tick % 2 === 0) {
                    lastContent = displayContent;
                    await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n${spinnerChar} **Running...**\n${displayContent}`, [buttons]);
                }
            }
            catch (error) {
                console.error('Error in stream update interval:', error instanceof Error ? error.message : error);
            }
        }, 1000);
        await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n📝 Sending prompt...`, [buttons]);
        await sessionManager.sendPrompt(port, sessionId, discordContext + prompt, preferredModel, preferredAgent, undefined, imageAttachments);
        promptSent = true;
    }
    catch (error) {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        if (tuiPollInterval) {
            clearInterval(tuiPollInterval);
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const edited = await updateStreamMessage(`${contextHeader}\n📌 **Prompt**: ${prompt}\n\n❌ OpenCode execution failed: ${errorMessage}`, []);
        if (!edited) {
            await safeSend(`❌ OpenCode execution failed: ${errorMessage}`);
        }
        const client = sessionManager.getSseClient(threadId);
        if (client) {
            client.disconnect();
            sessionManager.clearSseClient(threadId);
        }
        const settings = dataStore.getQueueSettings(threadId);
        if (settings.continueOnFailure) {
            await processNextInQueue(channel, threadId, parentChannelId);
        }
        else {
            dataStore.clearQueue(threadId);
            await safeSend('❌ Execution failed. Queue cleared.');
        }
    }
}
