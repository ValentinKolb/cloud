import {
  arg,
  type CliInputFlagValue,
  type CloudCliContext,
  type CloudCliTableColumn,
  command,
  confirmFlag,
  defineCliCommands,
  flag,
  paginationFlags,
  readCliInput,
} from "./index";

type Pagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

type GatewayHealth = {
  status: "ok" | "warn" | "error";
  checkedAt: string;
  summary: Record<string, number>;
  apps: {
    id: string;
    name: string;
    status: "ok" | "warn" | "error";
    online: boolean;
    healthy: boolean;
    lastSeenAt: string;
    offlineForMs: number;
  }[];
};

type GatewayRoute = {
  prefix: string;
  appId: string;
  count: number;
  errors: number;
  lastSeen: string | null;
};

type GatewayRoutesResponse = {
  generatedAt: string | null;
  instanceId: string | null;
  total: number;
  routeCount: number;
  items: GatewayRoute[];
};

type LogEntry = {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type LogSummary = {
  total: number;
  errors24h: number;
  warnings24h: number;
  total24h: number;
  sources: number;
  lastErrorAt: string | null;
};

type LogStatsResponse = {
  groupBy: "source" | "level";
  items: { key: string; count: number }[];
};

type TelemetryEvent = {
  id: number;
  appId: string;
  routePrefix: string;
  method: string;
  status: number;
  durationMs: number;
  errorKind: string | null;
  occurredAt: string;
};

type DiagnosticWarning = {
  title: string;
  detail: string;
  tone: "amber" | "red";
};

type PostgresDiagnostics = {
  available: boolean;
  error: string | null;
  schemas: number;
  tables: number;
  totalBytes: number;
  installedExtensions: number;
  availableExtensions: number;
  tableRows: {
    schema: string;
    name: string;
    estimatedRows: number;
    deadRows: number;
    totalBytes: number;
    tableBytes: number;
    indexBytes: number;
    warnings: string[];
  }[];
  extensionRows: {
    name: string;
    installed: boolean;
    installedVersion: string | null;
    defaultVersion: string | null;
    comment: string | null;
  }[];
  warnings: DiagnosticWarning[];
};

type RedisDiagnostics = {
  available: boolean;
  error: string | null;
  dbSize: number;
  sampledKeys: number;
  scanComplete: boolean;
  keyspace: { database: string; keys: number; expires: number; avgTtlMs: number }[];
  prefixes: { depth: number; prefix: string; count: number; share: number }[];
  warnings: DiagnosticWarning[];
};

type Notification = {
  id: string;
  recipient: string;
  subject: string;
  status: "sent" | "pending" | "error";
  error: string | null;
  sentAt: string | null;
  createdAt: string;
};

type NotificationBatchStatus = "draft" | "ready" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
type NotificationRecipientStatus = "pending" | "sending" | "sent" | "skipped" | "error";

type NotificationBatch = {
  id: string;
  subject: string;
  bodyMarkdown: string;
  selection: Record<string, unknown>;
  selectionHash: string;
  status: NotificationBatchStatus;
  createdAt: string;
  finalizedAt: string | null;
  targetCount: number;
  deliverableCount: number;
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  lastError: string | null;
};

type NotificationBatchRecipient = {
  batchId: string;
  userId: string;
  recipient: string | null;
  uid: string;
  displayName: string;
  provider: "local" | "ipa";
  profile: "user" | "guest";
  status: NotificationRecipientStatus;
  notificationId: string | null;
  error: string | null;
  attemptCount: number;
  sentAt: string | null;
  updatedAt: string;
};

type NotificationBatchPreview = {
  targetCount: number;
  deliverableCount: number;
  skippedNoEmailCount: number;
  duplicateCount: number;
  recipientHash: string;
};

type Announcement = {
  id: string;
  version: number;
  kind: "announcement" | "banner";
  title: string;
  tone: "info" | "success" | "warning" | "danger";
  publishedAt: string;
  expiresAt: string | null;
};

type HealthWebhook = {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  enabled: boolean;
  scopeKind: "all" | "include" | "exclude";
  scopeAppIds: string[];
  sendOn: ("ok" | "warn" | "error" | "recovery" | "every_check")[];
  minStatus: "ok" | "warn" | "error";
  repeatIntervalMs: number;
  timeoutMs: number;
  lastStatus: "ok" | "warn" | "error" | null;
  lastSentAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  deliveryCount: number;
  failureCount: number;
};

type MetricsToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type MetricsCollector = {
  id: string;
  name: string;
  description: string;
  status: "ok" | "error";
  series: number;
  durationMs: number;
  lastRunAt: string;
  error: string | null;
  metricNames: string[];
};

const apiGet = async <T>(ctx: CloudCliContext, path: string): Promise<T> => ctx.readJson<T>(await ctx.fetch(path));

const apiJson = async <T>(ctx: CloudCliContext, method: string, path: string, body?: unknown): Promise<T> =>
  ctx.readJson<T>(
    await ctx.fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  raw: unknown,
  rows: TRow[],
  columns: CloudCliTableColumn<TRow>[],
) => {
  if (ctx.options.output === "json") ctx.json(raw);
  else ctx.table(rows, columns);
};

const queryString = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
};

const pageQuery = (flags: { page?: number; perPage?: number }) => ({
  page: flags.page ?? 1,
  per_page: flags.perPage ?? 50,
});

const truncate = (value: string | null | undefined, max = 90): string => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const PG_BIGINT_MAX = 9_223_372_036_854_775_807n;

const parseLogId = (value: string): string => {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Log id must be a positive integer.");
  if (BigInt(value) > PG_BIGINT_MAX) throw new Error("Log id must fit into a Postgres BIGINT.");
  return value;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
};

const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const readJsonInput = async <T>(input: CliInputFlagValue, label: string): Promise<T> => {
  const raw = await readCliInput(input, { label, required: true });
  try {
    return JSON.parse(raw ?? "") as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readOptionalInput = async (input: CliInputFlagValue, label: string): Promise<string | undefined> =>
  readCliInput(input, { label, trimFinalNewline: true });

const parseExpiresAt = (value: string | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === "never" || value === "null") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('--expires-at must be an ISO timestamp, "never", or "null".');
  return date.toISOString();
};

const announcementRows = (items: Announcement[]) =>
  items.map((item) => ({
    version: item.version,
    kind: item.kind,
    tone: item.tone,
    title: item.title,
    published: item.publishedAt,
    expires: item.expiresAt ?? "",
    id: item.id,
  }));

const logRows = (entries: LogEntry[], messageLength = 120) =>
  entries.map((entry) => ({
    time: entry.createdAt,
    level: entry.level,
    source: entry.source,
    message: truncate(entry.message, messageLength),
    metadata: entry.metadata ? "yes" : "",
    id: entry.id,
  }));

const logColumns = [
  { key: "time" },
  { key: "level" },
  { key: "source" },
  { key: "message" },
  { key: "metadata" },
  { key: "id" },
] satisfies CloudCliTableColumn<ReturnType<typeof logRows>[number]>[];

const getLogs = async (
  ctx: CloudCliContext,
  params: {
    search?: string;
    source?: string;
    level?: "debug" | "info" | "warn" | "error";
    sinceHours?: number;
    page?: number;
    perPage?: number;
  },
): Promise<{ entries: LogEntry[]; pagination: Pagination }> =>
  apiGet(
    ctx,
    `/api/logging${queryString({
      search: params.search,
      source: params.source,
      level: params.level,
      since_hours: params.sinceHours,
      ...pageQuery(params),
    })}`,
  );

const sortByTimeDesc = <T extends { createdAt?: string; occurredAt?: string; time?: string }>(items: T[]): T[] =>
  items
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? b.occurredAt ?? b.time ?? 0).getTime() - new Date(a.createdAt ?? a.occurredAt ?? a.time ?? 0).getTime(),
    );

const parseLookbackHours = (value: string | undefined): number => {
  const raw = value?.trim() || "24h";
  const match = raw.match(/^(\d+)(m|h|d)$/i);
  if (!match) throw new Error("--since must be a duration like 30m, 6h, or 7d.");
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const hours = unit === "m" ? Math.max(1, Math.ceil(amount / 60)) : unit === "d" ? amount * 24 : amount;
  return Math.min(Math.max(hours, 1), 24 * 31);
};

const resolveApp = async (ctx: CloudCliContext, ref: string) => {
  const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
  const lower = ref.toLowerCase();
  const matches = health.apps.filter((app) => app.id.toLowerCase() === lower || app.name.toLowerCase() === lower);
  if (matches.length === 1) return { health, app: matches[0]! };
  if (matches.length > 1) throw new Error(`Ambiguous app reference "${ref}". Use an app id.`);
  throw new Error(`App "${ref}" not found.`);
};

const schemaRows = (tables: PostgresDiagnostics["tableRows"]) => {
  const schemas = new Map<string, { schema: string; tables: number; rows: number; totalBytes: number; warnings: number }>();
  for (const table of tables) {
    const current = schemas.get(table.schema) ?? { schema: table.schema, tables: 0, rows: 0, totalBytes: 0, warnings: 0 };
    current.tables += 1;
    current.rows += table.estimatedRows;
    current.totalBytes += table.totalBytes;
    current.warnings += table.warnings.length;
    schemas.set(table.schema, current);
  }
  return [...schemas.values()]
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .map((schema) => ({ ...schema, total: formatBytes(schema.totalBytes) }));
};

const webhookInputFromFlags = (flags: {
  name?: string;
  url?: string;
  method?: "GET" | "POST";
  enabled?: boolean;
  disabled?: boolean;
  scope?: "all" | "include" | "exclude";
  apps?: string;
  sendOn?: string;
  minStatus?: "ok" | "warn" | "error";
  repeatIntervalMs?: number;
  timeoutMs?: number;
}) => ({
  name: flags.name,
  url: flags.url,
  method: flags.method,
  enabled: flags.disabled ? false : flags.enabled ? true : undefined,
  scopeKind: flags.scope,
  scopeAppIds: flags.apps
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  sendOn: flags.sendOn
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  minStatus: flags.minStatus,
  repeatIntervalMs: flags.repeatIntervalMs,
  timeoutMs: flags.timeoutMs,
});

const cleanObject = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

const defaultWebhookInput = (flags: ReturnType<typeof webhookInputFromFlags>) => ({
  name: flags.name,
  url: flags.url,
  method: flags.method ?? "POST",
  enabled: flags.enabled ?? true,
  scopeKind: flags.scopeKind ?? "all",
  scopeAppIds: flags.scopeAppIds ?? [],
  sendOn: flags.sendOn ?? ["error", "recovery"],
  minStatus: flags.minStatus ?? "error",
  repeatIntervalMs: flags.repeatIntervalMs ?? 1_800_000,
  timeoutMs: flags.timeoutMs ?? 5000,
});

const webhookRows = (items: HealthWebhook[]) =>
  items.map((webhook) => ({
    enabled: webhook.enabled,
    name: webhook.name,
    method: webhook.method,
    status: webhook.lastStatus ?? "",
    failures: webhook.failureCount,
    scope: webhook.scopeKind,
    sendOn: webhook.sendOn.join(","),
    url: truncate(webhook.url, 72),
    id: webhook.id,
  }));

const webhookColumns = [
  { key: "enabled" },
  { key: "name" },
  { key: "method" },
  { key: "status" },
  { key: "failures" },
  { key: "scope" },
  { key: "sendOn" },
  { key: "url" },
  { key: "id" },
] satisfies CloudCliTableColumn<ReturnType<typeof webhookRows>[number]>[];

const batchRows = (items: NotificationBatch[]) =>
  items.map((batch) => ({
    status: batch.status,
    subject: truncate(batch.subject, 72),
    targets: batch.targetCount,
    deliverable: batch.deliverableCount,
    sent: batch.sentCount,
    errors: batch.errorCount,
    created: batch.createdAt,
    id: batch.id,
  }));

const previewRows = (preview: NotificationBatchPreview) => [
  {
    targets: preview.targetCount,
    deliverable: preview.deliverableCount,
    skippedNoEmail: preview.skippedNoEmailCount,
    duplicates: preview.duplicateCount,
    recipientHash: preview.recipientHash,
  },
];

const safeCollect = async <T>(
  label: string,
  load: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; label: string; error: string }> => {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    return { ok: false, label, error: error instanceof Error ? error.message : String(error) };
  }
};

const DIAGNOSE_SECTIONS = ["health", "logs", "telemetry", "postgres", "redis", "metrics"] as const;
type DiagnoseSection = (typeof DIAGNOSE_SECTIONS)[number];

const parseDiagnoseSections = (value: string | undefined, label: string): Set<DiagnoseSection> | null => {
  if (!value) return null;
  const sections = new Set<DiagnoseSection>();
  for (const raw of value.split(",")) {
    const section = raw.trim();
    if (!section) continue;
    if (!DIAGNOSE_SECTIONS.includes(section as DiagnoseSection)) {
      throw new Error(`${label} must contain only: ${DIAGNOSE_SECTIONS.join(", ")}.`);
    }
    sections.add(section as DiagnoseSection);
  }
  return sections;
};

const skippedCollect = (label: string): { ok: false; label: string; skipped: true; error: string } => ({
  ok: false,
  label,
  skipped: true,
  error: "Skipped by diagnose filters.",
});

const trimLogMessages = <T extends { entries: LogEntry[] }>(result: T, messageLength: number): T => ({
  ...result,
  entries: result.entries.map((entry) => ({ ...entry, message: truncate(entry.message, messageLength) })),
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export default defineCliCommands({
  name: "admin",
  summary: "Inspect and operate Cloud administration surfaces.",
  commands: [
    command("status", {
      summary: "Show gateway and app health",
      run: async ({ ctx }) => {
        const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
        const row = {
          status: health.status,
          apps: health.summary.apps,
          healthy: health.summary.healthy,
          degraded: health.summary.degraded,
          offline: health.summary.offline,
          routes: health.summary.routes,
          requests: health.summary.requests,
          errors: health.summary.errors,
        };
        printJsonOrTable(
          ctx,
          health,
          [row],
          [
            { key: "status" },
            { key: "apps" },
            { key: "healthy" },
            { key: "degraded" },
            { key: "offline" },
            { key: "routes" },
            { key: "requests" },
            { key: "errors" },
          ],
        );
      },
    }),
    command("diagnose", {
      summary: "Collect a bounded diagnostics bundle for agents",
      flags: {
        since: flag.string({ default: "24h", description: "Lookback window like 30m, 6h, or 7d" }),
        logLimit: flag.int({ name: "log-limit", default: 20, min: 1, max: 50, description: "Recent error/warn logs per level" }),
        include: flag.string({ description: "Comma-separated sections: health,logs,telemetry,postgres,redis,metrics" }),
        skip: flag.string({ description: "Comma-separated sections to skip" }),
        messageLength: flag.int({
          name: "message-length",
          default: 500,
          min: 40,
          max: 5000,
          description: "Log message length in JSON bundle",
        }),
        fullLogs: flag.boolean({ name: "full-logs", description: "Do not trim log messages in the JSON bundle" }),
      },
      run: async ({ ctx, flags }) => {
        const hours = parseLookbackHours(flags.since);
        const logLimit = flags.logLimit ?? 20;
        const include = parseDiagnoseSections(flags.include, "--include");
        const skip = parseDiagnoseSections(flags.skip, "--skip");
        const shouldCollect = (section: DiagnoseSection) => (!include || include.has(section)) && !skip?.has(section);
        const [health, logSummary, logErrors, logWarnings, telemetrySummary, telemetryErrors, postgres, redis, metrics] = await Promise.all(
          [
            shouldCollect("health")
              ? safeCollect("gateway health", () => apiGet<GatewayHealth>(ctx, "/api/gateway/health"))
              : skippedCollect("gateway health"),
            shouldCollect("logs")
              ? safeCollect("log summary", () => apiGet<LogSummary>(ctx, "/api/logging/summary"))
              : skippedCollect("log summary"),
            shouldCollect("logs")
              ? safeCollect("error logs", () => getLogs(ctx, { level: "error", sinceHours: hours, perPage: logLimit }))
              : skippedCollect("error logs"),
            shouldCollect("logs")
              ? safeCollect("warning logs", () => getLogs(ctx, { level: "warn", sinceHours: hours, perPage: logLimit }))
              : skippedCollect("warning logs"),
            shouldCollect("telemetry")
              ? safeCollect("telemetry summary", () =>
                  apiGet<Record<string, number | null>>(ctx, `/api/gateway/telemetry/summary${queryString({ hours })}`),
                )
              : skippedCollect("telemetry summary"),
            shouldCollect("telemetry")
              ? safeCollect("telemetry errors", () =>
                  apiGet<{ items: TelemetryEvent[]; total: number }>(
                    ctx,
                    `/api/gateway/telemetry/events${queryString({ errors: "1", hours, page: 1, per_page: Math.min(logLimit, 50) })}`,
                  ),
                )
              : skippedCollect("telemetry errors"),
            shouldCollect("postgres")
              ? safeCollect("postgres", () => apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres"))
              : skippedCollect("postgres"),
            shouldCollect("redis")
              ? safeCollect("redis", () => apiGet<RedisDiagnostics>(ctx, "/api/gateway/data/redis"))
              : skippedCollect("redis"),
            shouldCollect("metrics")
              ? safeCollect("metrics", () =>
                  apiGet<{ generatedAt: string; series: number; collectors: MetricsCollector[] }>(ctx, "/api/gateway/metrics/snapshot"),
                )
              : skippedCollect("metrics"),
          ],
        );
        const bundle = {
          generatedAt: new Date().toISOString(),
          lookbackHours: hours,
          health,
          logs: {
            summary: logSummary,
            errors:
              logErrors.ok && !flags.fullLogs
                ? { ...logErrors, data: trimLogMessages(logErrors.data, flags.messageLength ?? 500) }
                : logErrors,
            warnings:
              logWarnings.ok && !flags.fullLogs
                ? { ...logWarnings, data: trimLogMessages(logWarnings.data, flags.messageLength ?? 500) }
                : logWarnings,
          },
          telemetry: { summary: telemetrySummary, errors: telemetryErrors },
          postgres,
          redis,
          metrics,
        };
        if (ctx.options.output === "json") {
          ctx.json(bundle);
          return;
        }

        const lines = ["Cloud admin diagnose", `lookback: ${hours}h`, ""];
        if (health.ok) {
          lines.push(
            `gateway: ${health.data.status}`,
            `apps: ${health.data.summary.healthy ?? 0} healthy, ${health.data.summary.degraded ?? 0} degraded, ${health.data.summary.offline ?? 0} offline`,
          );
        } else lines.push(`gateway: unavailable (${health.error})`);
        if (logSummary.ok) {
          lines.push(
            `logs: ${logSummary.data.errors24h} errors / ${logSummary.data.warnings24h} warnings in 24h, ${logSummary.data.total} retained`,
          );
        } else lines.push(`logs: unavailable (${logSummary.error})`);
        if (telemetrySummary.ok) {
          lines.push(`telemetry: ${telemetrySummary.data.requests ?? 0} requests, ${telemetrySummary.data.errors ?? 0} errors`);
        } else lines.push(`telemetry: unavailable (${telemetrySummary.error})`);
        if (postgres.ok)
          lines.push(
            `postgres: ${postgres.data.tables} tables, ${formatBytes(postgres.data.totalBytes)}, ${postgres.data.warnings.length} warnings`,
          );
        else lines.push(`postgres: unavailable (${postgres.error})`);
        if (redis.ok) lines.push(`redis: ${redis.data.dbSize} keys, ${redis.data.warnings.length} warnings`);
        else lines.push(`redis: unavailable (${redis.error})`);
        if (metrics.ok) {
          const failed = metrics.data.collectors.filter((collector) => collector.status !== "ok");
          lines.push(`metrics: ${metrics.data.series} series, ${failed.length} failed collectors`);
        } else lines.push(`metrics: unavailable (${metrics.error})`);
        if (logErrors.ok && logErrors.data.entries.length > 0) {
          lines.push("", "recent errors:");
          for (const entry of logErrors.data.entries.slice(0, 5)) {
            lines.push(`- [${entry.createdAt}] ${entry.source}: ${truncate(entry.message, 140)} (#${entry.id})`);
          }
        }
        ctx.print(lines.join("\n"));
      },
    }),
    command("apps list", {
      summary: "List registered apps and live health",
      run: async ({ ctx }) => {
        const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
        const rows = health.apps.map((app) => ({
          id: app.id,
          name: app.name,
          status: app.status,
          online: app.online,
          healthy: app.healthy,
          lastSeen: app.lastSeenAt,
          offlineMs: app.offlineForMs,
        }));
        printJsonOrTable(ctx, health, rows, [
          { key: "id" },
          { key: "status" },
          { key: "online" },
          { key: "healthy" },
          { key: "lastSeen" },
          { key: "name" },
        ]);
      },
    }),
    command("apps get", {
      summary: "Show one registered app by id or exact name",
      args: { ref: arg.required({ valueLabel: "id|name" }) },
      run: async ({ ctx, args }) => {
        const { app } = await resolveApp(ctx, args.ref);
        printJsonOrTable(
          ctx,
          app,
          [
            {
              id: app.id,
              name: app.name,
              status: app.status,
              online: app.online,
              healthy: app.healthy,
              lastSeen: app.lastSeenAt,
              offlineMs: app.offlineForMs,
            },
          ],
          [
            { key: "id" },
            { key: "name" },
            { key: "status" },
            { key: "online" },
            { key: "healthy" },
            { key: "lastSeen" },
            { key: "offlineMs" },
          ],
        );
      },
    }),
    command("apps remove", {
      summary: "Remove an offline registered app",
      args: { id: arg.required({ valueLabel: "app-id" }) },
      flags: { yes: confirmFlag("Confirm removing the offline app registry entry") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to remove an app without --yes.");
        const result = await apiJson<{ id: string }>(ctx, "DELETE", `/api/gateway/apps/${encodeURIComponent(args.id)}`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Removed ${result.id}.`);
      },
    }),
    command("routes list", {
      summary: "List active gateway routes",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Search route prefix or app id" }),
        app: flag.string({ description: "Filter by app id" }),
        errors: flag.boolean({ description: "Only routes with errors" }),
        sort: flag.enum(["count", "prefix", "errors"], { default: "count", description: "Sort by count, prefix, or errors" }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<GatewayRoutesResponse>(
          ctx,
          `/api/gateway/routes${queryString({
            search: flags.search,
            app: flags.app,
            errors: flags.errors,
            sort: flags.sort,
          })}`,
        );
        const rows = result.items.map((route) => ({
          prefix: route.prefix,
          app: route.appId,
          requests: route.count,
          errors: route.errors,
          lastSeen: route.lastSeen ?? "",
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "prefix" },
          { key: "app" },
          { key: "requests" },
          { key: "errors" },
          { key: "lastSeen" },
        ]);
      },
    }),
    command("logs list", {
      summary: "List log entries with source, level, and free-text filters",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Free-text log search" }),
        source: flag.string({ description: "Log source filter" }),
        level: flag.enum(["debug", "info", "warn", "error"], { description: "Log level filter" }),
        since: flag.string({ description: "Lookback window like 30m, 6h, or 7d" }),
        messageLength: flag.int({ name: "message-length", default: 140, min: 40, max: 1000, description: "Table message preview length" }),
        ...paginationFlags({ defaultPerPage: 50, maxPerPage: 100 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await getLogs(ctx, { ...flags, sinceHours: flags.since ? parseLookbackHours(flags.since) : undefined });
        printJsonOrTable(ctx, result, logRows(result.entries, flags.messageLength), logColumns);
      },
    }),
    command("logs summary", {
      summary: "Show log volume and recent error summary",
      run: async ({ ctx }) => {
        const result = await apiGet<LogSummary>(ctx, "/api/logging/summary");
        printJsonOrTable(
          ctx,
          result,
          [result],
          [{ key: "total" }, { key: "total24h" }, { key: "errors24h" }, { key: "warnings24h" }, { key: "sources" }, { key: "lastErrorAt" }],
        );
      },
    }),
    command("logs stats", {
      summary: "Group log volume by source or level",
      flags: {
        groupBy: flag.enum(["source", "level"], { name: "group-by", default: "source", description: "Stats dimension" }),
        since: flag.string({ default: "24h", description: "Lookback window like 30m, 6h, or 7d" }),
        limit: flag.int({ default: 50, min: 1, max: 200, description: "Maximum groups" }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<LogStatsResponse>(
          ctx,
          `/api/logging/stats${queryString({
            group_by: flags.groupBy,
            since_hours: parseLookbackHours(flags.since),
            limit: flags.limit,
          })}`,
        );
        printJsonOrTable(ctx, result, result.items, [
          { key: "key", label: flags.groupBy === "level" ? "level" : "source" },
          { key: "count" },
        ]);
      },
    }),
    command("logs errors", {
      summary: "List recent error logs for incident debugging",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Free-text log search" }),
        source: flag.string({ description: "Log source filter" }),
        since: flag.string({ default: "24h", description: "Lookback window like 30m, 6h, or 7d" }),
        messageLength: flag.int({ name: "message-length", default: 180, min: 40, max: 1000, description: "Table message preview length" }),
        ...paginationFlags({ defaultPerPage: 25, maxPerPage: 100 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await getLogs(ctx, { ...flags, level: "error", sinceHours: parseLookbackHours(flags.since) });
        printJsonOrTable(ctx, result, logRows(result.entries, flags.messageLength), logColumns);
      },
    }),
    command("logs problems", {
      summary: "List recent warn and error logs together",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Free-text log search" }),
        source: flag.string({ description: "Log source filter" }),
        since: flag.string({ default: "24h", description: "Lookback window like 30m, 6h, or 7d" }),
        limit: flag.int({ default: 50, min: 1, max: 100, description: "Maximum combined rows" }),
        messageLength: flag.int({ name: "message-length", default: 160, min: 40, max: 1000, description: "Table message preview length" }),
      },
      run: async ({ ctx, flags }) => {
        const perPage = flags.limit ?? 50;
        const sinceHours = parseLookbackHours(flags.since);
        const [errors, warnings] = await Promise.all([
          getLogs(ctx, { search: flags.search, source: flags.source, level: "error", sinceHours, perPage }),
          getLogs(ctx, { search: flags.search, source: flags.source, level: "warn", sinceHours, perPage }),
        ]);
        const entries = sortByTimeDesc([...errors.entries, ...warnings.entries]).slice(0, perPage);
        const result = { entries, totals: { errors: errors.pagination.total, warnings: warnings.pagination.total } };
        printJsonOrTable(ctx, result, logRows(entries, flags.messageLength), logColumns);
      },
    }),
    command("logs show", {
      summary: "Show one log entry with full message and metadata",
      args: { id: arg.required({ valueLabel: "id" }) },
      run: async ({ ctx, args }) => {
        const id = parseLogId(args.id);
        const result = await apiGet<LogEntry>(ctx, `/api/logging/${id}`);
        if (ctx.options.output === "json") {
          ctx.json(result);
          return;
        }
        const metadata = result.metadata ? `\nmetadata:\n${JSON.stringify(result.metadata, null, 2)}` : "";
        ctx.print(`[${result.createdAt}] ${result.level} ${result.source} #${result.id}\n${result.message}${metadata}`);
      },
    }),
    command("logs explain", {
      summary: "Collect one log entry with nearby diagnostic context",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: {
        since: flag.string({ default: "24h", description: "Context lookback window like 30m, 6h, or 7d" }),
        limit: flag.int({ default: 20, min: 1, max: 50, description: "Context rows per section" }),
        messageLength: flag.int({ name: "message-length", default: 500, min: 40, max: 5000, description: "Context log message length" }),
      },
      run: async ({ ctx, args, flags }) => {
        const id = parseLogId(args.id);
        const log = await apiGet<LogEntry>(ctx, `/api/logging/${id}`);
        const sinceHours = parseLookbackHours(flags.since);
        const limit = flags.limit ?? 20;
        const [sameSource, recentProblems, telemetryErrors, appHealth] = await Promise.all([
          safeCollect("same source logs", () => getLogs(ctx, { source: log.source, sinceHours, perPage: limit })),
          safeCollect("recent warn/error logs", async () => {
            const [errors, warnings] = await Promise.all([
              getLogs(ctx, { level: "error", sinceHours, perPage: limit }),
              getLogs(ctx, { level: "warn", sinceHours, perPage: limit }),
            ]);
            return sortByTimeDesc([...errors.entries, ...warnings.entries]).slice(0, limit);
          }),
          safeCollect("telemetry errors", () =>
            apiGet<{ items: TelemetryEvent[]; total: number }>(
              ctx,
              `/api/gateway/telemetry/events${queryString({ errors: "1", hours: sinceHours, page: 1, per_page: limit })}`,
            ),
          ),
          safeCollect("app health", async () => {
            const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
            return health.apps.find((app) => app.id === log.source || app.name === log.source) ?? null;
          }),
        ]);
        const trimEntry = (entry: LogEntry) => ({ ...entry, message: truncate(entry.message, flags.messageLength ?? 500) });
        const bundle = {
          log,
          lookbackHours: sinceHours,
          sameSource:
            sameSource.ok && flags.messageLength
              ? { ...sameSource, data: trimLogMessages(sameSource.data, flags.messageLength) }
              : sameSource,
          recentProblems: recentProblems.ok ? { ...recentProblems, data: recentProblems.data.map(trimEntry) } : recentProblems,
          telemetryErrors,
          appHealth,
        };
        if (ctx.options.output === "json") {
          ctx.json(bundle);
          return;
        }
        const lines = [
          `[${log.createdAt}] ${log.level} ${log.source} #${log.id}`,
          log.message,
          "",
          `same-source logs: ${sameSource.ok ? sameSource.data.entries.length : `unavailable (${sameSource.error})`}`,
          `recent problems: ${recentProblems.ok ? recentProblems.data.length : `unavailable (${recentProblems.error})`}`,
          `telemetry errors: ${telemetryErrors.ok ? telemetryErrors.data.items.length : `unavailable (${telemetryErrors.error})`}`,
          `app health: ${appHealth.ok ? (appHealth.data ? `${appHealth.data.status} (${appHealth.data.id})` : "no matching app") : `unavailable (${appHealth.error})`}`,
        ];
        ctx.print(lines.join("\n"));
      },
    }),
    command("logs tail", {
      summary: "Show latest logs, optionally filtered",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Free-text log search" }),
        source: flag.string({ description: "Log source filter" }),
        level: flag.enum(["debug", "info", "warn", "error"], { description: "Log level filter" }),
        since: flag.string({ description: "Lookback window like 30m, 6h, or 7d" }),
        lines: flag.int({ default: 20, min: 1, max: 100, description: "Rows to show" }),
        follow: flag.boolean({ aliases: ["f"], description: "Poll and print new rows until interrupted" }),
        interval: flag.int({ default: 2, min: 1, max: 60, description: "Follow poll interval in seconds" }),
        messageLength: flag.int({ name: "message-length", default: 180, min: 40, max: 1000, description: "Table message preview length" }),
      },
      run: async ({ ctx, flags }) => {
        const load = () =>
          getLogs(ctx, {
            search: flags.search,
            source: flags.source,
            level: flags.level,
            sinceHours: flags.since ? parseLookbackHours(flags.since) : undefined,
            perPage: flags.lines ?? 20,
          });
        const result = await load();
        printJsonOrTable(ctx, result, logRows(result.entries, flags.messageLength), logColumns);
        if (!flags.follow) return;
        const seen = new Set(result.entries.map((entry) => entry.id));
        while (true) {
          await sleep((flags.interval ?? 2) * 1000);
          const next = await load();
          const fresh = next.entries.filter((entry) => !seen.has(entry.id)).reverse();
          for (const entry of fresh) seen.add(entry.id);
          if (fresh.length === 0) continue;
          if (ctx.options.output === "json") {
            for (const entry of fresh) ctx.json(entry);
          } else {
            ctx.table(logRows(fresh, flags.messageLength), logColumns);
          }
        }
      },
    }),
    command("logs sources", {
      summary: "List log sources",
      run: async ({ ctx }) => {
        const result = await apiGet<{ sources: string[] }>(ctx, "/api/logging/sources");
        printJsonOrTable(
          ctx,
          result,
          result.sources.map((source) => ({ source })),
          [{ key: "source" }],
        );
      },
    }),
    command("logs cleanup", {
      summary: "Delete old retained logs",
      flags: {
        days: flag.int({ default: 30, min: 1, description: "Delete logs older than this many days" }),
        yes: confirmFlag("Confirm log cleanup"),
      },
      run: async ({ ctx, flags }) => {
        if (!flags.yes) throw new Error("Refusing to clean logs without --yes.");
        const result = await ctx.readJson<{ deleted: number }>(
          await ctx.fetch(`/api/logging/cleanup${queryString({ days: flags.days })}`, { method: "DELETE" }),
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Deleted ${result.deleted} log entries.`);
      },
    }),
    command("telemetry summary", {
      summary: "Show gateway telemetry summary",
      flags: { hours: flag.int({ default: 24, min: 1, max: 24 * 31, description: "Lookback window in hours" }) },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<Record<string, number | null>>(
          ctx,
          `/api/gateway/telemetry/summary${queryString({ hours: flags.hours })}`,
        );
        const rows = [result as Record<string, unknown>];
        printJsonOrTable(ctx, result, rows, [
          { key: "requests" },
          { key: "errors" },
          { key: "slowRequests" },
          { key: "avgDurationMs", value: (row) => formatMs(row.avgDurationMs as number | null) },
          { key: "p95DurationMs", value: (row) => formatMs(row.p95DurationMs as number | null) },
        ]);
      },
    }),
    command("telemetry events", {
      summary: "List request telemetry events",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Search app, route, method, or error" }),
        app: flag.string({ description: "App id filter" }),
        route: flag.string({ description: "Route prefix filter" }),
        hours: flag.int({ default: 24, min: 1, max: 24 * 31, description: "Lookback window in hours" }),
        slow: flag.boolean({ description: "Only slow requests" }),
        errors: flag.boolean({ description: "Only error requests" }),
        ...paginationFlags({ defaultPerPage: 100, maxPerPage: 200 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ items: TelemetryEvent[]; total: number }>(
          ctx,
          `/api/gateway/telemetry/events${queryString({
            search: flags.search,
            app: flags.app,
            route: flags.route,
            hours: flags.hours,
            slow: flags.slow ? "1" : undefined,
            errors: flags.errors ? "1" : undefined,
            ...pageQuery(flags),
          })}`,
        );
        const rows = result.items.map((event) => ({
          time: event.occurredAt,
          app: event.appId,
          route: event.routePrefix,
          method: event.method,
          status: event.status,
          duration: formatMs(event.durationMs),
          error: event.errorKind ?? "",
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "time" },
          { key: "app" },
          { key: "route" },
          { key: "method" },
          { key: "status" },
          { key: "duration" },
          { key: "error" },
        ]);
      },
    }),
    command("telemetry apps", {
      summary: "List apps with telemetry in the lookback window",
      flags: { hours: flag.int({ default: 24, min: 1, max: 24 * 31, description: "Lookback window in hours" }) },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ items: string[] }>(ctx, `/api/gateway/telemetry/apps${queryString({ hours: flags.hours })}`);
        printJsonOrTable(
          ctx,
          result,
          result.items.map((app) => ({ app })),
          [{ key: "app" }],
        );
      },
    }),
    command("postgres summary", {
      summary: "Show Postgres diagnostic summary",
      run: async ({ ctx }) => {
        const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
        const rows = [
          {
            available: data.available,
            schemas: data.schemas,
            tables: data.tables,
            storage: formatBytes(data.totalBytes),
            extensions: `${data.installedExtensions}/${data.availableExtensions}`,
            warnings: data.warnings.length,
            error: data.error ?? "",
          },
        ];
        printJsonOrTable(ctx, data, rows, [
          { key: "available" },
          { key: "schemas" },
          { key: "tables" },
          { key: "storage" },
          { key: "extensions" },
          { key: "warnings" },
          { key: "error" },
        ]);
      },
    }),
    command("postgres tables", {
      summary: "List Postgres tables",
      flags: {
        schema: flag.string({ description: "Schema filter" }),
        search: flag.string({ aliases: ["q"], description: "Search schema, table, or warning" }),
        sort: flag.enum(["size", "rows", "name", "dead"], { default: "size", description: "Sort order" }),
      },
      run: async ({ ctx, flags }) => {
        const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
        const needle = flags.search?.toLowerCase();
        const tables = data.tableRows
          .filter((table) => !flags.schema || table.schema === flags.schema)
          .filter((table) => {
            if (!needle) return true;
            return `${table.schema}.${table.name} ${table.warnings.join(" ")}`.toLowerCase().includes(needle);
          })
          .sort((a, b) => {
            if (flags.sort === "rows") return b.estimatedRows - a.estimatedRows;
            if (flags.sort === "dead") return b.deadRows - a.deadRows;
            if (flags.sort === "name") return `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`);
            return b.totalBytes - a.totalBytes;
          });
        const rows = tables.map((table) => ({
          table: `${table.schema}.${table.name}`,
          rows: table.estimatedRows,
          total: formatBytes(table.totalBytes),
          heap: formatBytes(table.tableBytes),
          indexes: formatBytes(table.indexBytes),
          deadRows: table.deadRows,
          warnings: table.warnings.join(", "),
        }));
        printJsonOrTable(ctx, { ...data, tableRows: tables }, rows, [
          { key: "table" },
          { key: "rows" },
          { key: "total" },
          { key: "heap" },
          { key: "indexes" },
          { key: "deadRows" },
          { key: "warnings" },
        ]);
      },
    }),
    command("postgres schemas", {
      summary: "List Postgres schemas with aggregate table size",
      run: async ({ ctx }) => {
        const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
        const rows = schemaRows(data.tableRows);
        printJsonOrTable(ctx, { items: rows }, rows, [
          { key: "schema" },
          { key: "tables" },
          { key: "rows" },
          { key: "total" },
          { key: "warnings" },
        ]);
      },
    }),
    command("postgres extensions", {
      summary: "List available Postgres extensions",
      flags: {
        installed: flag.boolean({ description: "Only installed extensions" }),
        search: flag.string({ aliases: ["q"], description: "Search extensions" }),
      },
      run: async ({ ctx, flags }) => {
        const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
        const needle = flags.search?.toLowerCase();
        const rows = data.extensionRows
          .filter((extension) => !flags.installed || extension.installed)
          .filter((extension) => {
            if (!needle) return true;
            return `${extension.name} ${extension.comment ?? ""}`.toLowerCase().includes(needle);
          })
          .map((extension) => ({
            name: extension.name,
            installed: extension.installed,
            installedVersion: extension.installedVersion ?? "",
            defaultVersion: extension.defaultVersion ?? "",
            description: truncate(extension.comment, 80),
          }));
        printJsonOrTable(ctx, { items: rows }, rows, [
          { key: "name" },
          { key: "installed" },
          { key: "installedVersion" },
          { key: "defaultVersion" },
          { key: "description" },
        ]);
      },
    }),
    command("redis summary", {
      summary: "Show Redis diagnostic summary",
      run: async ({ ctx }) => {
        const data = await apiGet<RedisDiagnostics>(ctx, "/api/gateway/data/redis");
        const expiring = data.keyspace.reduce((sum, row) => sum + row.expires, 0);
        const rows = [
          {
            available: data.available,
            keys: data.dbSize,
            expiring,
            sampled: data.sampledKeys,
            scanComplete: data.scanComplete,
            warnings: data.warnings.length,
            error: data.error ?? "",
          },
        ];
        printJsonOrTable(ctx, data, rows, [
          { key: "available" },
          { key: "keys" },
          { key: "expiring" },
          { key: "sampled" },
          { key: "scanComplete" },
          { key: "warnings" },
          { key: "error" },
        ]);
      },
    }),
    command("redis prefixes", {
      summary: "List sampled Redis prefixes",
      flags: {
        depth: flag.int({ default: 3, min: 1, max: 3, description: "Prefix depth" }),
        search: flag.string({ aliases: ["q"], description: "Search prefixes" }),
      },
      run: async ({ ctx, flags }) => {
        const data = await apiGet<RedisDiagnostics>(ctx, "/api/gateway/data/redis");
        const needle = flags.search?.toLowerCase();
        const rows = data.prefixes
          .filter((prefix) => prefix.depth === flags.depth)
          .filter((prefix) => !needle || prefix.prefix.toLowerCase().includes(needle))
          .map((prefix) => ({
            prefix: prefix.prefix,
            depth: prefix.depth,
            count: prefix.count,
            share: `${(prefix.share * 100).toFixed(1)}%`,
          }));
        printJsonOrTable(ctx, { items: rows, sampledKeys: data.sampledKeys, scanComplete: data.scanComplete }, rows, [
          { key: "prefix" },
          { key: "depth" },
          { key: "count" },
          { key: "share" },
        ]);
      },
    }),
    command("notifications list", {
      summary: "List email notifications",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Search notifications" }),
        status: flag.enum(["sent", "pending", "error"], { description: "Notification status" }),
        ...paginationFlags({ defaultPerPage: 50, maxPerPage: 100 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ notifications: Notification[]; pagination: Pagination }>(
          ctx,
          `/api/notifications${queryString({ search: flags.search, status: flags.status, ...pageQuery(flags) })}`,
        );
        const rows = result.notifications.map((item) => ({
          status: item.status,
          recipient: item.recipient,
          subject: truncate(item.subject, 72),
          error: truncate(item.error, 48),
          created: item.createdAt,
          id: item.id,
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "status" },
          { key: "recipient" },
          { key: "subject" },
          { key: "error" },
          { key: "created" },
          { key: "id" },
        ]);
      },
    }),
    command("notifications summary", {
      summary: "Show notification status summary",
      run: async ({ ctx }) => {
        const result = await apiGet<Record<string, number>>(ctx, "/api/notifications/summary");
        printJsonOrTable(ctx, result, [result], [{ key: "sent" }, { key: "pending" }, { key: "error" }]);
      },
    }),
    command("notifications get", {
      summary: "Show one notification",
      args: { id: arg.required({ valueLabel: "id" }) },
      run: async ({ ctx, args }) => {
        const result = await apiGet<Notification>(ctx, `/api/notifications/${encodeURIComponent(args.id)}`);
        printJsonOrTable(
          ctx,
          result,
          [result as unknown as Record<string, unknown>],
          [
            { key: "status" },
            { key: "recipient" },
            { key: "subject" },
            { key: "error" },
            { key: "sentAt" },
            { key: "createdAt" },
            { key: "id" },
          ],
        );
      },
    }),
    command("notifications resend", {
      summary: "Resend a pending or failed notification",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Confirm resending this notification") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to resend a notification without --yes.");
        const result = await apiJson<{ message: string }>(ctx, "POST", `/api/notifications/${encodeURIComponent(args.id)}/resend`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(result.message);
      },
    }),
    command("notifications pending-system", {
      summary: "Show pending system notification count",
      run: async ({ ctx }) => {
        const result = await apiGet<{ count: number }>(ctx, "/api/notifications/pending-system/count");
        printJsonOrTable(ctx, result, [result], [{ key: "count" }]);
      },
    }),
    command("notifications send-pending-system", {
      summary: "Send all pending system notifications",
      flags: { yes: confirmFlag("Confirm sending all pending system notifications") },
      run: async ({ ctx, flags }) => {
        if (!flags.yes) throw new Error("Refusing to send all pending system notifications without --yes.");
        const result = await apiJson<unknown>(ctx, "POST", "/api/notifications/pending-system/send-all");
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print("Pending system notification send submitted.");
      },
    }),
    command("notification-batches list", {
      summary: "List account notification batches",
      flags: {
        status: flag.enum(["draft", "ready", "running", "completed", "completed_with_errors", "failed", "cancelled"], {
          description: "Batch status",
        }),
        ...paginationFlags({ defaultPerPage: 50, maxPerPage: 100 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ batches: NotificationBatch[]; pagination: Pagination }>(
          ctx,
          `/api/accounts/notifications/batches${queryString({ status: flags.status, ...pageQuery(flags) })}`,
        );
        printJsonOrTable(ctx, result, batchRows(result.batches), [
          { key: "status" },
          { key: "subject" },
          { key: "targets" },
          { key: "deliverable" },
          { key: "sent" },
          { key: "errors" },
          { key: "created" },
          { key: "id" },
        ]);
      },
    }),
    command("notification-batches preview", {
      summary: "Resolve notification batch recipients from a selection JSON body",
      flags: {
        selection: flag.input({
          fileName: "selection-file",
          fileAliases: ["f"],
          required: true,
          description: "Audience selection JSON",
        }),
      },
      run: async ({ ctx, flags }) => {
        const selection = await readJsonInput<Record<string, unknown>>(flags.selection, "notification batch selection");
        const result = await apiJson<NotificationBatchPreview>(ctx, "POST", "/api/accounts/notifications/batches/preview", { selection });
        printJsonOrTable(ctx, result, previewRows(result), [
          { key: "targets" },
          { key: "deliverable" },
          { key: "skippedNoEmail" },
          { key: "duplicates" },
          { key: "recipientHash" },
        ]);
      },
    }),
    command("notification-batches create", {
      summary: "Create a draft account notification batch",
      flags: {
        subject: flag.string({ required: true, description: "Email subject" }),
        body: flag.input({
          fileName: "body-file",
          fileAliases: ["b"],
          required: true,
          description: "Markdown body",
        }),
        selection: flag.input({
          fileName: "selection-file",
          fileAliases: ["f"],
          required: true,
          description: "Audience selection JSON",
        }),
      },
      run: async ({ ctx, flags }) => {
        const [bodyMarkdown, selection] = await Promise.all([
          readCliInput(flags.body, { label: "notification batch body", required: true }),
          readJsonInput<Record<string, unknown>>(flags.selection, "notification batch selection"),
        ]);
        const result = await apiJson<NotificationBatch>(ctx, "POST", "/api/accounts/notifications/batches", {
          subject: flags.subject,
          bodyMarkdown,
          selection,
        });
        const row = batchRows([result])[0]!;
        printJsonOrTable(
          ctx,
          result,
          [row],
          [
            { key: "status" },
            { key: "subject" },
            { key: "targets" },
            { key: "deliverable" },
            { key: "sent" },
            { key: "errors" },
            { key: "created" },
            { key: "id" },
          ],
        );
      },
    }),
    command("notification-batches get", {
      summary: "Show one account notification batch",
      args: { id: arg.required({ valueLabel: "id" }) },
      run: async ({ ctx, args }) => {
        const result = await apiGet<NotificationBatch>(ctx, `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}`);
        const row = batchRows([result])[0]!;
        printJsonOrTable(
          ctx,
          result,
          [row],
          [
            { key: "status" },
            { key: "subject" },
            { key: "targets" },
            { key: "deliverable" },
            { key: "sent" },
            { key: "errors" },
            { key: "created" },
            { key: "id" },
          ],
        );
      },
    }),
    command("notification-batches finalize", {
      summary: "Finalize a draft batch and submit async delivery",
      args: { id: arg.required({ valueLabel: "batch-id" }) },
      flags: { yes: confirmFlag("Confirm finalizing and sending this notification batch") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to finalize a notification batch without --yes.");
        const batch = await apiGet<NotificationBatch>(ctx, `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}`);
        if (batch.status !== "draft") throw new Error(`Only draft batches can be finalized. Current status: ${batch.status}.`);
        const preview = await apiJson<NotificationBatchPreview>(ctx, "POST", "/api/accounts/notifications/batches/preview", {
          selection: batch.selection,
        });
        if (preview.deliverableCount <= 0) throw new Error("No deliverable recipients match this notification batch.");
        const result = await apiJson<{ batch: NotificationBatch; jobId: string }>(
          ctx,
          "POST",
          `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}/finalize`,
          {
            expectedSelectionHash: batch.selectionHash,
            expectedDeliverableCount: preview.deliverableCount,
            expectedRecipientHash: preview.recipientHash,
          },
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Finalized batch ${result.batch.id}. Delivery job: ${result.jobId}`);
      },
    }),
    command("notification-batches recipients", {
      summary: "List account notification batch recipients",
      args: { id: arg.required({ valueLabel: "batch-id" }) },
      flags: {
        status: flag.enum(["pending", "sending", "sent", "skipped", "error"], { description: "Recipient status" }),
        ...paginationFlags({ defaultPerPage: 100, maxPerPage: 100 }),
      },
      run: async ({ ctx, args, flags }) => {
        const result = await apiGet<{ recipients: NotificationBatchRecipient[]; pagination: Pagination }>(
          ctx,
          `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}/recipients${queryString({
            status: flags.status,
            ...pageQuery(flags),
          })}`,
        );
        const rows = result.recipients.map((recipient) => ({
          status: recipient.status,
          user: recipient.displayName || recipient.uid,
          uid: recipient.uid,
          email: recipient.recipient ?? "",
          provider: recipient.provider,
          profile: recipient.profile,
          attempts: recipient.attemptCount,
          error: truncate(recipient.error, 60),
          userId: recipient.userId,
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "status" },
          { key: "user" },
          { key: "uid" },
          { key: "email" },
          { key: "provider" },
          { key: "profile" },
          { key: "attempts" },
          { key: "error" },
          { key: "userId" },
        ]);
      },
    }),
    command("notification-batches retry-failed", {
      summary: "Retry all failed recipients in a finalized batch",
      args: { id: arg.required({ valueLabel: "batch-id" }) },
      flags: { yes: confirmFlag("Confirm retrying failed notification recipients") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to retry failed recipients without --yes.");
        const result = await apiJson<{ batch: NotificationBatch; jobId: string }>(
          ctx,
          "POST",
          `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}/retry-failed`,
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Retry submitted: ${result.jobId}`);
      },
    }),
    command("notification-batches retry-recipient", {
      summary: "Retry one failed recipient in a finalized batch",
      args: {
        id: arg.required({ valueLabel: "batch-id" }),
        userId: arg.required({ valueLabel: "user-id" }),
      },
      flags: { yes: confirmFlag("Confirm retrying the failed notification recipient") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to retry a recipient without --yes.");
        const result = await apiJson<{ batch: NotificationBatch; jobId: string }>(
          ctx,
          "POST",
          `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}/recipients/${encodeURIComponent(args.userId)}/retry`,
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Retry submitted: ${result.jobId}`);
      },
    }),
    command("notification-batches delete-draft", {
      summary: "Delete a draft account notification batch",
      args: { id: arg.required({ valueLabel: "batch-id" }) },
      flags: { yes: confirmFlag("Confirm deleting the draft notification batch") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to delete a draft notification batch without --yes.");
        const result = await apiJson<{ id: string }>(ctx, "DELETE", `/api/accounts/notifications/batches/${encodeURIComponent(args.id)}`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Deleted draft ${result.id}.`);
      },
    }),
    command("announcements list", {
      summary: "List platform announcements and banners",
      flags: {
        kind: flag.enum(["announcement", "banner"], { description: "Announcement kind" }),
        search: flag.string({ aliases: ["q"], description: "Search title or body" }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ items: Announcement[] }>(
          ctx,
          `/api/admin/core/announcements${queryString({ kind: flags.kind, search: flags.search })}`,
        );
        printJsonOrTable(ctx, result, announcementRows(result.items), [
          { key: "version" },
          { key: "kind" },
          { key: "tone" },
          { key: "title" },
          { key: "published" },
          { key: "expires" },
          { key: "id" },
        ]);
      },
    }),
    command("announcements create", {
      summary: "Create an announcement or banner",
      flags: {
        kind: flag.enum(["announcement", "banner"], { default: "announcement", description: "Entry kind" }),
        title: flag.string({ required: true, description: "Entry title" }),
        body: flag.input({ required: true, description: "Markdown body" }),
        tone: flag.enum(["info", "success", "warning", "danger"], { default: "info", description: "Visual tone" }),
        publishedAt: flag.string({ name: "published-at", description: "ISO publish timestamp" }),
        expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp, never, or null" }),
      },
      run: async ({ ctx, flags }) => {
        const body = await readCliInput(flags.body, { label: "announcement body", required: true });
        const result = await apiJson<Announcement>(ctx, "POST", "/api/admin/core/announcements", {
          kind: flags.kind,
          title: flags.title,
          body,
          tone: flags.tone,
          publishedAt: flags.publishedAt,
          expiresAt: parseExpiresAt(flags.expiresAt),
        });
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Created ${result.kind} v${result.version}: ${result.title}`);
      },
    }),
    command("announcements update", {
      summary: "Update an announcement or banner",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: {
        kind: flag.enum(["announcement", "banner"], { description: "Entry kind" }),
        title: flag.string({ description: "Entry title" }),
        body: flag.input({ description: "Markdown body" }),
        tone: flag.enum(["info", "success", "warning", "danger"], { description: "Visual tone" }),
        publishedAt: flag.string({ name: "published-at", description: "ISO publish timestamp" }),
        expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp, never, or null" }),
      },
      run: async ({ ctx, args, flags }) => {
        const body = await readOptionalInput(flags.body, "announcement body");
        const payload: Record<string, unknown> = {};
        if (flags.kind) payload.kind = flags.kind;
        if (flags.title) payload.title = flags.title;
        if (body !== undefined) payload.body = body;
        if (flags.tone) payload.tone = flags.tone;
        if (flags.publishedAt) payload.publishedAt = flags.publishedAt;
        const expiresAt = parseExpiresAt(flags.expiresAt);
        if (expiresAt !== undefined) payload.expiresAt = expiresAt;
        const result = await apiJson<Announcement>(ctx, "PATCH", `/api/admin/core/announcements/${encodeURIComponent(args.id)}`, payload);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Updated ${result.kind} v${result.version}: ${result.title}`);
      },
    }),
    command("announcements delete", {
      summary: "Delete an announcement or banner",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Confirm announcement deletion") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to delete an announcement without --yes.");
        const result = await apiJson<{ message: string }>(ctx, "DELETE", `/api/admin/core/announcements/${encodeURIComponent(args.id)}`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(result.message);
      },
    }),
    command("webhooks list", {
      summary: "List gateway health webhooks",
      run: async ({ ctx }) => {
        const result = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
        printJsonOrTable(ctx, result, webhookRows(result), webhookColumns);
      },
    }),
    command("webhooks get", {
      summary: "Show one gateway health webhook",
      args: { id: arg.required({ valueLabel: "id" }) },
      run: async ({ ctx, args }) => {
        const result = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
        const webhook = result.find((item) => item.id === args.id);
        if (!webhook) throw new Error("Health webhook not found.");
        printJsonOrTable(ctx, webhook, webhookRows([webhook]), webhookColumns);
      },
    }),
    command("webhooks apply", {
      summary: "Create or replace a gateway health webhook from JSON",
      args: { id: arg.optional({ valueLabel: "id" }) },
      flags: {
        body: flag.input({
          name: "body",
          fileName: "body-file",
          fileAliases: ["f"],
          required: true,
          description: "Webhook JSON body",
        }),
      },
      run: async ({ ctx, args, flags }) => {
        const payload = await readJsonInput<unknown>(flags.body, "webhook");
        const path = args.id ? `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}` : "/api/gateway/health/webhooks";
        const result = await apiJson<HealthWebhook>(ctx, args.id ? "PUT" : "POST", path, payload);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`${args.id ? "Updated" : "Created"} webhook ${result.name}.`);
      },
    }),
    command("webhooks create", {
      summary: "Create a gateway health webhook from flags",
      flags: {
        name: flag.string({ required: true, description: "Webhook name" }),
        url: flag.string({ required: true, description: "Webhook URL" }),
        method: flag.enum(["GET", "POST"], { default: "POST", description: "HTTP method" }),
        enabled: flag.boolean({ default: true, description: "Enable webhook" }),
        disabled: flag.boolean({ description: "Create disabled" }),
        scope: flag.enum(["all", "include", "exclude"], { default: "all", description: "App scope mode" }),
        apps: flag.string({ description: "Comma-separated app ids for include/exclude scope" }),
        sendOn: flag.string({ name: "send-on", description: "Comma-separated events: ok,warn,error,recovery,every_check" }),
        minStatus: flag.enum(["ok", "warn", "error"], { name: "min-status", default: "error", description: "Minimum status" }),
        repeatIntervalMs: flag.int({ name: "repeat-interval-ms", description: "Repeat interval in milliseconds" }),
        timeoutMs: flag.int({ name: "timeout-ms", description: "Request timeout in milliseconds" }),
      },
      run: async ({ ctx, flags }) => {
        const input = defaultWebhookInput(webhookInputFromFlags(flags));
        const result = await apiJson<HealthWebhook>(ctx, "POST", "/api/gateway/health/webhooks", input);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Created webhook ${result.name}.`);
      },
    }),
    command("webhooks update", {
      summary: "Partially update a gateway health webhook from flags",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: {
        name: flag.string({ description: "Webhook name" }),
        url: flag.string({ description: "Webhook URL" }),
        method: flag.enum(["GET", "POST"], { description: "HTTP method" }),
        enabled: flag.boolean({ description: "Enable webhook" }),
        disabled: flag.boolean({ description: "Disable webhook" }),
        scope: flag.enum(["all", "include", "exclude"], { description: "App scope mode" }),
        apps: flag.string({ description: "Comma-separated app ids for include/exclude scope" }),
        sendOn: flag.string({ name: "send-on", description: "Comma-separated events: ok,warn,error,recovery,every_check" }),
        minStatus: flag.enum(["ok", "warn", "error"], { name: "min-status", description: "Minimum status" }),
        repeatIntervalMs: flag.int({ name: "repeat-interval-ms", description: "Repeat interval in milliseconds" }),
        timeoutMs: flag.int({ name: "timeout-ms", description: "Request timeout in milliseconds" }),
      },
      run: async ({ ctx, args, flags }) => {
        const items = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
        const current = items.find((item) => item.id === args.id);
        if (!current) throw new Error("Health webhook not found.");
        const update = cleanObject(webhookInputFromFlags(flags));
        const input = {
          name: current.name,
          url: current.url,
          method: current.method,
          enabled: current.enabled,
          scopeKind: current.scopeKind,
          scopeAppIds: current.scopeAppIds,
          sendOn: current.sendOn,
          minStatus: current.minStatus,
          repeatIntervalMs: current.repeatIntervalMs,
          timeoutMs: current.timeoutMs,
          ...update,
        };
        const result = await apiJson<HealthWebhook>(ctx, "PUT", `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}`, input);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Updated webhook ${result.name}.`);
      },
    }),
    command("webhooks test", {
      summary: "Submit a gateway health webhook test delivery",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Confirm sending a webhook test delivery") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to test a webhook without --yes.");
        const result = await apiJson<{ message: string; jobId: string }>(
          ctx,
          "POST",
          `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}/test`,
        );
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`${result.message}: ${result.jobId}`);
      },
    }),
    command("webhooks delete", {
      summary: "Delete a gateway health webhook",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Confirm webhook deletion") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to delete a webhook without --yes.");
        const result = await apiJson<{ message: string }>(ctx, "DELETE", `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(result.message);
      },
    }),
    command("metrics status", {
      summary: "Show metric collector status",
      run: async ({ ctx }) => {
        const result = await apiGet<{ generatedAt: string; series: number; collectors: MetricsCollector[] }>(
          ctx,
          "/api/gateway/metrics/snapshot",
        );
        const rows = result.collectors.map((collector) => ({
          id: collector.id,
          status: collector.status,
          series: collector.series,
          duration: formatMs(collector.durationMs),
          metrics: collector.metricNames.length,
          error: truncate(collector.error, 60),
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "id" },
          { key: "status" },
          { key: "series" },
          { key: "duration" },
          { key: "metrics" },
          { key: "error" },
        ]);
      },
    }),
    command("metrics read", {
      summary: "Read raw Prometheus metrics",
      run: async ({ ctx }) => {
        const response = await ctx.fetch("/metrics");
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`${response.status} ${text.trim() || response.statusText}`);
        }
        ctx.print((await response.text()).trimEnd());
      },
    }),
    command("metrics catalogue", {
      summary: "List exposed metric names by collector",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Search metric or collector text" }),
        category: flag.string({ description: "Collector id or name filter" }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ generatedAt: string; series: number; collectors: MetricsCollector[] }>(
          ctx,
          "/api/gateway/metrics/snapshot",
        );
        const search = flags.search?.toLowerCase();
        const category = flags.category?.toLowerCase();
        const rows = result.collectors
          .filter((collector) => !category || collector.id.toLowerCase() === category || collector.name.toLowerCase() === category)
          .flatMap((collector) =>
            collector.metricNames.map((metric) => ({
              collector: collector.id,
              name: metric,
              status: collector.status,
              series: collector.series,
              description: truncate(collector.description, 90),
            })),
          )
          .filter((row) => {
            if (!search) return true;
            return `${row.collector} ${row.name} ${row.description}`.toLowerCase().includes(search);
          })
          .sort((a, b) => a.collector.localeCompare(b.collector) || a.name.localeCompare(b.name));
        printJsonOrTable(ctx, { generatedAt: result.generatedAt, items: rows }, rows, [
          { key: "collector" },
          { key: "name" },
          { key: "status" },
          { key: "series" },
          { key: "description" },
        ]);
      },
    }),
    command("metrics tokens list", {
      summary: "List metrics bearer tokens",
      run: async ({ ctx }) => {
        const result = await apiGet<{ items: MetricsToken[] }>(ctx, "/api/gateway/metrics/tokens");
        const rows = result.items.map((token) => ({
          name: token.name,
          prefix: token.tokenPrefix,
          expires: token.expiresAt ?? "never",
          lastUsed: token.lastUsedAt ?? "never",
          id: token.id,
        }));
        printJsonOrTable(ctx, result, rows, [{ key: "name" }, { key: "prefix" }, { key: "expires" }, { key: "lastUsed" }, { key: "id" }]);
      },
    }),
    command("metrics tokens create", {
      summary: "Create a metrics bearer token",
      args: { name: arg.required({ valueLabel: "name" }) },
      flags: { expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp, never, or null" }) },
      run: async ({ ctx, args, flags }) => {
        const result = await apiJson<{ token: string; credential: MetricsToken }>(ctx, "POST", "/api/gateway/metrics/tokens", {
          name: args.name,
          expiresAt: parseExpiresAt(flags.expiresAt) ?? null,
        });
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(`Token: ${result.token}\nPrefix: ${result.credential.tokenPrefix}\nStore this token now. It cannot be shown again.`);
      },
    }),
    command("metrics tokens revoke", {
      summary: "Revoke a metrics bearer token",
      args: { id: arg.required({ valueLabel: "id" }) },
      flags: { yes: confirmFlag("Confirm metrics token revocation") },
      run: async ({ ctx, args, flags }) => {
        if (!flags.yes) throw new Error("Refusing to revoke a metrics token without --yes.");
        const result = await apiJson<{ message: string }>(ctx, "DELETE", `/api/gateway/metrics/tokens/${encodeURIComponent(args.id)}`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(result.message);
      },
    }),
  ],
});
