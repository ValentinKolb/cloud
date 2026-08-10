import { refreshCurrentPath } from "@k2b/ssr/nav";
import { onCleanup, onMount } from "solid-js";
import { type NotebookWorkspaceEvent, notebooksWorkspace } from "../../../../lib/workspace-events";
import { dispatchWorkspaceEvent } from "./workspace-events";

type Props = {
  notebookId: string;
  appUrl: string;
  initialCursor: string | null;
};

const resolveHttpBaseUrl = (raw: string): URL => {
  const value = raw.trim();
  const browserOrigin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost:3000";
  if (!value) return new URL(browserOrigin);
  if (/^https?:\/\//i.test(value)) return new URL(value);
  if (value.startsWith("/")) return new URL(value, browserOrigin);
  return new URL(`${new URL(browserOrigin).protocol}//${value}`);
};

export default function WorkspaceEventBridge(props: Props) {
  onMount(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let lastCursor = props.initialCursor;
    let eventQueue = Promise.resolve();
    let generation = 0;
    let activeWorkspaceId = props.notebookId;

    const terminateAndRefresh = () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      refreshCurrentPath();
    };

    const connect = () => {
      if (disposed) return;
      generation += 1;
      const socketGeneration = generation;
      eventQueue = Promise.resolve();
      const wsUrl = new URL("/api/notebooks/ws", resolveHttpBaseUrl(props.appUrl));
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(wsUrl.href);
      socket = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: notebooksWorkspace.wsType.subscribe,
            payload: { notebookId: props.notebookId, fromCursor: lastCursor },
          }),
        );
      };

      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data);
        } catch {
          return;
        }
        const value = parsed as {
          type?: unknown;
          payload?: { notebookId?: unknown; cursor?: unknown; event?: unknown; code?: unknown };
        };
        if (value.type === notebooksWorkspace.wsType.revoked) {
          terminateAndRefresh();
          return;
        }
        if (value.type === notebooksWorkspace.wsType.error) {
          const code = value.payload?.code;
          if (
            code === "LOGIN_REQUIRED" ||
            code === "SESSION_EXPIRED" ||
            code === "ACCESS_DENIED" ||
            code === "ACCESS_REVOKED" ||
            code === "NOTE_NOT_FOUND"
          ) {
            terminateAndRefresh();
          } else {
            ws.close();
          }
          return;
        }
        if (value.type === notebooksWorkspace.wsType.ready) {
          if (typeof value.payload?.notebookId === "string") activeWorkspaceId = value.payload.notebookId;
          return;
        }
        if (value.type !== notebooksWorkspace.wsType.event) return;
        if (value.payload?.notebookId !== activeWorkspaceId) return;
        const event = value.payload?.event as NotebookWorkspaceEvent | undefined;
        if (!event || event.v !== 1 || event.notebookId !== activeWorkspaceId) return;
        const cursor = typeof value.payload?.cursor === "string" ? value.payload.cursor : null;
        eventQueue = eventQueue
          .then(async () => {
            if (disposed || socketGeneration !== generation) return;
            await dispatchWorkspaceEvent(event, cursor);
            if (socketGeneration === generation && cursor) lastCursor = cursor;
          })
          .catch(() => {
            if (!disposed && socketGeneration === generation) ws.close();
          });
      };

      ws.onclose = (event) => {
        if (socket === ws) socket = undefined;
        if (disposed) return;
        if (event.code === 1008) {
          terminateAndRefresh();
          return;
        }
        reconnectTimer = setTimeout(connect, 2_000 + Math.floor(Math.random() * 1_500));
      };

      ws.onerror = () => ws.close();
    };

    connect();
    onCleanup(() => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    });
  });

  return null;
}
