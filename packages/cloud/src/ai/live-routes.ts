import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { getCookie } from "hono/cookie";
import { type AuthContext, auth } from "../server";
import { isAccountExpired } from "../services/account-model";
import { accounts } from "../services/accounts";
import { logger } from "../services/logging";
import {
  AI_LIVE_WS_TYPE,
  type AiInvalidation,
  AiInvalidationSchema,
  AiLiveClientMessageSchema,
  AiLiveCursorSchema,
  type AiLiveErrorCode,
  type AiLiveServerMessage,
} from "./live-events";
import { latestAiInvalidationCursor, liveAiInvalidations } from "./live-outbox";

const log = logger("ai:live-routes");
const AUTH_REFRESH_INTERVAL_MS = 8_000;
const MAX_CLIENT_MESSAGE_LENGTH = 8_000;
const MAX_PENDING_MESSAGES = 8;

type LiveUser = { id: string };
type WsPhase = "open" | "subscribed" | "closing";

type WsContext = {
  socket: ServerWebSocket<unknown>;
  sessionToken: string | null;
  phase: WsPhase;
  userId: string | null;
  streamAbort: AbortController | null;
  authRefreshTimer: ReturnType<typeof setTimeout> | null;
  scopeVersion: string | null;
};

export type AiLiveRoutesConfig = {
  resolveLiveUser?: (sessionToken: string | null) => Promise<LiveUser | null>;
  resolveScopeVersion?: (userId: string) => Promise<string>;
};

export const resolveAiLiveSessionUser = async (
  sessionToken: string | null,
  dependencies: {
    getSession?: typeof auth.session.getData;
    getUser?: typeof accounts.users.get;
    revokeAllForUser?: typeof auth.session.revokeAllForUser;
  } = {},
): Promise<LiveUser | null> => {
  if (!sessionToken) return null;
  const session = await (dependencies.getSession ?? auth.session.getData)(sessionToken);
  if (!session) return null;
  const user = await (dependencies.getUser ?? accounts.users.get)({ id: session.userId });
  if (!user) return null;
  if (isAccountExpired(user.accountExpires)) {
    await (dependencies.revokeAllForUser ?? auth.session.revokeAllForUser)(user.id);
    return null;
  }
  return { id: user.id };
};

const isClosing = (ctx: WsContext): boolean => ctx.phase === "closing";

export const isAiLiveSubscriptionCurrent = (state: Pick<WsContext, "phase" | "userId">, userId: string, signal: AbortSignal): boolean =>
  !signal.aborted && state.phase === "subscribed" && state.userId === userId;

const send = (socket: ServerWebSocket<unknown>, message: AiLiveServerMessage): boolean => {
  try {
    return socket.send(JSON.stringify(message)) > 0;
  } catch {
    return false;
  }
};

const stopSubscription = (ctx: WsContext) => {
  ctx.streamAbort?.abort();
  ctx.streamAbort = null;
  if (ctx.authRefreshTimer) clearTimeout(ctx.authRefreshTimer);
  ctx.authRefreshTimer = null;
  ctx.userId = null;
  ctx.scopeVersion = null;
};

const closeWithError = (ctx: WsContext, code: AiLiveErrorCode, message: string, closeCode: number) => {
  if (isClosing(ctx)) return;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, { type: AI_LIVE_WS_TYPE.error, payload: { code, message } });
  ctx.socket.close(closeCode, code);
};

const revoke = (ctx: WsContext, code: "login_required" | "access_denied", message: string) => {
  if (isClosing(ctx)) return;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, { type: AI_LIVE_WS_TYPE.revoked, payload: { code, message } });
  ctx.socket.close(1008, code);
};

export const resolveAiLiveCursor = async (
  userId: string,
  fromCursor: string | null,
  recover: boolean,
  latest: (userId: string) => Promise<string | null> = latestAiInvalidationCursor,
): Promise<string> => AiLiveCursorSchema.parse(recover || !fromCursor ? ((await latest(userId)) ?? "0-0") : fromCursor);

export const parseAiLiveReplayEvent = (
  item: { cursor: unknown; data: unknown },
): { cursor: string; event: AiInvalidation } | null => {
  const cursor = AiLiveCursorSchema.safeParse(item.cursor);
  const event = AiInvalidationSchema.safeParse(item.data);
  return cursor.success && event.success ? { cursor: cursor.data, event: event.data } : null;
};

const buildAiLiveRoutes = (config: AiLiveRoutesConfig = {}) => {
  const resolveLiveUser = config.resolveLiveUser ?? resolveAiLiveSessionUser;

  const currentUser = async (ctx: WsContext): Promise<LiveUser | null> => {
    const user = await resolveLiveUser(ctx.sessionToken);
    return user && (!ctx.userId || user.id === ctx.userId) ? user : null;
  };

  const startAuthRefresh = (ctx: WsContext, userId: string) => {
    if (ctx.authRefreshTimer) clearTimeout(ctx.authRefreshTimer);
    ctx.authRefreshTimer = setTimeout(async () => {
      if (ctx.phase !== "subscribed" || ctx.userId !== userId) return;
      try {
        if (!(await currentUser(ctx))) {
          revoke(ctx, "login_required", "Login required");
          return;
        }
        if (config.resolveScopeVersion) {
          const version = await config.resolveScopeVersion(userId);
          if (ctx.phase !== "subscribed" || ctx.userId !== userId) return;
          if (ctx.scopeVersion !== null && version !== ctx.scopeVersion) {
            if (!send(ctx.socket, { type: AI_LIVE_WS_TYPE.scopeChanged, payload: { at: new Date().toISOString() } })) {
              closeWithError(ctx, "backpressure", "AI updates exceeded the connection capacity", 1013);
              return;
            }
          }
          ctx.scopeVersion = version;
        }
        startAuthRefresh(ctx, userId);
      } catch (error) {
        log.error("AI live authorization refresh failed", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        closeWithError(ctx, "internal_error", "AI live authorization refresh failed", 1011);
      }
    }, AUTH_REFRESH_INTERVAL_MS);
  };

  const startStream = (ctx: WsContext, userId: string, after: string) => {
    ctx.streamAbort?.abort();
    const abort = new AbortController();
    ctx.streamAbort = abort;
    void (async () => {
      try {
        for await (const item of liveAiInvalidations({ userId, after, signal: abort.signal })) {
          if (!isAiLiveSubscriptionCurrent(ctx, userId, abort.signal)) break;
          if (!(await currentUser(ctx))) {
            revoke(ctx, "login_required", "Login required");
            return;
          }
          if (!isAiLiveSubscriptionCurrent(ctx, userId, abort.signal)) break;
          const replay = parseAiLiveReplayEvent(item);
          if (!replay) {
            closeWithError(ctx, "stream_failed", "AI event stream contains invalid data", 1011);
            return;
          }
          if (!send(ctx.socket, { type: AI_LIVE_WS_TYPE.event, payload: replay })) {
            closeWithError(ctx, "backpressure", "AI updates exceeded the connection capacity", 1013);
            return;
          }
        }
        if (isAiLiveSubscriptionCurrent(ctx, userId, abort.signal)) closeWithError(ctx, "stream_failed", "AI event stream ended", 1012);
      } catch (error) {
        if (abort.signal.aborted || isClosing(ctx)) return;
        log.error("AI live event stream failed", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        closeWithError(ctx, "stream_failed", "AI event stream failed", 1012);
      } finally {
        if (ctx.streamAbort === abort) ctx.streamAbort = null;
      }
    })();
  };

  const handleSubscribe = async (ctx: WsContext, fromCursor: string | null, recover: boolean) => {
    if (isClosing(ctx)) return;
    const user = await currentUser(ctx);
    if (isClosing(ctx)) return;
    if (!user) {
      revoke(ctx, "login_required", "Login required");
      return;
    }
    let cursor: string;
    let scopeVersion: string | null;
    try {
      cursor = await resolveAiLiveCursor(user.id, fromCursor, recover);
      scopeVersion = config.resolveScopeVersion ? await config.resolveScopeVersion(user.id) : null;
    } catch (error) {
      log.error("AI live subscription setup failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "stream_failed", "AI live subscription failed", 1012);
      return;
    }
    if (isClosing(ctx)) return;
    stopSubscription(ctx);
    ctx.phase = "subscribed";
    ctx.userId = user.id;
    ctx.scopeVersion = scopeVersion;
    if (!send(ctx.socket, { type: AI_LIVE_WS_TYPE.ready, payload: { cursor, recovered: recover } })) {
      closeWithError(ctx, "backpressure", "AI updates exceeded the connection capacity", 1013);
      return;
    }
    startStream(ctx, user.id, cursor);
    startAuthRefresh(ctx, user.id);
  };

  const handleMessage = async (ctx: WsContext, raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      closeWithError(ctx, "invalid_json", "Invalid JSON payload", 1008);
      return;
    }
    const message = AiLiveClientMessageSchema.safeParse(parsed);
    if (!message.success) {
      closeWithError(ctx, "invalid_message", "Invalid AI live subscription", 1008);
      return;
    }
    await handleSubscribe(ctx, message.data.payload.fromCursor, message.data.payload.recover);
  };

  return new Hono<AuthContext>().get(
    "/",
    upgradeWebSocket((c) => {
      const sessionToken = getCookie(c, "session_token") ?? null;
      let ctx: WsContext | null = null;
      let processing: Promise<void> = Promise.resolve();
      let pendingMessages = 0;
      return {
        onOpen(_, ws) {
          ctx = {
            socket: ws.raw as ServerWebSocket<unknown>,
            sessionToken,
            phase: "open",
            userId: null,
            streamAbort: null,
            authRefreshTimer: null,
            scopeVersion: null,
          };
        },
        onMessage(event) {
          if (!ctx || isClosing(ctx)) return;
          if (typeof event.data !== "string" || event.data.length > MAX_CLIENT_MESSAGE_LENGTH) {
            closeWithError(ctx, "invalid_message", "Invalid AI live subscription", 1008);
            return;
          }
          if (pendingMessages >= MAX_PENDING_MESSAGES) {
            closeWithError(ctx, "backpressure", "Too many pending AI live messages", 1013);
            return;
          }
          const current = ctx;
          const raw = event.data;
          pendingMessages++;
          processing = processing
            .then(() => handleMessage(current, raw))
            .catch((error) => {
              log.error("AI live message handling failed", { error: error instanceof Error ? error.message : String(error) });
              closeWithError(current, "internal_error", "AI live subscription failed", 1011);
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
};

export const aiLiveRoutes = buildAiLiveRoutes();
export type AiLiveRoutes = typeof aiLiveRoutes;
