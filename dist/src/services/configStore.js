import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const CONFIG_DIR = join(homedir(), '.remote-opencode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
function ensureConfigDir() {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
}
export function getConfigDir() {
    return CONFIG_DIR;
}
export function loadConfig() {
    ensureConfigDir();
    if (!existsSync(CONFIG_FILE)) {
        return {};
    }
    try {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return {};
    }
}
export function saveConfig(config) {
    ensureConfigDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
export function getBotConfig() {
    return loadConfig().bot;
}
export function setBotConfig(bot) {
    const config = loadConfig();
    config.bot = bot;
    saveConfig(config);
}
export function getPortConfig() {
    return loadConfig().ports;
}
export function setPortConfig(ports) {
    const config = loadConfig();
    config.ports = ports;
    saveConfig(config);
}
export function hasBotConfig() {
    const bot = getBotConfig();
    return !!(bot?.discordToken && bot?.clientId && bot?.guildId);
}
export function clearBotConfig() {
    const config = loadConfig();
    delete config.bot;
    saveConfig(config);
}
export function getAllowedUserIds() {
    return loadConfig().allowedUserIds ?? [];
}
export function setAllowedUserIds(ids) {
    const config = loadConfig();
    config.allowedUserIds = ids;
    saveConfig(config);
}
export function addAllowedUserId(id) {
    const config = loadConfig();
    const current = config.allowedUserIds ?? [];
    if (!current.includes(id)) {
        config.allowedUserIds = [...current, id];
        saveConfig(config);
    }
}
export function removeAllowedUserId(id) {
    const config = loadConfig();
    const current = config.allowedUserIds ?? [];
    if (!current.includes(id))
        return false;
    if (current.length <= 1)
        return false; // prevent removing last user
    config.allowedUserIds = current.filter(uid => uid !== id);
    saveConfig(config);
    return true;
}
export function isAuthorized(userId) {
    const ids = getAllowedUserIds();
    if (ids.length === 0)
        return true; // no restriction
    return ids.includes(userId);
}
export function getOpenAIApiKey() {
    return process.env.OPENAI_API_KEY || loadConfig().openaiApiKey;
}
export function setOpenAIApiKey(key) {
    const config = loadConfig();
    config.openaiApiKey = key;
    saveConfig(config);
}
export function removeOpenAIApiKey() {
    const config = loadConfig();
    delete config.openaiApiKey;
    saveConfig(config);
}
export function getSonioxApiKey() {
    return process.env.SONIOX_API_KEY || loadConfig().sonioxApiKey;
}
export function setSonioxApiKey(key) {
    const config = loadConfig();
    config.sonioxApiKey = key;
    saveConfig(config);
}
export function removeSonioxApiKey() {
    const config = loadConfig();
    delete config.sonioxApiKey;
    saveConfig(config);
}
