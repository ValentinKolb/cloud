import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { AGGREGATIONS } from "../contracts";
import type { Aggregation, EventQuery, MetricQuery, PulseExplorerQuery, StateQuery } from "../contracts";

const MAX_DURATION_MS = 90 * 24 * 60 * 60_000;

export const intervalToMs = (input: string): number | null => {
  const match = input.trim().match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const duration = unit === "m" ? amount * 60_000 : unit === "h" ? amount * 60 * 60_000 : amount * 24 * 60 * 60_000;
  return duration <= MAX_DURATION_MS ? duration : null;
};

export const durationToInterval = (input: string): string | null => {
  const match = input.trim().match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const unit = match[2] === "m" ? "minutes" : match[2] === "h" ? "hours" : "days";
  return `${Number(match[1])} ${unit}`;
};

export const tokenizeQueryText = (text: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && i + 1 < text.length) {
        i += 1;
        current += text[i]!;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char) || char === ",") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      if (char === ",") tokens.push(",");
      continue;
    }
    current += char;
  }
  if (quote) return [];
  if (current) tokens.push(current);
  return tokens;
};

const parseDimensionFilter = (token: string): [string, string] | null => {
  const separator = token.indexOf("=");
  if (separator <= 0) return null;
  const key = token.slice(0, separator).trim();
  const value = token.slice(separator + 1).trim();
  return key && value ? [key, value] : null;
};

const readQueryName = (token: string | undefined): string | null => {
  const value = token?.trim();
  if (!value || value === "*") return null;
  return value;
};

const readQueryLimit = (value: string | undefined, fallback: number): Result<number> => {
  if (!value) return ok(fallback);
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) return fail(err.badInput("Limit must be a positive integer"));
  return ok(Math.min(limit, 1_000));
};

const validateUuid = (value: string | null): boolean =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

type SharedClauses = {
  since: string;
  sourceId: string | null;
  entityId: string | null;
  entityType: string | null;
  dimensions: Record<string, string>;
  limit: number;
};

const parseSharedQueryClauses = (
  tokens: string[],
  startIndex: number,
  defaults: { since?: string; limit?: number } = {},
): Result<SharedClauses> => {
  let since = defaults.since ?? "";
  let sourceId: string | null = null;
  let entityId: string | null = null;
  let entityType: string | null = null;
  let limit = defaults.limit ?? 500;
  const dimensions: Record<string, string> = {};
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index]?.toLowerCase();
    if (token === "since") {
      since = tokens[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (token === "source") {
      sourceId = tokens[index + 1] ?? null;
      if (!validateUuid(sourceId)) return fail(err.badInput("Source must be a valid UUID"));
      index += 2;
      continue;
    }
    if (token === "entity") {
      entityId = tokens[index + 1] ?? null;
      if (!entityId) return fail(err.badInput("Entity is missing"));
      index += 2;
      continue;
    }
    if (token === "entity_type") {
      entityType = tokens[index + 1] ?? null;
      if (!entityType) return fail(err.badInput("Entity type is missing"));
      index += 2;
      continue;
    }
    if (token === "limit") {
      const parsed = readQueryLimit(tokens[index + 1], limit);
      if (!parsed.ok) return fail(parsed.error);
      limit = parsed.data;
      index += 2;
      continue;
    }
    if (token === "where") {
      index += 1;
      while (index < tokens.length) {
        const filter = tokens[index];
        if (!filter || filter === ",") {
          index += 1;
          continue;
        }
        const parsed = parseDimensionFilter(filter);
        if (!parsed) return fail(err.badInput(`Invalid dimension filter "${filter}"`));
        dimensions[parsed[0]] = parsed[1];
        index += 1;
      }
      continue;
    }
    return fail(err.badInput(`Unexpected token "${tokens[index]}"`));
  }
  return ok({ since, sourceId, entityId, entityType, dimensions, limit });
};

const compileMetricQueryTokens = (baseId: string, tokens: string[]): Result<MetricQuery> => {
  const metric = tokens[1]?.trim();
  const aggregation = tokens[2] as Aggregation | undefined;
  if (!metric) return fail(err.badInput("Metric query name is missing"));
  if (!aggregation || !AGGREGATIONS.includes(aggregation)) return fail(err.badInput(`Unsupported aggregation "${aggregation ?? ""}"`));

  let bucket = "5m";
  let since = "24h";
  let index = 3;
  const sharedTokens = ["metric", metric, "since", since];
  while (index < tokens.length) {
    const token = tokens[index]?.toLowerCase();
    if (token === "every") {
      bucket = tokens[index + 1] ?? "";
      index += 2;
      continue;
    }
    sharedTokens.push(tokens[index]!);
    index += 1;
  }
  const shared = parseSharedQueryClauses(sharedTokens, 2, { since, limit: 1_000 });
  if (!shared.ok) return fail(shared.error);
  since = shared.data.since;

  if (!intervalToMs(bucket) || !intervalToMs(since)) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  return ok({
    kind: "metric",
    baseId,
    metric,
    aggregation,
    bucket,
    since,
    sourceId: shared.data.sourceId,
    entityId: shared.data.entityId,
    entityType: shared.data.entityType,
    dimensions: shared.data.dimensions,
  });
};

const compileEventQueryTokens = (baseId: string, tokens: string[]): Result<EventQuery> => {
  const shared = parseSharedQueryClauses(tokens, 2, { since: "24h", limit: 500 });
  if (!shared.ok) return fail(shared.error);
  if (!intervalToMs(shared.data.since)) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  return ok({
    kind: "events",
    baseId,
    event: readQueryName(tokens[1]),
    since: shared.data.since,
    sourceId: shared.data.sourceId,
    entityId: shared.data.entityId,
    entityType: shared.data.entityType,
    dimensions: shared.data.dimensions,
    limit: shared.data.limit,
  });
};

const compileStateQueryTokens = (baseId: string, tokens: string[]): Result<StateQuery> => {
  const shared = parseSharedQueryClauses(tokens, 2, { since: "", limit: 500 });
  if (!shared.ok) return fail(shared.error);
  if (shared.data.since && !intervalToMs(shared.data.since)) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  return ok({
    kind: "states",
    baseId,
    state: readQueryName(tokens[1]),
    since: shared.data.since || null,
    sourceId: shared.data.sourceId,
    entityId: shared.data.entityId,
    entityType: shared.data.entityType,
    dimensions: shared.data.dimensions,
    limit: shared.data.limit,
  });
};

export const compilePulseQueryText = (baseId: string, text: string): Result<PulseExplorerQuery> => {
  const tokens = tokenizeQueryText(text.trim());
  if (tokens.length === 0) return fail(err.badInput("Query is empty or has an unterminated quote"));
  const kind = tokens[0]?.toLowerCase();
  if (kind === "metric") return compileMetricQueryTokens(baseId, tokens);
  if (kind === "events") return compileEventQueryTokens(baseId, tokens);
  if (kind === "states") return compileStateQueryTokens(baseId, tokens);
  return fail(err.badInput('Query must start with "metric", "events", or "states"'));
};
