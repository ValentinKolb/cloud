import type { User } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { accounts, logger } from "@valentinkolb/cloud/services";
import { auth } from "@valentinkolb/cloud/server";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import { gridsWorkspace } from "./lib/workspace-events";
import { gridsService } from "./service";
import { canReadDashboardIncludedData } from "./service/dashboard-included-access";
import { latestMetadataEventCursor, liveMetadataEvents } from "./service/metadata-events";
import { latestRecordEventCursor, liveRecordEvents } from "./service/record-events";

const log = logger("grids:ws");
const WS_TYPE = gridsWorkspace.wsType;
const ACCESS_REFRESH_INTERVAL_MS = 15_000;
const MAX_PENDING_MESSAGES = 100;
const CLOSE_SERVICE_RESTART = 1012;

const SubscribeMessageSchema = z.object({
  type: z.literal(WS_TYPE.recordsSubscribe),
  payload: z.object({
    tableId: z.string().uuid(),
    dashboardId: z.string().uuid().optional(),
    sessionToken: z.string().min(1).optional(),
    fromCursor: z.string().regex(gridsWorkspace.streamCursorPattern).nullable().optional(),
  }),
});

const SubscribeMetadataMessageSchema = z.object({
  type: z.literal(WS_TYPE.metadataSubscribe),
  payload: z.object({
    baseId: z.string().uuid(),
    sessionToken: z.string().min(1).optional(),
    fromCursor: z.string().regex(gridsWorkspace.streamCursorPattern).nullable().optional(),
  }),
});

const ClientMessageSchema = z.discriminatedUnion("type", [SubscribeMessageSchema, SubscribeMetadataMessageSchema]);
type ClientMessage = z.infer<typeof ClientMessageSchema>;
type WsPhase = "open" | "subscribed" | "closing";
type Subscription =
  | { kind: "records"; baseId: string; tableId: string; dashboardId?: string }
  | { kind: "metadata"; baseId: string };

type WsContext = {
  socket: ServerWebSocket<unknown>;
  phase: WsPhase;
  sessionToken: string | null;
  user: User | null;
  subscription: Subscription | null;
  streamAbort: AbortController | null;
  accessRefreshTimeout: ReturnType<typeof setTimeout> | null;
};

type AccessResult =
  | { ok: true; user: User; baseId: string; tableId: string }
  | { ok: false; code: string; message: string; tableId?: string };

const createContext = (socket: ServerWebSocket<unknown>, sessionToken: string | null): WsContext => ({
  socket,
  phase: "open",
  sessionToken,
  user: null,
  subscription: null,
  streamAbort: null,
  accessRefreshTimeout: null,
});

const send = (socket: ServerWebSocket<unknown>, type: string, payload?: unknown) => {
  try {
    socket.send(JSON.stringify({ type, payload }));
  } catch {
    // Closed sockets are normal during tab/navigation churn.
  }
};

const errorTypeFor = (ctx: WsContext): string =>
  ctx.subscription?.kind === "metadata" ? WS_TYPE.metadataError : WS_TYPE.recordsError;

const stopStream = (ctx: WsContext) => {
  if (ctx.streamAbort) ctx.streamAbort.abort();
  ctx.streamAbort = null;
};

const stopAccessRefresh = (ctx: WsContext) => {
  if (ctx.accessRefreshTimeout) clearTimeout(ctx.accessRefreshTimeout);
  ctx.accessRefreshTimeout = null;
};

const closeCodeForError = (code: string): number => {
  if (code === "internal_error") return 1011;
  if (code === "backpressure") return 1013;
  return 1008;
};

const closeWithError = (ctx: WsContext, code: string, message: string, tableId?: string) => {
  if (ctx.phase === "closing") return;
  ctx.phase = "closing";
  stopAccessRefresh(ctx);
  stopStream(ctx);
  send(ctx.socket, errorTypeFor(ctx), { code, message, tableId });
  ctx.socket.close(closeCodeForError(code), code);
};

const resolveSessionUser = async (sessionToken: string | null): Promise<User | null> => {
  if (!sessionToken) return null;
  const session = await auth.session.getData(sessionToken);
  if (!session) return null;
  return accounts.users.get({ id: session.userId });
};

const evaluateTableAccess = async (tableId: string, sessionToken: string | null): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required", tableId };

  const table = await gridsService.table.get(tableId);
  if (!table) return { ok: false, code: "not_found", message: "Table not found", tableId };
  if (hasRole(user, "admin")) return { ok: true, user, baseId: table.baseId, tableId: table.id };

  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: table.baseId,
    tableId: table.id,
  });
  const level = gridsService.permission.resolve(grants, { baseId: table.baseId, tableId: table.id });
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { ok: false, code: "access_denied", message: "Access denied", tableId: table.id };
  }

  return { ok: true, user, baseId: table.baseId, tableId: table.id };
};

const evaluateDashboardRecordAccess = async (
  dashboardId: string,
  tableId: string,
  sessionToken: string | null,
): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required", tableId };

  const dashboard = await gridsService.dashboard.get(dashboardId);
  if (!dashboard) return { ok: false, code: "not_found", message: "Dashboard not found", tableId };
  const sourceTableIds = await gridsService.dashboard.sourceTableIds(dashboard);
  if (!sourceTableIds.includes(tableId)) {
    return { ok: false, code: "access_denied", message: "Table is not part of this dashboard", tableId };
  }
  if (hasRole(user, "admin")) return { ok: true, user, baseId: dashboard.baseId, tableId };

  const canRead = await canReadDashboardIncludedData(dashboard, {
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  if (!canRead) return { ok: false, code: "access_denied", message: "Access denied", tableId };

  return { ok: true, user, baseId: dashboard.baseId, tableId };
};

const evaluateBaseAccess = async (baseId: string, sessionToken: string | null): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required" };

  const base = await gridsService.base.get(baseId);
  if (!base) return { ok: false, code: "not_found", message: "Base not found" };
  if (hasRole(user, "admin")) return { ok: true, user, baseId: base.id, tableId: "" };

  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: base.id,
  });
  const level = gridsService.permission.resolve(grants, { baseId: base.id });
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { ok: false, code: "access_denied", message: "Access denied" };
  }

  return { ok: true, user, baseId: base.id, tableId: "" };
};

const startStream = (ctx: WsContext, afterCursor: string | null) => {
  stopStream(ctx);
  const subscription = ctx.subscription;
  if (!subscription) return;

  const baseId = subscription.baseId;
  const abort = new AbortController();
  ctx.streamAbort = abort;

  void (async () => {
    try {
      if (subscription.kind === "records") {
        const tableId = subscription.tableId;
        send(ctx.socket, WS_TYPE.recordsReady, { tableId });
        for await (const event of liveRecordEvents({ baseId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          if (event.data.tableId !== tableId) continue;
          send(
            ctx.socket,
            WS_TYPE.recordsEvent,
            subscription.dashboardId
              ? {
                  tableId,
                  cursor: event.cursor,
                }
              : {
                  tableId,
                  cursor: event.cursor,
                  event: event.data,
                },
          );
        }
      } else {
        send(ctx.socket, WS_TYPE.metadataReady, { baseId });
        for await (const event of liveMetadataEvents({ baseId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          send(ctx.socket, WS_TYPE.metadataEvent, {
            baseId,
            cursor: event.cursor,
            event: event.data,
          });
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      log.error("Workspace event stream failed", {
        baseId,
        kind: subscription.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      send(ctx.socket, subscription.kind === "records" ? WS_TYPE.recordsError : WS_TYPE.metadataError, {
        code: "stream_failed",
        message: "Workspace event stream failed",
        baseId,
        tableId: subscription.kind === "records" ? subscription.tableId : undefined,
      });
      stopAccessRefresh(ctx);
      ctx.phase = "closing";
      ctx.socket.close(CLOSE_SERVICE_RESTART, "stream_failed");
    } finally {
      if (ctx.streamAbort === abort) ctx.streamAbort = null;
    }
  })();
};

const startAccessRefresh = (ctx: WsContext) => {
  stopAccessRefresh(ctx);
  if (ctx.phase !== "subscribed" || !ctx.subscription || !ctx.sessionToken) return;

  ctx.accessRefreshTimeout = setTimeout(async () => {
    if (ctx.phase !== "subscribed" || !ctx.subscription || !ctx.sessionToken) return;
    try {
      const subscription = ctx.subscription;
      const access =
        subscription.kind === "records"
          ? subscription.dashboardId
            ? await evaluateDashboardRecordAccess(subscription.dashboardId, subscription.tableId, ctx.sessionToken)
            : await evaluateTableAccess(subscription.tableId, ctx.sessionToken)
          : await evaluateBaseAccess(subscription.baseId, ctx.sessionToken);
      if (!access.ok) {
        stopStream(ctx);
        send(ctx.socket, subscription.kind === "records" ? WS_TYPE.recordsRevoked : WS_TYPE.metadataRevoked, {
          code: access.code,
          message: access.code === "access_denied" ? "Access was revoked" : access.message,
          baseId: subscription.baseId,
          tableId: subscription.kind === "records" ? subscription.tableId : undefined,
        });
        ctx.socket.close(1008, access.code);
        ctx.phase = "closing";
        return;
      }
      ctx.user = access.user;
      startAccessRefresh(ctx);
    } catch (error) {
      log.error("Workspace stream access refresh failed", {
        subscription: ctx.subscription,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "internal_error", "Access refresh failed", ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined);
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

const handleSubscribe = async (ctx: WsContext, payload: z.infer<typeof SubscribeMessageSchema.shape.payload>) => {
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = payload.dashboardId
    ? await evaluateDashboardRecordAccess(payload.dashboardId, payload.tableId, sessionToken)
    : await evaluateTableAccess(payload.tableId, sessionToken);
  if (!access.ok) {
    closeWithError(ctx, access.code, access.message, access.tableId ?? payload.tableId);
    return;
  }

  const baselineCursor = payload.fromCursor ?? (await latestRecordEventCursor(access.baseId)) ?? "0-0";

  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.user = access.user;
  ctx.subscription = { kind: "records", baseId: access.baseId, tableId: access.tableId, dashboardId: payload.dashboardId };
  startStream(ctx, baselineCursor);
  startAccessRefresh(ctx);
};

const handleMetadataSubscribe = async (
  ctx: WsContext,
  payload: z.infer<typeof SubscribeMetadataMessageSchema.shape.payload>,
) => {
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = await evaluateBaseAccess(payload.baseId, sessionToken);
  if (!access.ok) {
    closeWithError(ctx, access.code, access.message);
    return;
  }

  const baselineCursor = payload.fromCursor ?? (await latestMetadataEventCursor(access.baseId)) ?? "0-0";

  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.user = access.user;
  ctx.subscription = { kind: "metadata", baseId: access.baseId };
  startStream(ctx, baselineCursor);
  startAccessRefresh(ctx);
};

const handleClientMessage = async (ctx: WsContext, raw: string): Promise<void> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    send(ctx.socket, errorTypeFor(ctx), { code: "invalid_json", message: "Invalid JSON payload" });
    return;
  }

  const message = ClientMessageSchema.safeParse(parsed);
  if (!message.success) {
    send(ctx.socket, errorTypeFor(ctx), { code: "invalid_message", message: "Invalid message payload" });
    return;
  }

  if (message.data.type === WS_TYPE.recordsSubscribe) {
    await handleSubscribe(ctx, message.data.payload);
  } else if (message.data.type === WS_TYPE.metadataSubscribe) {
    await handleMetadataSubscribe(ctx, message.data.payload);
  }
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

      async onMessage(event) {
        if (!ctx || ctx.phase === "closing") return;
        if (typeof event.data !== "string") {
          send(ctx.socket, errorTypeFor(ctx), { code: "invalid_message", message: "Only JSON text messages are supported" });
          return;
        }
        if (pendingMessages >= MAX_PENDING_MESSAGES) {
          closeWithError(
            ctx,
            "backpressure",
            "Too many pending websocket messages",
            ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
          );
          return;
        }

        pendingMessages++;
        const raw = event.data;
        const currentCtx = ctx;
        processing = processing
          .then(() => handleClientMessage(currentCtx, raw))
          .catch((error) => {
            log.error("Websocket message handling failed", {
              subscription: currentCtx.subscription,
              error: error instanceof Error ? error.message : String(error),
            });
            closeWithError(
              currentCtx,
              "internal_error",
              "Message handling failed",
              currentCtx.subscription?.kind === "records" ? currentCtx.subscription.tableId : undefined,
            );
          })
          .finally(() => {
            pendingMessages = Math.max(0, pendingMessages - 1);
          });
      },

      async onClose() {
        if (!ctx) return;
        await processing.catch(() => undefined);
        ctx.phase = "closing";
        stopAccessRefresh(ctx);
        stopStream(ctx);
      },
    };
  }),
);

export default app;
