import { auth, hasPermission } from "@valentinkolb/cloud/server";
import { accounts, logger } from "@valentinkolb/cloud/services";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { SPACE_LIVE_WS_TYPE, SpaceLiveClientMessageSchema, type SpaceLiveServerMessage } from "./live-events";
import { spacesService } from "./service";
import { latestSpaceEventCursor, liveSpaceEvents } from "./service/events";

const log = logger("spaces:websocket");
const ACCESS_REFRESH_INTERVAL_MS = 8_000;
const MAX_CLIENT_MESSAGE_LENGTH = 16_000;
const MAX_PENDING_MESSAGES = 8;

type WsPhase = "open" | "subscribed" | "closing";

type WsContext = {
  socket: ServerWebSocket<unknown>;
  sessionToken: string | null;
  phase: WsPhase;
  spaceId: string | null;
  streamAbort: AbortController | null;
  accessRefreshTimer: ReturnType<typeof setTimeout> | null;
};

type AccessResult = { ok: true } | { ok: false; code: "login_required" | "not_found" | "access_denied"; message: string };

const createContext = (socket: ServerWebSocket<unknown>, sessionToken: string | null): WsContext => ({
  socket,
  sessionToken,
  phase: "open",
  spaceId: null,
  streamAbort: null,
  accessRefreshTimer: null,
});

const isClosing = (ctx: WsContext): boolean => ctx.phase === "closing";

const send = (socket: ServerWebSocket<unknown>, message: SpaceLiveServerMessage): boolean => {
  try {
    return socket.send(JSON.stringify(message)) > 0;
  } catch {
    return false;
  }
};

const stopStream = (ctx: WsContext) => {
  ctx.streamAbort?.abort();
  ctx.streamAbort = null;
};

const stopAccessRefresh = (ctx: WsContext) => {
  if (ctx.accessRefreshTimer) clearTimeout(ctx.accessRefreshTimer);
  ctx.accessRefreshTimer = null;
};

const stopSubscription = (ctx: WsContext) => {
  stopAccessRefresh(ctx);
  stopStream(ctx);
  ctx.spaceId = null;
};

const closeWithError = (ctx: WsContext, code: string, message: string, closeCode: number) => {
  if (ctx.phase === "closing") return;
  const spaceId = ctx.spaceId ?? undefined;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, { type: SPACE_LIVE_WS_TYPE.error, payload: { spaceId, code, message } });
  ctx.socket.close(closeCode, code);
};

const revoke = (ctx: WsContext, spaceId: string, access: Exclude<AccessResult, { ok: true }>) => {
  if (ctx.phase === "closing") return;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, {
    type: SPACE_LIVE_WS_TYPE.revoked,
    payload: { spaceId, code: access.code, message: access.message },
  });
  ctx.socket.close(1008, access.code);
};

const evaluateAccess = async (sessionToken: string | null, spaceId: string): Promise<AccessResult> => {
  if (!sessionToken) return { ok: false, code: "login_required", message: "Login required" };
  const session = await auth.session.getData(sessionToken);
  if (!session) return { ok: false, code: "login_required", message: "Login required" };
  const user = await accounts.users.get({ id: session.userId });
  if (!user) return { ok: false, code: "login_required", message: "Login required" };

  const space = await spacesService.space.get({ id: spaceId });
  if (!space) return { ok: false, code: "not_found", message: "Space not found" };
  const permission = await spacesService.space.permission.get({
    spaceId,
    subject: { type: "user", userId: user.id },
  });
  return hasPermission(permission, "read") ? { ok: true } : { ok: false, code: "access_denied", message: "Access denied" };
};

const startAccessRefresh = (ctx: WsContext, spaceId: string) => {
  stopAccessRefresh(ctx);
  ctx.accessRefreshTimer = setTimeout(async () => {
    if (ctx.phase !== "subscribed" || ctx.spaceId !== spaceId) return;
    try {
      const access = await evaluateAccess(ctx.sessionToken, spaceId);
      if (ctx.phase !== "subscribed" || ctx.spaceId !== spaceId) return;
      if (!access.ok) {
        revoke(ctx, spaceId, access);
        return;
      }
      startAccessRefresh(ctx, spaceId);
    } catch (error) {
      if (ctx.phase !== "subscribed" || ctx.spaceId !== spaceId) return;
      log.error("Space WebSocket access refresh failed", {
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "internal_error", "Access refresh failed", 1011);
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

const startStream = (ctx: WsContext, spaceId: string, after: string) => {
  stopStream(ctx);
  const abort = new AbortController();
  ctx.streamAbort = abort;

  void (async () => {
    try {
      for await (const event of liveSpaceEvents({ spaceId, after, signal: abort.signal })) {
        if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.spaceId !== spaceId) break;
        const access = await evaluateAccess(ctx.sessionToken, spaceId);
        if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.spaceId !== spaceId) break;
        if (!access.ok) {
          revoke(ctx, spaceId, access);
          break;
        }
        if (
          !send(ctx.socket, {
            type: SPACE_LIVE_WS_TYPE.event,
            payload: { spaceId, cursor: event.cursor, event: event.data },
          })
        ) {
          closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
          break;
        }
      }
    } catch (error) {
      if (abort.signal.aborted || ctx.phase === "closing") return;
      log.error("Space WebSocket event stream failed", {
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "stream_failed", "Space event stream failed", 1012);
    } finally {
      if (ctx.streamAbort === abort) ctx.streamAbort = null;
    }
  })();
};

const handleSubscribe = async (ctx: WsContext, spaceId: string, fromCursor: string | null) => {
  if (isClosing(ctx)) return;
  const access = await evaluateAccess(ctx.sessionToken, spaceId);
  if (isClosing(ctx)) return;
  if (!access.ok) {
    ctx.spaceId = spaceId;
    revoke(ctx, spaceId, access);
    return;
  }

  const cursor = fromCursor ?? (await latestSpaceEventCursor(spaceId)) ?? "0-0";
  if (isClosing(ctx)) return;
  stopSubscription(ctx);
  ctx.phase = "subscribed";
  ctx.spaceId = spaceId;
  if (!send(ctx.socket, { type: SPACE_LIVE_WS_TYPE.ready, payload: { spaceId, cursor } })) {
    closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
    return;
  }
  startStream(ctx, spaceId, cursor);
  startAccessRefresh(ctx, spaceId);
};

const handleMessage = async (ctx: WsContext, raw: string) => {
  if (isClosing(ctx)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    closeWithError(ctx, "invalid_json", "Invalid JSON payload", 1008);
    return;
  }
  const message = SpaceLiveClientMessageSchema.safeParse(parsed);
  if (!message.success) {
    closeWithError(ctx, "invalid_message", "Invalid live subscription", 1008);
    return;
  }
  await handleSubscribe(ctx, message.data.payload.spaceId, message.data.payload.fromCursor);
};

const app = new Hono().get(
  "/",
  upgradeWebSocket((c) => {
    const sessionToken = auth.session.getToken(c);
    let ctx: WsContext | null = null;
    let processing: Promise<void> = Promise.resolve();
    let pendingMessages = 0;

    return {
      onOpen(_, ws) {
        ctx = createContext(ws.raw as ServerWebSocket<unknown>, sessionToken);
      },
      onMessage(event) {
        if (!ctx || ctx.phase === "closing") return;
        if (typeof event.data !== "string" || event.data.length > MAX_CLIENT_MESSAGE_LENGTH) {
          closeWithError(ctx, "invalid_message", "Invalid live subscription", 1008);
          return;
        }
        if (pendingMessages >= MAX_PENDING_MESSAGES) {
          closeWithError(ctx, "backpressure", "Too many pending live messages", 1013);
          return;
        }

        pendingMessages++;
        const current = ctx;
        const raw = event.data;
        processing = processing
          .then(() => handleMessage(current, raw))
          .catch((error) => {
            log.error("Space WebSocket message handling failed", {
              spaceId: current.spaceId,
              error: error instanceof Error ? error.message : String(error),
            });
            closeWithError(current, "internal_error", "Live subscription failed", 1011);
          })
          .finally(() => {
            pendingMessages = Math.max(0, pendingMessages - 1);
          });
      },
      async onClose() {
        if (!ctx) return;
        ctx.phase = "closing";
        stopSubscription(ctx);
        await processing.catch(() => undefined);
      },
    };
  }),
);

export default app;
