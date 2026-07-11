import type { GridsWorkflowRunEvent } from "../../../lib/workflow-run-events";
import { gridsWorkspace } from "../../../lib/workspace-events";

type ProviderError = { code: string; message: string };

type WorkflowRunEventsProviderOptions = {
  workflowId: string;
  dashboardId?: string | null;
  dashboardWidgetId?: string | null;
  onReady?: () => void;
  onEvent?: (event: GridsWorkflowRunEvent, cursor: string | null) => void;
  onError?: (error: ProviderError) => void;
  onRevoked?: (error: ProviderError) => void;
  onFatal?: (error: ProviderError) => void;
};

const parseMessage = (raw: string): { type?: unknown; payload?: unknown } | null => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as { type?: unknown; payload?: unknown }) : null;
  } catch {
    return null;
  }
};

const parseError = (payload: unknown, fallback: ProviderError): ProviderError => {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : fallback.code,
    message: typeof value.message === "string" ? value.message : fallback.message,
  };
};

const terminalCloseError = (event: CloseEvent): ProviderError | null => {
  if (event.code === 1008) return { code: event.reason || "access_denied", message: "Workflow access changed or expired." };
  if (event.code === 1013) return { code: "backpressure", message: "Workflow updates are overloaded." };
  if (event.code === 1011) return { code: "internal_error", message: "Workflow updates failed." };
  return null;
};

export const createWorkflowRunEventsProvider = (options: WorkflowRunEventsProviderOptions) => {
  let socket: WebSocket | null = null;
  let disposed = false;
  let terminated = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let lastCursor: string | null = null;

  const clearReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const sendSubscribe = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: gridsWorkspace.wsType.workflowRunsSubscribe,
        payload: {
          workflowId: options.workflowId,
          ...(options.dashboardId && options.dashboardWidgetId
            ? { dashboardId: options.dashboardId, dashboardWidgetId: options.dashboardWidgetId }
            : {}),
          fromCursor: lastCursor,
        },
      }),
    );
  };

  const handleMessage = (raw: string) => {
    const message = parseMessage(raw);
    if (!message) return;
    if (message.type === gridsWorkspace.wsType.workflowRunsReady) {
      options.onReady?.();
      return;
    }
    if (message.type === gridsWorkspace.wsType.workflowRunsRevoked) {
      const error = parseError(message.payload, { code: "access_denied", message: "Workflow access was revoked." });
      terminated = true;
      clearReconnect();
      options.onRevoked?.(error);
      socket?.close(1008, error.code);
      return;
    }
    if (message.type === gridsWorkspace.wsType.workflowRunsError) {
      options.onError?.(parseError(message.payload, { code: "stream_failed", message: "Workflow updates failed." }));
      return;
    }
    if (message.type !== gridsWorkspace.wsType.workflowRunsEvent || !message.payload || typeof message.payload !== "object") return;
    const payload = message.payload as { cursor?: unknown; event?: unknown };
    if (!payload.event || typeof payload.event !== "object") return;
    const event = payload.event as GridsWorkflowRunEvent;
    if (event.v !== 1 || event.workflowId !== options.workflowId || !event.run || event.run.workflowId !== options.workflowId) return;
    const cursor = typeof payload.cursor === "string" ? payload.cursor : null;
    if (cursor) lastCursor = cursor;
    options.onEvent?.(event, cursor);
  };

  const connect = () => {
    if (disposed || terminated || typeof WebSocket === "undefined") return;
    clearReconnect();
    const url = new URL("/api/grids/ws", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const next = new WebSocket(url.href);
    socket = next;
    next.onopen = () => {
      reconnectAttempt = 0;
      sendSubscribe();
    };
    next.onmessage = (event) => {
      if (typeof event.data === "string") handleMessage(event.data);
    };
    next.onclose = (event) => {
      if (socket === next) socket = null;
      if (disposed || terminated) return;
      const terminal = terminalCloseError(event);
      if (terminal) {
        terminated = true;
        options.onFatal?.(terminal);
        return;
      }
      const delay = Math.min(10_000, 750 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 250);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = setTimeout(connect, delay);
    };
    next.onerror = () => next.close();
  };

  return {
    connect,
    dispose: () => {
      disposed = true;
      clearReconnect();
      socket?.close();
      socket = null;
    },
  };
};
