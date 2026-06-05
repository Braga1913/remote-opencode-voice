import { EventSource } from "eventsource";
import { getAuthHeaders } from "./serverAuth.js";
export class SSEClient {
    eventSource = null;
    partUpdatedCallbacks = [];
    sessionIdleCallbacks = [];
    sessionErrorCallbacks = [];
    errorCallbacks = [];
    toolUpdatedCallbacks = [];
    reasoningUpdatedCallbacks = [];
    stepUpdatedCallbacks = [];
    permissionUpdatedCallbacks = [];
    questionAskedCallbacks = [];
    connect(baseUrl) {
        const url = `${baseUrl}/event`;
        // When OPENCODE_SERVER_PASSWORD is set, forward the same Basic auth
        // header we use for regular HTTP requests. The `eventsource` package
        // allows overriding the underlying fetch so we can inject headers —
        // EventSource itself does not accept headers directly.
        const authHeaders = getAuthHeaders();
        const init = Object.keys(authHeaders).length > 0
            ? {
                fetch: (input, fetchInit) => fetch(input, {
                    ...fetchInit,
                    headers: { ...fetchInit?.headers, ...authHeaders },
                }),
            }
            : undefined;
        this.eventSource = new EventSource(url, init);
        this.eventSource.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            }
            catch (error) {
                this.handleError(new Error(`Failed to parse SSE event: ${error}`));
            }
        });
        this.eventSource.addEventListener("error", (error) => {
            this.handleError(error instanceof Error ? error : new Error("SSE connection error"));
        });
    }
    onPartUpdated(callback) {
        this.partUpdatedCallbacks.push(callback);
    }
    onSessionIdle(callback) {
        this.sessionIdleCallbacks.push(callback);
    }
    onSessionError(callback) {
        this.sessionErrorCallbacks.push(callback);
    }
    onError(callback) {
        this.errorCallbacks.push(callback);
    }
    onToolUpdated(callback) {
        this.toolUpdatedCallbacks.push(callback);
    }
    onReasoningUpdated(callback) {
        this.reasoningUpdatedCallbacks.push(callback);
    }
    onStepUpdated(callback) {
        this.stepUpdatedCallbacks.push(callback);
    }
    onPermissionUpdated(callback) {
        this.permissionUpdatedCallbacks.push(callback);
    }
    onQuestionAsked(callback) {
        this.questionAskedCallbacks.push(callback);
    }
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
    isConnected() {
        return (this.eventSource !== null &&
            this.eventSource.readyState === EventSource.OPEN);
    }
    handleMessage(event) {
        console.log(`[SSE] Event: ${event.type}`);
        if (event.type === "message.part.updated") {
            const part = event.properties.part;
            console.log(`[SSE] Part type: ${part?.type}, id: ${part?.id}`);
            if (part && part.type === "text") {
                const textPart = {
                    id: part.id,
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    text: part.text,
                };
                this.partUpdatedCallbacks.forEach((cb) => cb(textPart));
            }
            else if (part && part.type === "tool") {
                console.log(`[SSE] Tool: ${part.tool}, status: ${part.state?.status}, callID: ${part.callID}`);
                const toolPart = {
                    id: part.id,
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    callID: part.callID,
                    tool: part.tool,
                    state: part.state,
                };
                this.toolUpdatedCallbacks.forEach((cb) => cb(toolPart));
            }
            else if (part && part.type === "reasoning") {
                const reasoningPart = {
                    id: part.id,
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    text: part.text,
                };
                this.reasoningUpdatedCallbacks.forEach((cb) => cb(reasoningPart));
            }
            else if (part && (part.type === "step-start" || part.type === "step-finish")) {
                const stepPart = {
                    id: part.id,
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    type: part.type,
                };
                this.stepUpdatedCallbacks.forEach((cb) => cb(stepPart));
            }
        }
        else if (event.type === "session.idle") {
            const sessionID = event.properties.sessionID;
            console.log(`[SSE] Session idle: ${sessionID}`);
            if (sessionID) {
                this.sessionIdleCallbacks.forEach((cb) => cb(sessionID));
            }
        }
        else if (event.type === "session.error") {
            const sessionID = event.properties.sessionID;
            const error = event.properties.error;
            console.log(`[SSE] Session error: ${sessionID}`, error);
            if (sessionID && error) {
                this.sessionErrorCallbacks.forEach((cb) => cb(sessionID, error));
            }
        }
        else if (event.type === "permission.updated") {
            const permission = event.properties;
            console.log(`[SSE] Permission updated: ${permission?.id}, type: ${permission?.type}`);
            if (permission && permission.id && permission.sessionID) {
                this.permissionUpdatedCallbacks.forEach((cb) => cb(permission));
            }
        }
        else if (event.type === "question.asked") {
            const question = event.properties;
            console.log(`[SSE] Question asked: ${question?.id}`);
            if (question && question.id) {
                this.questionAskedCallbacks.forEach((cb) => cb(question));
            }
        }
        else if (event.type === "session.status") {
            console.log(`[SSE] Session status:`, event.properties?.status || 'unknown');
        }
        else if (event.type === "session.diff") {
            console.log(`[SSE] Session diff:`, JSON.stringify(event.properties).slice(0, 200));
        }
    }
    handleError(error) {
        this.errorCallbacks.forEach((cb) => cb(error));
    }
}
