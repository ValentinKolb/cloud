import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { AGGREGATIONS } from "../contracts";
import type { Aggregation, EventQuery, MetricQuery, PulseExplorerQuery, StateQuery } from "../contracts";

const MAX_DURATION_MS = 90 * 24 * 60 * 60_000;

type QueryTokenQuote = '"' | "'";

type QueryTokenState = {
  tokens: string[];
  current: string;
  quote: QueryTokenQuote | null;
};

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
  if (intervalToMs(input) === null) return null;
  const match = input.trim().match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const unit = match[2] === "m" ? "minutes" : match[2] === "h" ? "hours" : "days";
  return `${Number(match[1])} ${unit}`;
};

export const tokenizeQueryText = (text: string): string[] => {
  const state: QueryTokenState = { tokens: [], current: "", quote: null };
  for (let i = 0; i < text.length; i += 1) {
    i = readQueryTokenChar(text, i, state);
  }
  if (state.quote) return [];
  pushCurrentQueryToken(state);
  return state.tokens;
};

const readQueryTokenChar = (text: string, index: number, state: QueryTokenState): number => {
  const char = text[index]!;
  if (state.quote) return readQuotedQueryTokenChar(text, index, state);
  if (isQueryQuote(char)) state.quote = char;
  else if (isQueryTokenSeparator(char)) pushQueryTokenSeparator(char, state);
  else state.current += char;
  return index;
};

const readQuotedQueryTokenChar = (text: string, index: number, state: QueryTokenState): number => {
  const char = text[index]!;
  if (char === state.quote) {
    state.quote = null;
    return index;
  }
  if (char === "\\" && index + 1 < text.length) {
    state.current += text[index + 1]!;
    return index + 1;
  }
  state.current += char;
  return index;
};

const isQueryQuote = (char: string): char is QueryTokenQuote => char === '"' || char === "'";
const isQueryTokenSeparator = (char: string): boolean => /\s/.test(char) || char === ",";

const pushQueryTokenSeparator = (char: string, state: QueryTokenState) => {
  pushCurrentQueryToken(state);
  if (char === ",") state.tokens.push(",");
};

const pushCurrentQueryToken = (state: QueryTokenState) => {
  if (!state.current) return;
  state.tokens.push(state.current);
  state.current = "";
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

type SharedClauseState = SharedClauses & {
  index: number;
};

type SharedClauseReader = (tokens: string[], state: SharedClauseState) => Result<void>;

type MetricTokenParts = {
  metric: string;
  aggregation: Aggregation;
  bucket: string;
  sharedTokens: string[];
};

const parseSharedQueryClauses = (
  tokens: string[],
  startIndex: number,
  defaults: { since?: string; limit?: number } = {},
): Result<SharedClauses> => {
  const state: SharedClauseState = {
    since: defaults.since ?? "",
    sourceId: null,
    entityId: null,
    entityType: null,
    dimensions: {},
    limit: defaults.limit ?? 500,
    index: startIndex,
  };
  while (state.index < tokens.length) {
    const clause = readSharedQueryClause(tokens, state);
    if (!clause.ok) return fail(clause.error);
  }
  const { index: _index, ...clauses } = state;
  return ok(clauses);
};

const readSharedQueryClause = (tokens: string[], state: SharedClauseState): Result<void> => {
  const token = tokens[state.index]?.toLowerCase();
  const reader = token ? SHARED_CLAUSE_READERS[token] : undefined;
  if (reader) return reader(tokens, state);
  return fail(err.badInput(`Unexpected token "${tokens[state.index]}"`));
};

const SHARED_CLAUSE_READERS: Record<string, SharedClauseReader> = {
  since: (tokens, state) => {
    state.since = tokens[state.index + 1] ?? "";
    state.index += 2;
    return ok(undefined);
  },
  source: (tokens, state) => {
    state.sourceId = tokens[state.index + 1] ?? null;
    if (!validateUuid(state.sourceId)) return fail(err.badInput("Source must be a valid UUID"));
    state.index += 2;
    return ok(undefined);
  },
  entity: (tokens, state) => {
    state.entityId = tokens[state.index + 1] ?? null;
    if (!state.entityId) return fail(err.badInput("Entity is missing"));
    state.index += 2;
    return ok(undefined);
  },
  entity_type: (tokens, state) => {
    state.entityType = tokens[state.index + 1] ?? null;
    if (!state.entityType) return fail(err.badInput("Entity type is missing"));
    state.index += 2;
    return ok(undefined);
  },
  limit: (tokens, state) => readLimitClause(tokens, state),
  where: (tokens, state) => readWhereClause(tokens, state),
};

const readLimitClause = (tokens: string[], state: SharedClauseState): Result<void> => {
  const parsed = readQueryLimit(tokens[state.index + 1], state.limit);
  if (!parsed.ok) return fail(parsed.error);
  state.limit = parsed.data;
  state.index += 2;
  return ok(undefined);
};

const readWhereClause = (tokens: string[], state: SharedClauseState): Result<void> => {
  state.index += 1;
  while (state.index < tokens.length) {
    const filter = tokens[state.index];
    if (!filter || filter === ",") {
      state.index += 1;
      continue;
    }
    const parsed = parseDimensionFilter(filter);
    if (!parsed) return fail(err.badInput(`Invalid dimension filter "${filter}"`));
    state.dimensions[parsed[0]] = parsed[1];
    state.index += 1;
  }
  return ok(undefined);
};

const compileMetricQueryTokens = (baseId: string, tokens: string[]): Result<MetricQuery> => {
  const parts = readMetricTokenParts(tokens);
  if (!parts.ok) return fail(parts.error);
  const shared = parseSharedQueryClauses(parts.data.sharedTokens, 2, { since: "24h", limit: 1_000 });
  if (!shared.ok) return fail(shared.error);
  if (!intervalToMs(parts.data.bucket) || !intervalToMs(shared.data.since)) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  return ok(metricQueryFromParts(baseId, parts.data, shared.data));
};

const readMetricTokenParts = (tokens: string[]): Result<MetricTokenParts> => {
  const metric = tokens[1]?.trim();
  if (!metric) return fail(err.badInput("Metric query name is missing"));
  const aggregation = readMetricAggregation(tokens[2]);
  if (!aggregation.ok) return fail(aggregation.error);
  const metricOptions = readMetricOptions(tokens, metric);
  return ok({ metric, aggregation: aggregation.data, bucket: metricOptions.bucket, sharedTokens: metricOptions.sharedTokens });
};

const readMetricAggregation = (value: string | undefined): Result<Aggregation> => {
  if (!value || !AGGREGATIONS.includes(value as Aggregation)) return fail(err.badInput(`Unsupported aggregation "${value ?? ""}"`));
  return ok(value as Aggregation);
};

const readMetricOptions = (tokens: string[], metric: string): Pick<MetricTokenParts, "bucket" | "sharedTokens"> => {
  let bucket = "5m";
  let index = 3;
  const sharedTokens = ["metric", metric, "since", "24h"];
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
  return { bucket, sharedTokens };
};

const metricQueryFromParts = (baseId: string, parts: MetricTokenParts, shared: SharedClauses): MetricQuery => ({
  kind: "metric",
  baseId,
  metric: parts.metric,
  aggregation: parts.aggregation,
  bucket: parts.bucket,
  since: shared.since,
  sourceId: shared.sourceId,
  entityId: shared.entityId,
  entityType: shared.entityType,
  dimensions: shared.dimensions,
});

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
  const trimmed = text.trim();
  if (!trimmed) return fail(err.badInput("Query is empty"));
  const tokens = tokenizeQueryText(trimmed);
  if (tokens.length === 0) return fail(err.badInput("Query has an unterminated quote"));
  const kind = tokens[0]?.toLowerCase();
  if (kind === "metric") return compileMetricQueryTokens(baseId, tokens);
  if (kind === "events") return compileEventQueryTokens(baseId, tokens);
  if (kind === "states") return compileStateQueryTokens(baseId, tokens);
  return fail(err.badInput('Query must start with "metric", "events", or "states"'));
};
