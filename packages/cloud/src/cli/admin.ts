import {
  arg,
  command,
  confirmFlag,
  defineCliCommands,
  flag,
  paginationFlags,
  readCliInput,
  type CliInputFlagValue,
  type CloudCliContext,
  type CloudCliTableColumn,
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

type LogEntry = {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  createdAt: string;
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
  minStatus: "ok" | "warn" | "error";
  lastStatus: "ok" | "warn" | "error" | null;
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
  status: "ok" | "error";
  series: number;
  durationMs: number;
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
    command("logs list", {
      summary: "List log entries with source, level, and free-text filters",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Free-text log search" }),
        source: flag.string({ description: "Log source filter" }),
        level: flag.enum(["debug", "info", "warn", "error"], { description: "Log level filter" }),
        ...paginationFlags({ defaultPerPage: 50, maxPerPage: 100 }),
      },
      run: async ({ ctx, flags }) => {
        const result = await apiGet<{ entries: LogEntry[]; pagination: Pagination }>(
          ctx,
          `/api/logging${queryString({ search: flags.search, source: flags.source, level: flags.level, ...pageQuery(flags) })}`,
        );
        const rows = result.entries.map((entry) => ({
          time: entry.createdAt,
          level: entry.level,
          source: entry.source,
          message: truncate(entry.message),
          id: entry.id,
        }));
        printJsonOrTable(ctx, result, rows, [{ key: "time" }, { key: "level" }, { key: "source" }, { key: "message" }, { key: "id" }]);
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
      },
      run: async ({ ctx, flags }) => {
        const data = await apiGet<PostgresDiagnostics>(ctx, "/api/gateway/data/postgres");
        const needle = flags.search?.toLowerCase();
        const rows = data.tableRows
          .filter((table) => !flags.schema || table.schema === flags.schema)
          .filter((table) => {
            if (!needle) return true;
            return `${table.schema}.${table.name} ${table.warnings.join(" ")}`.toLowerCase().includes(needle);
          })
          .map((table) => ({
            table: `${table.schema}.${table.name}`,
            rows: table.estimatedRows,
            total: formatBytes(table.totalBytes),
            heap: formatBytes(table.tableBytes),
            indexes: formatBytes(table.indexBytes),
            deadRows: table.deadRows,
            warnings: table.warnings.join(", "),
          }));
        printJsonOrTable(ctx, data, rows, [
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
        printJsonOrTable(ctx, data, rows, [
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
        printJsonOrTable(ctx, data, rows, [{ key: "prefix" }, { key: "depth" }, { key: "count" }, { key: "share" }]);
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
    command("notifications show", {
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
      run: async ({ ctx, args }) => {
        const result = await apiJson<{ message: string }>(ctx, "POST", `/api/notifications/${encodeURIComponent(args.id)}/resend`);
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print(result.message);
      },
    }),
    command("notifications send-pending", {
      summary: "Send all pending system notifications",
      flags: { yes: confirmFlag("Confirm sending all pending system notifications") },
      run: async ({ ctx, flags }) => {
        if (!flags.yes) throw new Error("Refusing to send all pending system notifications without --yes.");
        const result = await apiJson<unknown>(ctx, "POST", "/api/notifications/pending-system/send-all");
        if (ctx.options.output === "json") ctx.json(result);
        else ctx.print("Pending system notification send submitted.");
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
        const rows = result.map((webhook) => ({
          enabled: webhook.enabled,
          name: webhook.name,
          method: webhook.method,
          status: webhook.lastStatus ?? "",
          failures: webhook.failureCount,
          url: truncate(webhook.url, 72),
          id: webhook.id,
        }));
        printJsonOrTable(ctx, result, rows, [
          { key: "enabled" },
          { key: "name" },
          { key: "method" },
          { key: "status" },
          { key: "failures" },
          { key: "url" },
          { key: "id" },
        ]);
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
    command("webhooks test", {
      summary: "Submit a gateway health webhook test delivery",
      args: { id: arg.required({ valueLabel: "id" }) },
      run: async ({ ctx, args }) => {
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
      flags: { expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp" }) },
      run: async ({ ctx, args, flags }) => {
        const result = await apiJson<{ token: string; credential: MetricsToken }>(ctx, "POST", "/api/gateway/metrics/tokens", {
          name: args.name,
          expiresAt: flags.expiresAt ?? null,
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
