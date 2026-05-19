import { type NotebookPresenceParticipant, NotebookPresenceParticipantSchema } from "@valentinkolb/cloud/contracts";
import { encoding } from "@valentinkolb/stdlib";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { notebooksWorkspace, type NotebookWorkspaceEvent } from "../../../lib/workspace-events";
import { notebooksYjs } from "../../../lib/yjs";

type YjsErrorCode = (typeof notebooksYjs.errorCode)[keyof typeof notebooksYjs.errorCode];

export type YjsProviderError = {
  code: YjsErrorCode;
  message: string;
  noteId?: string;
};

export type YjsProviderOptions = {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  noteId: string;
  appUrl: string;
  sessionToken: string;
  initialCursor?: string | null;
  onConnectionChange?: (connected: boolean) => void;
  onPresenceChange?: (participants: NotebookPresenceParticipant[]) => void;
  workspace?: {
    notebookId: string;
    initialCursor?: string | null;
    onEvent?: (event: NotebookWorkspaceEvent, cursor: string | null) => void;
    onError?: (error: YjsProviderError) => void;
  };
  onError?: (error: YjsProviderError) => void;
  onFatal?: (error: YjsProviderError) => void;
};

const WS_TYPE = notebooksYjs.wsType;
const WORKSPACE_WS_TYPE = notebooksWorkspace.wsType;
const TERMINAL_ERROR_CODES = new Set<string>(notebooksYjs.terminalErrorCodes);
const KNOWN_ERROR_CODES = new Set<string>(Object.values(notebooksYjs.errorCode));
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_JITTER_MS = 1_500;

const resolveHttpBaseUrl = (raw: string): URL => {
  const value = raw.trim();
  const browserOrigin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost:3000";

  if (!value) return new URL(browserOrigin);
  if (/^https?:\/\//i.test(value)) return new URL(value);
  if (value.startsWith("/")) return new URL(value, browserOrigin);
  return new URL(`${new URL(browserOrigin).protocol}//${value}`);
};

/**
 * Client-side Yjs provider:
 * - connect and send `notes.yjs.replay.request`
 * - wait for replay to become ready before sending local writes
 * - apply pushed sync/awareness updates
 * - stop reconnecting on terminal `notes.yjs.error` codes
 */
export function createYjsProvider(opts: YjsProviderOptions) {
  const { doc, awareness, appUrl } = opts;
  // `activeNoteId` starts at whatever the caller passed (UUID or
  // 6-char short-id) and converges to the server-canonical UUID on
  // `replayReady`. Every subsequent client→server message uses the
  // canonical form, so the per-message `payload.noteId` matcher on
  // both sides agrees on a single value.
  let activeNoteId = opts.noteId;
  let ws: WebSocket | null = null;
  let isDisposed = false;
  let isTerminated = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCursor = opts.initialCursor ?? null;
  let lastWorkspaceCursor = opts.workspace?.initialCursor ?? null;
  let activeWorkspaceId = opts.workspace?.notebookId ?? null;
  let replayReady = false;
  let localStateSent = false;
  let needsFullResync = false;

  const errorMessageByCode: Record<YjsErrorCode, string> = {
    LOGIN_REQUIRED: "Login required",
    SESSION_EXPIRED: "Session expired",
    ACCESS_DENIED: "Access denied",
    ACCESS_REVOKED: "Access was revoked",
    NOTE_NOT_FOUND: "Note not found",
    NOTE_LOCKED: "Note is locked",
    INVALID_JSON: "Invalid JSON payload",
    INVALID_MESSAGE: "Invalid websocket message",
    INVALID_PAYLOAD: "Invalid websocket payload",
    BACKPRESSURE: "Websocket backpressure",
    INTERNAL_ERROR: "Internal websocket error",
  };

  const sendJson = (type: string, payload?: unknown): boolean => {
    if (isDisposed || isTerminated) return false;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  };

  const sendSyncPublish = (data: Uint8Array): boolean => sendJson(WS_TYPE.syncPublish, { noteId: activeNoteId, payload: encoding.toBase64(data) });

  const sendAwarenessPublish = (data: Uint8Array): boolean => sendJson(WS_TYPE.awarenessPublish, { noteId: activeNoteId, payload: encoding.toBase64(data) });

  const sendReplayRequest = (fromCursor: string | null): boolean =>
    sendJson(WS_TYPE.replayRequest, {
      noteId: activeNoteId,
      fromCursor,
      sessionToken: opts.sessionToken,
    });

  const sendWorkspaceSubscribe = (): boolean => {
    if (!opts.workspace) return false;
    return sendJson(WORKSPACE_WS_TYPE.subscribe, {
      notebookId: opts.workspace.notebookId,
      fromCursor: lastWorkspaceCursor,
      sessionToken: opts.sessionToken,
    });
  };

  const sendLocalStateIfNeeded = () => {
    if (!replayReady || localStateSent) return;
    if (needsFullResync) {
      const localState = Y.encodeStateAsUpdate(doc);
      if (localState.length > 0 && !sendSyncPublish(localState)) {
        needsFullResync = true;
        return;
      }
    }
    localStateSent = true;
    needsFullResync = false;
  };

  const terminate = (error: YjsProviderError) => {
    if (isTerminated) return;
    isTerminated = true;
    replayReady = false;
    localStateSent = false;
    needsFullResync = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close();
      } catch {
        // Ignore close failures. Terminal flow is already enforced via isTerminated.
      }
    }
    opts.onFatal?.(error);
  };

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (isDisposed || isTerminated) return;
    if (origin === "remote") return;
    if (!replayReady) {
      needsFullResync = true;
      return;
    }
    if (!sendSyncPublish(update)) needsFullResync = true;
  };

  const onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (isDisposed || isTerminated) return;
    if (origin === "remote") return;
    if (!replayReady) return;
    const changedClients = added.concat(updated).concat(removed);
    if (changedClients.length === 0) return;
    sendAwarenessPublish(awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
  };

  const normalizeError = (payload: unknown): YjsProviderError => {
    if (!payload || typeof payload !== "object") {
      return {
        code: notebooksYjs.errorCode.internalError,
        message: "Unknown websocket error",
      };
    }
    const value = payload as { code?: unknown; message?: unknown; noteId?: unknown };
    return {
      code: typeof value.code === "string" ? (value.code as YjsErrorCode) : notebooksYjs.errorCode.internalError,
      message: typeof value.message === "string" ? value.message : "Unknown websocket error",
      noteId: typeof value.noteId === "string" ? value.noteId : undefined,
    };
  };

  const normalizeTerminalCloseReason = (reason: string): YjsProviderError | null => {
    const value = reason.trim();
    if (!KNOWN_ERROR_CODES.has(value) || !TERMINAL_ERROR_CODES.has(value)) {
      return null;
    }
    const code = value as YjsErrorCode;
    return {
      code,
      message: errorMessageByCode[code] ?? "Connection closed",
    };
  };

  const normalizeTerminalCloseCode = (code: number): YjsProviderError | null => {
    if (code === 1008) {
      return {
        code: notebooksYjs.errorCode.accessRevoked,
        message: "Access changed or note became unavailable",
      };
    }

    if (code === 1013) {
      return {
        code: notebooksYjs.errorCode.backpressure,
        message: "Websocket backpressure",
      };
    }

    if (code === 1011) {
      return {
        code: notebooksYjs.errorCode.internalError,
        message: "Internal websocket error",
      };
    }

    return null;
  };

  const handleJsonMessage = (raw: string) => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;
    const msg = message as { type?: unknown; payload?: unknown };
    if (msg.type === WS_TYPE.error) {
      const error = normalizeError(msg.payload);
      opts.onError?.(error);
      if (TERMINAL_ERROR_CODES.has(error.code)) {
        terminate(error);
      }
      return;
    }

    if (msg.type === WORKSPACE_WS_TYPE.error || msg.type === WORKSPACE_WS_TYPE.revoked) {
      const error = normalizeError(msg.payload);
      opts.workspace?.onError?.(error);
      return;
    }

    if (msg.type === WORKSPACE_WS_TYPE.ready) {
      const payload = (msg.payload ?? {}) as { notebookId?: unknown };
      if (typeof payload.notebookId === "string") activeWorkspaceId = payload.notebookId;
      return;
    }

    if (msg.type === WORKSPACE_WS_TYPE.event) {
      const payload = (msg.payload ?? {}) as {
        notebookId?: unknown;
        cursor?: unknown;
        event?: unknown;
      };
      if (!opts.workspace || payload.notebookId !== activeWorkspaceId) return;
      if (typeof payload.cursor === "string") lastWorkspaceCursor = payload.cursor;
      const event = payload.event as NotebookWorkspaceEvent | undefined;
      if (!event || event.v !== 1 || event.notebookId !== activeWorkspaceId) return;
      opts.workspace.onEvent?.(event, typeof payload.cursor === "string" ? payload.cursor : null);
      return;
    }

    if (msg.type === WS_TYPE.replayReady) {
      const payload = (msg.payload ?? {}) as { noteId?: unknown };
      // Adopt the server-canonical id form. We may have sent a
      // short-id; the server replies with the canonical UUID. Updating
      // `activeNoteId` here means every subsequent send + every
      // inbound `payload.noteId` matcher uses the same value.
      if (typeof payload.noteId === "string") activeNoteId = payload.noteId;
      replayReady = true;
      sendLocalStateIfNeeded();
      return;
    }

    if (msg.type === WS_TYPE.presenceSnapshot || msg.type === WS_TYPE.presenceChanged) {
      const payload = (msg.payload ?? {}) as {
        noteId?: unknown;
        participants?: unknown;
      };

      if (payload.noteId !== activeNoteId) return;
      const participants = NotebookPresenceParticipantSchema.array().safeParse(payload.participants);
      if (!participants.success) return;
      opts.onPresenceChange?.(participants.data);
      return;
    }

    const isPushType = msg.type === WS_TYPE.syncPush || msg.type === WS_TYPE.awarenessPush;
    if (!isPushType) return;

    const payload = msg.payload as {
      noteId?: unknown;
      updates?: Array<{ cursor?: unknown; payload?: unknown }>;
    };

    if (payload.noteId !== activeNoteId || !Array.isArray(payload.updates)) return;
    for (const update of payload.updates) {
      if (typeof update.payload !== "string") continue;
      try {
        if (msg.type === WS_TYPE.syncPush) {
          Y.applyUpdate(doc, encoding.fromBase64(update.payload), "remote");
        } else {
          awarenessProtocol.applyAwarenessUpdate(awareness, encoding.fromBase64(update.payload), "remote");
        }
      } catch {
        // Ignore malformed updates to keep collaboration resilient.
      }

      if (typeof update.cursor === "string") {
        lastCursor = update.cursor;
      }
    }

    replayReady = true;
    sendLocalStateIfNeeded();
  };

  const connect = () => {
    if (isDisposed || isTerminated) return;

    const wsUrl = new URL("/api/notebooks/ws", resolveHttpBaseUrl(appUrl));
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(wsUrl.href);

    ws.onopen = () => {
      opts.onConnectionChange?.(true);
      replayReady = false;
      localStateSent = false;
      sendWorkspaceSubscribe();
      sendReplayRequest(lastCursor);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") handleJsonMessage(event.data);
    };

    ws.onclose = (event) => {
      opts.onConnectionChange?.(false);
      replayReady = false;
      localStateSent = false;

      const closeError = normalizeTerminalCloseReason(event.reason ?? "") ?? normalizeTerminalCloseCode(event.code);
      if (closeError) {
        opts.onError?.(closeError);
        terminate(closeError);
        return;
      }

      if (!isDisposed && !isTerminated) {
        const delay = RECONNECT_BASE_DELAY_MS + Math.floor(Math.random() * RECONNECT_JITTER_MS);
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => ws?.close();
  };

  doc.on("update", onDocUpdate);
  awareness.on("update", onAwarenessUpdate);

  return {
    connect,
    dispose: () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], "disconnect");
      doc.off("update", onDocUpdate);
      awareness.off("update", onAwarenessUpdate);
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
