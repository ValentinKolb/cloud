import type { PulseCurrentState, PulseRecordedEvent } from "../contracts";

export type RecordedEventRow = {
  id: string;
  kind: string;
  ts: Date | string;
  value: number | null;
  source_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  dimensions: unknown;
  attributes: unknown;
  payload: unknown;
  recorded_at: Date | string;
};

export type CurrentStateRow = {
  state_key: string;
  value: unknown;
  source_id: string | null;
  entity_id: string;
  entity_type: string | null;
  dimensions: unknown;
  updated_at: Date | string;
};

export const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

export const isoNullable = (value: Date | string | null): string | null => (value ? iso(value) : null);

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const parseJsonObject = (value: unknown): Record<string, unknown> => {
  const parsed = parseJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};

export const normalizeDimensions = (dimensions: Record<string, unknown> | undefined): Record<string, string> => {
  const entries = Object.entries(dimensions ?? {})
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
};

export const jsonbObject = (value: Record<string, unknown>): string => JSON.stringify(value);

export const mapRecordedEvent = (row: RecordedEventRow): PulseRecordedEvent => ({
  id: row.id,
  kind: row.kind,
  ts: iso(row.ts),
  value: row.value,
  sourceId: row.source_id,
  entityId: row.entity_id,
  entityType: row.entity_type,
  dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  attributes: parseJsonObject(row.attributes),
  payload: parseJsonObject(row.payload),
  recordedAt: iso(row.recorded_at),
});

export const mapCurrentState = (row: CurrentStateRow): PulseCurrentState => ({
  key: row.state_key,
  value: parseJson(row.value),
  sourceId: row.source_id,
  entityId: row.entity_id,
  entityType: row.entity_type,
  dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  updatedAt: iso(row.updated_at),
});
