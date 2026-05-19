import { onCleanup, onMount } from "solid-js";
import { notebooksWorkspace, type NotebookWorkspaceEvent } from "../../../../lib/workspace-events";
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
    const wsUrl = new URL("/api/notebooks/ws", resolveHttpBaseUrl(props.appUrl));
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(wsUrl.href);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: notebooksWorkspace.wsType.subscribe,
          payload: { notebookId: props.notebookId, sessionToken: props.sessionToken },
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
      if (value.type !== notebooksWorkspace.wsType.event) return;
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

    onCleanup(() => ws.close());
  });

  return null;
}
