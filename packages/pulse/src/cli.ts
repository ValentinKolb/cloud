import {
  arg,
  type CliInputFlagValue,
  type CloudCliContext,
  command,
  confirmFlag,
  createAccessCommands,
  defineCliCommands,
  flag,
  readCliInput,
} from "@valentinkolb/cloud/cli";
import type { AccessEntry, PermissionLevel, Principal, ServiceAccountCredential } from "@valentinkolb/cloud/contracts";
import {
  METRIC_TYPES,
  type MetricQueryPoint,
  type MetricType,
  type PulseBase,
  type PulseCapabilitySnapshot,
  type PulseCurrentState,
  type PulseDashboard,
  type PulseDashboardConfig,
  type PulseDashboardDslCompileResult,
  type PulseIngestBatch,
  type PulseInventory,
  type PulseMetricSeries,
  type PulseMetricSummary,
  type PulseQueryCompileResult,
  type PulseRecordedEvent,
  type PulseSavedQuery,
  type PulseSource,
  type PulseSourceScrape,
  SOURCE_KINDS,
  type SourceKind,
} from "./contracts";

type PulseSourceApiKey = ServiceAccountCredential & { permission: PermissionLevel };
type IngestResult = { metrics: number; events: number; states: number };
type MessageResult = { message: string };
type DashboardPublishResult = { dashboard: PulseDashboard; token: string };
type QueryRunResult = {
  compiled: unknown;
  points: MetricQueryPoint[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};
type SourceApiKeyCreateResult = { credential: PulseSourceApiKey; token: string };
type InventoryResource = PulseInventory["resources"][number];
type InventoryMetric = PulseInventory["metrics"][number];
type SourceFilterFlags = { source?: string; sourceId?: string };
type ResourceSignalFilters = {
  q?: string;
  sourceId?: string;
  resource?: InventoryResource;
  entity?: string;
  entityType?: string;
};

const PULSE_BASE_DEFAULT_KEY = "pulse.base";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUERY_INPUT = flag.input({
  name: "query",
  fileName: "file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "query",
});
const DASHBOARD_DSL_INPUT = flag.input({
  name: "content",
  fileName: "file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "dsl",
});
const JSON_INPUT = flag.input({
  name: "batch",
  fileName: "file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "json",
});

const apiPath = (path: string) => `/api/pulse${path}`;

const queryString = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
};

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") {
    ctx.json(value);
    return;
  }
  ctx.table(rows, columns);
};

const printMessage = (ctx: CloudCliContext, value: unknown, message: string) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.print(message);
};

const compactId = (value: string | null | undefined): string => (value ? value.slice(0, 8) : "-");
const yesNo = (value: boolean): string => (value ? "yes" : "no");
const formatDate = (value: string | null | undefined): string => (value ? value : "-");
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const ensureUuid = (value: string): boolean => UUID_RE.test(value);

const requireDefaultBaseRef = async (ctx: CloudCliContext): Promise<string> => {
  const ref = await ctx.getDefault(PULSE_BASE_DEFAULT_KEY);
  if (!ref) throw new Error("Missing Pulse base. Pass --base <base> or run `cld pulse use <base>`.");
  return ref;
};

const baseRefFromArgs = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ baseRef: string; rest: string[] }> => {
  const flagged = typeof ctx.flags.base === "string" ? ctx.flags.base : undefined;
  if (flagged) return { baseRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { baseRef: args[0]!, rest: args.slice(1) };
  return { baseRef: await requireDefaultBaseRef(ctx), rest: args };
};

const requireRestArg = (args: string[], index: number, label: string): string => {
  const value = args[index];
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const exactMatch = <T>(items: T[], ref: string, fields: ((item: T) => string | null | undefined)[], label: string): T => {
  const matches = items.filter((item) => fields.some((field) => field(item) === ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use an ID.`);
  const foldedMatches = items.filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase() === ref.toLowerCase()));
  if (foldedMatches.length === 1) return foldedMatches[0]!;
  if (foldedMatches.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use an ID.`);
  const candidates = items
    .filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase().includes(ref.toLowerCase())))
    .slice(0, 5)
    .map((item) =>
      fields
        .map((field) => field(item))
        .filter(Boolean)
        .join(" / "),
    )
    .join(", ");
  throw new Error(`Unknown ${label} "${ref}".${candidates ? ` Candidates: ${candidates}.` : ""}`);
};

const listBases = (ctx: CloudCliContext): Promise<PulseBase[]> => readApi<PulseBase[]>(ctx, "/bases");

const resolveBase = async (ctx: CloudCliContext, ref: string): Promise<PulseBase> => {
  if (ensureUuid(ref)) return readApi<PulseBase>(ctx, `/bases/${encodeURIComponent(ref)}`);
  return exactMatch(await listBases(ctx), ref, [(base) => base.id, (base) => base.name], "Pulse base");
};

const resolveBaseFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ base: PulseBase; rest: string[] }> => {
  const { baseRef, rest } = await baseRefFromArgs(ctx, args, requiredTrailingArgs);
  return { base: await resolveBase(ctx, baseRef), rest };
};

const listSources = (ctx: CloudCliContext, baseId: string): Promise<PulseSource[]> =>
  readApi<PulseSource[]>(ctx, `/bases/${encodeURIComponent(baseId)}/sources`);

const resolveSource = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<PulseSource> =>
  exactMatch(await listSources(ctx, baseId), ref, [(source) => source.id, (source) => source.name], "source");

const listDashboards = (ctx: CloudCliContext, baseId: string): Promise<PulseDashboard[]> =>
  readApi<PulseDashboard[]>(ctx, `/bases/${encodeURIComponent(baseId)}/dashboards`);

const resolveDashboard = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<PulseDashboard> =>
  exactMatch(await listDashboards(ctx, baseId), ref, [(dashboard) => dashboard.id, (dashboard) => dashboard.name], "dashboard");

const listSavedQueries = (ctx: CloudCliContext, baseId: string): Promise<PulseSavedQuery[]> =>
  readApi<PulseSavedQuery[]>(ctx, `/bases/${encodeURIComponent(baseId)}/saved-queries`);

const resolveSavedQuery = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<PulseSavedQuery> =>
  exactMatch(await listSavedQueries(ctx, baseId), ref, [(query) => query.id, (query) => query.name], "saved query");

const readTextInput = async (input: CliInputFlagValue, label: string, maxLength?: number): Promise<string> => {
  const value = (await readCliInput(input, { label, required: true, trimFinalNewline: true }))?.trim();
  if (!value) throw new Error(`Missing ${label}.`);
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
  return value;
};

const readJsonInput = async <T>(input: CliInputFlagValue, label: string): Promise<T> => {
  const text = await readTextInput(input, label);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
};

const sourceFilterFlags = {
  source: flag.string({ description: "Source name or ID" }),
  sourceId: flag.string({ name: "source-id", description: "Source ID" }),
};

const resourceFilterFlags = {
  ...sourceFilterFlags,
  resource: flag.string({ description: "Resource key, ID, or label" }),
  entity: flag.string({ description: "Entity/resource ID" }),
  entityType: flag.string({ name: "entity-type", description: "Entity/resource type" }),
};

const publicDashboardDisplayUrl = (ctx: CloudCliContext, token: string, options: { theme?: string; height?: string } = {}): string => {
  const url = new URL(`/app/pulse/display/${encodeURIComponent(token)}`, ctx.options.server);
  if (options.theme === "light" || options.theme === "dark") url.searchParams.set("theme", options.theme);
  if (options.height === "scroll" || options.height === "full") url.searchParams.set("height", options.height);
  return url.toString();
};

const maxIso = (left: string | null, right: string | null): string | null => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
};

const includesSearch = (q: string | undefined, values: (string | number | boolean | null | undefined)[]): boolean => {
  if (!q) return true;
  const normalized = q.toLowerCase();
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalized),
  );
};

const sliceRows = <T>(items: T[], limit?: number, offset?: number): T[] => {
  const start = Math.max(0, offset ?? 0);
  const end = limit === undefined ? undefined : start + Math.max(1, limit);
  return items.slice(start, end);
};

const resolveSourceFilter = async (ctx: CloudCliContext, baseId: string, filters: SourceFilterFlags): Promise<string | undefined> => {
  if (filters.source && filters.sourceId) throw new Error("Pass either --source or --source-id, not both.");
  if (filters.sourceId) return filters.sourceId;
  if (!filters.source) return undefined;
  if (ensureUuid(filters.source)) return filters.source;
  return (await resolveSource(ctx, baseId, filters.source)).id;
};

const resolveResource = (inventory: PulseInventory, ref: string): InventoryResource =>
  exactMatch(inventory.resources, ref, [(resource) => resource.key, (resource) => resource.id, (resource) => resource.label], "resource");

const resourceEntityRefs = (resource: InventoryResource): string[] => {
  const refs = [resource.key, resource.id];
  if (resource.type) refs.push(`${resource.type}:${resource.id}`);
  return refs.filter(Boolean);
};

const matchesResourceEntity = (resource: InventoryResource, entityId: string | null | undefined, entityType?: string | null): boolean => {
  if (resource.type && entityType && resource.type !== entityType) return false;
  const refs = new Set(resourceEntityRefs(resource));
  return Boolean(entityId && refs.has(entityId));
};

const filterInventoryMetrics = (inventory: PulseInventory, filters: ResourceSignalFilters & { type?: MetricType }): InventoryMetric[] =>
  inventory.metrics.filter((metric) => {
    if (filters.type && metric.type !== filters.type) return false;
    if (filters.sourceId && metric.sourceId !== filters.sourceId) return false;
    if (filters.resource && metric.resourceKey !== filters.resource.key) return false;
    if (filters.entity && metric.resourceId !== filters.entity && metric.resourceKey !== filters.entity) return false;
    if (filters.entityType && metric.resourceType !== filters.entityType) return false;
    return includesSearch(filters.q, [
      metric.metric,
      metric.resourceKey,
      metric.resourceId,
      metric.resourceType,
      metric.sourceId,
      ...Object.keys(metric.dimensions),
      ...Object.values(metric.dimensions),
    ]);
  });

const metricSummariesFromInventory = (metrics: InventoryMetric[]): PulseMetricSummary[] => {
  const summaries = new Map<string, PulseMetricSummary>();
  for (const metric of metrics) {
    const key = `${metric.metric}\u0000${metric.type}\u0000${metric.unit ?? ""}`;
    const current = summaries.get(key);
    if (current) {
      current.seriesCount += 1;
      current.lastSeenAt = maxIso(current.lastSeenAt, metric.lastSeenAt);
      continue;
    }
    summaries.set(key, {
      name: metric.metric,
      type: metric.type,
      unit: metric.unit,
      seriesCount: 1,
      lastSeenAt: metric.lastSeenAt,
    });
  }
  return [...summaries.values()].sort((left, right) => left.name.localeCompare(right.name));
};

const filterInventoryStates = (inventory: PulseInventory, filters: ResourceSignalFilters & { key?: string }): PulseCurrentState[] =>
  inventory.states.filter((state) => {
    if (filters.key && state.key !== filters.key) return false;
    if (filters.sourceId && state.sourceId !== filters.sourceId) return false;
    if (filters.resource && !matchesResourceEntity(filters.resource, state.entityId, state.entityType)) return false;
    if (filters.entity && state.entityId !== filters.entity) return false;
    if (filters.entityType && state.entityType !== filters.entityType) return false;
    return includesSearch(filters.q, [
      state.key,
      formatValue(state.value),
      state.entityId,
      state.entityType,
      state.sourceId,
      ...Object.keys(state.dimensions),
      ...Object.values(state.dimensions),
    ]);
  });

const filterInventoryEvents = (inventory: PulseInventory, filters: ResourceSignalFilters & { kind?: string }): PulseRecordedEvent[] =>
  inventory.events.filter((event) => {
    if (filters.kind && event.kind !== filters.kind) return false;
    if (filters.sourceId && event.sourceId !== filters.sourceId) return false;
    if (filters.resource && !matchesResourceEntity(filters.resource, event.entityId, event.entityType)) return false;
    if (filters.entity && event.entityId !== filters.entity) return false;
    if (filters.entityType && event.entityType !== filters.entityType) return false;
    return includesSearch(filters.q, [
      event.kind,
      event.value,
      event.entityId,
      event.entityType,
      event.sourceId,
      ...Object.keys(event.dimensions),
      ...Object.values(event.dimensions),
      JSON.stringify(event.payload),
    ]);
  });

const baseRows = (bases: PulseBase[]) =>
  bases.map((base) => ({
    id: compactId(base.id),
    name: base.name,
    retentionDays: base.retentionDays,
    deletion: base.deletionStartedAt ? (base.deletionFailedAt ? "failed" : "running") : "",
    updatedAt: base.updatedAt,
  }));

const sourceRows = (sources: PulseSource[]) =>
  sources.map((source) => ({
    id: compactId(source.id),
    name: source.name,
    kind: source.kind,
    enabled: yesNo(source.enabled),
    endpoint: source.endpointUrl ?? "",
    interval: source.scrapeIntervalSeconds ?? "",
    token: yesNo(source.bearerTokenConfigured),
    lastSeenAt: formatDate(source.lastSeenAt),
  }));

const scrapeRows = (scrapes: PulseSourceScrape[]) =>
  scrapes.map((scrape) => ({
    id: compactId(scrape.id),
    success: yesNo(scrape.success),
    finishedAt: scrape.finishedAt,
    durationMs: scrape.durationMs,
    data: `${scrape.metrics} metrics, ${scrape.events} events, ${scrape.states} states`,
    error: scrape.errorMessage ?? "",
  }));

const keyRows = (keys: PulseSourceApiKey[]) =>
  keys.map((key) => ({
    id: compactId(key.id),
    name: key.name,
    prefix: key.tokenPrefix,
    permission: key.permission,
    expiresAt: formatDate(key.expiresAt),
    lastUsedAt: formatDate(key.lastUsedAt),
    createdAt: key.createdAt,
  }));

const metricRows = (metrics: PulseMetricSummary[]) =>
  metrics.map((metric) => ({
    metric: metric.name,
    type: metric.type,
    unit: metric.unit ?? "",
    series: metric.seriesCount,
    lastSeenAt: formatDate(metric.lastSeenAt),
  }));

const seriesRows = (series: PulseMetricSeries[]) =>
  series.map((item) => ({
    id: compactId(item.id),
    metric: item.metric,
    source: compactId(item.sourceId),
    entity: item.entityId ?? "",
    entityType: item.entityType ?? "",
    value: item.latestValue ?? "",
    lastSeenAt: formatDate(item.lastSeenAt),
  }));

const inventoryMetricRows = (metrics: InventoryMetric[]) =>
  metrics.map((metric) => ({
    id: compactId(metric.seriesId),
    metric: metric.metric,
    type: metric.type,
    unit: metric.unit ?? "",
    source: compactId(metric.sourceId),
    resource: metric.resourceKey,
    value: formatValue(metric.latestValue),
    lastSeenAt: formatDate(metric.lastSeenAt),
  }));

const stateRows = (states: PulseCurrentState[]) =>
  states.map((state) => ({
    key: state.key,
    value: formatValue(state.value),
    source: compactId(state.sourceId),
    entity: state.entityId,
    entityType: state.entityType ?? "",
    updatedAt: state.updatedAt,
  }));

const eventRows = (events: PulseRecordedEvent[]) =>
  events.map((event) => ({
    id: compactId(event.id),
    kind: event.kind,
    value: event.value ?? "",
    source: compactId(event.sourceId),
    entity: event.entityId ?? "",
    entityType: event.entityType ?? "",
    ts: event.ts,
  }));

const resourceRows = (inventory: PulseInventory, filters: { q?: string; type?: string; source?: string }) => {
  const q = filters.q?.toLowerCase();
  return inventory.resources
    .filter((resource) => {
      if (filters.type && resource.type !== filters.type) return false;
      if (filters.source && !resource.sourceIds.includes(filters.source)) return false;
      if (!q) return true;
      return (
        resource.label.toLowerCase().includes(q) ||
        resource.id.toLowerCase().includes(q) ||
        (resource.type ?? "").toLowerCase().includes(q) ||
        Object.values(resource.dimensions).some((value) => value.toLowerCase().includes(q))
      );
    })
    .map((resource) => ({
      key: resource.key,
      type: resource.type ?? "",
      label: resource.label,
      metrics: resource.metricCount,
      states: resource.stateCount,
      events: resource.eventCount,
      sources: resource.sourceIds.length,
      lastSeenAt: formatDate(resource.lastSeenAt),
    }));
};

const resourceDetailRows = (resource: InventoryResource) => [
  { key: "key", value: resource.key },
  { key: "id", value: resource.id },
  { key: "label", value: resource.label },
  { key: "type", value: resource.type ?? "" },
  { key: "sources", value: resource.sourceIds.map(compactId).join(", ") },
  { key: "metrics", value: resource.metricCount },
  { key: "states", value: resource.stateCount },
  { key: "events", value: resource.eventCount },
  { key: "lastSeenAt", value: formatDate(resource.lastSeenAt) },
  ...Object.entries(resource.dimensions).map(([key, value]) => ({ key: `dimension.${key}`, value })),
];

const overviewRows = (base: PulseBase, inventory: PulseInventory, sources: PulseSource[], metrics: PulseMetricSummary[]) => {
  const resourceTypes = new Set(inventory.resources.map((resource) => resource.type).filter(Boolean));
  return [
    {
      base: base.name,
      sources: sources.length,
      resources: inventory.resources.length,
      resourceTypes: resourceTypes.size,
      metrics: metrics.length,
      metricSeries: inventory.metrics.length,
      events: inventory.events.length,
      states: inventory.states.length,
    },
  ];
};

const dashboardRows = (dashboards: PulseDashboard[]) =>
  dashboards.map((dashboard) => ({
    id: compactId(dashboard.id),
    name: dashboard.name,
    public: yesNo(dashboard.publicEnabled),
    dsl: dashboard.config.dsl ? "yes" : "no",
    refresh: dashboard.config.refreshIntervalSeconds ?? "",
    updatedAt: dashboard.updatedAt,
  }));

const savedQueryRows = (queries: PulseSavedQuery[]) =>
  queries.map((query) => ({
    id: compactId(query.id),
    name: query.name,
    query: query.query,
    updatedAt: query.updatedAt,
  }));

const compileDashboardDsl = async (ctx: CloudCliContext, baseId: string, text: string): Promise<PulseDashboardConfig> => {
  const result = await readApi<PulseDashboardDslCompileResult>(ctx, "/dashboard-dsl/compile", jsonRequest("POST", { baseId, text }));
  if (!result.ok || !result.config) {
    const diagnostics = result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`).join("\n");
    throw new Error(`Dashboard DSL is invalid.${diagnostics ? `\n${diagnostics}` : ""}`);
  }
  return { ...result.config, dsl: text };
};

const runQueryText = (ctx: CloudCliContext, baseId: string, query: string): Promise<QueryRunResult> =>
  readApi<QueryRunResult>(ctx, "/query/metric-text", jsonRequest("POST", { baseId, query }));

const compileQueryText = (ctx: CloudCliContext, baseId: string, query: string): Promise<PulseQueryCompileResult> =>
  readApi<PulseQueryCompileResult>(ctx, "/query/compile-text", jsonRequest("POST", { baseId, query }));

const baseFlag = { base: flag.string({ description: "Pulse base ID or exact name" }) };
const sourceKindFlag = flag.enum(SOURCE_KINDS, { name: "kind", description: "Source kind", required: true });
const metricTypeFlag = flag.enum(METRIC_TYPES, { name: "type", description: "Metric type" });
const pulseAccessCommands = createAccessCommands({
  resourceLabel: "Pulse base",
  resourceArgLabel: "base",
  resourceArgDescription: "Optional Pulse base id or exact name. If omitted, the default from `cld pulse use` is used.",
  resolveResource: async (ctx, args) => {
    const { base } = await resolveBaseFromCommand(ctx, args, 0);
    return {
      id: base.id,
      label: `${base.name} (${compactId(base.id)})`,
    };
  },
  list: async (ctx, base) => readApi<AccessEntry[]>(ctx, `/bases/${encodeURIComponent(base.id)}/access`),
  grant: async (ctx, base, principal: Principal, permission: PermissionLevel) =>
    readApi<AccessEntry>(ctx, `/bases/${encodeURIComponent(base.id)}/access`, jsonRequest("POST", { principal, permission })),
  update: async (ctx, base, accessId, permission) => {
    await readApi<MessageResult>(
      ctx,
      `/bases/${encodeURIComponent(base.id)}/access/${encodeURIComponent(accessId)}`,
      jsonRequest("PATCH", { permission }),
    );
  },
  revoke: async (ctx, base, accessId) => {
    await readApi<MessageResult>(ctx, `/bases/${encodeURIComponent(base.id)}/access/${encodeURIComponent(accessId)}`, jsonRequest("DELETE"));
  },
  examples: {
    list: ['cld pulse access list "Ops telemetry"', "cld pulse access list --base 810db53e-e756-4db5-9a40-9091f04a0abd"],
    grant: [
      'cld pulse access grant "Ops telemetry" --user valentin.kolb --permission read',
      'cld pulse access grant "Ops telemetry" --group "Sysadmins" --permission admin',
      'cld pulse access grant "Ops telemetry" --authenticated --permission read',
    ],
    set: [
      'cld pulse access set "Ops telemetry" --group "Sysadmins" --permission write',
      "cld pulse access set --base 810db53e-e756-4db5-9a40-9091f04a0abd --access-id 00000000-0000-4000-8000-000000000000 --permission admin",
    ],
    revoke: [
      'cld pulse access revoke "Ops telemetry" --user valentin.kolb --yes',
      "cld pulse access revoke --base 810db53e-e756-4db5-9a40-9091f04a0abd --access-id 00000000-0000-4000-8000-000000000000 --yes",
    ],
    searchPrincipals: [
      "cld pulse access search-principals val --kind user,group",
      'cld pulse access search-principals "Sysadmins" --kind group',
    ],
  },
});
const publicDisplayFlags = {
  theme: flag.enum(["light", "dark"] as const, { description: "Public display theme" }),
  height: flag.enum(["scroll", "full"] as const, { description: "Public display height mode" }),
};
const resourceListFlags = {
  ...baseFlag,
  q: flag.string({ description: "Search resources" }),
  type: flag.string({ description: "Resource type" }),
  ...sourceFilterFlags,
  includeInventory: flag.boolean({ name: "include-inventory", description: "Include raw inventory data in JSON output" }),
};

const listResourcesForCommand = async (
  ctx: CloudCliContext,
  args: string[],
  flags: SourceFilterFlags & { q?: string; type?: string; includeInventory?: boolean },
) => {
  const { base } = await resolveBaseFromCommand(ctx, args, 0);
  const sourceId = await resolveSourceFilter(ctx, base.id, flags);
  const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
  const rows = resourceRows(inventory, { q: flags.q, type: flags.type, source: sourceId });
  printJsonOrTable(ctx, flags.includeInventory ? { ...inventory, resources: rows } : { resources: rows }, rows, [
    { key: "type" },
    { key: "label" },
    { key: "metrics" },
    { key: "states" },
    { key: "events" },
    { key: "sources" },
    { key: "lastSeenAt" },
  ]);
};

const module = defineCliCommands({
  name: "pulse",
  summary: "Inspect Pulse data and manage Pulse bases, sources, queries, and dashboards.",
  commands: [
    command("capabilities", {
      summary: "Show Pulse deployment capabilities",
      async run({ ctx }) {
        const capabilities = await readApi<PulseCapabilitySnapshot>(ctx, "/capabilities");
        printJsonOrTable(
          ctx,
          capabilities,
          [
            {
              timescaleEnabled: yesNo(capabilities.timescaleEnabled),
              timeBucketAvailable: yesNo(capabilities.timeBucketAvailable),
              continuousAggregatesAvailable: yesNo(capabilities.continuousAggregatesAvailable),
            },
          ],
          [
            { key: "timescaleEnabled", label: "Timescale" },
            { key: "timeBucketAvailable", label: "time_bucket" },
            { key: "continuousAggregatesAvailable", label: "continuous aggregates" },
          ],
        );
      },
    }),
    command("list", {
      summary: "List Pulse bases",
      async run({ ctx }) {
        const bases = await listBases(ctx);
        printJsonOrTable(ctx, bases, baseRows(bases), [
          { key: "id" },
          { key: "name" },
          { key: "retentionDays", label: "retention" },
          { key: "deletion" },
          { key: "updatedAt" },
        ]);
      },
    }),
    command("use", {
      summary: "Set the default Pulse base",
      args: { base: arg.required({ valueLabel: "base", description: "Base ID or exact name" }) },
      async run({ ctx, args }) {
        const base = await resolveBase(ctx, args.base);
        await ctx.setDefault(PULSE_BASE_DEFAULT_KEY, base.id);
        if (ctx.options.output === "json") ctx.json({ base, defaultBase: base.id });
        else ctx.print(`Using Pulse base ${base.name} (${base.id}).`);
      },
    }),
    command("current", {
      summary: "Show the default Pulse base",
      async run({ ctx }) {
        const ref = await requireDefaultBaseRef(ctx);
        const base = await resolveBase(ctx, ref);
        if (ctx.options.output === "json") ctx.json({ base, defaultBase: base.id });
        else ctx.print(`${base.name} (${base.id})`);
      },
    }),
    command("get", {
      summary: "Show a Pulse base",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        if (ctx.options.output === "json") ctx.json(base);
        else {
          ctx.print(`${base.name} (${base.id})`);
          ctx.print(`Retention: ${base.retentionDays} days`);
          if (base.description) ctx.print(base.description);
        }
      },
    }),
    command("create", {
      summary: "Create a Pulse base",
      args: { name: arg.required({ valueLabel: "name" }) },
      flags: {
        description: flag.string({ description: "Base description" }),
        use: flag.boolean({ description: "Set the created base as default" }),
      },
      async run({ ctx, args, flags }) {
        const base = await readApi<PulseBase>(
          ctx,
          "/bases",
          jsonRequest("POST", { name: args.name, description: flags.description ?? null }),
        );
        if (flags.use) await ctx.setDefault(PULSE_BASE_DEFAULT_KEY, base.id);
        if (ctx.options.output === "json") ctx.json(base);
        else ctx.print(`Created Pulse base ${base.name} (${base.id}).`);
      },
    }),
    command("update", {
      summary: "Update a Pulse base",
      flags: {
        ...baseFlag,
        name: flag.string({ description: "New base name" }),
        description: flag.string({ description: "New base description" }),
        retentionDays: flag.int({ name: "retention-days", min: 1, max: 3650, description: "Retention in days" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const patch = {
          name: flags.name,
          description: flags.description,
          retentionDays: flags.retentionDays,
        };
        const updated = await readApi<PulseBase>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("PATCH", patch));
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Updated Pulse base ${updated.name} (${updated.id}).`);
      },
    }),
    command("delete", {
      summary: "Delete a Pulse base",
      flags: { ...baseFlag, yes: confirmFlag("Delete this Pulse base") },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to delete without --yes.");
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const result = await readApi<MessageResult>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("DELETE"));
        printMessage(ctx, result, result.message);
      },
    }),
    command("clear-data", {
      summary: "Clear all Pulse data while keeping the base and settings",
      flags: { ...baseFlag, yes: confirmFlag("Clear all data in this Pulse base") },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to clear data without --yes.");
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const result = await readApi<MessageResult>(ctx, `/bases/${encodeURIComponent(base.id)}/clear-data`, jsonRequest("POST"));
        printMessage(ctx, result, result.message);
      },
    }),
    ...pulseAccessCommands,

    command("sources list", {
      summary: "List Pulse sources",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const sources = await listSources(ctx, base.id);
        printJsonOrTable(ctx, sources, sourceRows(sources), [
          { key: "id" },
          { key: "name" },
          { key: "kind" },
          { key: "enabled" },
          { key: "interval" },
          { key: "token" },
          { key: "lastSeenAt" },
        ]);
      },
    }),
    command("sources create", {
      summary: "Create a Pulse source",
      flags: {
        ...baseFlag,
        name: flag.string({ required: true, description: "Source name" }),
        kind: sourceKindFlag,
        endpointUrl: flag.string({ name: "endpoint-url", description: "Metrics endpoint URL" }),
        bearerToken: flag.string({ name: "bearer-token", description: "Metrics endpoint bearer token" }),
        scrapeIntervalSeconds: flag.int({ name: "scrape-interval-seconds", min: 10, max: 86400, description: "Scrape interval" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const source = await readApi<PulseSource>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources`,
          jsonRequest("POST", {
            kind: flags.kind as SourceKind,
            name: flags.name,
            endpointUrl: flags.endpointUrl ?? null,
            bearerToken: flags.bearerToken ?? null,
            scrapeIntervalSeconds: flags.scrapeIntervalSeconds ?? null,
          }),
        );
        if (ctx.options.output === "json") ctx.json(source);
        else ctx.print(`Created source ${source.name} (${source.id}).`);
      },
    }),
    command("sources update", {
      summary: "Update a Pulse source",
      flags: {
        ...baseFlag,
        name: flag.string({ description: "New source name" }),
        enabled: flag.enum(["true", "false"], { description: "Enable or disable the source" }),
        endpointUrl: flag.string({ name: "endpoint-url", description: "Metrics endpoint URL" }),
        bearerToken: flag.string({ name: "bearer-token", description: "New bearer token" }),
        scrapeIntervalSeconds: flag.int({ name: "scrape-interval-seconds", min: 10, max: 86400, description: "Scrape interval" }),
      },
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const updated = await readApi<PulseSource>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}`,
          jsonRequest("PATCH", {
            name: flags.name,
            enabled: flags.enabled === undefined ? undefined : flags.enabled === "true",
            endpointUrl: flags.endpointUrl,
            bearerToken: flags.bearerToken,
            scrapeIntervalSeconds: flags.scrapeIntervalSeconds,
          }),
        );
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Updated source ${updated.name} (${updated.id}).`);
      },
    }),
    command("sources delete", {
      summary: "Delete a Pulse source",
      flags: { ...baseFlag, yes: confirmFlag("Delete this source") },
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to delete without --yes.");
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        await readApi<unknown>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}`,
          jsonRequest("DELETE"),
        );
        printMessage(ctx, { deleted: source.id }, `Deleted source ${source.name}.`);
      },
    }),
    command("sources scrape", {
      summary: "Scrape a metrics source now",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const result = await readApi<IngestResult>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/scrape`,
          jsonRequest("POST"),
        );
        printJsonOrTable(ctx, result, [result], [{ key: "metrics" }, { key: "events" }, { key: "states" }]);
      },
    }),
    command("sources scrapes", {
      summary: "List recent scrape attempts for a source",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const scrapes = await readApi<PulseSourceScrape[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/scrapes`,
        );
        printJsonOrTable(ctx, scrapes, scrapeRows(scrapes), [
          { key: "success" },
          { key: "finishedAt" },
          { key: "data" },
          { key: "durationMs" },
          { key: "error" },
        ]);
      },
    }),

    command("tokens list", {
      summary: "List HTTP ingest tokens for a source",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const keys = await readApi<PulseSourceApiKey[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/api-keys`,
        );
        printJsonOrTable(ctx, keys, keyRows(keys), [
          { key: "id" },
          { key: "name" },
          { key: "prefix" },
          { key: "permission" },
          { key: "expiresAt" },
          { key: "lastUsedAt" },
        ]);
      },
    }),
    command("tokens create", {
      summary: "Create an HTTP ingest token for a source",
      flags: {
        ...baseFlag,
        name: flag.string({ required: true, description: "Token label" }),
        expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp" }),
      },
      args: { args: arg.rest({ valueLabel: "base source", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const result = await readApi<SourceApiKeyCreateResult>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/api-keys`,
          jsonRequest("POST", { name: flags.name, permission: "write", expiresAt: flags.expiresAt ?? null }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else {
          ctx.print(`Created token ${result.credential.name} (${result.credential.id}).`);
          ctx.print(result.token);
        }
      },
    }),
    command("tokens revoke", {
      summary: "Revoke an HTTP ingest token",
      flags: { ...baseFlag, yes: confirmFlag("Revoke this token") },
      args: { args: arg.rest({ valueLabel: "base source token", required: true }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to revoke without --yes.");
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 2);
        const source = await resolveSource(ctx, base.id, requireRestArg(rest, 0, "source"));
        const tokenRef = requireRestArg(rest, 1, "token");
        const keys = await readApi<PulseSourceApiKey[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/api-keys`,
        );
        const key = exactMatch(keys, tokenRef, [(item) => item.id, (item) => item.name, (item) => item.tokenPrefix], "token");
        await readApi<unknown>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/api-keys/${encodeURIComponent(key.id)}`,
          jsonRequest("DELETE"),
        );
        printMessage(ctx, { revoked: key.id }, `Revoked token ${key.name}.`);
      },
    }),

    command("inventory", {
      summary: "Show Pulse inventory counts",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
        const summary = {
          resources: inventory.resources.length,
          metrics: inventory.metrics.length,
          events: inventory.events.length,
          states: inventory.states.length,
        };
        printJsonOrTable(
          ctx,
          { summary, inventory },
          [summary],
          [{ key: "resources" }, { key: "metrics" }, { key: "events" }, { key: "states" }],
        );
      },
    }),
    command("resources", {
      summary: "List Pulse resources from inventory",
      flags: resourceListFlags,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        await listResourcesForCommand(ctx, args.args, flags);
      },
    }),
    command("resources list", {
      summary: "List Pulse resources from inventory",
      flags: resourceListFlags,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        await listResourcesForCommand(ctx, args.args, flags);
      },
    }),
    command("resources get", {
      summary: "Show one Pulse resource from inventory",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base resource", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
        const resource = resolveResource(inventory, requireRestArg(rest, 0, "resource"));
        printJsonOrTable(ctx, resource, resourceDetailRows(resource), [{ key: "key" }, { key: "value" }]);
      },
    }),
    command("resources metrics", {
      summary: "List metrics for one Pulse resource",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search metric names or dimensions" }),
        ...sourceFilterFlags,
        type: metricTypeFlag,
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base resource", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const [sourceId, inventory] = await Promise.all([
          resolveSourceFilter(ctx, base.id, flags),
          readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`),
        ]);
        const resource = resolveResource(inventory, requireRestArg(rest, 0, "resource"));
        const metrics = sliceRows(
          filterInventoryMetrics(inventory, { q: flags.q, sourceId, resource, type: flags.type as MetricType | undefined }),
          flags.limit,
          flags.offset,
        );
        printJsonOrTable(ctx, metrics, inventoryMetricRows(metrics), [
          { key: "metric" },
          { key: "value" },
          { key: "type" },
          { key: "unit" },
          { key: "source" },
          { key: "lastSeenAt" },
        ]);
      },
    }),
    command("resources states", {
      summary: "List current states for one Pulse resource",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search states" }),
        ...sourceFilterFlags,
        key: flag.string({ description: "State key" }),
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base resource", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const [sourceId, inventory] = await Promise.all([
          resolveSourceFilter(ctx, base.id, flags),
          readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`),
        ]);
        const resource = resolveResource(inventory, requireRestArg(rest, 0, "resource"));
        const states = sliceRows(
          filterInventoryStates(inventory, { q: flags.q, sourceId, resource, key: flags.key }),
          flags.limit,
          flags.offset,
        );
        printJsonOrTable(ctx, states, stateRows(states), [
          { key: "key" },
          { key: "value" },
          { key: "source" },
          { key: "entity" },
          { key: "updatedAt" },
        ]);
      },
    }),
    command("resources events", {
      summary: "List recent events for one Pulse resource",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search events" }),
        ...sourceFilterFlags,
        kind: flag.string({ description: "Event kind" }),
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base resource", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const [sourceId, inventory] = await Promise.all([
          resolveSourceFilter(ctx, base.id, flags),
          readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`),
        ]);
        const resource = resolveResource(inventory, requireRestArg(rest, 0, "resource"));
        const events = sliceRows(
          filterInventoryEvents(inventory, { q: flags.q, sourceId, resource, kind: flags.kind }),
          flags.limit,
          flags.offset,
        );
        printJsonOrTable(ctx, events, eventRows(events), [
          { key: "kind" },
          { key: "value" },
          { key: "source" },
          { key: "entity" },
          { key: "ts" },
        ]);
      },
    }),
    command("overview", {
      summary: "Summarize a Pulse base for dashboard planning",
      flags: {
        ...baseFlag,
        includeInventory: flag.boolean({ name: "include-inventory", description: "Include the full inventory payload in JSON output" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const [sources, inventory, metrics, dashboards] = await Promise.all([
          listSources(ctx, base.id),
          readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`),
          readApi<PulseMetricSummary[]>(ctx, `/bases/${encodeURIComponent(base.id)}/metrics${queryString({ limit: 500 })}`),
          listDashboards(ctx, base.id),
        ]);
        const topResources = [...inventory.resources]
          .sort((a, b) => b.metricCount + b.stateCount + b.eventCount - (a.metricCount + a.stateCount + a.eventCount))
          .slice(0, 20);
        const topMetrics = [...metrics].sort((a, b) => b.seriesCount - a.seriesCount).slice(0, 20);
        const summary = overviewRows(base, inventory, sources, metrics)[0]!;
        const overview = {
          base,
          summary,
          sources: sourceRows(sources),
          dashboards: dashboardRows(dashboards),
          topResources: resourceRows({ ...inventory, resources: topResources }, {}),
          topMetrics: metricRows(topMetrics),
          ...(flags.includeInventory ? { inventory, metrics } : {}),
        };
        if (ctx.options.output === "json") {
          ctx.json(overview);
          return;
        }
        printJsonOrTable(ctx, overview, overviewRows(base, inventory, sources, metrics), [
          { key: "base" },
          { key: "sources" },
          { key: "resources" },
          { key: "resourceTypes" },
          { key: "metrics" },
          { key: "metricSeries" },
          { key: "events" },
          { key: "states" },
        ]);
        if (topResources.length) {
          ctx.print("");
          ctx.print("Top resources:");
          ctx.table(resourceRows({ ...inventory, resources: topResources }, {}), [
            { key: "type" },
            { key: "label" },
            { key: "metrics" },
            { key: "states" },
            { key: "events" },
            { key: "lastSeenAt" },
          ]);
        }
        if (topMetrics.length) {
          ctx.print("");
          ctx.print("Top metrics:");
          ctx.table(metricRows(topMetrics), [
            { key: "metric" },
            { key: "type" },
            { key: "unit" },
            { key: "series" },
            { key: "lastSeenAt" },
          ]);
        }
      },
    }),
    command("metrics", {
      summary: "List metric definitions",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search metric names" }),
        type: metricTypeFlag,
        ...resourceFilterFlags,
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const sourceId = await resolveSourceFilter(ctx, base.id, flags);
        if (sourceId || flags.resource || flags.entity || flags.entityType) {
          const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
          const resource = flags.resource ? resolveResource(inventory, flags.resource) : undefined;
          const metrics = sliceRows(
            metricSummariesFromInventory(
              filterInventoryMetrics(inventory, {
                q: flags.q,
                type: flags.type as MetricType | undefined,
                sourceId,
                resource,
                entity: flags.entity,
                entityType: flags.entityType,
              }),
            ),
            flags.limit,
            flags.offset,
          );
          printJsonOrTable(ctx, metrics, metricRows(metrics), [
            { key: "metric" },
            { key: "type" },
            { key: "unit" },
            { key: "series" },
            { key: "lastSeenAt" },
          ]);
          return;
        }
        const metrics = await readApi<PulseMetricSummary[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/metrics${queryString({
            q: flags.q,
            type: flags.type as MetricType | undefined,
            limit: flags.limit,
            offset: flags.offset,
          })}`,
        );
        printJsonOrTable(ctx, metrics, metricRows(metrics), [
          { key: "metric" },
          { key: "type" },
          { key: "unit" },
          { key: "series" },
          { key: "lastSeenAt" },
        ]);
      },
    }),
    command("states", {
      summary: "List current states",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search states" }),
        ...resourceFilterFlags,
        key: flag.string({ description: "State key" }),
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const sourceId = await resolveSourceFilter(ctx, base.id, flags);
        if (flags.resource || flags.entity || flags.entityType) {
          const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
          const resource = flags.resource ? resolveResource(inventory, flags.resource) : undefined;
          const states = sliceRows(
            filterInventoryStates(inventory, {
              q: flags.q,
              key: flags.key,
              sourceId,
              resource,
              entity: flags.entity,
              entityType: flags.entityType,
            }),
            flags.limit,
            flags.offset,
          );
          printJsonOrTable(ctx, states, stateRows(states), [
            { key: "key" },
            { key: "value" },
            { key: "source" },
            { key: "entity" },
            { key: "updatedAt" },
          ]);
          return;
        }
        const states = await readApi<PulseCurrentState[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/states${queryString({
            q: flags.q,
            key: flags.key,
            sourceId,
            limit: flags.limit,
            offset: flags.offset,
          })}`,
        );
        printJsonOrTable(ctx, states, stateRows(states), [
          { key: "key" },
          { key: "value" },
          { key: "source" },
          { key: "entity" },
          { key: "updatedAt" },
        ]);
      },
    }),
    command("events", {
      summary: "List recent events",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search events" }),
        kind: flag.string({ description: "Event kind" }),
        ...resourceFilterFlags,
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const sourceId = await resolveSourceFilter(ctx, base.id, flags);
        if (flags.resource || flags.entity || flags.entityType) {
          const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
          const resource = flags.resource ? resolveResource(inventory, flags.resource) : undefined;
          const events = sliceRows(
            filterInventoryEvents(inventory, {
              q: flags.q,
              kind: flags.kind,
              sourceId,
              resource,
              entity: flags.entity,
              entityType: flags.entityType,
            }),
            flags.limit,
            flags.offset,
          );
          printJsonOrTable(ctx, events, eventRows(events), [
            { key: "kind" },
            { key: "value" },
            { key: "source" },
            { key: "entity" },
            { key: "ts" },
          ]);
          return;
        }
        const events = await readApi<PulseRecordedEvent[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/recent-events${queryString({
            q: flags.q,
            kind: flags.kind,
            sourceId,
            limit: flags.limit,
            offset: flags.offset,
          })}`,
        );
        printJsonOrTable(ctx, events, eventRows(events), [
          { key: "kind" },
          { key: "value" },
          { key: "source" },
          { key: "entity" },
          { key: "ts" },
        ]);
      },
    }),
    command("series", {
      summary: "List metric variants/series",
      flags: {
        ...baseFlag,
        q: flag.string({ description: "Search series dimensions" }),
        ...resourceFilterFlags,
        limit: flag.int({ min: 1, max: 500, description: "Maximum rows" }),
        offset: flag.int({ min: 0, description: "Row offset" }),
      },
      args: {
        args: arg.rest({ valueLabel: "base metric", required: true }),
      },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const metric = requireRestArg(rest, 0, "metric");
        const sourceId = await resolveSourceFilter(ctx, base.id, flags);
        if (flags.resource || flags.entity || flags.entityType) {
          const inventory = await readApi<PulseInventory>(ctx, `/bases/${encodeURIComponent(base.id)}/inventory`);
          const resource = flags.resource ? resolveResource(inventory, flags.resource) : undefined;
          const series = sliceRows(
            filterInventoryMetrics(inventory, {
              q: flags.q,
              sourceId,
              resource,
              entity: flags.entity,
              entityType: flags.entityType,
            }).filter((item) => item.metric === metric),
            flags.limit,
            flags.offset,
          );
          printJsonOrTable(ctx, series, inventoryMetricRows(series), [
            { key: "metric" },
            { key: "value" },
            { key: "type" },
            { key: "unit" },
            { key: "source" },
            { key: "lastSeenAt" },
          ]);
          return;
        }
        const series = await readApi<PulseMetricSeries[]>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/series${queryString({
            metric,
            q: flags.q,
            sourceId,
            limit: flags.limit,
            offset: flags.offset,
          })}`,
        );
        printJsonOrTable(ctx, series, seriesRows(series), [
          { key: "metric" },
          { key: "source" },
          { key: "entity" },
          { key: "value" },
          { key: "lastSeenAt" },
        ]);
      },
    }),

    command("query compile", {
      summary: "Compile a Pulse query",
      flags: { ...baseFlag, query: QUERY_INPUT },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const query = await readTextInput(flags.query, "query", 2000);
        const result = await compileQueryText(ctx, base.id, query);
        if (ctx.options.output === "json") ctx.json(result);
        else if (result.ok) ctx.print("Query is valid.");
        else {
          for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.severity}: ${diagnostic.message}`);
        }
      },
    }),
    command("query run", {
      summary: "Run a Pulse query",
      flags: { ...baseFlag, query: QUERY_INPUT },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const query = await readTextInput(flags.query, "query", 2000);
        const result = await runQueryText(ctx, base.id, query);
        if (ctx.options.output === "json") {
          ctx.json(result);
          return;
        }
        if (result.points.length) {
          printJsonOrTable(
            ctx,
            result,
            result.points.map((point) => ({ bucket: point.bucket, value: point.value ?? "" })),
            [{ key: "bucket" }, { key: "value" }],
          );
        } else if (result.events.length) {
          printJsonOrTable(ctx, result, eventRows(result.events), [{ key: "kind" }, { key: "value" }, { key: "entity" }, { key: "ts" }]);
        } else if (result.states.length) {
          printJsonOrTable(ctx, result, stateRows(result.states), [
            { key: "key" },
            { key: "value" },
            { key: "entity" },
            { key: "updatedAt" },
          ]);
        } else {
          ctx.print("No rows.");
        }
      },
    }),
    command("query list", {
      summary: "List saved queries",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const queries = await listSavedQueries(ctx, base.id);
        printJsonOrTable(ctx, queries, savedQueryRows(queries), [{ key: "id" }, { key: "name" }, { key: "query" }, { key: "updatedAt" }]);
      },
    }),
    command("query save", {
      summary: "Save a Pulse query",
      flags: {
        ...baseFlag,
        name: flag.string({ required: true, description: "Saved query name" }),
        description: flag.string({ description: "Saved query description" }),
        query: QUERY_INPUT,
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const query = await readTextInput(flags.query, "query", 2000);
        const compile = await compileQueryText(ctx, base.id, query);
        if (!compile.ok) throw new Error(`Query is invalid: ${compile.diagnostics.map((item) => item.message).join("; ")}`);
        const saved = await readApi<PulseSavedQuery>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/saved-queries`,
          jsonRequest("POST", { name: flags.name, description: flags.description ?? null, query }),
        );
        if (ctx.options.output === "json") ctx.json(saved);
        else ctx.print(`Saved query ${saved.name} (${saved.id}).`);
      },
    }),
    command("query delete", {
      summary: "Delete a saved query",
      flags: { ...baseFlag, yes: confirmFlag("Delete this saved query") },
      args: { args: arg.rest({ valueLabel: "base query", required: true }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to delete without --yes.");
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const query = await resolveSavedQuery(ctx, base.id, requireRestArg(rest, 0, "saved query"));
        const result = await readApi<MessageResult>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/saved-queries/${encodeURIComponent(query.id)}`,
          jsonRequest("DELETE"),
        );
        printMessage(ctx, result, result.message);
      },
    }),

    command("dashboards list", {
      summary: "List dashboards",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const dashboards = await listDashboards(ctx, base.id);
        printJsonOrTable(ctx, dashboards, dashboardRows(dashboards), [
          { key: "id" },
          { key: "name" },
          { key: "public" },
          { key: "dsl" },
          { key: "refresh" },
          { key: "updatedAt" },
        ]);
      },
    }),
    command("dashboards get", {
      summary: "Show a dashboard",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        if (ctx.options.output === "json") ctx.json(dashboard);
        else {
          ctx.print(`${dashboard.name} (${dashboard.id})`);
          ctx.print(`Public: ${yesNo(dashboard.publicEnabled)}`);
          ctx.print(`Refresh: ${dashboard.config.refreshIntervalSeconds ?? "manual"}`);
          if (dashboard.config.dsl) ctx.print(dashboard.config.dsl);
        }
      },
    }),
    command("dashboards compile", {
      summary: "Compile dashboard DSL",
      flags: { ...baseFlag, content: DASHBOARD_DSL_INPUT },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const text = await readTextInput(flags.content, "dashboard DSL", 40000);
        const result = await readApi<PulseDashboardDslCompileResult>(
          ctx,
          "/dashboard-dsl/compile",
          jsonRequest("POST", { baseId: base.id, text }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else if (result.ok) ctx.print("Dashboard DSL is valid.");
        else {
          for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
        }
      },
    }),
    command("dashboards create", {
      summary: "Create a dashboard from DSL",
      flags: {
        ...baseFlag,
        name: flag.string({ required: true, description: "Dashboard name" }),
        content: DASHBOARD_DSL_INPUT,
        public: flag.boolean({ description: "Enable public link after create" }),
        ...publicDisplayFlags,
      },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const text = await readTextInput(flags.content, "dashboard DSL", 40000);
        const config = await compileDashboardDsl(ctx, base.id, text);
        const dashboard = await readApi<PulseDashboard>(
          ctx,
          `/bases/${encodeURIComponent(base.id)}/dashboards`,
          jsonRequest("POST", { name: flags.name, config }),
        );
        if (!flags.public) {
          if (ctx.options.output === "json") ctx.json(dashboard);
          else ctx.print(`Created dashboard ${dashboard.name} (${dashboard.id}).`);
          return;
        }
        const result = await readApi<DashboardPublishResult>(
          ctx,
          `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
          jsonRequest("POST"),
        );
        const url = publicDashboardDisplayUrl(ctx, result.token, flags);
        if (ctx.options.output === "json") ctx.json({ ...result, url });
        else {
          ctx.print(`Created dashboard ${result.dashboard.name} (${result.dashboard.id}).`);
          ctx.print(`Public token: ${result.token}`);
          ctx.print(`Public URL: ${url}`);
        }
      },
    }),
    command("dashboards update", {
      summary: "Update dashboard metadata or DSL",
      flags: {
        ...baseFlag,
        name: flag.string({ description: "Dashboard name" }),
        content: DASHBOARD_DSL_INPUT,
      },
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        const text = await readCliInput(flags.content, { label: "dashboard DSL", required: false, trimFinalNewline: true });
        const config = text?.trim() ? await compileDashboardDsl(ctx, base.id, text.trim()) : undefined;
        const updated = await readApi<PulseDashboard>(
          ctx,
          `/dashboards/${encodeURIComponent(dashboard.id)}`,
          jsonRequest("PATCH", { name: flags.name, config }),
        );
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Updated dashboard ${updated.name} (${updated.id}).`);
      },
    }),
    command("dashboards delete", {
      summary: "Delete a dashboard",
      flags: { ...baseFlag, yes: confirmFlag("Delete this dashboard") },
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to delete without --yes.");
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        const result = await readApi<MessageResult>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("DELETE"));
        printMessage(ctx, result, result.message);
      },
    }),
    command("dashboards publish", {
      summary: "Enable a dashboard public link",
      flags: { ...baseFlag, ...publicDisplayFlags },
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args, flags }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        const result = await readApi<DashboardPublishResult>(
          ctx,
          `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
          jsonRequest("POST"),
        );
        const url = publicDashboardDisplayUrl(ctx, result.token, flags);
        if (ctx.options.output === "json") ctx.json({ ...result, url });
        else {
          ctx.print(`Published dashboard ${result.dashboard.name}.`);
          ctx.print(`Public token: ${result.token}`);
          ctx.print(`Public URL: ${url}`);
        }
      },
    }),
    command("dashboards public-url", {
      summary: "Create or show a dashboard public display URL",
      flags: {
        ...baseFlag,
        ...publicDisplayFlags,
        yes: confirmFlag("Enable or refresh this dashboard public link"),
      },
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args, flags }) {
        if (!flags.yes) throw new Error("Refusing to enable or refresh a public link without --yes.");
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        const result = await readApi<DashboardPublishResult>(
          ctx,
          `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
          jsonRequest("POST"),
        );
        const url = publicDashboardDisplayUrl(ctx, result.token, flags);
        if (ctx.options.output === "json") ctx.json({ ...result, url });
        else ctx.print(url);
      },
    }),
    command("dashboards unpublish", {
      summary: "Disable a dashboard public link",
      flags: baseFlag,
      args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
      async run({ ctx, args }) {
        const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
        const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
        const updated = await readApi<PulseDashboard>(
          ctx,
          `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
          jsonRequest("DELETE"),
        );
        if (ctx.options.output === "json") ctx.json(updated);
        else ctx.print(`Unpublished dashboard ${updated.name}.`);
      },
    }),

    command("ingest", {
      summary: "Ingest a Pulse JSON batch through the authenticated API",
      flags: { ...baseFlag, batch: JSON_INPUT },
      args: { args: arg.rest({ valueLabel: "base" }) },
      async run({ ctx, args, flags }) {
        const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
        const batch = await readJsonInput<PulseIngestBatch>(flags.batch, "ingest JSON");
        const result = await readApi<IngestResult>(ctx, `/bases/${encodeURIComponent(base.id)}/ingest`, jsonRequest("POST", batch));
        printJsonOrTable(ctx, result, [result], [{ key: "metrics" }, { key: "events" }, { key: "states" }]);
      },
    }),
  ],
});

export default module;
