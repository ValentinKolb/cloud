import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import type { GridsWorkflowRunEvent } from "../../../lib/workflow-run-events";
import { gridsWorkspace } from "../../../lib/workspace-events";

type ProviderError = { code: string; message: string };

type WorkflowRunEventsProviderOptions = {
  workflowId: string;
  dashboardId?: string | null;
  dashboardWidgetId?: string | null;
  onReady?: () => void;
  onEvent?: (event: GridsWorkflowRunEvent, cursor: string | null) => void;
  onError?: (error: ProviderError) => void;
  onRevoked?: (error: ProviderError) => void;
  onFatal?: (error: ProviderError) => void;
};

type ProviderMessage = {
  type?: unknown;
  payload?: unknown;
};

const parseMessage = (raw: string): ProviderMessage | null => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as ProviderMessage) : null;
  } catch {
    return null;
  }
};

const parseError = (payload: unknown, fallback: ProviderError): ProviderError => {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : fallback.code,
    message: typeof value.message === "string" ? value.message : fallback.message,
  };
};

export const createWorkflowRunEventsProvider = (options: WorkflowRunEventsProviderOptions) => {
  let revoked = false;

  return createLiveWebSocket<ProviderMessage>({
    url: "/api/grids/ws",
    activity: "visible",
    subscribe: (cursor) => ({
      type: gridsWorkspace.wsType.workflowRunsSubscribe,
      payload: {
        workflowId: options.workflowId,
        ...(options.dashboardId && options.dashboardWidgetId
          ? { dashboardId: options.dashboardId, dashboardWidgetId: options.dashboardWidgetId }
          : {}),
        fromCursor: cursor,
      },
    }),
    parse: parseMessage,
    onMessage: (message, controls) => {
      if (message.type === gridsWorkspace.wsType.workflowRunsReady) {
        options.onReady?.();
        return;
      }
      if (message.type === gridsWorkspace.wsType.workflowRunsRevoked) {
        const error = parseError(message.payload, { code: "access_denied", message: "Workflow access was revoked." });
        revoked = true;
        try {
          options.onRevoked?.(error);
        } finally {
          controls.terminate(error);
        }
        return;
      }
      if (message.type === gridsWorkspace.wsType.workflowRunsError) {
        options.onError?.(parseError(message.payload, { code: "stream_failed", message: "Workflow updates failed." }));
        return;
      }
      if (message.type !== gridsWorkspace.wsType.workflowRunsEvent || !message.payload || typeof message.payload !== "object") return;
      const payload = message.payload as { cursor?: unknown; event?: unknown };
      if (!payload.event || typeof payload.event !== "object") return;
      const event = payload.event as GridsWorkflowRunEvent;
      if (event.v !== 1 || event.workflowId !== options.workflowId || !event.run || event.run.workflowId !== options.workflowId) return;
      const cursor = typeof payload.cursor === "string" ? payload.cursor : null;
      options.onEvent?.(event, cursor);
      controls.markApplied(cursor);
    },
    onFatal: (error) => {
      if (!revoked) options.onFatal?.(error);
    },
  });
};
