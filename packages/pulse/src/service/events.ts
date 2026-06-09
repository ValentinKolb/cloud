import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("pulse:events");

export type PulseDataEvent = {
  v: 1;
  type: "base.changed" | "source.changed" | "metric.ingested" | "event.ingested" | "state.changed";
  baseId: string;
  sourceId?: string | null;
  metric?: string;
  eventKind?: string;
  stateKey?: string;
  occurredAt: string;
};

const pulseTopic = topic<PulseDataEvent>({
  id: "data",
  prefix: "cloud:pulse:events",
  retentionMs: 24 * 60 * 60 * 1000,
  limits: { payloadBytes: 12_000 },
});

export const emitPulseEvent = async (event: Omit<PulseDataEvent, "v" | "occurredAt"> & { occurredAt?: string }): Promise<void> => {
  const payload: PulseDataEvent = {
    v: 1,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  };

  try {
    await pulseTopic.pub({
      tenantId: payload.baseId,
      orderingKey: payload.sourceId ?? payload.type,
      idempotencyKey: `${payload.type}:${payload.sourceId ?? "base"}:${payload.metric ?? payload.eventKind ?? payload.stateKey ?? "all"}:${payload.occurredAt}`,
      data: payload,
    });
  } catch (error) {
    log.warn("Failed to publish Pulse event", {
      type: payload.type,
      baseId: payload.baseId,
      sourceId: payload.sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const livePulseEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  pulseTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestPulseEventCursor = async (baseId: string): Promise<string | null> => pulseTopic.latestCursor({ tenantId: baseId });
