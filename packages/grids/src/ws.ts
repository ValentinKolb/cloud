import type { User } from "@valentinkolb/cloud/contracts";
import { auth } from "@valentinkolb/cloud/server";
import { accounts, logger } from "@valentinkolb/cloud/services";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import { gridsWorkspace } from "./lib/workspace-events";
import { gridsService } from "./service";
import { type GridsMetadataEvent, latestMetadataEventCursor, liveMetadataEvents } from "./service/metadata-events";
import { latestRecordEventCursor, liveRecordEvents } from "./service/record-events";
import { latestWorkflowRunEventCursor, liveWorkflowRunEvents } from "./service/workflow-run-events";

const log = logger("grids:ws");
const WS_TYPE = gridsWorkspace.wsType;
const ACCESS_REFRESH_INTERVAL_MS = 15_000;
const MAX_CLIENT_MESSAGE_LENGTH = 16_000;
const MAX_PENDING_MESSAGES = 8;
const CLOSE_SERVICE_RESTART = 1012;

const SubscribeMessageSchema = z.object({
  type: z.literal(WS_TYPE.recordsSubscribe),
  payload: z.object({
    tableId: z.string().uuid(),
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

const SubscribeWorkflowRunsMessageSchema = z.object({
  type: z.literal(WS_TYPE.workflowRunsSubscribe),
  payload: z.object({
    workflowId: z.string().uuid(),
    sessionToken: z.string().min(1).optional(),
    fromCursor: z.string().regex(gridsWorkspace.streamCursorPattern).nullable().optional(),
  }),
});

const ClientMessageSchema = z.union([SubscribeMessageSchema, SubscribeMetadataMessageSchema, SubscribeWorkflowRunsMessageSchema]);
type WsPhase = "open" | "subscribed" | "closing";
type Subscription =
  | { kind: "records"; baseId: string; tableId: string }
  | { kind: "metadata"; baseId: string }
  | { kind: "workflow-runs"; baseId: string; workflowId: string };

type WsContext = {
  socket: ServerWebSocket<unknown>;
  phase: WsPhase;
  sessionToken: string | null;
  subscription: Subscription | null;
  streamAbort: AbortController | null;
  accessRefreshTimeout: ReturnType<typeof setTimeout> | null;
};

type AccessResult =
  | {
      ok: true;
      baseId: string;
      tableId?: string;
      workflowId?: string;
      recordEventVisibility?: "full" | "cursor_only";
    }
  | { ok: false; code: string; message: string; tableId?: string };

type WorkspaceRuntime = {
  evaluateRecordsAccess: (tableId: string, sessionToken: string | null) => Promise<AccessResult>;
  evaluateBaseAccess: (baseId: string, sessionToken: string | null) => Promise<AccessResult>;
  evaluateMetadataEventAccess: (event: GridsMetadataEvent, sessionToken: string | null) => Promise<boolean>;
  evaluateWorkflowAccess: (workflowId: string, sessionToken: string | null) => Promise<AccessResult>;
  evaluateSubscriptionAccess: (subscription: Subscription, sessionToken: string | null) => Promise<AccessResult>;
  latestRecordCursor: typeof latestRecordEventCursor;
  latestMetadataCursor: typeof latestMetadataEventCursor;
  latestWorkflowRunCursor: typeof latestWorkflowRunEventCursor;
  recordEvents: typeof liveRecordEvents;
  metadataEvents: typeof liveMetadataEvents;
  workflowRunEvents: typeof liveWorkflowRunEvents;
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel: (timeout: ReturnType<typeof setTimeout>) => void;
};

const createContext = (socket: ServerWebSocket<unknown>, sessionToken: string | null): WsContext => ({
  socket,
  phase: "open",
  sessionToken,
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

const isClosing = (ctx: Pick<WsContext, "phase">): boolean => ctx.phase === "closing";

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

const stopAccessRefresh = (ctx: WsContext, runtime: WorkspaceRuntime) => {
  if (ctx.accessRefreshTimeout) runtime.cancel(ctx.accessRefreshTimeout);
  ctx.accessRefreshTimeout = null;
};

const stopSubscription = (ctx: WsContext, runtime: WorkspaceRuntime) => {
  stopAccessRefresh(ctx, runtime);
  stopStream(ctx);
  ctx.subscription = null;
};

export const isWorkspaceAccessRefreshCurrent = (
  ctx: Pick<WsContext, "phase" | "sessionToken" | "subscription">,
  subscription: Subscription,
  sessionToken: string,
): boolean => ctx.phase === "subscribed" && ctx.subscription === subscription && ctx.sessionToken === sessionToken;

export const workspaceCloseCodeForError = (code: string): number => {
  if (code === "internal_error") return 1011;
  if (code === "backpressure" || code === "stream_failed" || code === "stream_ended") return CLOSE_SERVICE_RESTART;
  return 1008;
};

const closeWithError = (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  code: string,
  message: string,
  tableId?: string,
  errorType = errorTypeFor(ctx),
) => {
  if (ctx.phase === "closing") return;
  ctx.phase = "closing";
  stopSubscription(ctx, runtime);
  send(ctx.socket, errorType, { code, message, tableId });
  ctx.socket.close(workspaceCloseCodeForError(code), code);
};

const revokeAccess = (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  subscription: Subscription,
  access: Exclude<AccessResult, { ok: true }>,
) => {
  if (isClosing(ctx)) return;
  ctx.phase = "closing";
  stopSubscription(ctx, runtime);
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
  const decision = gridsService.permission.resolveRecordAccess(grants, { baseId: table.baseId, tableId: table.id }, "read", user.id);
  if (!decision.recordAccess) {
    return { ok: false, code: "access_denied", message: "Access denied", tableId: table.id };
  }

  return {
    ok: true,
    baseId: table.baseId,
    tableId: table.id,
    recordEventVisibility: decision.recordAccess.kind === "all" ? "full" : "cursor_only",
  };
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

  return { ok: true, baseId: base.id };
};

const metadataEventTarget = (event: GridsMetadataEvent) => {
  const tableId = event.resource.tableId ?? (event.resource.kind === "table" ? event.resource.id : undefined);
  if (event.resource.kind === "view" && tableId) return { baseId: event.baseId, tableId, viewId: event.resource.id } as const;
  if (event.resource.kind === "form" && tableId) return { baseId: event.baseId, tableId, formId: event.resource.id } as const;
  if (event.resource.kind === "workflow") return { baseId: event.baseId, workflowId: event.resource.id } as const;
  return tableId ? ({ baseId: event.baseId, tableId } as const) : ({ baseId: event.baseId } as const);
};

const evaluateMetadataEventAccess = async (event: GridsMetadataEvent, sessionToken: string | null): Promise<boolean> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return false;
  const target = metadataEventTarget(event);
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
  return gridsService.permission.hasAtLeast(gridsService.permission.resolve(grants, target), "read");
};

const evaluateWorkflowAccess = async (workflowId: string, sessionToken: string | null): Promise<AccessResult> => {
  const user = await resolveSessionUser(sessionToken);
  if (!user) return { ok: false, code: "login_required", message: "Login required" };

  const workflow = await gridsService.workflow.get(workflowId);
  if (!workflow) return { ok: false, code: "not_found", message: "Workflow not found" };

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

  return { ok: true, baseId: workflow.baseId, workflowId: workflow.id };
};

const evaluateSubscriptionAccess = (subscription: Subscription, sessionToken: string | null): Promise<AccessResult> =>
  subscription.kind === "records"
    ? evaluateTableAccess(subscription.tableId, sessionToken)
    : subscription.kind === "metadata"
      ? evaluateBaseAccess(subscription.baseId, sessionToken)
      : evaluateWorkflowAccess(subscription.workflowId, sessionToken);

const workspaceRuntime: WorkspaceRuntime = {
  evaluateRecordsAccess: evaluateTableAccess,
  evaluateBaseAccess,
  evaluateMetadataEventAccess,
  evaluateWorkflowAccess,
  evaluateSubscriptionAccess,
  latestRecordCursor: latestRecordEventCursor,
  latestMetadataCursor: latestMetadataEventCursor,
  latestWorkflowRunCursor: latestWorkflowRunEventCursor,
  recordEvents: liveRecordEvents,
  metadataEvents: liveMetadataEvents,
  workflowRunEvents: liveWorkflowRunEvents,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (timeout) => clearTimeout(timeout),
};

const ensureCurrentAccess = async (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  subscription: Subscription,
): Promise<Extract<AccessResult, { ok: true }> | null> => {
  const access = await runtime.evaluateSubscriptionAccess(subscription, ctx.sessionToken);
  if (ctx.phase !== "subscribed" || ctx.subscription !== subscription) return null;
  if (access.ok) return access;
  revokeAccess(ctx, runtime, subscription, access);
  return null;
};

const startStream = (ctx: WsContext, runtime: WorkspaceRuntime, afterCursor: string | null) => {
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
        for await (const event of runtime.recordEvents({ baseId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          if (event.data.tableId !== tableId) continue;
          const access = await ensureCurrentAccess(ctx, runtime, subscription);
          if (!access) break;
          const sent = send(
            ctx.socket,
            WS_TYPE.recordsEvent,
            access.recordEventVisibility === "cursor_only"
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
            closeWithError(ctx, runtime, "backpressure", "Live updates exceeded the connection capacity", tableId);
            break;
          }
        }
      } else if (subscription.kind === "metadata") {
        for await (const event of runtime.metadataEvents({ baseId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          if (!(await ensureCurrentAccess(ctx, runtime, subscription))) break;
          if (!(await runtime.evaluateMetadataEventAccess(event.data, ctx.sessionToken))) continue;
          const sent = send(ctx.socket, WS_TYPE.metadataEvent, {
            baseId,
            cursor: event.cursor,
            event: event.data,
          });
          if (!sent) {
            closeWithError(ctx, runtime, "backpressure", "Live updates exceeded the connection capacity");
            break;
          }
        }
      } else {
        const workflowId = subscription.workflowId;
        for await (const event of runtime.workflowRunEvents({ baseId, workflowId, after: afterCursor, signal: abort.signal })) {
          if (abort.signal.aborted || ctx.phase !== "subscribed" || ctx.subscription !== subscription) break;
          if (!(await ensureCurrentAccess(ctx, runtime, subscription))) break;
          const sent = send(ctx.socket, WS_TYPE.workflowRunsEvent, {
            workflowId,
            cursor: event.cursor,
            event: event.data,
          });
          if (!sent) {
            closeWithError(ctx, runtime, "backpressure", "Workflow updates exceeded the connection capacity");
            break;
          }
        }
      }

      if (!abort.signal.aborted && ctx.phase === "subscribed" && ctx.subscription === subscription) {
        closeWithError(
          ctx,
          runtime,
          "stream_ended",
          subscription.kind === "workflow-runs" ? "Workflow update stream ended" : "Workspace event stream ended",
          subscription.kind === "records" ? subscription.tableId : undefined,
        );
      }
    } catch (error) {
      if (abort.signal.aborted || isClosing(ctx)) return;
      log.error("Workspace event stream failed", {
        baseId,
        kind: subscription.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(
        ctx,
        runtime,
        "stream_failed",
        "Workspace event stream failed",
        subscription.kind === "records" ? subscription.tableId : undefined,
      );
    } finally {
      if (ctx.streamAbort === abort) ctx.streamAbort = null;
    }
  })();
};

const startAccessRefresh = (ctx: WsContext, runtime: WorkspaceRuntime) => {
  stopAccessRefresh(ctx, runtime);
  if (ctx.phase !== "subscribed" || !ctx.subscription || !ctx.sessionToken) return;

  ctx.accessRefreshTimeout = runtime.schedule(async () => {
    if (ctx.phase !== "subscribed" || !ctx.subscription || !ctx.sessionToken) return;
    const subscription = ctx.subscription;
    const sessionToken = ctx.sessionToken;
    try {
      const access = await runtime.evaluateSubscriptionAccess(subscription, sessionToken);
      if (!isWorkspaceAccessRefreshCurrent(ctx, subscription, sessionToken)) return;
      if (!access.ok) {
        revokeAccess(ctx, runtime, subscription, access);
        return;
      }
      startAccessRefresh(ctx, runtime);
    } catch (error) {
      if (!isWorkspaceAccessRefreshCurrent(ctx, subscription, sessionToken)) return;
      log.error("Workspace stream access refresh failed", {
        subscription,
        error: error instanceof Error ? error.message : String(error),
      });
      closeWithError(
        ctx,
        runtime,
        "internal_error",
        "Access refresh failed",
        subscription.kind === "records" ? subscription.tableId : undefined,
      );
    }
  }, ACCESS_REFRESH_INTERVAL_MS);
};

export const resolveWorkspaceEventCursor = async (
  fromCursor: string | null | undefined,
  latestCursor: () => Promise<string | null>,
): Promise<string> => fromCursor ?? (await latestCursor()) ?? "0-0";

const resolveSubscriptionCursor = async (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  fromCursor: string | null | undefined,
  latestCursor: () => Promise<string | null>,
): Promise<string | null> => {
  try {
    return await resolveWorkspaceEventCursor(fromCursor, latestCursor);
  } catch (error) {
    if (isClosing(ctx)) return null;
    log.error("Workspace event cursor resolution failed", {
      subscription: ctx.subscription,
      error: error instanceof Error ? error.message : String(error),
    });
    closeWithError(
      ctx,
      runtime,
      "stream_failed",
      "Workspace event stream failed",
      ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
    );
    return null;
  }
};

const handleSubscribe = async (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  payload: z.infer<typeof SubscribeMessageSchema.shape.payload>,
) => {
  if (isClosing(ctx)) return;
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = await runtime.evaluateRecordsAccess(payload.tableId, sessionToken);
  if (isClosing(ctx)) return;
  if (!access.ok || !access.tableId) {
    if (access.ok) {
      closeWithError(ctx, runtime, "not_found", "Table not found", payload.tableId);
      return;
    }
    closeWithError(ctx, runtime, access.code, access.message, access.tableId ?? payload.tableId);
    return;
  }

  const subscription: Subscription = {
    kind: "records",
    baseId: access.baseId,
    tableId: access.tableId,
  };
  stopSubscription(ctx, runtime);
  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.subscription = subscription;
  const baselineCursor = await resolveSubscriptionCursor(ctx, runtime, payload.fromCursor, () => runtime.latestRecordCursor(access.baseId));
  if (!baselineCursor) return;
  if (isClosing(ctx) || ctx.subscription !== subscription) return;
  if (!send(ctx.socket, WS_TYPE.recordsReady, { tableId: access.tableId, cursor: baselineCursor })) {
    closeWithError(ctx, runtime, "backpressure", "Live updates exceeded the connection capacity", access.tableId);
    return;
  }
  startStream(ctx, runtime, baselineCursor);
  startAccessRefresh(ctx, runtime);
};

const handleMetadataSubscribe = async (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  payload: z.infer<typeof SubscribeMetadataMessageSchema.shape.payload>,
) => {
  if (isClosing(ctx)) return;
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = await runtime.evaluateBaseAccess(payload.baseId, sessionToken);
  if (isClosing(ctx)) return;
  if (!access.ok) {
    closeWithError(ctx, runtime, access.code, access.message, undefined, WS_TYPE.metadataError);
    return;
  }

  const subscription: Subscription = { kind: "metadata", baseId: access.baseId };
  stopSubscription(ctx, runtime);
  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.subscription = subscription;
  const baselineCursor = await resolveSubscriptionCursor(ctx, runtime, payload.fromCursor, () =>
    runtime.latestMetadataCursor(access.baseId),
  );
  if (!baselineCursor) return;
  if (isClosing(ctx) || ctx.subscription !== subscription) return;
  if (!send(ctx.socket, WS_TYPE.metadataReady, { baseId: access.baseId, cursor: baselineCursor })) {
    closeWithError(ctx, runtime, "backpressure", "Live updates exceeded the connection capacity");
    return;
  }
  startStream(ctx, runtime, baselineCursor);
  startAccessRefresh(ctx, runtime);
};

const handleWorkflowRunsSubscribe = async (
  ctx: WsContext,
  runtime: WorkspaceRuntime,
  payload: z.infer<typeof SubscribeWorkflowRunsMessageSchema>["payload"],
) => {
  if (isClosing(ctx)) return;
  const sessionToken = payload.sessionToken ?? ctx.sessionToken;
  const access = await runtime.evaluateWorkflowAccess(payload.workflowId, sessionToken);
  if (isClosing(ctx)) return;
  if (!access.ok || !access.workflowId) {
    closeWithError(
      ctx,
      runtime,
      access.ok ? "not_found" : access.code,
      access.ok ? "Workflow not found" : access.message,
      undefined,
      WS_TYPE.workflowRunsError,
    );
    return;
  }

  const subscription: Subscription = {
    kind: "workflow-runs",
    baseId: access.baseId,
    workflowId: access.workflowId,
  };
  stopSubscription(ctx, runtime);
  ctx.phase = "subscribed";
  ctx.sessionToken = sessionToken;
  ctx.subscription = subscription;
  const workflowId = access.workflowId;
  const baselineCursor = await resolveSubscriptionCursor(ctx, runtime, payload.fromCursor, () =>
    runtime.latestWorkflowRunCursor(access.baseId, workflowId),
  );
  if (!baselineCursor) return;
  if (isClosing(ctx) || ctx.subscription !== subscription) return;
  if (!send(ctx.socket, WS_TYPE.workflowRunsReady, { workflowId, cursor: baselineCursor })) {
    closeWithError(ctx, runtime, "backpressure", "Workflow updates exceeded the connection capacity");
    return;
  }
  startStream(ctx, runtime, baselineCursor);
  startAccessRefresh(ctx, runtime);
};

const handleClientMessage = async (ctx: WsContext, runtime: WorkspaceRuntime, raw: string): Promise<void> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    closeWithError(
      ctx,
      runtime,
      "invalid_json",
      "Invalid JSON payload",
      ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
    );
    return;
  }

  const message = ClientMessageSchema.safeParse(parsed);
  if (!message.success) {
    closeWithError(
      ctx,
      runtime,
      "invalid_message",
      "Invalid message payload",
      ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
    );
    return;
  }

  if (message.data.type === WS_TYPE.recordsSubscribe) {
    await handleSubscribe(ctx, runtime, message.data.payload);
  } else if (message.data.type === WS_TYPE.metadataSubscribe) {
    await handleMetadataSubscribe(ctx, runtime, message.data.payload);
  } else if (message.data.type === WS_TYPE.workflowRunsSubscribe) {
    await handleWorkflowRunsSubscribe(ctx, runtime, message.data.payload);
  }
};

export const createWorkspaceWebSocketSession = (sessionToken: string | null, overrides: Partial<WorkspaceRuntime> = {}) => {
  const runtime = { ...workspaceRuntime, ...overrides };
  let ctx: WsContext | null = null;
  let processing: Promise<void> = Promise.resolve();
  let pendingMessages = 0;

  return {
    open(socket: ServerWebSocket<unknown>): void {
      ctx = createContext(socket, sessionToken);
    },

    message(data: unknown): void {
      if (!ctx || ctx.phase === "closing") return;
      if (typeof data !== "string" || data.length > MAX_CLIENT_MESSAGE_LENGTH) {
        closeWithError(
          ctx,
          runtime,
          "invalid_message",
          "Invalid websocket subscription",
          ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
        );
        return;
      }
      if (pendingMessages >= MAX_PENDING_MESSAGES) {
        closeWithError(
          ctx,
          runtime,
          "backpressure",
          "Too many pending websocket messages",
          ctx.subscription?.kind === "records" ? ctx.subscription.tableId : undefined,
        );
        return;
      }

      pendingMessages++;
      const currentCtx = ctx;
      processing = processing
        .then(() => handleClientMessage(currentCtx, runtime, data))
        .catch((error) => {
          log.error("Websocket message handling failed", {
            subscription: currentCtx.subscription,
            error: error instanceof Error ? error.message : String(error),
          });
          closeWithError(
            currentCtx,
            runtime,
            "internal_error",
            "Message handling failed",
            currentCtx.subscription?.kind === "records" ? currentCtx.subscription.tableId : undefined,
          );
        })
        .finally(() => {
          pendingMessages = Math.max(0, pendingMessages - 1);
        });
    },

    async close(): Promise<void> {
      if (!ctx) return;
      ctx.phase = "closing";
      stopSubscription(ctx, runtime);
      await processing.catch(() => undefined);
    },

    drain(): Promise<void> {
      return processing;
    },
  };
};

const app = new Hono().get(
  "/",
  upgradeWebSocket((c) => {
    const session = createWorkspaceWebSocketSession(auth.session.getToken(c));

    return {
      onOpen(_, ws) {
        session.open(ws.raw as ServerWebSocket<unknown>);
      },

      onMessage(event) {
        session.message(event.data);
      },

      onClose() {
        return session.close();
      },
    };
  }),
);

export default app;
