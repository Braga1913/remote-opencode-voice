import { MessageFlags } from 'discord.js';
import * as sessionManager from '../services/sessionManager.js';
import * as serveManager from '../services/serveManager.js';
import * as dataStore from '../services/dataStore.js';
import * as worktreeManager from '../services/worktreeManager.js';
export async function handleButton(interaction) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const action = parts[0];
    if (action === 'perm') {
        // Format: perm_threadId_permissionID_response
        if (parts.length < 4) {
            await interaction.reply({
                content: '❌ Invalid permission button.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const threadId = parts[1];
        const permissionID = parts[2];
        const response = parts[3];
        await handlePermission(interaction, threadId, permissionID, response);
        return;
    }
    if (action === 'tui') {
        // Format: tui_threadId_index, tui_custom_threadId, tui_threadId_confirm, tui_threadId_cancel
        if (parts.length < 3) {
            await interaction.reply({
                content: '❌ Invalid TUI button.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const threadId = parts[1];
        const secondPart = parts[2];
        if (secondPart === 'custom') {
            // Custom text input - show modal or ask for text
            await handleTuiCustom(interaction, threadId);
        }
        else if (secondPart === 'confirm') {
            // Confirm yes
            await handleTuiResponse(interaction, threadId, 'yes');
        }
        else if (secondPart === 'cancel') {
            // Confirm no
            await handleTuiResponse(interaction, threadId, 'no');
        }
        else {
            // Numbered option index
            const optionIndex = parseInt(secondPart, 10);
            if (isNaN(optionIndex)) {
                await interaction.reply({
                    content: '❌ Invalid TUI option.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            await handleTuiResponse(interaction, threadId, String(optionIndex));
        }
        return;
    }
    if (action === 'question') {
        // Format: question_threadId_callID_index or question_custom_threadId_callID
        if (parts.length < 4) {
            await interaction.reply({
                content: '❌ Invalid question button.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const threadId = parts[1];
        const callID = parts[2];
        const secondPart = parts[3];
        if (secondPart === 'custom') {
            await handleQuestionCustom(interaction, threadId, callID);
        }
        else {
            const optionIndex = parseInt(secondPart, 10);
            if (isNaN(optionIndex)) {
                await interaction.reply({
                    content: '❌ Invalid question option.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            await handleQuestionResponse(interaction, threadId, callID, optionIndex);
        }
        return;
    }
    const threadId = parts[1];
    if (!threadId) {
        await interaction.reply({
            content: '❌ Invalid button.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    if (action === 'interrupt') {
        await handleInterrupt(interaction, threadId);
    }
    else if (action === 'delete') {
        await handleWorktreeDelete(interaction, threadId);
    }
    else if (action === 'pr') {
        await handleWorktreePR(interaction, threadId);
    }
    else {
        await interaction.reply({
            content: '❌ Unknown action.',
            flags: MessageFlags.Ephemeral
        });
    }
}
async function handleInterrupt(interaction, threadId) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const channel = interaction.channel;
    const parentChannelId = channel?.isThread() ? channel.parentId : channel?.id;
    const preferredModel = parentChannelId ? dataStore.getChannelModel(parentChannelId) : undefined;
    const port = serveManager.getPort(session.projectPath, preferredModel);
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const success = await sessionManager.abortSession(port, session.sessionId);
    if (success) {
        await interaction.editReply({ content: '⏸️ Interrupt request sent.' });
    }
    else {
        await interaction.editReply({ content: '⚠️ Failed to interrupt. Server may not be running or no active task.' });
    }
}
async function handleWorktreeDelete(interaction, threadId) {
    const mapping = dataStore.getWorktreeMapping(threadId);
    if (!mapping) {
        await interaction.reply({ content: '⚠️ Worktree mapping not found.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (worktreeManager.worktreeExists(mapping.worktreePath)) {
            await worktreeManager.removeWorktree(mapping.worktreePath, false);
        }
        dataStore.removeWorktreeMapping(threadId);
        const channel = interaction.channel;
        if (channel?.isThread()) {
            await channel.setArchived(true);
        }
        await interaction.editReply({ content: '✅ Worktree deleted and thread archived.' });
    }
    catch (error) {
        await interaction.editReply({ content: `❌ Failed to delete worktree: ${error.message}` });
    }
}
async function handleWorktreePR(interaction, threadId) {
    const mapping = dataStore.getWorktreeMapping(threadId);
    if (!mapping) {
        await interaction.reply({ content: '⚠️ Worktree mapping not found.', flags: MessageFlags.Ephemeral });
        return;
    }
    const channel = interaction.channel;
    const parentChannelId = channel?.isThread() ? channel.parentId : channel?.id;
    const preferredModel = parentChannelId ? dataStore.getChannelModel(parentChannelId) : undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const port = await serveManager.spawnServe(mapping.worktreePath, preferredModel);
        await serveManager.waitForReady(port, 30000, mapping.worktreePath, preferredModel);
        const sessionId = await sessionManager.ensureSessionForThread(threadId, mapping.worktreePath, port);
        const prPrompt = `Create a pull request for the current branch. Include a clear title and description summarizing all changes.`;
        await sessionManager.sendPrompt(port, sessionId, prPrompt, preferredModel);
        await interaction.editReply({ content: '🚀 PR creation started! Check the thread for progress.' });
    }
    catch (error) {
        await interaction.editReply({ content: `❌ Failed to start PR creation: ${error.message}` });
    }
}
async function handlePermission(interaction, threadId, permissionID, response) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const channel = interaction.channel;
    const parentChannelId = channel?.isThread() ? channel.parentId : channel?.id;
    const preferredModel = parentChannelId ? dataStore.getChannelModel(parentChannelId) : undefined;
    const port = serveManager.getPort(session.projectPath, preferredModel);
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const success = await sessionManager.respondToPermission(port, session.sessionId, permissionID, response);
    if (success) {
        const responseLabel = response === 'once' ? '✅ Allowed (once)' : response === 'always' ? '🔁 Allowed (always)' : '❌ Rejected';
        await interaction.editReply({ content: `Permission ${responseLabel}` });
        // Update the original permission message to show the response
        try {
            const message = interaction.message;
            if (message) {
                await message.edit({ content: `🔐 **Permission Request** — ${responseLabel}`, components: [] });
            }
        }
        catch {
            // Message may have been deleted or is too old to edit
        }
    }
    else {
        await interaction.editReply({ content: '⚠️ Failed to respond to permission. Server may not be running.' });
    }
}
async function handleTuiResponse(interaction, threadId, response) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const channel = interaction.channel;
    const parentChannelId = channel?.isThread() ? channel.parentId : channel?.id;
    const preferredModel = parentChannelId ? dataStore.getChannelModel(parentChannelId) : undefined;
    const port = serveManager.getPort(session.projectPath, preferredModel);
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const success = await sessionManager.respondToTuiRequest(port, { response });
    if (success) {
        await interaction.editReply({ content: `✅ Response sent: ${response}` });
        // Update the original message to show the response
        try {
            const message = interaction.message;
            if (message) {
                await message.edit({ content: `❓ **Question** — Responded: ${response}`, components: [] });
            }
        }
        catch {
            // Message may have been deleted or is too old to edit
        }
    }
    else {
        await interaction.editReply({ content: '⚠️ Failed to send response. Server may not be running.' });
    }
}
async function handleTuiCustom(interaction, threadId) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const channel = interaction.channel;
    const parentChannelId = channel?.isThread() ? channel.parentId : channel?.id;
    const preferredModel = parentChannelId ? dataStore.getChannelModel(parentChannelId) : undefined;
    const port = serveManager.getPort(session.projectPath, preferredModel);
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    // Show a modal for custom text input
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalActionRowBuilder } = await import('discord.js');
    const modal = new ModalBuilder()
        .setCustomId(`tui_modal_${threadId}`)
        .setTitle('Custom Response');
    const textInput = new TextInputBuilder()
        .setCustomId('response')
        .setLabel('Your answer')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
    const actionRow = new ModalActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);
    await interaction.showModal(modal);
    // Wait for modal submission
    const filter = (i) => i.customId === `tui_modal_${threadId}` && i.user.id === interaction.user.id;
    try {
        const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 300000 });
        const response = modalInteraction.fields.getTextInputValue('response');
        await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
        const success = await sessionManager.respondToTuiRequest(port, { response });
        if (success) {
            await modalInteraction.editReply({ content: `✅ Response sent: ${response}` });
            // Update the original message to show the response
            try {
                const message = interaction.message;
                if (message) {
                    await message.edit({ content: `❓ **Question** — Responded: ${response}`, components: [] });
                }
            }
            catch {
                // Message may have been deleted or is too old to edit
            }
        }
        else {
            await modalInteraction.editReply({ content: '⚠️ Failed to send response. Server may not be running.' });
        }
    }
    catch (error) {
        console.error('Error waiting for modal submission:', error);
    }
}
async function handleQuestionResponse(interaction, threadId, callID, optionIndex) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const port = session.port;
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Send the option label as the answer
    const response = String(optionIndex + 1); // 1-indexed for the user
    console.log(`[Button] Sending question response: ${response} to port ${port}, session ${session.sessionId}`);
    const pendingQuestion = sessionManager.getPendingQuestion(threadId);
    const requestID = pendingQuestion?.requestID;
    if (!requestID) {
        await interaction.editReply({ content: '⚠️ No pending question found.' });
        return;
    }
    // Format answer as [[label]] for the question API
    const answers = [[response]];
    const success = await sessionManager.replyToQuestion(port, requestID, answers);
    if (success && pendingQuestion) {
        sessionManager.clearPendingQuestion(threadId);
    }
    if (success) {
        await interaction.editReply({ content: `✅ Answer sent: Option ${response}` });
        // Update the original message to show the response
        try {
            const message = interaction.message;
            if (message) {
                await message.edit({ content: `❓ **Question** — Answered: Option ${response}`, components: [] });
            }
        }
        catch {
            // Message may have been deleted or is too old to edit
        }
    }
    else {
        await interaction.editReply({ content: '⚠️ Failed to send answer. Server may not be running.' });
    }
}
async function handleQuestionCustom(interaction, threadId, callID) {
    const session = sessionManager.getSessionForThread(threadId);
    if (!session) {
        await interaction.reply({
            content: '⚠️ Session not found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    const port = session.port;
    if (!port) {
        await interaction.reply({
            content: '⚠️ Server is not running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    // Show a modal for custom text input
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalActionRowBuilder } = await import('discord.js');
    const modal = new ModalBuilder()
        .setCustomId(`question_modal_${threadId}_${callID}`)
        .setTitle('Your Answer');
    const textInput = new TextInputBuilder()
        .setCustomId('response')
        .setLabel('Your answer')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
    const actionRow = new ModalActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);
    await interaction.showModal(modal);
    // Wait for modal submission
    const filter = (i) => i.customId === `question_modal_${threadId}_${callID}` && i.user.id === interaction.user.id;
    try {
        const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 300000 });
        const response = modalInteraction.fields.getTextInputValue('response');
        await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
        // Send the custom response to the question API
        console.log(`[Button] Sending custom question response: ${response} to port ${port}, session ${session.sessionId}`);
        const pendingQuestion = sessionManager.getPendingQuestion(threadId);
        const requestID = pendingQuestion?.requestID;
        if (!requestID) {
            await modalInteraction.editReply({ content: '⚠️ No pending question found.' });
            return;
        }
        // Format answer as [[text]] for the question API
        const answers = [[response]];
        const success = await sessionManager.replyToQuestion(port, requestID, answers);
        if (success && pendingQuestion) {
            sessionManager.clearPendingQuestion(threadId);
        }
        if (success) {
            await modalInteraction.editReply({ content: `✅ Answer sent: ${response}` });
            // Update the original message to show the response
            try {
                const message = interaction.message;
                if (message) {
                    await message.edit({ content: `❓ **Question** — Answered: ${response}`, components: [] });
                }
            }
            catch {
                // Message may have been deleted or is too old to edit
            }
        }
        else {
            await modalInteraction.editReply({ content: '⚠️ Failed to send answer. Server may not be running.' });
        }
    }
    catch (error) {
        console.error('Error waiting for modal submission:', error);
    }
}
