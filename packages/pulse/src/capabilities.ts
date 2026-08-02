import { err, fail, ok } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import type { z } from "zod";
import {
  BaseListDataSchema,
  BaseListInputSchema,
  FieldSearchDataSchema,
  FieldSearchInputSchema,
  MetricSearchDataSchema,
  MetricSearchInputSchema,
  QueryCompileDataSchema,
  QueryExecutionDataSchema,
  QueryTextInputSchema,
  SavedQueryExecuteInputSchema,
  SavedQueryListDataSchema,
  SavedQueryListInputSchema,
  SourceListDataSchema,
  SourceListInputSchema,
} from "./capability-contracts";
import type { PulseBase, PulseCurrentState, PulseRecordedEvent, PulseSavedQuery, PulseSource } from "./contracts";
import { accessScopeFor } from "./service/access-control";
import { pulseService } from "./service";

const QUERY_ROW_LIMIT = 100;
const QUERY_POINT_LIMIT = 500;

const encodeCursor = (offset: number): string => Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return ok(0);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; offset?: unknown };
    return value.v === 1 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0
      ? ok(Number(value.offset))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const scopeFor = (context: CapabilityExecutionContext) => accessScopeFor(context.actor, context.accessSubject);

const baseHref = (baseId: string) => `/app/pulse/${baseId}`;
const resourceHref = (baseId: string, resourceKey: string) => `${baseHref(baseId)}/resources/${encodeURIComponent(resourceKey)}`;
const explorerHref = (baseId: string) => `${baseHref(baseId)}/explorer`;

const mapBase = (base: PulseBase) => ({
  id: base.id,
  name: base.name.slice(0, 120),
  description: base.description?.slice(0, 1_000) ?? null,
  createdAt: base.createdAt,
  updatedAt: base.updatedAt,
});

const mapSource = (source: PulseSource) => ({
  id: source.id,
  baseId: source.baseId,
  kind: source.kind,
  name: source.name.slice(0, 120),
  enabled: source.enabled,
  lastSeenAt: source.lastSeenAt,
  lastError: source.lastError?.slice(0, 2_000) ?? null,
  lastErrorAt: source.lastErrorAt,
  updatedAt: source.updatedAt,
});

const mapSavedQuery = (query: PulseSavedQuery) => ({
  id: query.id,
  baseId: query.baseId,
  name: query.name.slice(0, 120),
  description: query.description?.slice(0, 1_000) ?? null,
  query: query.query.slice(0, 2_000),
  createdAt: query.createdAt,
  updatedAt: query.updatedAt,
});

const pageResult = <T>(items: T[], offset: number, limit: number) => {
  const data = items.slice(0, limit);
  const hasMore = items.length > limit;
  return { data, page: { hasMore, ...(hasMore ? { nextCursor: encodeCursor(offset + data.length) } : {}) } };
};

const runBaseSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return ok({ data: [] });
  const result = await pulseService.base.list(scope.data, { query: input.query, limit: input.limit });
  if (!result.ok) return result;
  const data: CloudResourceView[] = result.data.map((base) => ({
    ref: { type: "pulse.base", id: base.id },
    title: base.name.slice(0, 500),
    preview: base.description?.slice(0, 2_000),
    icon: "ti ti-activity-heartbeat",
    priority: 7,
    metadata: [{ label: "Type", value: "Pulse Base" }],
    links: [{ rel: "open", href: baseHref(base.id) }],
  }));
  return ok({ data });
};

const runBaseList = async (input: z.infer<typeof BaseListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.base.list(scope.data, { query: input.query, limit: input.limit + 1, offset: cursor.data });
  if (!result.ok) return result;
  const page = pageResult(result.data.map(mapBase), cursor.data, input.limit);
  return ok({
    ...page,
    refs: page.data.map((base) => ({ type: "pulse.base" as const, id: base.id })),
  });
};

const runSourceList = async (input: z.infer<typeof SourceListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.source.list(input.baseId, scope.data, {
    query: input.query,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  if (!result.ok) return result;
  const page = pageResult(result.data.map(mapSource), cursor.data, input.limit);
  return ok({
    ...page,
    refs: page.data.map((source) => ({ type: "pulse.source" as const, id: source.id })),
    links: [{ rel: "open" as const, href: `${baseHref(input.baseId)}/sources` }],
  });
};

const resourceRefId = (baseId: string, resourceKey: string): string =>
  `sha256:${new Bun.CryptoHasher("sha256").update(`${baseId}\0${resourceKey}`).digest("hex")}`;

const runResourceSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return ok({ data: [] });
  const result = await pulseService.query.searchResources(scope.data, {
    query: input.query,
    limit: input.limit,
  });
  if (!result.ok) return result;
  const data: CloudResourceView[] = result.data.map((resource) => ({
    ref: { type: "pulse.resource", id: resourceRefId(resource.baseId, resource.key) },
    title: resource.label.slice(0, 500),
    preview: [resource.type, resource.id].filter(Boolean).join(" · "),
    icon: "ti ti-box",
    priority: 6,
    metadata: [
      { label: "Base", value: resource.baseName.slice(0, 1_000) },
      { label: "Base ID", value: resource.baseId },
      { label: "Resource key", value: resource.key },
    ],
    links: [{ rel: "open", href: resourceHref(resource.baseId, resource.key) }],
  }));
  return ok({ data });
};

const runMetricSearch = async (input: z.infer<typeof MetricSearchInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.query.metrics(input.baseId, scope.data, {
    q: input.query,
    type: input.type,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  if (!result.ok) return result;
  const page = pageResult(
    result.data.map((metric) => ({
      ...metric,
      name: metric.name.slice(0, 240),
      unit: metric.unit?.slice(0, 120) ?? null,
    })),
    cursor.data,
    input.limit,
  );
  return ok({ ...page, refs: [{ type: "pulse.base", id: input.baseId }] });
};

const runFieldSearch = async (input: z.infer<typeof FieldSearchInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.query.fields(input.baseId, scope.data, {
    q: input.query,
    scope: input.scope,
    role: input.role,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  if (!result.ok) return result;
  const page = pageResult(
    result.data.map((field) => ({ ...field, signalName: field.signalName.slice(0, 240) })),
    cursor.data,
    input.limit,
  );
  return ok({ ...page, refs: [{ type: "pulse.base", id: input.baseId }] });
};

const runQueryCompile = async (input: z.infer<typeof QueryTextInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.query.compileText({ ...input, user: scope.data });
  if (!result.ok) return result;
  return ok({
    data: {
      valid: result.data.ok,
      kind: result.data.compiled?.kind ?? null,
      diagnostics: result.data.diagnostics.slice(0, 20).map((diagnostic) => ({
        ...diagnostic,
        message: diagnostic.message.slice(0, 1_000),
      })),
    },
    refs: [{ type: "pulse.base", id: input.baseId }],
    links: [{ rel: "open" as const, href: explorerHref(input.baseId) }],
  });
};

const compactStateValue = (value: unknown): string | number | boolean | null => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return typeof value === "string" ? value.slice(0, 1_000) : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  try {
    return JSON.stringify(value).slice(0, 1_000);
  } catch {
    return String(value).slice(0, 1_000);
  }
};

const compactEvent = (event: PulseRecordedEvent) => ({
  id: event.id,
  kind: event.kind.slice(0, 240),
  ts: event.ts,
  value: event.value,
  sourceId: event.sourceId,
  entityId: event.entityId?.slice(0, 500) ?? null,
  entityType: event.entityType?.slice(0, 120) ?? null,
  dimensions: event.dimensions,
});

const compactState = (state: PulseCurrentState) => ({
  key: state.key.slice(0, 240),
  value: compactStateValue(state.value),
  sourceId: state.sourceId,
  entityId: state.entityId.slice(0, 500),
  entityType: state.entityType?.slice(0, 120) ?? null,
  dimensions: state.dimensions,
  updatedAt: state.updatedAt,
});

const executeQuery = async (input: z.infer<typeof QueryTextInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const compiled = await pulseService.query.compileText({ ...input, user: scope.data });
  if (!compiled.ok) return compiled;
  if (!compiled.data.ok || !compiled.data.compiled) {
    return fail(err.badInput(compiled.data.diagnostics[0]?.message ?? "Invalid Pulse query"));
  }
  const result = await pulseService.query.executeCompiled(compiled.data.compiled, scope.data, {
    maxMetricPoints: QUERY_POINT_LIMIT,
    maxAggregatePoints: QUERY_POINT_LIMIT,
    maxRows: QUERY_ROW_LIMIT + 1,
  });
  if (!result.ok) return result;
  const rowQuery =
    compiled.data.compiled.kind === "events" && (compiled.data.compiled.aggregation ?? "rows") === "rows"
      ? compiled.data.compiled
      : compiled.data.compiled.kind === "states"
        ? compiled.data.compiled
        : null;
  const returnedRows = result.data.events.length + result.data.states.length;
  return ok({
    data: {
      kind: compiled.data.compiled.kind,
      query: input.query,
      points: result.data.points.map((point) => ({
        ...point,
        value: point.value === null || Number.isFinite(point.value) ? point.value : null,
      })),
      events: result.data.events.slice(0, QUERY_ROW_LIMIT).map(compactEvent),
      states: result.data.states.slice(0, QUERY_ROW_LIMIT).map(compactState),
      limitApplied: rowQuery ? Math.min(rowQuery.limit, QUERY_ROW_LIMIT) : QUERY_POINT_LIMIT,
      truncated: Boolean(rowQuery && rowQuery.limit > QUERY_ROW_LIMIT && returnedRows > QUERY_ROW_LIMIT),
    },
    refs: [{ type: "pulse.base", id: input.baseId }],
    links: [{ rel: "open" as const, href: explorerHref(input.baseId) }],
  });
};

const runSavedQueryList = async (input: z.infer<typeof SavedQueryListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const result = await pulseService.savedQuery.list(input.baseId, scope.data, {
    query: input.query,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  if (!result.ok) return result;
  const page = pageResult(result.data.map(mapSavedQuery), cursor.data, input.limit);
  return ok({
    ...page,
    refs: page.data.map((query) => ({ type: "pulse.saved_query" as const, id: query.id })),
    links: [{ rel: "open" as const, href: explorerHref(input.baseId) }],
  });
};

const runSavedQueryExecute = async (input: z.infer<typeof SavedQueryExecuteInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const saved = await pulseService.savedQuery.get(input.baseId, input.queryId, scope.data);
  if (!saved.ok) return saved;
  const result = await executeQuery({ baseId: input.baseId, query: saved.data.query }, context);
  if (!result.ok) return result;
  return ok({
    ...result.data,
    refs: [
      { type: "pulse.base", id: input.baseId },
      { type: "pulse.saved_query", id: saved.data.id },
    ],
    links: [{ rel: "open" as const, href: explorerHref(input.baseId) }],
  });
};

export const pulseCapabilities = defineCapabilities({
  version: 1,
  types: {
    base: { title: "Pulse Base", description: "A permission-scoped Pulse telemetry workspace.", icon: "ti ti-activity-heartbeat" },
    source: { title: "Pulse Source", description: "A telemetry source and its current ingest or scrape health.", icon: "ti ti-plug" },
    resource: { title: "Pulse Resource", description: "An observed resource with metrics, events, or states.", icon: "ti ti-box" },
    saved_query: { title: "Pulse Saved Query", description: "A named, validated Pulse query stored in a Base.", icon: "ti ti-code" },
  },
  queries: {
    "base.search": {
      title: "Search Pulse Bases",
      description: "Find accessible Pulse Bases by name or description.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: { tags: [{ tag: "pulse", title: "Pulse", description: "Show Pulse Bases only.", aliases: ["telemetry"] }] },
      run: runBaseSearch,
    },
    "base.list": {
      title: "List Pulse Bases",
      description: "Start here to list accessible Pulse Bases and obtain a baseId for catalog or query calls.",
      input: BaseListInputSchema,
      data: BaseListDataSchema,
      openWorld: false,
      run: runBaseList,
    },
    "source.list": {
      title: "List Pulse Sources",
      description: "List bounded source health for one readable Base without exposing credentials.",
      input: SourceListInputSchema,
      data: SourceListDataSchema,
      openWorld: false,
      run: runSourceList,
    },
    "resource.search": {
      title: "Search Pulse Resources",
      description: "Find observed resources across accessible Pulse Bases.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: {
        tags: [
          { tag: "pulse-resource", title: "Pulse resources", description: "Show observed Pulse resources only.", aliases: ["resource"] },
        ],
      },
      run: runResourceSearch,
    },
    "metric.search": {
      title: "Search Pulse Metrics",
      description: "Discover metric names and types in one readable Base before authoring a query.",
      input: MetricSearchInputSchema,
      data: MetricSearchDataSchema,
      openWorld: false,
      run: runMetricSearch,
    },
    "field.search": {
      title: "Search Pulse Fields",
      description: "Discover dimension or attribute keys for metrics, events, and states without exposing sensitive values.",
      input: FieldSearchInputSchema,
      data: FieldSearchDataSchema,
      openWorld: false,
      run: runFieldSearch,
    },
    "query.compile": {
      title: "Compile Pulse Query",
      description: "Validate Pulse query DSL and return its kind and actionable diagnostics without reading telemetry rows.",
      input: QueryTextInputSchema,
      data: QueryCompileDataSchema,
      openWorld: false,
      run: runQueryCompile,
    },
    "query.execute": {
      title: "Execute Pulse Query",
      description: "Execute validated Pulse query DSL with at most 500 points or 100 compact rows; raw event payloads are omitted.",
      input: QueryTextInputSchema,
      data: QueryExecutionDataSchema,
      openWorld: false,
      run: executeQuery,
    },
    "saved_query.list": {
      title: "List saved Pulse Queries",
      description: "List bounded named queries in one readable Base.",
      input: SavedQueryListInputSchema,
      data: SavedQueryListDataSchema,
      openWorld: false,
      run: runSavedQueryList,
    },
    "saved_query.execute": {
      title: "Execute saved Pulse Query",
      description: "Load and execute the exact stored query with the same compact limits as query.execute.",
      input: SavedQueryExecuteInputSchema,
      data: QueryExecutionDataSchema,
      openWorld: false,
      run: runSavedQueryExecute,
    },
  },
});
