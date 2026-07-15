import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { onCleanup, onMount } from "solid-js";
import { type NotebookWorkspaceEvent, notebooksWorkspace } from "../../../../lib/workspace-events";
import { WORKSPACE_EVENT } from "./workspace-events";

type Props = {
  notebookId: string;
  appUrl: string;
  sessionToken: string;
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
    let lastCursor: string | null = null;

    const connect = () => {
      if (disposed) return;
      const wsUrl = new URL("/api/notebooks/ws", resolveHttpBaseUrl(props.appUrl));
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(wsUrl.href);
      socket = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: notebooksWorkspace.wsType.subscribe,
            payload: { notebookId: props.notebookId, fromCursor: lastCursor, sessionToken: props.sessionToken },
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
        const value = parsed as { type?: unknown; payload?: { cursor?: unknown; event?: unknown } };
        if (value.type === notebooksWorkspace.wsType.revoked) {
          disposed = true;
          refreshCurrentPath();
          return;
        }
        if (value.type !== notebooksWorkspace.wsType.event) return;
        if (typeof value.payload?.cursor === "string") lastCursor = value.payload.cursor;
        const event = value.payload?.event as NotebookWorkspaceEvent | undefined;
        if (!event || event.v !== 1) return;
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_EVENT, {
            detail: {
              cursor: typeof value.payload?.cursor === "string" ? value.payload.cursor : null,
              event,
            },
          }),
        );
      };

      ws.onclose = (event) => {
        if (socket === ws) socket = undefined;
        if (disposed) return;
        if (event.code === 1008) {
          disposed = true;
          refreshCurrentPath();
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
