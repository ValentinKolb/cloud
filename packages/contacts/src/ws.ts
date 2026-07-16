import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, rateLimit } from "@valentinkolb/cloud/server";
import { accounts, logger } from "@valentinkolb/cloud/services";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import {
  CONTACTS_LIVE_WS_TYPE,
  ContactLiveClientMessageSchema,
  type ContactLiveScope,
  type ContactLiveServerMessage,
  type ContactServiceEvent,
  ContactServiceEventSchema,
  classifyContactScopeChange,
  contactEventBookIds,
  projectContactEvent,
} from "./live-events";
import { contactsService } from "./service";
import { latestContactEventCursor, liveContactEvents } from "./service/events";

const log = logger("contacts:websocket");
const ACCESS_REFRESH_INTERVAL_MS = 8_000;
const MAX_CLIENT_MESSAGE_LENGTH = 16_000;
const MAX_PENDING_MESSAGES = 8;

type AccessFailure = {
  ok: false;
  code: "login_required" | "not_found" | "access_denied";
  message: string;
};
type AccessResult = { ok: true; userId: string; readableBookIds: Set<string> } | AccessFailure;
type WsPhase = "open" | "subscribed" | "closing";
type WsContext = {
  socket: ServerWebSocket<unknown>;
  sessionToken: string | null;
  phase: WsPhase;
  scope: ContactLiveScope | null;
  userId: string | null;
  readableBookIds: Set<string>;
  streamAbort: AbortController | null;
  accessRefreshTimer: ReturnType<typeof setTimeout> | null;
};

const createContext = (socket: ServerWebSocket<unknown>, sessionToken: string | null): WsContext => ({
  socket,
  sessionToken,
  phase: "open",
  scope: null,
  userId: null,
  readableBookIds: new Set(),
  streamAbort: null,
  accessRefreshTimer: null,
});

const isClosing = (ctx: WsContext): boolean => ctx.phase === "closing";

const send = (socket: ServerWebSocket<unknown>, message: ContactLiveServerMessage): boolean => {
  try {
    return socket.send(JSON.stringify(message)) > 0;
  } catch {
    return false;
  }
};

const stopSubscription = (ctx: WsContext) => {
  if (ctx.accessRefreshTimer) clearTimeout(ctx.accessRefreshTimer);
  ctx.accessRefreshTimer = null;
  ctx.streamAbort?.abort();
  ctx.streamAbort = null;
  ctx.scope = null;
  ctx.userId = null;
  ctx.readableBookIds = new Set();
};

const closeWithError = (ctx: WsContext, code: string, message: string, closeCode: number) => {
  if (isClosing(ctx)) return;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, { type: CONTACTS_LIVE_WS_TYPE.error, payload: { code, message } });
  ctx.socket.close(closeCode, code);
};

const revoke = (ctx: WsContext, access: AccessFailure) => {
  if (isClosing(ctx)) return;
  ctx.phase = "closing";
  stopSubscription(ctx);
  send(ctx.socket, {
    type: CONTACTS_LIVE_WS_TYPE.revoked,
    payload: { code: access.code, message: access.message },
  });
  ctx.socket.close(1008, access.code);
};

const sameIds = (left: Set<string>, right: Set<string>): boolean => left.size === right.size && [...left].every((id) => right.has(id));

const evaluateAccess = async (sessionToken: string | null, scope: ContactLiveScope): Promise<AccessResult> => {
  if (!sessionToken) return { ok: false, code: "login_required", message: "Login required" };
  const session = await auth.session.getData(sessionToken);
  if (!session) return { ok: false, code: "login_required", message: "Login required" };
  const user = await accounts.users.get({ id: session.userId });
  if (!user || !hasRole(user, "user")) return { ok: false, code: "access_denied", message: "Access denied" };

  const subject = { type: "user" as const, userId: user.id };
  if (scope.kind === "book") {
    if (contactsService.system.isBookId(scope.bookId)) {
      return { ok: false, code: "not_found", message: "Contact book not found" };
    }
    const book = await contactsService.book.get({ id: scope.bookId });
    if (!book) return { ok: false, code: "not_found", message: "Contact book not found" };
    const canRead = await contactsService.book.permission.canAccess({ bookId: scope.bookId, subject, requiredLevel: "read" });
    if (!canRead) return { ok: false, code: "access_denied", message: "Access denied" };
    return { ok: true, userId: user.id, readableBookIds: new Set([scope.bookId]) };
  }

  const readableBookIds = new Set(await contactsService.book.readableIds({ subject }));
  return { ok: true, userId: user.id, readableBookIds };
};

const updateAccess = async (ctx: WsContext, scope: ContactLiveScope): Promise<boolean> => {
  const access = await evaluateAccess(ctx.sessionToken, scope);
  if (ctx.phase !== "subscribed" || ctx.scope !== scope) return false;
  if (!access.ok) {
    revoke(ctx, access);
    return false;
  }
  if (scope.kind === "all" && !sameIds(ctx.readableBookIds, access.readableBookIds)) {
    const change = classifyContactScopeChange(ctx.readableBookIds, access.readableBookIds);
    ctx.readableBookIds = access.readableBookIds;
    if (!send(ctx.socket, { type: CONTACTS_LIVE_WS_TYPE.scopeChanged, payload: { change } })) {
      closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
      return false;
    }
  } else {
    ctx.readableBookIds = access.readableBookIds;
  }
  ctx.userId = access.userId;
  return true;
};

const refreshAllEventAccess = async (ctx: WsContext, event: ContactServiceEvent): Promise<ContactServiceEvent | null> => {
  const affectedBookIds = [...new Set(contactEventBookIds(event))];
  const mayExpandScope = event.type === "book.created" || event.type === "access.changed";
  if (!mayExpandScope && !affectedBookIds.some((bookId) => ctx.readableBookIds.has(bookId))) return null;
  if (!ctx.sessionToken || !ctx.userId) return null;
  const session = await auth.session.getData(ctx.sessionToken);
  if (!session || session.userId !== ctx.userId) {
    revoke(ctx, { ok: false, code: "login_required", message: "Login required" });
    return null;
  }

  const subject = { type: "user" as const, userId: ctx.userId };
  const before = new Set(ctx.readableBookIds);
  for (const bookId of affectedBookIds) {
    const canRead = await contactsService.book.permission.canAccess({ bookId, subject, requiredLevel: "read" });
    if (canRead === ctx.readableBookIds.has(bookId)) continue;
    if (canRead) ctx.readableBookIds.add(bookId);
    else ctx.readableBookIds.delete(bookId);
  }

  if (!sameIds(before, ctx.readableBookIds)) {
    if (
      !send(ctx.socket, {
        type: CONTACTS_LIVE_WS_TYPE.scopeChanged,
        payload: { change: classifyContactScopeChange(before, ctx.readableBookIds) },
      })
    ) {
      closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
    }
    // The replacement SSR snapshot includes both the new scope and this event.
    return null;
  }
  return projectContactEvent(event, ctx.readableBookIds);
};

const refreshEventAccess = async (
  ctx: WsContext,
  scope: ContactLiveScope,
  event: ContactServiceEvent,
): Promise<ContactServiceEvent | null> => {
  if (scope.kind === "all") return refreshAllEventAccess(ctx, event);
  if (!contactEventBookIds(event).includes(scope.bookId)) return null;
  if (!(await updateAccess(ctx, scope))) return null;
  return projectContactEvent(event, ctx.readableBookIds);
};

const startAccessRefresh = (ctx: WsContext, scope: ContactLiveScope) => {
  if (ctx.accessRefreshTimer) clearTimeout(ctx.accessRefreshTimer);
  ctx.accessRefreshTimer = setTimeout(async () => {
    if (ctx.phase !== "subscribed" || ctx.scope !== scope) return;
    try {
      if (await updateAccess(ctx, scope)) startAccessRefresh(ctx, scope);
    } catch (error) {
      if (ctx.phase !== "subscribed" || ctx.scope !== scope) return;
      log.error("Contacts WebSocket access refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "internal_error", "Access refresh failed", 1011);
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

const startStream = (ctx: WsContext, scope: ContactLiveScope, after: string) => {
  ctx.streamAbort?.abort();
  const abort = new AbortController();
  ctx.streamAbort = abort;

  void (async () => {
    try {
      for await (const envelope of liveContactEvents({ after, signal: abort.signal })) {
        if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.scope !== scope) break;
        const parsed = ContactServiceEventSchema.safeParse(envelope.data);
        if (!parsed.success) continue;
        const event = await refreshEventAccess(ctx, scope, parsed.data);
        if (!event || ctx.phase !== "subscribed") continue;
        if (!send(ctx.socket, { type: CONTACTS_LIVE_WS_TYPE.event, payload: { cursor: envelope.cursor, event } })) {
          closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
          break;
        }
      }
    } catch (error) {
      if (abort.signal.aborted || ctx.phase === "closing") return;
      log.error("Contacts WebSocket event stream failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "stream_failed", "Contacts event stream failed", 1012);
    } finally {
      if (ctx.streamAbort === abort) ctx.streamAbort = null;
    }
  })();
};

const handleSubscribe = async (ctx: WsContext, scope: ContactLiveScope, fromCursor: string | null) => {
  if (isClosing(ctx)) return;
  if (ctx.phase === "subscribed") {
    closeWithError(ctx, "already_subscribed", "A live subscription is already active", 1008);
    return;
  }
  const access = await evaluateAccess(ctx.sessionToken, scope);
  if (isClosing(ctx)) return;
  if (!access.ok) {
    revoke(ctx, access);
    return;
  }

  const cursor = fromCursor ?? (await latestContactEventCursor()) ?? "0-0";
  if (ctx.phase === "closing") return;
  stopSubscription(ctx);
  ctx.phase = "subscribed";
  ctx.scope = scope;
  ctx.userId = access.userId;
  ctx.readableBookIds = access.readableBookIds;
  if (!send(ctx.socket, { type: CONTACTS_LIVE_WS_TYPE.ready, payload: { cursor } })) {
    closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", 1013);
    return;
  }
  startStream(ctx, scope, cursor);
  startAccessRefresh(ctx, scope);
};

const handleMessage = async (ctx: WsContext, raw: string) => {
  if (ctx.phase === "closing") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    closeWithError(ctx, "invalid_json", "Invalid JSON payload", 1008);
    return;
  }
  const message = ContactLiveClientMessageSchema.safeParse(parsed);
  if (!message.success) {
    closeWithError(ctx, "invalid_message", "Invalid live subscription", 1008);
    return;
  }
  await handleSubscribe(ctx, message.data.payload.scope, message.data.payload.fromCursor);
};

const app = new Hono<AuthContext>().use("*", rateLimit({ keyBy: "auto", limitPerSecond: 5 })).get(
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
        processing = processing
          .then(() => handleMessage(current, event.data as string))
          .catch((error) => {
            log.error("Contacts WebSocket message handling failed", {
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
