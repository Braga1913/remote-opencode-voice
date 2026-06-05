export function stripAnsi(text) {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
export function parseSSEEvent(data) {
    try {
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
export function extractTextFromPart(part) {
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
    }
    return '';
}
export function accumulateText(current, newText) {
    return current + newText;
}
function stripHtmlBreaks(text) {
    return text.replace(/<br\s*\/?>/gi, '\n');
}
export function parseOpenCodeOutput(buffer) {
    const lines = buffer.split('\n').filter(line => line.trim());
    const textParts = [];
    let lastFinish = null;
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            switch (event.type) {
                case 'text':
                    if (event.part?.text) {
                        textParts.push(event.part.text);
                    }
                    break;
                case 'step_finish':
                    lastFinish = event;
                    break;
            }
        }
        catch {
            const cleaned = stripAnsi(line);
            if (cleaned.trim()) {
                textParts.push(cleaned);
            }
        }
    }
    let result = stripHtmlBreaks(textParts.join('\n'));
    if (lastFinish?.part?.tokens) {
        const tokens = lastFinish.part.tokens;
        const cost = lastFinish.part.cost;
        result += `\n\n---\n📊 Tokens: ${tokens.input?.toLocaleString() || 0} in / ${tokens.output?.toLocaleString() || 0} out`;
        if (cost !== undefined && cost > 0) {
            result += ` | 💰 $${cost.toFixed(4)}`;
        }
    }
    return result;
}
export function buildContextHeader(branchName, modelName) {
    return `🌿 \`${branchName}\` · 🤖 \`${modelName}\``;
}
export function formatOutput(buffer, maxLength = 1900) {
    const parsed = parseOpenCodeOutput(buffer);
    if (!parsed.trim()) {
        return '⏳ Processing...';
    }
    if (parsed.length <= maxLength) {
        return parsed;
    }
    return '...(truncated)...\n\n' + parsed.slice(-maxLength);
}
const MESSAGE_MAX_LENGTH = 1900;
/**
 * Split text into chunks that fit within Discord's message limit.
 * Splits on paragraph boundaries (double newline) when possible.
 */
function splitIntoChunks(text, maxLength) {
    if (text.length <= maxLength) {
        return [text];
    }
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        // Try to split at a paragraph boundary (double newline)
        let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
        if (splitIndex <= 0 || splitIndex < maxLength * 0.3) {
            // Fallback: split at single newline
            splitIndex = remaining.lastIndexOf('\n', maxLength);
        }
        if (splitIndex <= 0 || splitIndex < maxLength * 0.3) {
            // Last resort: hard split at maxLength
            splitIndex = maxLength;
        }
        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).replace(/^\n+/, '');
    }
    return chunks;
}
export function formatOutputForMobile(buffer) {
    const parsed = parseOpenCodeOutput(buffer);
    if (!parsed.trim()) {
        return { chunks: ['⏳ Processing...'] };
    }
    const chunks = splitIntoChunks(parsed, MESSAGE_MAX_LENGTH);
    return { chunks };
}
