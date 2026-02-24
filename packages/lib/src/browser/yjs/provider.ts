import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export type YjsProviderOptions = {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  noteId: string;
  appUrl: string;
  sessionToken: string;
  onMembersChange?: (userIds: string[]) => void;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (message: string) => void;
};

export function createYjsProvider(opts: YjsProviderOptions) {
  const { doc, awareness, noteId, appUrl } = opts;
  let ws: WebSocket | null = null;
  let isDisposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isSynced = false;

  const sendJson = (type: string, payload?: unknown) => ws?.send(JSON.stringify({ type, payload }));

  const sendBinary = (data: Uint8Array) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  };

  // --- Sync protocol helpers ---

  const handleSyncMessage = (decoder: decoding.Decoder) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");

    if (encoding.length(encoder) > 1) {
      sendBinary(encoding.toUint8Array(encoder));
    }

    if (syncMessageType === syncProtocol.messageYjsSyncStep2 && !isSynced) {
      isSynced = true;
    }
  };

  const handleAwarenessMessage = (decoder: decoding.Decoder) => {
    const update = decoding.readVarUint8Array(decoder);
    awarenessProtocol.applyAwarenessUpdate(awareness, update, "remote");
  };

  const handleBinaryMessage = (data: ArrayBuffer) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MSG_SYNC) {
        handleSyncMessage(decoder);
        return;
      }
      if (messageType === MSG_AWARENESS) {
        handleAwarenessMessage(decoder);
        return;
      }
    } catch {
      // Ignore malformed frames to keep collaborative editing resilient.
    }
  };

  const startSync = () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    sendBinary(encoding.toUint8Array(encoder));

    if (awareness.getLocalState() !== null) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]));
      sendBinary(encoding.toUint8Array(awarenessEncoder));
    }

    const updateEncoder = encoding.createEncoder();
    encoding.writeVarUint(updateEncoder, MSG_SYNC);
    syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc));
    sendBinary(encoding.toUint8Array(updateEncoder));
  };

  const handleJsonMessage = (msg: { type: string; payload?: any }) => {
    switch (msg.type) {
      case "note.joined":
        startSync();
        break;
      case "note.members":
        opts.onMembersChange?.(msg.payload.userIds);
        break;
      case "error":
        opts.onError?.(msg.payload?.message ?? "Unknown error");
        break;
    }
  };

  // --- Doc update listener ---

  const onDocUpdate = (update: Uint8Array, origin: any) => {
    if (origin === "remote") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    sendBinary(encoding.toUint8Array(encoder));
  };

  // --- Awareness update listener ---

  const onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
    sendBinary(encoding.toUint8Array(encoder));
  };

  // --- Connection ---

  const connect = () => {
    if (isDisposed) return;
    isSynced = false;

    const protocol = appUrl.startsWith("https") ? "wss:" : "ws:";
    const host = appUrl.replace(/^https?:\/\//, "");
    ws = new WebSocket(`${protocol}//${host}/ws?session_token=${opts.sessionToken}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      opts.onConnectionChange?.(true);
      sendJson("note.join", { noteId });
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        handleBinaryMessage(event.data);
        return;
      }
      if (event.data instanceof Blob) {
        event.data
          .arrayBuffer()
          .then(handleBinaryMessage)
          .catch(() => {});
        return;
      }
      try {
        handleJsonMessage(JSON.parse(event.data as string));
      } catch {
        /* ignore parse errors */
      }
    };

    ws.onclose = () => {
      opts.onConnectionChange?.(false);
      isSynced = false;
      if (!isDisposed) reconnectTimer = setTimeout(connect, 2000);
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
        sendJson("note.leave", { noteId });
        ws.close();
        ws = null;
      }
    },
  };
}
