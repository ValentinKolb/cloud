import type { PulseCurrentState, PulseRecordedEvent } from "../../contracts";
import { derivePulseResource, pulseSignalSubject } from "../../resource-model";

type SignalIdentity = {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
};

const signalName = (params: SignalIdentity): string | undefined => params.metric ?? params.key ?? params.kind;

export const stateRowId = (state: PulseCurrentState): string =>
  [state.key, state.sourceId ?? "", state.entityId, JSON.stringify(state.dimensions)].join(":");

export const eventGroupId = (event: PulseRecordedEvent): string => [event.kind, signalSubject(event)].join(":");

export const stateGroupId = (state: PulseCurrentState): string => [state.key, state.sourceId ?? ""].join(":");

export const signalResourceKey = (params: SignalIdentity): string | null =>
  derivePulseResource({ signalName: signalName(params), ...params })?.key ?? null;

export const signalSubject = (params: SignalIdentity): string => pulseSignalSubject({ signalName: signalName(params), ...params });

export const dimensionsSummary = (dimensions: Record<string, string>, limit = 3): string =>
  Object.entries(dimensions)
    .filter(([key]) => !["host", "instance", "collector"].includes(key))
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");
