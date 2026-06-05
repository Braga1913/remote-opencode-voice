import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OPENCODE_CONFIG_DIR = join(homedir(), '.config', 'opencode');
const AGENTS_DIRS = [
    join(OPENCODE_CONFIG_DIR, 'agents'),
    join(OPENCODE_CONFIG_DIR, 'agent'),
];

// Cache: agentName -> invisible_prompt string
const cache = new Map();

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter object, or {} if none found.
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const yaml = match[1];
    const result = {};
    for (const line of yaml.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}

/**
 * Find the agent .md file for a given agent name.
 * Searches in ~/.config/opencode/agents/ and ~/.config/opencode/agent/
 */
function findAgentFile(agentName) {
    for (const dir of AGENTS_DIRS) {
        const filePath = join(dir, `${agentName}.md`);
        if (existsSync(filePath)) return filePath;
    }
    return null;
}

/**
 * Get the invisible_prompt for an agent.
 * Returns the raw template string, or '' if none defined.
 * Results are cached after first read.
 */
export function getInvisiblePrompt(agentName) {
    if (!agentName) return '';
    if (cache.has(agentName)) return cache.get(agentName);

    const filePath = findAgentFile(agentName);
    if (!filePath) {
        cache.set(agentName, '');
        return '';
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const prompt = frontmatter.invisible_prompt || '';
        cache.set(agentName, prompt);
        return prompt;
    } catch {
        cache.set(agentName, '');
        return '';
    }
}

/**
 * Substitute template variables in an invisible prompt.
 * Supported variables: {nickname}, {roles}, {user_id}, {username}
 */
export function substituteVariables(template, context) {
    if (!template) return '';
    return template
        .replace(/\{nickname\}/g, context.nickname || '')
        .replace(/\{roles\}/g, context.roles || '')
        .replace(/\{user_id\}/g, context.userId || '')
        .replace(/\{username\}/g, context.username || '');
}

/**
 * Clear the cache (e.g., if agents are updated).
 */
export function clearCache() {
    cache.clear();
}
