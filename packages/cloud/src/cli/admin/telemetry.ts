/**
 * HTTP request telemetry: aggregate health, per-route rankings, and drilldown
 * into individual requests.
 */
import { arg, command, flag, paginationFlags } from "../index";
import { getLogs } from "./logs";
import { apiGet, formatMs, pageQuery, printJsonOrTable, queryString, safeCollect } from "./shared";

export type TelemetryEvent = {
  id: number;
  appId: string;
  routePrefix: string;
  method: string;
  status: number;
  durationMs: number;
  errorKind: string | null;
  occurredAt: string;
};

const telemetryLegacyCommands = [
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
];

// ─── Route analysis ──────────────────────────────────────────────────────────
// Aggregate-first: `routes` answers "what is broken" or "what is busy" in a
// single call, which is the question worth asking before paging through
// individual requests. Backed by minute rollups, so a 30d window is cheap.

export type TelemetryRouteRow = {
  appId: string;
  route: string;
  requests: number;
  errors: number;
  slowRequests: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
};

export type TelemetryOverview = {
  requests: number;
  serverErrors: number;
  clientErrors: number;
  rateLimited: number;
  slowRequests: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
};

export const TELEMETRY_RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
export const TELEMETRY_SORTS = ["errorRate", "errors", "requests", "slow", "duration"] as const;

export const errorRate = (errors: number, requests: number): string =>
  requests === 0 ? "-" : `${((errors / requests) * 100).toFixed(1)}%`;

export const routeRows = (items: TelemetryRouteRow[]) =>
  items.map((row) => ({
    route: row.route,
    app: row.appId,
    requests: row.requests,
    errors: row.errors,
    errorRate: errorRate(row.errors, row.requests),
    slow: row.slowRequests,
    avgMs: formatMs(row.avgDurationMs),
    maxMs: formatMs(row.maxDurationMs),
  }));

export const rangeFlag = () => flag.enum(TELEMETRY_RANGES, { default: "24h", description: "Time window: 1h, 6h, 24h, 7d, or 30d" });

export const telemetryAnalysisCommands = [
  command("telemetry overview", {
    summary: "Show request volume split by error class",
    description:
      "Rollup-backed counts for the selected window. Server errors (5xx), client errors (4xx) and rate limits (429) are counted separately, because a rate-limited caller and a broken endpoint need different responses.",
    examples: ["cld admin telemetry overview --range 24h --json", "cld admin telemetry overview --range 7d --app grids"],
    flags: {
      range: rangeFlag(),
      app: flag.string({ description: "Restrict to one app id" }),
      route: flag.string({ description: "Restrict to one route template" }),
    },
    run: async ({ ctx, flags }) => {
      const raw = await apiGet<TelemetryOverview>(
        ctx,
        `/api/gateway/telemetry/overview${queryString({ range: flags.range, app: flags.app, route: flags.route })}`,
      );
      printJsonOrTable(
        ctx,
        raw,
        [
          {
            requests: raw.requests,
            serverErrors: raw.serverErrors,
            clientErrors: raw.clientErrors,
            rateLimited: raw.rateLimited,
            slow: raw.slowRequests,
            avgMs: formatMs(raw.avgDurationMs),
            maxMs: formatMs(raw.maxDurationMs),
          },
        ],
        [
          { key: "requests", label: "Requests" },
          { key: "serverErrors", label: "5xx" },
          { key: "clientErrors", label: "4xx" },
          { key: "rateLimited", label: "429" },
          { key: "slow", label: "Slow" },
          { key: "avgMs", label: "Avg" },
          { key: "maxMs", label: "Max" },
        ],
      );
    },
  }),

  command("telemetry routes", {
    summary: "Rank route templates by errors, popularity, or latency",
    description:
      "The primary troubleshooting view. Routes are real route templates (`/api/mail/mailboxes/:id`), not registry prefixes, so a failing endpoint is identifiable. Sort by errorRate to find what is broken, by requests to find what is popular. errorRate ignores routes under 20 requests so a single failure cannot top the list.",
    examples: [
      "cld admin telemetry routes --sort errorRate --range 24h --json",
      "cld admin telemetry routes --sort requests --range 7d",
      "cld admin telemetry routes --errors --app mail",
    ],
    flags: {
      range: rangeFlag(),
      app: flag.string({ description: "Restrict to one app id" }),
      sort: flag.enum(TELEMETRY_SORTS, { default: "errorRate", description: "Ranking order" }),
      errors: flag.boolean({ description: "Only routes that produced errors" }),
      slow: flag.boolean({ description: "Only routes that produced slow requests" }),
      limit: flag.int({ default: 25, min: 1, max: 100, description: "Maximum routes returned" }),
    },
    run: async ({ ctx, flags }) => {
      const raw = await apiGet<{ items: TelemetryRouteRow[] }>(
        ctx,
        `/api/gateway/telemetry/routes${queryString({
          range: flags.range,
          app: flags.app,
          sort: flags.sort,
          errors: flags.errors ? "1" : undefined,
          slow: flags.slow ? "1" : undefined,
          limit: flags.limit,
        })}`,
      );
      printJsonOrTable(ctx, raw, routeRows(raw.items), [
        { key: "route", label: "Route" },
        { key: "app", label: "App" },
        { key: "requests", label: "Requests" },
        { key: "errors", label: "Errors" },
        { key: "errorRate", label: "Rate" },
        { key: "slow", label: "Slow" },
        { key: "avgMs", label: "Avg" },
        { key: "maxMs", label: "Max" },
      ]);
    },
  }),

  command("telemetry timeseries", {
    summary: "Show requests and errors bucketed over time",
    description:
      "Bucket width follows the range so every window returns a readable number of points. Use it to place when a change started.",
    examples: ["cld admin telemetry timeseries --range 24h --json", "cld admin telemetry timeseries --range 7d --app grids"],
    flags: {
      range: rangeFlag(),
      app: flag.string({ description: "Restrict to one app id" }),
      route: flag.string({ description: "Restrict to one route template" }),
    },
    run: async ({ ctx, flags }) => {
      const raw = await apiGet<{ items: { at: string; requests: number; errors: number }[] }>(
        ctx,
        `/api/gateway/telemetry/timeseries${queryString({ range: flags.range, app: flags.app, route: flags.route })}`,
      );
      printJsonOrTable(ctx, raw, raw.items, [
        { key: "at", label: "Bucket" },
        { key: "requests", label: "Requests" },
        { key: "errors", label: "Errors" },
      ]);
    },
  }),

  command("telemetry explain", {
    summary: "Collect one route with its requests and related logs",
    description:
      "The counterpart to `logs explain`: takes a route template and returns its error breakdown, recent individual requests, and log entries from the owning app in one bundle. Sections that fail are reported as {ok:false,error} instead of aborting the command.",
    examples: [
      'cld admin telemetry explain "/api/mail/mailboxes/:id" --json',
      'cld admin telemetry explain "/app/grids" --range 6h --app grids',
    ],
    args: { route: arg.required({ valueLabel: "route" }) },
    flags: {
      range: rangeFlag(),
      app: flag.string({ description: "App id owning the route; narrows the log lookup" }),
      limit: flag.int({ default: 20, min: 1, max: 100, description: "Requests and log rows per section" }),
    },
    run: async ({ ctx, args, flags }) => {
      const scope = { range: flags.range, app: flags.app, route: args.route };
      const [overview, events, logs] = await Promise.all([
        safeCollect("overview", () => apiGet<TelemetryOverview>(ctx, `/api/gateway/telemetry/overview${queryString(scope)}`)),
        safeCollect("requests", () =>
          apiGet<{ items: Record<string, unknown>[] }>(
            ctx,
            `/api/gateway/telemetry/route-events${queryString({ ...scope, limit: flags.limit })}`,
          ),
        ),
        // Reuses the logs helper so the query shape cannot drift from `logs list`.
        safeCollect("logs", () =>
          getLogs(ctx, { source: flags.app, level: "error", sinceHours: rangeHours(flags.range ?? "24h"), perPage: flags.limit }),
        ),
      ]);

      const bundle = { route: args.route, range: flags.range, app: flags.app ?? null, overview, requests: events, logs };
      if (ctx.options.output === "json") {
        ctx.json(bundle);
        return;
      }
      ctx.print(`route: ${args.route} (${flags.range})`);
      ctx.print(
        overview.ok
          ? `requests: ${overview.data.requests}, 5xx: ${overview.data.serverErrors}, 4xx: ${overview.data.clientErrors}, 429: ${overview.data.rateLimited}, slow: ${overview.data.slowRequests}`
          : `overview: unavailable (${overview.error})`,
      );
      ctx.print(events.ok ? `recent requests: ${events.data.items.length}` : `recent requests: unavailable (${events.error})`);
      ctx.print(logs.ok ? `related error logs: ${logs.data.entries.length}` : `related error logs: unavailable (${logs.error})`);
    },
  }),
];

export const telemetryCommands = [...telemetryLegacyCommands, ...telemetryAnalysisCommands];

/**
 * Maps `diagnose --since` (free-form hours) onto the nearest supported
 * telemetry range, so one lookback flag drives every section of the bundle.
 */
export const diagnoseRange = (hours: number): string => {
  if (hours <= 1) return "1h";
  if (hours <= 6) return "6h";
  if (hours <= 24) return "24h";
  if (hours <= 24 * 7) return "7d";
  return "30d";
};

/** Range identifiers back to hours, for helpers that take a lookback window. */
export const rangeHours = (range: string): number =>
  range === "1h" ? 1 : range === "6h" ? 6 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24;
