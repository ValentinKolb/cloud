/**
 * Background jobs and scheduled work, read through the trace spans every
 * Cloud job records. Until now this was the one observability domain with no
 * CLI at all — visible in the admin UI, invisible to scripts and agents.
 *
 * Read-only. Triggering a schedule stays a deliberate action in the admin UI.
 */
import { arg, command, flag, paginationFlags } from "../index";
import { apiGet, formatMs, pageQuery, printJsonOrTable, queryString, truncate } from "./shared";

export type BackgroundJobTrace = {
  runs: number;
  failed: number;
  running: number;
  latestStatus: string | null;
  latestStartedAt: string | null;
  latestEndedAt: string | null;
  avgDurationMs: number | null;
  categories: string[];
};

export type BackgroundJobRow = {
  kind: "schedule" | "trace";
  source: string;
  label?: string | null;
  appId?: string | null;
  cron?: string | null;
  trace: BackgroundJobTrace | null;
};

export type TraceSpan = {
  traceId: string;
  spanId: string;
  source: string;
  appId: string | null;
  category: string | null;
  status: string;
  /** Failure detail; the field is `statusMessage`, not `error`. */
  statusMessage: string | null;
  /** Structured per-run metadata (counts, ids); shape is job-specific. */
  summary: Record<string, unknown> | null;
  eventCount: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
};

export type TraceEvent = {
  name: string;
  severity: string | null;
  occurredAt: string | null;
  body: string | null;
  attributes: Record<string, unknown> | null;
};

const HEALTH_VALUES = ["all", "failed", "running", "healthy"] as const;
const TYPE_VALUES = ["all", "job", "schedule", "ai", "http", "notification", "sync", "custom"] as const;

/** `traceId:spanId`, the identifier `jobs runs` prints and `jobs show` takes. */
const runKey = (span: { traceId: string; spanId: string }): string => `${span.traceId}:${span.spanId}`;

const jobRows = (items: BackgroundJobRow[]) =>
  items.map((row) => ({
    source: row.source,
    kind: row.kind,
    app: row.appId ?? "-",
    schedule: row.cron ?? "-",
    runs: row.trace?.runs ?? 0,
    failed: row.trace?.failed ?? 0,
    running: row.trace?.running ?? 0,
    latest: row.trace?.latestStatus ?? "-",
    avgMs: formatMs(row.trace?.avgDurationMs ?? null),
  }));

export const jobCommands = [
  command("jobs list", {
    summary: "List background jobs and schedules with their run health",
    description:
      "Joins registered schedules with recorded trace runs. `--health failed` means the MOST RECENT run of a source failed, i.e. currently unhealthy — it does not list every source that has ever failed. Use `jobs runs --source <id>` for run history.",
    examples: ["cld admin jobs list --json", "cld admin jobs list --health failed", "cld admin jobs list --type schedule --search mail"],
    flags: {
      search: flag.string({ aliases: ["q"], description: "Free-text match on source, label, or app" }),
      type: flag.enum(TYPE_VALUES, { default: "all", description: "Trace category" }),
      health: flag.enum(HEALTH_VALUES, { default: "all", description: "Current health of the latest run" }),
    },
    run: async ({ ctx, flags }) => {
      const raw = await apiGet<{ items: BackgroundJobRow[] }>(
        ctx,
        `/api/gateway/jobs${queryString({ search: flags.search, type: flags.type, health: flags.health })}`,
      );
      printJsonOrTable(ctx, raw, jobRows(raw.items), [
        { key: "source", label: "Source" },
        { key: "kind", label: "Kind" },
        { key: "app", label: "App" },
        { key: "schedule", label: "Cron" },
        { key: "runs", label: "Runs" },
        { key: "failed", label: "Failed" },
        { key: "running", label: "Running" },
        { key: "latest", label: "Latest" },
        { key: "avgMs", label: "Avg" },
      ]);
    },
  }),

  command("jobs stats", {
    summary: "Show aggregate run counts across all background jobs",
    examples: ["cld admin jobs stats --json"],
    run: async ({ ctx }) => {
      const raw = await apiGet<Record<string, number>>(ctx, "/api/gateway/jobs/stats");
      printJsonOrTable(
        ctx,
        raw,
        [raw],
        [
          { key: "runs", label: "Runs" },
          { key: "sources", label: "Sources" },
          { key: "running", label: "Running" },
          { key: "succeeded", label: "Succeeded" },
          { key: "failed", label: "Failed" },
        ],
      );
    },
  }),

  command("jobs runs", {
    summary: "List individual job runs, newest first",
    description: "Scope with --source to one job. The printed run id is `<traceId>:<spanId>` and is what `jobs show` expects.",
    examples: ["cld admin jobs runs --source gateway:telemetry:cleanup --json", "cld admin jobs runs --per-page 10"],
    flags: {
      source: flag.string({ description: "Restrict to one job source" }),
      ...paginationFlags({ defaultPerPage: 25, maxPerPage: 200 }),
    },
    run: async ({ ctx, flags }) => {
      const raw = await apiGet<{ items: TraceSpan[] }>(
        ctx,
        `/api/gateway/jobs/runs${queryString({ source: flags.source, ...pageQuery(flags) })}`,
      );
      printJsonOrTable(
        ctx,
        raw,
        raw.items.map((span) => ({
          run: runKey(span),
          source: span.source,
          status: span.status,
          startedAt: span.startedAt ?? "-",
          durationMs: formatMs(span.durationMs),
          error: truncate(span.statusMessage, 60) ?? "-",
        })),
        [
          { key: "run", label: "Run" },
          { key: "source", label: "Source" },
          { key: "status", label: "Status" },
          { key: "startedAt", label: "Started" },
          { key: "durationMs", label: "Duration" },
          { key: "error", label: "Error" },
        ],
      );
    },
  }),

  command("jobs show", {
    summary: "Show one job run with its recorded events",
    description: "Events are the closest thing a background job has to a log. Take the run id from `jobs runs`.",
    examples: ["cld admin jobs show <traceId>:<spanId> --json"],
    args: { run: arg.required({ valueLabel: "run" }) },
    run: async ({ ctx, args }) => {
      const raw = await apiGet<{ span: TraceSpan | null; events: TraceEvent[] }>(
        ctx,
        `/api/gateway/jobs/runs/${encodeURIComponent(args.run)}`,
      );
      if (ctx.options.output === "json") {
        ctx.json(raw);
        return;
      }
      if (!raw.span) {
        ctx.print("Run not found.");
        return;
      }
      ctx.print(`${raw.span.source} — ${raw.span.status}`);
      ctx.print(`started: ${raw.span.startedAt ?? "-"}  duration: ${formatMs(raw.span.durationMs)}`);
      if (raw.span.summary) ctx.print(`summary: ${JSON.stringify(raw.span.summary)}`);
      if (raw.span.statusMessage) ctx.print(`status message: ${raw.span.statusMessage}`);
      ctx.print("");
      ctx.table(
        raw.events.map((event) => ({
          occurredAt: event.occurredAt ?? "-",
          severity: event.severity ?? "-",
          name: event.name,
          body: truncate(event.body, 80) ?? "-",
        })),
        [
          { key: "occurredAt", label: "At" },
          { key: "severity", label: "Level" },
          { key: "name", label: "Event" },
          { key: "body", label: "Detail" },
        ],
      );
    },
  }),
];
