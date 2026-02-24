import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { ipa } from "@valentinkolb/cloud/core/services";
import { auth } from "@valentinkolb/cloud/lib/server";
import { logger } from "@valentinkolb/cloud/core/services";

const log = logger("yjs");
import { notebooksService } from "./service";
import * as yjsManager from "./service/yjs-manager";
import type { SessionUser } from "@valentinkolb/cloud/contracts/shared";

// ==========================
// Constants
// ==========================

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ==========================
// Types
// ==========================

type ConnState = {
  user: SessionUser | null;
  noteId: string | null;
  notebookId: string | null;
  peerId: string;
};

// ==========================
// Awareness (per-document, server-side)
// ==========================

const awarenessInstances = new Map<string, awarenessProtocol.Awareness>();

/**
 * Returns the shared awareness instance for a note and creates it on first access.
 */
function getAwareness(noteId: string, doc: Y.Doc): awarenessProtocol.Awareness {
  let awareness = awarenessInstances.get(noteId);
  if (!awareness) {
    awareness = new awarenessProtocol.Awareness(doc);
    awarenessInstances.set(noteId, awareness);
  }
  return awareness;
}

/**
 * Destroys and removes the awareness state when a note has no active subscribers.
 */
function removeAwareness(noteId: string): void {
  const awareness = awarenessInstances.get(noteId);
  if (awareness) {
    awareness.destroy();
    awarenessInstances.delete(noteId);
  }
}

// ==========================
// Helpers
// ==========================

/**
 * Sends a JSON websocket message with a typed envelope.
 */
function sendJson(socket: ServerWebSocket<unknown>, type: string, payload?: unknown) {
  socket.send(JSON.stringify({ type, payload }));
}

/**
 * Sends a standardized error envelope to the websocket client.
 */
function sendError(socket: ServerWebSocket<unknown>, message: string) {
  socket.send(JSON.stringify({ type: "error", payload: { message } }));
}

/**
 * Sends a binary websocket payload (Yjs sync/awareness frames).
 */
function sendBinary(socket: ServerWebSocket<unknown>, data: Uint8Array) {
  socket.send(data);
}

async function resolveUser(sessionToken: string | null): Promise<SessionUser | null> {
  if (!sessionToken) return null;
  const data = await auth.session.getData(sessionToken);
  if (!data) return null;
  return ipa.users.get({ id: data.userId });
}

// ==========================
// Note Join / Leave
// ==========================

async function handleJoin(socket: ServerWebSocket<unknown>, state: ConnState, noteId: string) {
  if (!state.user) {
    return sendError(socket, "Login required");
  }

  const note = await notebooksService.note.get({ id: noteId });
  if (!note) {
    return sendError(socket, "Note not found");
  }

  const hasAccess = await notebooksService.notebook.permission.canAccess({
    notebookId: note.notebookId,
    userId: state.user.id,
    userGroups: state.user.memberofGroup,
    requiredLevel: "read",
  });

  if (!hasAccess) {
    return sendError(socket, "Access denied");
  }

  // Leave previous note if any
  if (state.noteId && state.noteId !== noteId) {
    await handleLeaveInternal(socket, state);
  }

  state.noteId = noteId;
  state.notebookId = note.notebookId;

  socket.subscribe(`note:${noteId}`);
  socket.subscribe(`note:${noteId}:awareness`);

  await yjsManager.addSubscriber(noteId, note.notebookId, state.peerId, state.user.id);

  // Confirm join — client waits for this before sending binary
  sendJson(socket, "note.joined", { noteId });

  const onlineUsers = yjsManager.getOnlineUsers(noteId);
  sendJson(socket, "note.members", { noteId, userIds: onlineUsers });

  socket.publish(
    `note:${noteId}`,
    JSON.stringify({
      type: "note.user-joined",
      payload: {
        noteId,
        userId: state.user.id,
        displayName: state.user.displayName,
      },
    }),
  );

  log.info("User joined note", { uid: state.user.uid, noteId });
}

async function handleLeave(socket: ServerWebSocket<unknown>, state: ConnState, noteId: string) {
  if (state.noteId !== noteId) {
    return sendError(socket, "Not subscribed to this note");
  }
  await handleLeaveInternal(socket, state);
}

async function handleLeaveInternal(socket: ServerWebSocket<unknown>, state: ConnState) {
  if (!state.noteId) return;
  const noteId = state.noteId;

  socket.unsubscribe(`note:${noteId}`);
  socket.unsubscribe(`note:${noteId}:awareness`);

  yjsManager.removeSubscriber(noteId, state.peerId);

  if (yjsManager.getSubscriberCount(noteId) === 0) {
    removeAwareness(noteId);
  }

  if (state.user) {
    socket.publish(
      `note:${noteId}`,
      JSON.stringify({
        type: "note.user-left",
        payload: { noteId, userId: state.user.id },
      }),
    );
  }

  state.noteId = null;
  state.notebookId = null;

  log.info("User left note", { uid: state.user?.uid ?? "anonymous", noteId });
}

// ==========================
// Binary Message Handling
// ==========================

async function handleBinary(socket: ServerWebSocket<unknown>, state: ConnState, data: Uint8Array) {
  if (!state.noteId) {
    return sendError(socket, "Not subscribed to any note");
  }

  const noteId = state.noteId;
  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MSG_SYNC) {
    await handleSyncMessage(socket, state, noteId, decoder, data);
  } else if (messageType === MSG_AWARENESS) {
    handleAwarenessMessage(socket, noteId, decoder);
  } else {
    sendError(socket, `Unknown binary message type: ${messageType}`);
  }
}

async function handleSyncMessage(
  socket: ServerWebSocket<unknown>,
  state: ConnState,
  noteId: string,
  decoder: decoding.Decoder,
  rawMessage: Uint8Array,
) {
  const doc = yjsManager.getDoc(noteId);
  if (!doc) {
    return sendError(socket, "Document not loaded");
  }

  // SyncStep1 is read-only, SyncStep2 and Update require write
  const syncType = decoding.peekVarUint(decoder);

  if (syncType !== syncProtocol.messageYjsSyncStep1) {
    // Check if note is locked
    const note = await notebooksService.note.get({ id: noteId });
    if (note?.lockedAt) {
      return sendError(socket, "Note is locked and cannot be modified");
    }

    const hasWrite = await notebooksService.notebook.permission.canAccess({
      notebookId: state.notebookId!,
      userId: state.user!.id,
      userGroups: state.user!.memberofGroup,
      requiredLevel: "write",
    });
    if (!hasWrite) {
      return sendError(socket, "Write access required");
    }
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);

  const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, null);

  sendBinary(socket, encoding.toUint8Array(encoder));

  if (syncMessageType === syncProtocol.messageYjsSyncStep2 || syncMessageType === syncProtocol.messageYjsUpdate) {
    yjsManager.markDirty(noteId);
    socket.publish(`note:${noteId}`, rawMessage);
  }
}

/**
 * Applies and rebroadcasts awareness updates for presence synchronization.
 */
function handleAwarenessMessage(socket: ServerWebSocket<unknown>, noteId: string, decoder: decoding.Decoder) {
  const awarenessUpdate = decoding.readVarUint8Array(decoder);

  const doc = yjsManager.getDoc(noteId);
  if (doc) {
    const awareness = getAwareness(noteId, doc);
    awarenessProtocol.applyAwarenessUpdate(awareness, awarenessUpdate, null);
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessUpdate);
  const encoded = encoding.toUint8Array(encoder);

  socket.publish(`note:${noteId}:awareness`, encoded);
  sendBinary(socket, encoded);
}

// ==========================
// WebSocket Endpoint
// ==========================

const app = new Hono().get(
  "/",
  upgradeWebSocket((c) => {
    const sessionToken = c.req.query("session_token") ?? null;
    let socket: ServerWebSocket<unknown>;
    let ready: Promise<void>;

    const state: ConnState = {
      user: null,
      noteId: null,
      notebookId: null,
      peerId: crypto.randomUUID(),
    };

    return {
      onOpen(_, ws) {
        socket = ws.raw as ServerWebSocket<unknown>;
        ready = resolveUser(sessionToken).then((user) => {
          state.user = user;
        });
      },

      async onMessage(event) {
        await ready;
        const data = event.data;

        if (data instanceof ArrayBuffer) {
          await handleBinary(socket, state, new Uint8Array(data));
          return;
        }

        let msg: { type: string; payload?: unknown };
        try {
          msg = JSON.parse(data as string);
        } catch {
          return sendError(socket, "Invalid JSON");
        }

        if (!msg.type || typeof msg.type !== "string") {
          return sendError(socket, "Missing message type");
        }

        switch (msg.type) {
          case "note.join": {
            const payload = msg.payload as { noteId?: unknown } | undefined;
            const noteId = payload?.noteId;
            if (!noteId || typeof noteId !== "string") {
              return sendError(socket, "noteId required");
            }
            await handleJoin(socket, state, noteId);
            break;
          }
          case "note.leave": {
            const payload = msg.payload as { noteId?: unknown } | undefined;
            const noteId = payload?.noteId;
            if (!noteId || typeof noteId !== "string") {
              return sendError(socket, "noteId required");
            }
            await handleLeave(socket, state, noteId);
            break;
          }
          default:
            sendError(socket, `Unknown type: ${msg.type}`);
        }
      },

      async onClose() {
        await ready;
        if (state.noteId) {
          await handleLeaveInternal(socket, state);
        }
      },
    };
  }),
);

export default app;
