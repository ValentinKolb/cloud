import type { NotebookPresenceParticipant, User } from "@valentinkolb/cloud/contracts";
import { accounts, logger } from "@valentinkolb/cloud/services";
import { auth } from "@valentinkolb/cloud/server";
import { notebooksYjs } from "./lib/yjs";
import type { TopicLiveEvent } from "@valentinkolb/sync";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import { notebooksService } from "./service";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "./service/presence";
import { yjsSnapshotWorker } from "./service/yjs-snapshot-worker";
import type { YjsTopicEvent } from "./service/yjs-sync";
import { createYjsTopic, maxStreamCursor, NODE_ID, toBase64 } from "./service/yjs-sync";

/**
 * Notebooks realtime websocket (chat-style declarative flow):
 *
 * 1) Client opens socket and sends `notes.yjs.replay.request`.
 * 2) Server validates session + access, sends optional DB snapshot, starts topic stream.
 * 3) During `joined` phase, client may send sync/awareness publishes.
 * 4) Server periodically re-checks auth/access (10s). On terminal mismatch it sends
 *    `notes.yjs.error` with a code and closes the socket.
 *
 * The node is stateless across sockets and relies on the shared topic stream.
 */
const log = logger("yjs");
const WS_TYPE = notebooksYjs.wsType;
const ERROR_CODE = notebooksYjs.errorCode;
type NotebooksYjsErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
type NotebooksYjsErrorPayload = {
  code: NotebooksYjsErrorCode;
  message: string;
  noteId?: string;
};

const SNAPSHOT_INTERVAL_MS = 8_000;
const ACCESS_REFRESH_INTERVAL_MS = 10_000;
const NOTIFY_BATCH_SIZE = 100;
const NOTIFY_BATCH_MAX_BYTES = 256_000;
const NOTIFY_FLUSH_DELAY_MS = 25;
const MAX_PENDING_MESSAGES = 200;
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ReplayRequestMessageSchema = z.object({
  type: z.literal(WS_TYPE.replayRequest),
  payload: z.object({
    // Accepts either a UUID or a 6-char short-id — `evaluateAccess`
    // resolves the form against `notebooks.notes` and stores the
    // canonical UUID in `WsContext.noteId` for everything downstream.
    noteId: z.string().min(6).max(36),
    sessionToken: z.string().min(1).optional(),
    fromCursor: z.string().regex(notebooksYjs.streamCursorPattern).nullable().optional(),
  }),
});

const SyncPublishMessageSchema = z.object({
  type: z.literal(WS_TYPE.syncPublish),
  payload: z.object({
    // Accepts either a UUID or a 6-char short-id — `evaluateAccess`
    // resolves the form against `notebooks.notes` and stores the
    // canonical UUID in `WsContext.noteId` for everything downstream.
    noteId: z.string().min(6).max(36),
    payload: z.string().min(1),
  }),
});

const AwarenessPublishMessageSchema = z.object({
  type: z.literal(WS_TYPE.awarenessPublish),
  payload: z.object({
    // Accepts either a UUID or a 6-char short-id — `evaluateAccess`
    // resolves the form against `notebooks.notes` and stores the
    // canonical UUID in `WsContext.noteId` for everything downstream.
    noteId: z.string().min(6).max(36),
    payload: z.string().min(1),
  }),
});

const ClientMessageSchema = z.discriminatedUnion("type", [
  ReplayRequestMessageSchema,
  SyncPublishMessageSchema,
  AwarenessPublishMessageSchema,
]);

type ClientMessage = z.infer<typeof ClientMessageSchema>;
type WsPhase = "open" | "joined" | "closing";

type WsContext = {
  socket: ServerWebSocket<unknown>;
  phase: WsPhase;
  sessionToken: string | null;
  user: User | null;
  /** Canonical UUID — what every DB call + presence channel uses. */
  noteId: string | null;
  /** The form the client sent on `replayRequest` (UUID or short-id) —
   *  echoed back unchanged in server messages so the client's
   *  `replayReady` matcher converges. Wire-level publishes are
   *  validated against this. */
  wireNoteId: string | null;
  canWrite: boolean;
  peerId: string;
  streamAbort: AbortController | null;
  snapshotInterval: ReturnType<typeof setInterval> | null;
  presenceHeartbeatInterval: ReturnType<typeof setInterval> | null;
  accessRefreshTimeout: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  lastPublishedCursor: string | null;
};

type PresenceChannel = {
  noteId: string;
  members: Set<WsContext>;
  abort: AbortController;
  task: Promise<void>;
};

type AccessEvaluation = {
  ok: boolean;
  code?: NotebooksYjsErrorCode;
  message?: string;
  noteId?: string;
  /** Canonical UUID resolved from the route param (which may have been
   *  a short-id). Set when `ok` is true so callers can store it in
   *  `WsContext.noteId` for the rest of the session. */
  resolvedNoteId?: string;
  canWrite?: boolean;
};

type PushUpdate = {
  cursor: string | null;
  payload: string;
  originPeerId: string | null;
};

type PushMessage = {
  type: typeof WS_TYPE.syncPush | typeof WS_TYPE.awarenessPush;
  noteId: string;
  updates: PushUpdate[];
};

const isWritablePermission = (permission: "none" | "read" | "write" | "admin"): boolean => permission === "write" || permission === "admin";

const createContext = (socket: ServerWebSocket<unknown>): WsContext => ({
  socket,
  phase: "open",
  sessionToken: null,
  user: null,
  noteId: null,
  wireNoteId: null,
  canWrite: false,
  peerId: crypto.randomUUID(),
  streamAbort: null,
  snapshotInterval: null,
  presenceHeartbeatInterval: null,
  accessRefreshTimeout: null,
  dirty: false,
  lastPublishedCursor: null,
});

const presenceChannels = new Map<string, PresenceChannel>();

const send = (socket: ServerWebSocket<unknown>, type: string, payload?: unknown) => {
  try {
    socket.send(JSON.stringify({ type, payload }));
  } catch {
    // Ignore send failures on closed sockets.
  }
};

const warn = (socket: ServerWebSocket<unknown>, code: NotebooksYjsErrorCode, message: string, noteId?: string) => {
  const payload: NotebooksYjsErrorPayload = noteId ? { code, message, noteId } : { code, message };
  send(socket, WS_TYPE.error, payload);
};

const closeCodeForError = (code: NotebooksYjsErrorCode): number => {
  if (code === ERROR_CODE.internalError) return 1011;
  if (code === ERROR_CODE.backpressure) return 1013;
  return 1008;
};

const stopLiveStream = (ctx: WsContext) => {
  if (ctx.streamAbort) ctx.streamAbort.abort();
  ctx.streamAbort = null;
};

const stopSnapshotScheduler = (ctx: WsContext) => {
  if (ctx.snapshotInterval) clearInterval(ctx.snapshotInterval);
  ctx.snapshotInterval = null;
};

const stopPresenceHeartbeat = (ctx: WsContext) => {
  if (ctx.presenceHeartbeatInterval) clearInterval(ctx.presenceHeartbeatInterval);
  ctx.presenceHeartbeatInterval = null;
};

const stopAccessRefresh = (ctx: WsContext) => {
  if (ctx.accessRefreshTimeout) clearTimeout(ctx.accessRefreshTimeout);
  ctx.accessRefreshTimeout = null;
};

const sendPresenceMessage = (
  socket: ServerWebSocket<unknown>,
  type: typeof WS_TYPE.presenceSnapshot | typeof WS_TYPE.presenceChanged,
  noteId: string,
  participants: NotebookPresenceParticipant[],
) => {
  send(socket, type, {
    noteId,
    participants,
  });
};

const broadcastPresence = (
  channel: PresenceChannel,
  type: typeof WS_TYPE.presenceSnapshot | typeof WS_TYPE.presenceChanged,
  participants: NotebookPresenceParticipant[],
) => {
  for (const member of channel.members) {
    if (member.phase !== "joined" || member.noteId !== channel.noteId) continue;
    sendPresenceMessage(member.socket, type, channel.noteId, participants);
  }
};

const broadcastPresenceChanged = async (noteId: string) => {
  const channel = presenceChannels.get(noteId);
  if (!channel || channel.members.size === 0) return;

  const state = await notebooksService.presence.snapshot({ noteId });
  broadcastPresence(channel, WS_TYPE.presenceChanged, state.participants);
};

const runPresenceChannel = async (channel: PresenceChannel): Promise<void> => {
  while (!channel.abort.signal.aborted) {
    try {
      const state = await notebooksService.presence.snapshot({ noteId: channel.noteId });
      const reader = notebooksService.presence.reader({
        noteId: channel.noteId,
        after: state.cursor,
      });

      for await (const event of reader.stream({ signal: channel.abort.signal })) {
        if (channel.abort.signal.aborted) break;
        await broadcastPresenceChanged(channel.noteId);
        if (event.type === "overflow") break;
      }
    } catch (error) {
      if (channel.abort.signal.aborted) break;
      log.error("Presence stream failed", {
        noteId: channel.noteId,
        error: error instanceof Error ? error.message : String(error),
      });
      await Bun.sleep(500);
    }
  }
};

const ensurePresenceChannel = (noteId: string): PresenceChannel => {
  const existing = presenceChannels.get(noteId);
  if (existing) return existing;

  const channel: PresenceChannel = {
    noteId,
    members: new Set<WsContext>(),
    abort: new AbortController(),
    task: Promise.resolve(),
  };
  channel.task = runPresenceChannel(channel).finally(() => {
    const current = presenceChannels.get(noteId);
    if (current === channel && current.members.size === 0) {
      presenceChannels.delete(noteId);
    }
  });
  presenceChannels.set(noteId, channel);
  return channel;
};

const registerPresenceMember = (ctx: WsContext, noteId: string) => {
  ensurePresenceChannel(noteId).members.add(ctx);
};

const unregisterPresenceMember = (ctx: WsContext, noteId: string) => {
  const channel = presenceChannels.get(noteId);
  if (!channel) return;
  channel.members.delete(ctx);
  if (channel.members.size === 0) {
    channel.abort.abort();
    presenceChannels.delete(noteId);
  }
};

const sendPresenceSnapshot = async (ctx: WsContext, noteId: string) => {
  const state = await notebooksService.presence.snapshot({ noteId });
  sendPresenceMessage(ctx.socket, WS_TYPE.presenceSnapshot, noteId, state.participants);
};

const startPresenceHeartbeat = (ctx: WsContext) => {
  stopPresenceHeartbeat(ctx);
  if (ctx.phase !== "joined" || !ctx.noteId || !ctx.user) return;

  ctx.presenceHeartbeatInterval = setInterval(() => {
    const noteId = ctx.noteId;
    const user = ctx.user;
    if (!noteId || !user || ctx.phase !== "joined") return;

    void notebooksService.presence
      .heartbeat({
        noteId,
        peerId: ctx.peerId,
      })
      .then(async (result) => {
        if (result.ok) return;
        await notebooksService.presence.join({
          noteId,
          peerId: ctx.peerId,
          userId: user.id,
          displayName: user.displayName,
        });
      })
      .catch((error) => {
        log.warn("Presence heartbeat failed", {
          noteId,
          peerId: ctx.peerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, PRESENCE_HEARTBEAT_INTERVAL_MS);
};

const queueSnapshotIfNeeded = async (ctx: WsContext, reason: "periodic" | "unload") => {
  if (!ctx.noteId || !ctx.dirty || !ctx.lastPublishedCursor) return;

  try {
    await yjsSnapshotWorker.queueSnapshotSave({
      noteId: ctx.noteId,
      targetCursor: ctx.lastPublishedCursor,
      reason,
    });
    ctx.dirty = false;
    stopSnapshotScheduler(ctx);
    log.debug("Queued snapshot save", {
      noteId: ctx.noteId,
      cursor: ctx.lastPublishedCursor,
      reason,
    });
  } catch (error) {
    log.error("Failed to queue snapshot save", {
      noteId: ctx.noteId,
      cursor: ctx.lastPublishedCursor,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const startSnapshotScheduler = (ctx: WsContext) => {
  if (ctx.snapshotInterval) return;
  ctx.snapshotInterval = setInterval(() => {
    void queueSnapshotIfNeeded(ctx, "periodic");
  }, SNAPSHOT_INTERVAL_MS);
};

const leaveCurrentNote = async (ctx: WsContext) => {
  const noteId = ctx.noteId;
  await queueSnapshotIfNeeded(ctx, "unload");
  stopAccessRefresh(ctx);
  stopSnapshotScheduler(ctx);
  stopPresenceHeartbeat(ctx);
  stopLiveStream(ctx);
  if (noteId) {
    unregisterPresenceMember(ctx, noteId);
    try {
      await notebooksService.presence.leave({
        noteId,
        peerId: ctx.peerId,
        reason: ctx.phase === "closing" ? "socket-close" : "note-leave",
      });
      await broadcastPresenceChanged(noteId);
    } catch (error) {
      log.warn("Failed to leave presence", {
        noteId,
        peerId: ctx.peerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  ctx.noteId = null;
  ctx.canWrite = false;
  ctx.dirty = false;
  ctx.lastPublishedCursor = null;
  if (ctx.phase !== "closing") {
    ctx.phase = "open";
  }
};

const fatal = async (ctx: WsContext, code: NotebooksYjsErrorCode, message: string, noteId?: string) => {
  if (ctx.phase === "closing") return;
  ctx.phase = "closing";
  warn(ctx.socket, code, message, noteId);
  await leaveCurrentNote(ctx);
  ctx.socket.close(closeCodeForError(code), code);
};

const ensureValidBase64 = (payload: string): boolean => payload.length > 0 && payload.length % 4 === 0 && BASE64_REGEX.test(payload);

const resolveSessionUser = async (sessionToken: string | null): Promise<User | null> => {
  if (!sessionToken) return null;
  const session = await auth.session.getData(sessionToken);
  if (!session) return null;
  return accounts.users.get({ id: session.userId });
};

const evaluateAccess = async (
  noteIdOrShortId: string,
  user: User,
  mode: "read" | "write",
  deniedCode: NotebooksYjsErrorCode,
): Promise<AccessEvaluation> => {
  // Route param may be a UUID or a 6-char short-id — same boundary
  // resolution as the HTTP API. From here on we work with the
  // canonical UUID `note.id`.
  const note = await notebooksService.note.getByIdOrShortId({ idOrShortId: noteIdOrShortId });
  if (!note) {
    return {
      ok: false,
      code: ERROR_CODE.noteNotFound,
      message: "Note not found",
      noteId: noteIdOrShortId,
    };
  }

  const permission = await notebooksService.notebook.permission.get({
    notebookId: note.notebookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  if (permission === "none") {
    return {
      ok: false,
      code: deniedCode,
      message: deniedCode === ERROR_CODE.accessRevoked ? "Access was revoked" : "Access denied",
      noteId: note.id,
    };
  }

  const canWrite = isWritablePermission(permission);
  if (mode === "write" && !canWrite) {
    return {
      ok: false,
      code: ERROR_CODE.accessDenied,
      message: "Write access required",
      noteId: note.id,
    };
  }

  if (note.lockedAt) {
    return {
      ok: false,
      code: ERROR_CODE.noteLocked,
      message: "Note is locked",
      noteId: note.id,
    };
  }

  return {
    ok: true,
    resolvedNoteId: note.id,
    canWrite,
  };
};

const refreshJoinedAccess = async (ctx: WsContext): Promise<AccessEvaluation> => {
  if (!ctx.noteId) {
    return {
      ok: false,
      code: ERROR_CODE.noteNotFound,
      message: "Note not found",
    };
  }

  const user = await resolveSessionUser(ctx.sessionToken);
  if (!user) {
    return {
      ok: false,
      code: ERROR_CODE.sessionExpired,
      message: "Session expired",
      noteId: ctx.noteId,
    };
  }

  const access = await evaluateAccess(ctx.noteId, user, "read", ERROR_CODE.accessRevoked);
  if (!access.ok) return access;
  ctx.user = user;
  ctx.canWrite = access.canWrite ?? false;
  return access;
};

const startAccessRefresh = (ctx: WsContext) => {
  stopAccessRefresh(ctx);
  if (ctx.phase !== "joined" || !ctx.noteId) return;

  ctx.accessRefreshTimeout = setTimeout(async () => {
    if (ctx.phase !== "joined") return;
    try {
      const access = await refreshJoinedAccess(ctx);
      if (!access.ok) {
        await fatal(
          ctx,
          access.code ?? ERROR_CODE.internalError,
          access.message ?? "Access refresh failed",
          access.noteId ?? ctx.noteId ?? undefined,
        );
        return;
      }
      startAccessRefresh(ctx);
    } catch (error) {
      log.error("Access refresh failed", {
        noteId: ctx.noteId,
        error: error instanceof Error ? error.message : String(error),
      });
      await fatal(ctx, ERROR_CODE.internalError, "Access refresh failed", ctx.noteId ?? undefined);
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

const markDirty = (ctx: WsContext, cursor: string) => {
  ctx.lastPublishedCursor = maxStreamCursor(ctx.lastPublishedCursor, cursor);
  ctx.dirty = true;
  startSnapshotScheduler(ctx);
};

const toPushUpdate = (event: TopicLiveEvent<YjsTopicEvent>): PushUpdate => ({
  cursor: event.cursor,
  payload: event.data.payload,
  originPeerId: event.data.originPeerId,
});

const pushTypeForKind = (kind: YjsTopicEvent["kind"]): typeof WS_TYPE.syncPush | typeof WS_TYPE.awarenessPush =>
  kind === "sync" ? WS_TYPE.syncPush : WS_TYPE.awarenessPush;

const startLiveStream = (ctx: WsContext, noteId: string, afterCursor: string | null) => {
  stopLiveStream(ctx);
  const abort = new AbortController();
  ctx.streamAbort = abort;

  void (async () => {
    const noteTopic = createYjsTopic(noteId);
    const pending: PushMessage[] = [];
    let pendingEvents = 0;
    let pendingBytes = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      for (const entry of batch) {
        send(ctx.socket, entry.type, { noteId: entry.noteId, updates: entry.updates });
      }
      pendingEvents = 0;
      pendingBytes = 0;
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, NOTIFY_FLUSH_DELAY_MS);
    };

    try {
      for await (const event of noteTopic.live({
        // `"0-0"` = Redis Streams "from the very beginning" sentinel —
        // when there's no DB cursor yet (fresh note, snapshot worker
        // hasn't fired) we still need to replay every topic event the
        // user produced before reconnecting. Passing `undefined` would
        // fall through to `@valentinkolb/sync`'s default of `"$"`,
        // which means "deliver only NEW events from now on" and
        // silently drops the in-flight history. Mirrors the pattern
        // used by `yjs-snapshot-worker.ts:waitUntilTargetCursor`.
        after: afterCursor ?? "0-0",
        signal: abort.signal,
      })) {
        if (ctx.phase !== "joined" || ctx.noteId !== noteId) break;
        const update = toPushUpdate(event);
        const type = pushTypeForKind(event.data.kind);

        if (event.data.kind === "sync") {
          ctx.lastPublishedCursor = maxStreamCursor(ctx.lastPublishedCursor, event.cursor);
        }

        const lastPending = pending.at(-1);
        if (lastPending && lastPending.type === type && lastPending.noteId === noteId) {
          lastPending.updates.push(update);
        } else {
          pending.push({ type, noteId, updates: [update] });
        }

        pendingEvents++;
        pendingBytes += update.payload.length;
        if (pendingEvents >= NOTIFY_BATCH_SIZE || pendingBytes >= NOTIFY_BATCH_MAX_BYTES) {
          flush();
        } else {
          scheduleFlush();
        }
      }
      flush();
    } catch (error) {
      if (!abort.signal.aborted) {
        log.error("Yjs live stream failed", {
          noteId,
          error: error instanceof Error ? error.message : String(error),
        });
        await fatal(ctx, ERROR_CODE.internalError, "Live sync stream failed", noteId);
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      if (ctx.streamAbort === abort) {
        ctx.streamAbort = null;
      }
    }
  })();
};

const ensurePhase = (ctx: WsContext, allowedTypes: readonly string[], attemptedType: string): boolean => {
  if (allowedTypes.includes(attemptedType)) return true;
  warn(ctx.socket, ERROR_CODE.invalidMessage, `Message "${attemptedType}" is not allowed in phase "${ctx.phase}"`);
  return false;
};

const ensureJoinedNote = (ctx: WsContext, wireNoteId: string): boolean => {
  // Compare against `wireNoteId` (the form the client sent at join
  // time) — `ctx.noteId` is the canonical UUID we use for DB calls
  // and may differ from what the client sent if they used a short-id.
  if (ctx.phase !== "joined" || !ctx.wireNoteId || ctx.wireNoteId !== wireNoteId) {
    warn(ctx.socket, ERROR_CODE.invalidPayload, "Replay request required before publishing", wireNoteId);
    return false;
  }
  return true;
};

const ensureWritableNote = (ctx: WsContext, noteId: string): boolean => {
  if (!ctx.canWrite) {
    warn(ctx.socket, ERROR_CODE.accessDenied, "Write access required", noteId);
    return false;
  }
  return true;
};

const handleReplayRequest = async (ctx: WsContext, payload: z.infer<typeof ReplayRequestMessageSchema.shape.payload>) => {
  if (payload.sessionToken) ctx.sessionToken = payload.sessionToken;

  const user = await resolveSessionUser(ctx.sessionToken);
  if (!user) {
    await fatal(ctx, ERROR_CODE.loginRequired, "Login required", payload.noteId);
    return;
  }

  const access = await evaluateAccess(payload.noteId, user, "read", ERROR_CODE.accessDenied);
  if (!access.ok) {
    await fatal(ctx, access.code ?? ERROR_CODE.accessDenied, access.message ?? "Access denied", access.noteId ?? payload.noteId);
    return;
  }
  // Wire-level convention: the server emits canonical UUIDs in every
  // message it sends, including the response to `replayRequest`. The
  // client (`provider.ts`) starts with whatever form the caller passed
  // (UUID or short-id) and adopts the server's canonical form on
  // first `replayReady`. Subsequent client→server messages then use
  // the canonical UUID, so both sides agree on a single per-message
  // `payload.noteId` value for the rest of the session.
  const dbNoteId = access.resolvedNoteId!;

  if (ctx.noteId && ctx.noteId !== dbNoteId) {
    await leaveCurrentNote(ctx);
  }

  ctx.phase = "joined";
  ctx.user = user;
  ctx.noteId = dbNoteId;
  ctx.wireNoteId = dbNoteId; // converged
  ctx.canWrite = access.canWrite ?? false;

  registerPresenceMember(ctx, dbNoteId);
  await notebooksService.presence.join({
    noteId: dbNoteId,
    peerId: ctx.peerId,
    userId: user.id,
    displayName: user.displayName,
  });
  await sendPresenceSnapshot(ctx, dbNoteId);
  await broadcastPresenceChanged(dbNoteId);
  startPresenceHeartbeat(ctx);

  let replayCursor = payload.fromCursor ?? null;
  if (!replayCursor) {
    const snapshot = await notebooksService.note.getYjsStateWithCursor({ noteId: dbNoteId });
    if (snapshot?.yjsState) {
      send(ctx.socket, WS_TYPE.syncPush, {
        noteId: dbNoteId,
        updates: [
          {
            cursor: snapshot.streamCursor,
            payload: toBase64(snapshot.yjsState),
            originPeerId: null,
          },
        ],
      });
    }
    replayCursor = snapshot?.streamCursor ?? null;
  }

  startLiveStream(ctx, dbNoteId, replayCursor);
  startAccessRefresh(ctx);
  send(ctx.socket, WS_TYPE.replayReady, { noteId: dbNoteId });
  log.debug("Replay stream started", {
    noteId: dbNoteId,
    peerId: ctx.peerId,
    fromCursor: replayCursor,
  });
};

const handleSyncPublish = async (ctx: WsContext, payload: z.infer<typeof SyncPublishMessageSchema.shape.payload>) => {
  if (!ensureJoinedNote(ctx, payload.noteId)) return;
  if (!ensureWritableNote(ctx, payload.noteId)) return;
  if (!ensureValidBase64(payload.payload)) {
    warn(ctx.socket, ERROR_CODE.invalidPayload, "Invalid base64 payload", payload.noteId);
    return;
  }

  // Topic key is the canonical UUID — peers may have joined with
  // either form but they all converge on the same per-note topic.
  const noteTopic = createYjsTopic(ctx.noteId!);
  const published = await noteTopic.pub({
    data: {
      kind: "sync",
      payload: payload.payload,
      originNodeId: NODE_ID,
      originPeerId: ctx.peerId,
    },
  });

  markDirty(ctx, published.cursor);
};

const handleAwarenessPublish = async (ctx: WsContext, payload: z.infer<typeof AwarenessPublishMessageSchema.shape.payload>) => {
  if (!ensureJoinedNote(ctx, payload.noteId)) return;
  if (!ensureValidBase64(payload.payload)) {
    warn(ctx.socket, ERROR_CODE.invalidPayload, "Invalid base64 payload", payload.noteId);
    return;
  }

  const noteTopic = createYjsTopic(ctx.noteId!);
  await noteTopic.pub({
    data: {
      kind: "awareness",
      payload: payload.payload,
      originNodeId: NODE_ID,
      originPeerId: ctx.peerId,
    },
  });
};

const handlers = {
  [WS_TYPE.replayRequest]: handleReplayRequest,
  [WS_TYPE.syncPublish]: handleSyncPublish,
  [WS_TYPE.awarenessPublish]: handleAwarenessPublish,
} satisfies {
  [K in ClientMessage["type"]]: (ctx: WsContext, payload: Extract<ClientMessage, { type: K }>["payload"]) => Promise<void>;
};

const allowedTypesByPhase: Record<WsPhase, readonly ClientMessage["type"][]> = {
  open: [WS_TYPE.replayRequest],
  joined: [WS_TYPE.replayRequest, WS_TYPE.syncPublish, WS_TYPE.awarenessPublish],
  closing: [],
};

const dispatchClientMessage = async (ctx: WsContext, message: ClientMessage) => {
  if (message.type === WS_TYPE.replayRequest) {
    await handlers[WS_TYPE.replayRequest](ctx, message.payload);
    return;
  }
  if (message.type === WS_TYPE.syncPublish) {
    await handlers[WS_TYPE.syncPublish](ctx, message.payload);
    return;
  }
  await handlers[WS_TYPE.awarenessPublish](ctx, message.payload);
};

const handleClientMessage = async (ctx: WsContext, raw: string): Promise<void> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(ctx.socket, ERROR_CODE.invalidJson, "Invalid JSON payload");
    return;
  }

  const message = ClientMessageSchema.safeParse(parsed);
  if (!message.success) {
    warn(ctx.socket, ERROR_CODE.invalidMessage, "Invalid message payload");
    return;
  }

  if (!ensurePhase(ctx, allowedTypesByPhase[ctx.phase], message.data.type)) return;
  await dispatchClientMessage(ctx, message.data);
};

const app = new Hono().get(
  "/",
  upgradeWebSocket(() => {
    let ctx: WsContext | null = null;
    let processing: Promise<void> = Promise.resolve();
    let pendingMessages = 0;

    return {
      onOpen(_, ws) {
        ctx = createContext(ws.raw as ServerWebSocket<unknown>);
      },

      async onMessage(event) {
        if (!ctx) return;
        if (ctx.phase === "closing") return;
        if (typeof event.data !== "string") {
          warn(ctx.socket, ERROR_CODE.invalidMessage, "Only JSON text messages are supported");
          return;
        }

        if (pendingMessages >= MAX_PENDING_MESSAGES) {
          await fatal(ctx, ERROR_CODE.backpressure, "Too many pending websocket messages", ctx.noteId ?? undefined);
          return;
        }

        pendingMessages++;
        const raw = event.data;
        const currentCtx = ctx;
        processing = processing
          .then(() => handleClientMessage(currentCtx, raw))
          .catch(async (error) => {
            log.error("Websocket message handling failed", {
              noteId: currentCtx.noteId,
              error: error instanceof Error ? error.message : String(error),
            });
            await fatal(currentCtx, ERROR_CODE.internalError, "Message handling failed", currentCtx.noteId ?? undefined);
          })
          .finally(() => {
            pendingMessages = Math.max(0, pendingMessages - 1);
          });
      },

      async onClose() {
        if (!ctx) return;
        await processing.catch(() => undefined);
        if (ctx.phase === "closing") return;
        ctx.phase = "closing";
        await leaveCurrentNote(ctx);
      },
    };
  }),
);

export default app;
