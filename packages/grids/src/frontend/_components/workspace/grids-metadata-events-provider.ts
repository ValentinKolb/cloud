import { gridsWorkspace } from "../../../lib/workspace-events";

type LiveProviderError = {
  code: string;
  message: string;
};

type GridsMetadataEventsProviderOptions = {
  baseId: string;
  onReady?: () => void;
  onEvent?: (cursor: string | null) => void;
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

const TERMINAL_ERROR_CODES = new Set(["login_required", "access_denied", "not_found", "internal_error", "backpressure"]);

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
  if (reason && TERMINAL_ERROR_CODES.has(reason)) {
    return { code: reason, message: "Live metadata updates stopped." };
  }
  if (event.code === 1008) return { code: "access_denied", message: "Access changed or expired." };
  if (event.code === 1013) return { code: "backpressure", message: "Live metadata updates are overloaded." };
  if (event.code === 1011) return { code: "internal_error", message: "Live metadata updates failed." };
  return null;
};

const isMetadataEventForBase = (payload: unknown, baseId: string): boolean => {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as { baseId?: unknown; event?: unknown };
  if (value.baseId !== baseId) return false;
  if (!value.event || typeof value.event !== "object") return false;
  const event = value.event as { v?: unknown; baseId?: unknown; type?: unknown };
  return event.v === 1 && event.baseId === baseId && typeof event.type === "string";
};

export const createGridsMetadataEventsProvider = (opts: GridsMetadataEventsProviderOptions) => {
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
        type: gridsWorkspace.wsType.metadataSubscribe,
        payload: {
          baseId: opts.baseId,
          fromCursor: lastAppliedCursor,
        },
      }),
    );
  };

  const handleMessage = (raw: string) => {
    const message = parseJsonMessage(raw);
    if (!message) return;

    if (message.type === gridsWorkspace.wsType.metadataReady) {
      opts.onReady?.();
      return;
    }

    if (message.type === gridsWorkspace.wsType.metadataRevoked) {
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

    if (message.type === gridsWorkspace.wsType.metadataError) {
      const error = errorFromPayload(message.payload, { code: "internal_error", message: "Live metadata updates failed." });
      if (TERMINAL_ERROR_CODES.has(error.code)) fatal(error);
      else opts.onError?.(error);
      return;
    }

    if (message.type !== gridsWorkspace.wsType.metadataEvent || !message.payload || typeof message.payload !== "object") return;
    const payload = message.payload as { cursor?: unknown };
    if (!isMetadataEventForBase(message.payload, opts.baseId)) return;
    opts.onEvent?.(typeof payload.cursor === "string" ? payload.cursor : null);
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

      const delay =
        Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt) + Math.floor(Math.random() * RECONNECT_JITTER_MS);
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
