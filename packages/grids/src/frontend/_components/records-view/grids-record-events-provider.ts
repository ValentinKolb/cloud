import { gridsWorkspace } from "../../../lib/workspace-events";
import type { LiveRecordEvent } from "./live-refresh";
import { isLiveRecordEventForTable, isTerminalLiveErrorCode } from "./live-refresh";

type LiveProviderError = {
  code: string;
  message: string;
};

type GridsRecordEventsProviderOptions = {
  tableId: string;
  dashboardId?: string;
  onReady?: () => void;
  onEvent?: (event: LiveRecordEvent, cursor: string | null) => void;
  onError?: (error: LiveProviderError) => void;
  onRevoked?: (error: LiveProviderError) => void;
  onFatal?: (error: LiveProviderError) => void;
};

type ProviderMessage = {
  type?: unknown;
  payload?: unknown;
};

const RECONNECT_BASE_DELAY_MS = 750;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_JITTER_MS = 250;

const parseJsonMessage = (raw: string): ProviderMessage | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ProviderMessage) : null;
  } catch {
    return null;
  }
};

const errorFromPayload = (payload: unknown, fallback: LiveProviderError): LiveProviderError => {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : fallback.code,
    message: typeof value.message === "string" ? value.message : fallback.message,
  };
};

const terminalCloseError = (event: CloseEvent): LiveProviderError | null => {
  const reason = event.reason.trim();
  if (reason && isTerminalLiveErrorCode(reason)) {
    return { code: reason, message: "Live updates stopped." };
  }
  if (event.code === 1008) return { code: "access_denied", message: "Access changed or expired." };
  if (event.code === 1013) return { code: "backpressure", message: "Live updates are overloaded." };
  if (event.code === 1011) return { code: "internal_error", message: "Live updates failed." };
  return null;
};

export const createGridsRecordEventsProvider = (opts: GridsRecordEventsProviderOptions) => {
  let socket: WebSocket | null = null;
  let disposed = false;
  let terminated = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let lastAppliedCursor: string | null = null;
  let fatalSent = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const fatal = (error: LiveProviderError) => {
    if (fatalSent) return;
    fatalSent = true;
    terminated = true;
    clearReconnectTimer();
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        // The socket is already unusable; terminal state is what matters.
      }
    }
    opts.onFatal?.(error);
  };

  const sendSubscribe = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: gridsWorkspace.wsType.recordsSubscribe,
        payload: {
          tableId: opts.tableId,
          dashboardId: opts.dashboardId,
          fromCursor: lastAppliedCursor,
        },
      }),
    );
  };

  const handleMessage = (raw: string) => {
    const message = parseJsonMessage(raw);
    if (!message) return;

    if (message.type === gridsWorkspace.wsType.recordsReady) {
      opts.onReady?.();
      return;
    }

    if (message.type === gridsWorkspace.wsType.recordsRevoked) {
      const error = errorFromPayload(message.payload, { code: "access_denied", message: "Access was revoked." });
      terminated = true;
      clearReconnectTimer();
      if (socket && socket.readyState <= WebSocket.OPEN) {
        try {
          socket.close(1008, error.code);
        } catch {
          // Ignore close failures; revoked access is already terminal.
        }
      }
      opts.onRevoked?.(error);
      return;
    }

    if (message.type === gridsWorkspace.wsType.recordsError) {
      const error = errorFromPayload(message.payload, { code: "internal_error", message: "Live updates failed." });
      if (isTerminalLiveErrorCode(error.code)) fatal(error);
      else opts.onError?.(error);
      return;
    }

    if (message.type !== gridsWorkspace.wsType.recordsEvent || !message.payload || typeof message.payload !== "object") return;
    const payload = message.payload as { cursor?: unknown; event?: unknown };
    if (!isLiveRecordEventForTable(payload.event, opts.tableId)) return;
    opts.onEvent?.(payload.event, typeof payload.cursor === "string" ? payload.cursor : null);
  };

  const connect = () => {
    if (disposed || terminated || typeof WebSocket === "undefined") return;
    clearReconnectTimer();

    const wsUrl = new URL("/api/grids/ws", window.location.origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(wsUrl.href);
    socket = nextSocket;

    nextSocket.onopen = () => {
      reconnectAttempt = 0;
      sendSubscribe();
    };

    nextSocket.onmessage = (event) => {
      if (typeof event.data === "string") handleMessage(event.data);
    };

    nextSocket.onclose = (event) => {
      if (socket === nextSocket) socket = null;
      if (disposed || terminated) return;

      const closeError = terminalCloseError(event);
      if (closeError) {
        fatal(closeError);
        return;
      }

      const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt) + Math.floor(Math.random() * RECONNECT_JITTER_MS);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = setTimeout(connect, delay);
    };

    nextSocket.onerror = () => nextSocket.close();
  };

  return {
    connect,
    markApplied: (cursor: string | null | undefined) => {
      if (cursor) lastAppliedCursor = cursor;
    },
    dispose: () => {
      disposed = true;
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
  };
};
