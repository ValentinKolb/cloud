import type { User } from "@valentinkolb/cloud/contracts";
import { auth } from "@valentinkolb/cloud/server";
import { accounts, logger } from "@valentinkolb/cloud/services";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import { isWorkflowRunEventVisible } from "./lib/workflow-run-events";
import { gridsWorkspace } from "./lib/workspace-events";
import { gridsService } from "./service";
import { canReadDashboardIncludedData } from "./service/dashboard-included-access";
import { latestMetadataEventCursor, liveMetadataEvents } from "./service/metadata-events";
import { latestRecordEventCursor, liveRecordEvents } from "./service/record-events";
import { latestWorkflowRunEventCursor, liveWorkflowRunEvents } from "./service/workflow-run-events";

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

const SubscribeWorkflowRunsMessageSchema = z
  .object({
    type: z.literal(WS_TYPE.workflowRunsSubscribe),
    payload: z.object({
      workflowId: z.string().uuid(),
      dashboardId: z.string().uuid().optional(),
      dashboardWidgetId: z.string().min(1).max(200).optional(),
      sessionToken: z.string().min(1).optional(),
      fromCursor: z.string().regex(gridsWorkspace.streamCursorPattern).nullable().optional(),
    }),
  })
  .refine(
    ({ payload }) => Boolean(payload.dashboardId) === Boolean(payload.dashboardWidgetId),
    "dashboardId and dashboardWidgetId must be provided together",
  );

const ClientMessageSchema = z.union([SubscribeMessageSchema, SubscribeMetadataMessageSchema, SubscribeWorkflowRunsMessageSchema]);
type WsPhase = "open" | "subscribed" | "closing";
type Subscription =
  | { kind: "records"; baseId: string; tableId: string; dashboardId?: string }
  | { kind: "metadata"; baseId: string }
  | { kind: "workflow-runs"; baseId: string; workflowId: string; dashboardId?: string; dashboardWidgetId?: string };

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
  | { ok: true; user: User; baseId: string; tableId?: string; workflowId?: string }
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

export const sendWorkspaceMessage = (socket: ServerWebSocket<unknown>, type: string, payload?: unknown): boolean => {
  try {
    return socket.send(JSON.stringify({ type, payload })) > 0;
  } catch {
    // Closed sockets are normal during tab/navigation churn.
    return false;
  }
};

const send = sendWorkspaceMessage;

const errorTypeFor = (ctx: WsContext): string =>
  ctx.subscription?.kind === "metadata"
    ? WS_TYPE.metadataError
    : ctx.subscription?.kind === "workflow-runs"
      ? WS_TYPE.workflowRunsError
      : WS_TYPE.recordsError;

const stopStream = (ctx: WsContext) => {
  if (ctx.streamAbort) ctx.streamAbort.abort();
  ctx.streamAbort = null;
};

const stopAccessRefresh = (ctx: WsContext) => {
  if (ctx.accessRefreshTimeout) clearTimeout(ctx.accessRefreshTimeout);
  ctx.accessRefreshTimeout = null;
};

export const isWorkspaceAccessRefreshCurrent = (
  ctx: Pick<WsContext, "phase" | "sessionToken" | "subscription">,
  subscription: Subscription,
  sessionToken: string,
): boolean => ctx.phase === "subscribed" && ctx.subscription === subscription && ctx.sessionToken === sessionToken;

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

const evaluateDashboardRecordAccess = async (dashboardId: string, tableId: string, sessionToken: string | null): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required", tableId };

  const dashboard = await gridsService.dashboard.get(dashboardId);
  if (!dashboard) return { ok: false, code: "not_found", message: "Dashboard not found", tableId };
  const sourceTableIds = await gridsService.dashboard.sourceTableIds(dashboard);
  if (!sourceTableIds.includes(tableId)) {
    return { ok: false, code: "access_denied", message: "Table is not part of this dashboard", tableId };
  }

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

  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: base.id,
  });
  const level = gridsService.permission.resolve(grants, { baseId: base.id });
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { ok: false, code: "access_denied", message: "Access denied" };
  }

  return { ok: true, user, baseId: base.id };
};

const evaluateWorkflowAccess = async (
  workflowId: string,
  sessionToken: string | null,
  dashboard?: { id: string; widgetId: string },
): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required" };

  const workflow = await gridsService.workflow.get(workflowId);
  if (!workflow) return { ok: false, code: "not_found", message: "Workflow not found" };

  if (dashboard) {
    const item = await gridsService.dashboard.get(dashboard.id);
    if (!item || item.baseId !== workflow.baseId) return { ok: false, code: "not_found", message: "Dashboard not found" };
    const widget = item.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === dashboard.widgetId);
    if (!widget || widget.kind !== "workflow-button") {
      return { ok: false, code: "not_found", message: "Workflow widget not found" };
    }
    const launcher = await gridsService.workflow.launcher.get(widget.launcherId);
    if (!launcher || launcher.config.kind !== "dashboard" || launcher.workflowId !== workflow.id) {
      return { ok: false, code: "not_found", message: "Workflow widget not found" };
    }
    if (!(await canReadDashboardIncludedData(item, { userId: user.id, userGroups: user.memberofGroupIds }))) {
      return { ok: false, code: "access_denied", message: "Access denied" };
    }
  } else {
    const grants = await gridsService.permission.loadGrants({
      userId: user.id,
      userGroups: user.memberofGroupIds,
      baseId: workflow.baseId,
      workflowId: workflow.id,
    });
    const level = gridsService.permission.resolve(grants, { baseId: workflow.baseId, workflowId: workflow.id });
    if (!gridsService.permission.hasAtLeast(level, "read")) {
      return { ok: false, code: "access_denied", message: "Access denied" };
    }
  }

  return { ok: true, user, baseId: workflow.baseId, workflowId: workflow.id };
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
          const sent = send(
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
          if (!sent) {
            closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity", tableId);
            break;
          }
        }
      } else if (subscription.kind === "metadata") {
        send(ctx.socket, WS_TYPE.metadataReady, { baseId });
        for await (const event of liveMetadataEvents({ baseId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          const sent = send(ctx.socket, WS_TYPE.metadataEvent, {
            baseId,
            cursor: event.cursor,
            event: event.data,
          });
          if (!sent) {
            closeWithError(ctx, "backpressure", "Live updates exceeded the connection capacity");
            break;
          }
        }
      } else {
        const workflowId = subscription.workflowId;
        send(ctx.socket, WS_TYPE.workflowRunsReady, { workflowId });
        for await (const event of liveWorkflowRunEvents({ baseId, workflowId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          const dashboardScope =
            subscription.dashboardId && subscription.dashboardWidgetId
              ? { id: subscription.dashboardId, widgetId: subscription.dashboardWidgetId }
              : undefined;
          if (!isWorkflowRunEventVisible(event.data, dashboardScope)) {
            continue;
          }
          const sent = send(ctx.socket, WS_TYPE.workflowRunsEvent, {
            workflowId,
            cursor: event.cursor,
            event: event.data,
          });
          if (!sent) {
            closeWithError(ctx, "backpressure", "Workflow updates exceeded the connection capacity");
            break;
          }
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      log.error("Workspace event stream failed", {
        baseId,
        kind: subscription.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      send(
        ctx.socket,
        subscription.kind === "records"
          ? WS_TYPE.recordsError
          : subscription.kind === "metadata"
            ? WS_TYPE.metadataError
            : WS_TYPE.workflowRunsError,
        {
          code: "stream_failed",
          message: "Workspace event stream failed",
          baseId,
          tableId: subscription.kind === "records" ? subscription.tableId : undefined,
        },
      );
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
    const subscription = ctx.subscription;
    const sessionToken = ctx.sessionToken;
    try {
      const access =
        subscription.kind === "records"
          ? subscription.dashboardId
            ? await evaluateDashboardRecordAccess(subscription.dashboardId, subscription.tableId, sessionToken)
            : await evaluateTableAccess(subscription.tableId, sessionToken)
          : subscription.kind === "metadata"
            ? await evaluateBaseAccess(subscription.baseId, sessionToken)
            : await evaluateWorkflowAccess(
                subscription.workflowId,
                sessionToken,
                subscription.dashboardId && subscription.dashboardWidgetId
                  ? { id: subscription.dashboardId, widgetId: subscription.dashboardWidgetId }
                  : undefined,
              );
      if (!isWorkspaceAccessRefreshCurrent(ctx, subscription, sessionToken)) return;
      if (!access.ok) {
        stopStream(ctx);
        send(
          ctx.socket,
          subscription.kind === "records"
            ? WS_TYPE.recordsRevoked
            : subscription.kind === "metadata"
              ? WS_TYPE.metadataRevoked
              : WS_TYPE.workflowRunsRevoked,
          {
            code: access.code,
            message: access.code === "access_denied" ? "Access was revoked" : access.message,
            baseId: subscription.baseId,
            tableId: subscription.kind === "records" ? subscription.tableId : undefined,
          },
        );
        ctx.socket.close(1008, access.code);
        ctx.phase = "closing";
        return;
      }
      ctx.user = access.user;
      startAccessRefresh(ctx);
    } catch (error) {
      if (!isWorkspaceAccessRefreshCurrent(ctx, subscription, sessionToken)) return;
      log.error("Workspace stream access refresh failed", {
        subscription,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(ctx, "internal_error", "Access refresh failed", subscription.kind === "records" ? subscription.tableId : undefined);
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

const handleSubscribe = async (ctx: WsContext, payload: z.infer<typeof SubscribeMessageSchema.shape.payload>) => {
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = payload.dashboardId
    ? await evaluateDashboardRecordAccess(payload.dashboardId, payload.tableId, sessionToken)
    : await evaluateTableAccess(payload.tableId, sessionToken);
  if (!access.ok || !access.tableId) {
    if (access.ok) {
      closeWithError(ctx, "not_found", "Table not found", payload.tableId);
      return;
    }
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

const handleMetadataSubscribe = async (ctx: WsContext, payload: z.infer<typeof SubscribeMetadataMessageSchema.shape.payload>) => {
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

const handleWorkflowRunsSubscribe = async (ctx: WsContext, payload: z.infer<typeof SubscribeWorkflowRunsMessageSchema>["payload"]) => {
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const dashboard =
    payload.dashboardId && payload.dashboardWidgetId ? { id: payload.dashboardId, widgetId: payload.dashboardWidgetId } : undefined;
  const access = await evaluateWorkflowAccess(payload.workflowId, sessionToken, dashboard);
  if (!access.ok || !access.workflowId) {
    closeWithError(ctx, access.ok ? "not_found" : access.code, access.ok ? "Workflow not found" : access.message);
    return;
  }

  const baselineCursor = payload.fromCursor ?? (await latestWorkflowRunEventCursor(access.baseId, access.workflowId)) ?? "0-0";

  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.user = access.user;
  ctx.subscription = {
    kind: "workflow-runs",
    baseId: access.baseId,
    workflowId: access.workflowId,
    dashboardId: payload.dashboardId,
    dashboardWidgetId: payload.dashboardWidgetId,
  };
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
  } else if (message.data.type === WS_TYPE.workflowRunsSubscribe) {
    await handleWorkflowRunsSubscribe(ctx, message.data.payload);
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
