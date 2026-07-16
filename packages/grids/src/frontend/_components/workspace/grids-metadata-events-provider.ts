import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { gridsWorkspace } from "../../../lib/workspace-events";

type LiveProviderError = {
  code: string;
  message: string;
};

type GridsMetadataEventsProviderOptions = {
  baseId: string;
  initialCursor?: string | null;
  onReady?: () => void;
  onEvent?: (cursor: string | null) => void;
  onError?: (error: LiveProviderError) => void;
  onRevoked?: (error: LiveProviderError) => void;
  onFatal?: (error: LiveProviderError) => void;
};

type ProviderMessage = {
  type?: unknown;
  payload?: unknown;
};

const TERMINAL_ERROR_CODES = new Set(["login_required", "access_denied", "not_found", "internal_error", "backpressure"]);

const parseJsonMessage = (raw: string): ProviderMessage | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ProviderMessage) : null;
  } catch {
    return null;
  }
};

const errorFromPayload = (payload: unknown, fallback: LiveProviderError): LiveProviderError => {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : fallback.code,
    message: typeof value.message === "string" ? value.message : fallback.message,
  };
};

const isMetadataEventForBase = (payload: unknown, baseId: string): boolean => {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as { baseId?: unknown; event?: unknown };
  if (value.baseId !== baseId || !value.event || typeof value.event !== "object") return false;
  const event = value.event as { v?: unknown; baseId?: unknown; type?: unknown };
  return event.v === 1 && event.baseId === baseId && typeof event.type === "string";
};

export const createGridsMetadataEventsProvider = (opts: GridsMetadataEventsProviderOptions) => {
  let revoked = false;

  return createLiveWebSocket<ProviderMessage>({
    url: "/api/grids/ws",
    initialCursor: opts.initialCursor,
    activity: "visible",
    subscribe: (cursor) => ({
      type: gridsWorkspace.wsType.metadataSubscribe,
      payload: {
        baseId: opts.baseId,
        fromCursor: cursor,
      },
    }),
    parse: parseJsonMessage,
    onMessage: (message, controls) => {
      if (message.type === gridsWorkspace.wsType.metadataReady) {
        opts.onReady?.();
        return;
      }

      if (message.type === gridsWorkspace.wsType.metadataRevoked) {
        const error = errorFromPayload(message.payload, { code: "access_denied", message: "Access was revoked." });
        revoked = true;
        try {
          opts.onRevoked?.(error);
        } finally {
          controls.terminate(error);
        }
        return;
      }

      if (message.type === gridsWorkspace.wsType.metadataError) {
        const error = errorFromPayload(message.payload, { code: "internal_error", message: "Live metadata updates failed." });
        if (TERMINAL_ERROR_CODES.has(error.code)) controls.terminate(error);
        else opts.onError?.(error);
        return;
      }

      if (message.type !== gridsWorkspace.wsType.metadataEvent || !message.payload || typeof message.payload !== "object") return;
      if (!isMetadataEventForBase(message.payload, opts.baseId)) return;
      const payload = message.payload as { cursor?: unknown };
      opts.onEvent?.(typeof payload.cursor === "string" ? payload.cursor : null);
    },
    onFatal: (error) => {
      if (!revoked) opts.onFatal?.(error);
    },
  });
};
