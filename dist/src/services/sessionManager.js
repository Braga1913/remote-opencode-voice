import * as dataStore from "./dataStore.js";
import { sanitizeModel } from "../utils/stringUtils.js";
import { getAuthHeaders, assertNotAuthError } from "./serverAuth.js";
const threadSseClients = new Map();
const pendingQuestions = new Map();
function jsonHeaders() {
    return { "Content-Type": "application/json", ...getAuthHeaders() };
}
export async function createSession(port) {
    const url = `http://127.0.0.1:${port}/session`;
    const response = await fetch(url, {
        method: "POST",
        headers: jsonHeaders(),
        body: "{}",
    });
    if (!response.ok) {
        assertNotAuthError(response.status, "Failed to create session");
        throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.id) {
        throw new Error("Invalid session response: missing id");
    }
    return data.id;
}
function parseModelString(model) {
    const clean = sanitizeModel(model);
    const slashIndex = clean.indexOf("/");
    if (slashIndex === -1) {
        return null;
    }
    return {
        providerID: clean.slice(0, slashIndex),
        modelID: clean.slice(slashIndex + 1),
    };
}
export async function sendPrompt(port, sessionId, text, model, agent, messageID, files = []) {
    const url = `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`;
    console.log(`[Session] Sending prompt to ${url}`);
    const parts = [{ type: "text", text }];
    for (const file of files) {
        parts.push({
            type: "file",
            mime: file.mime,
            url: file.url,
            filename: file.filename,
        });
    }
    const body = { parts };
    if (messageID) {
        body.messageID = messageID;
    }
    if (model) {
        const cleanModel = sanitizeModel(model);
        const parsedModel = parseModelString(cleanModel);
        if (parsedModel) {
            body.model = parsedModel;
        }
    }
    if (agent) {
        body.agent = agent.toLowerCase();
    }
    console.log(`[Session] Prompt body:`, JSON.stringify(body));
    const response = await fetch(url, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
    });
    console.log(`[Session] Prompt response status: ${response.status}`);
    if (!response.ok) {
        const responseBody = await response.text();
        console.log(`[Session] Prompt error response: ${responseBody}`);
        assertNotAuthError(response.status, "Failed to send prompt");
        throw new Error(`Failed to send prompt: ${response.status} ${response.statusText} — ${responseBody}`);
    }
}
export async function validateSession(port, sessionId) {
    const url = `http://127.0.0.1:${port}/session/${sessionId}`;
    let response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: jsonHeaders(),
        });
    }
    catch {
        return false;
    }
    if (!response.ok) {
        assertNotAuthError(response.status, "Failed to validate session");
    }
    return response.ok;
}
export async function getSessionInfo(port, sessionId) {
    const url = `http://127.0.0.1:${port}/session/${sessionId}`;
    let response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: jsonHeaders(),
        });
    }
    catch {
        return null;
    }
    if (!response.ok) {
        assertNotAuthError(response.status, "Failed to get session info");
        return null;
    }
    const data = await response.json();
    return { id: data.id, title: data.title ?? "" };
}
export async function listSessions(port) {
    const url = `http://127.0.0.1:${port}/session`;
    let response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: jsonHeaders(),
        });
    }
    catch {
        return [];
    }
    if (!response.ok) {
        assertNotAuthError(response.status, "Failed to list sessions");
        return [];
    }
    const data = await response.json();
    if (Array.isArray(data)) {
        return data.map((s) => ({
            id: s.id,
            title: s.title ?? "",
        }));
    }
    return [];
}
export async function abortSession(port, sessionId) {
    const url = `http://127.0.0.1:${port}/session/${sessionId}/abort`;
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: getAuthHeaders(),
        });
    }
    catch {
        return false;
    }
    if (!response.ok) {
        assertNotAuthError(response.status, "Failed to abort session");
    }
    return response.ok;
}
export async function respondToPermission(port, sessionId, permissionID, response) {
    const url = `http://127.0.0.1:${port}/session/${sessionId}/permissions/${permissionID}`;
    let result;
    try {
        result = await fetch(url, {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify({ response }),
        });
    }
    catch {
        return false;
    }
    if (!result.ok) {
        assertNotAuthError(result.status, "Failed to respond to permission");
    }
    return result.ok;
}
export async function replyToQuestion(port, requestID, answers) {
    const url = `http://127.0.0.1:${port}/question/${requestID}/reply`;
    console.log(`[Session] Replying to question ${requestID} at ${url}`);
    let result;
    try {
        result = await fetch(url, {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify({ answers }),
        });
    }
    catch {
        return false;
    }
    console.log(`[Session] Question reply status: ${result.status}`);
    if (!result.ok) {
        const body = await result.text();
        console.log(`[Session] Question reply error: ${body}`);
        assertNotAuthError(result.status, "Failed to reply to question");
    }
    return result.ok;
}
export async function getNextTuiRequest(port) {
    const url = `http://127.0.0.1:${port}/tui/control/next`;
    let result;
    try {
        result = await fetch(url, {
            method: "GET",
            headers: getAuthHeaders(),
        });
    }
    catch {
        return null;
    }
    if (!result.ok) {
        return null;
    }
    try {
        return await result.json();
    }
    catch {
        return null;
    }
}
export async function respondToTuiRequest(port, response) {
    const url = `http://127.0.0.1:${port}/tui/control/response`;
    let result;
    try {
        result = await fetch(url, {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify(response),
        });
    }
    catch {
        return false;
    }
    if (!result.ok) {
        assertNotAuthError(result.status, "Failed to respond to TUI request");
    }
    return result.ok;
}
export function getSessionForThread(threadId) {
    const session = dataStore.getThreadSession(threadId);
    if (!session)
        return undefined;
    return {
        sessionId: session.sessionId,
        projectPath: session.projectPath,
        port: session.port,
    };
}
export function setSessionForThread(threadId, sessionId, projectPath, port) {
    const existing = dataStore.getThreadSession(threadId);
    const now = Date.now();
    dataStore.setThreadSession({
        threadId,
        sessionId,
        projectPath,
        port,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
    });
}
export async function ensureSessionForThread(threadId, projectPath, port) {
    const existingSession = getSessionForThread(threadId);
    if (existingSession && existingSession.projectPath === projectPath) {
        const isValid = await validateSession(port, existingSession.sessionId);
        if (isValid) {
            setSessionForThread(threadId, existingSession.sessionId, projectPath, port);
            return existingSession.sessionId;
        }
    }
    const sessionId = await createSession(port);
    setSessionForThread(threadId, sessionId, projectPath, port);
    return sessionId;
}
export function updateSessionLastUsed(threadId) {
    dataStore.updateThreadSessionLastUsed(threadId);
}
export function clearSessionForThread(threadId) {
    dataStore.clearThreadSession(threadId);
}
export function setSseClient(threadId, client) {
    threadSseClients.set(threadId, client);
}
export function getSseClient(threadId) {
    return threadSseClients.get(threadId);
}
export function clearSseClient(threadId) {
    threadSseClients.delete(threadId);
}
export function setPendingQuestion(threadId, requestID, questions) {
    pendingQuestions.set(threadId, { requestID, questions });
}
export function getPendingQuestion(threadId) {
    return pendingQuestions.get(threadId);
}
export function clearPendingQuestion(threadId) {
    pendingQuestions.delete(threadId);
}
