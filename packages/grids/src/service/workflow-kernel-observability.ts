import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type {
  GridsWorkflowChannel,
  GridsWorkflowEmailDelivery,
  GridsWorkflowRun,
  GridsWorkflowRunStats,
  GridsWorkflowRunStatsWindow,
  GridsWorkflowStepRun,
} from "../workflows/contracts";
import { parseJsonbRow } from "./jsonb";

type DbRow = Record<string, unknown>;
type RunCursor = { createdAt: string; id: string };

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DEFAULT_STATS_WINDOW: GridsWorkflowRunStatsWindow = "24h";
const STATS_WINDOW_SECONDS: Record<GridsWorkflowRunStatsWindow, number> = {
  "10m": 10 * 60,
  "1h": 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

const toIsoString = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const encodeCursor = (value: { createdAt: string; id: string }): string => `${value.createdAt}|${value.id}`;

const parseCursor = (cursor: string | null | undefined): RunCursor | null => {
  if (!cursor) return null;
  const [createdAt, id, ...rest] = cursor.split("|");
  if (!createdAt || !id || rest.length > 0 || !Number.isFinite(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  return { createdAt, id };
};

const pageSize = (limit: number | null | undefined): number => Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

const mapRun = (row: DbRow): GridsWorkflowRun => ({
  id: row.id as string,
  workflowId: (row.workflow_id as string | null) ?? null,
  launcherId: (row.launcher_id as string | null) ?? null,
  baseId: row.base_id as string,
  workflowRevision: Number(row.workflow_revision),
  mode: row.mode as GridsWorkflowRun["mode"],
  channel: row.channel as GridsWorkflowChannel,
  actorUserId: (row.actor_user_id as string | null) ?? null,
  serviceAccountId: (row.service_account_id as string | null) ?? null,
  inputs: parseJsonbRow<GridsWorkflowRun["inputs"]>(row.inputs, {}),
  status: row.status as GridsWorkflowRun["status"],
  result: parseJsonbRow<GridsWorkflowRun["result"]>(row.result, null),
  error: parseJsonbRow<GridsWorkflowRun["error"]>(row.error, null),
  resultMessage: (row.result_message as string | null) ?? null,
  createdAt: toIsoString(row.created_at as Date | string),
  startedAt: row.started_at ? toIsoString(row.started_at as Date | string) : null,
  finishedAt: row.finished_at ? toIsoString(row.finished_at as Date | string) : null,
});

const runColumns = sql`
  id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
  service_account_id, inputs, status, result, error, result_message, created_at, started_at, finished_at
`;

export const listWorkflowRunsPage = async (params: {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  status?: GridsWorkflowRun["status"] | null;
  mode?: GridsWorkflowRun["mode"] | null;
  channel?: GridsWorkflowChannel | null;
  cursor?: string | null;
  limit?: number | null;
}): Promise<{ items: GridsWorkflowRun[]; nextCursor: string | null }> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = pageSize(params.limit);
  const workflowIds = toPgUuidArray(params.workflowIds);
  const cursor = parseCursor(params.cursor);
  const workflowClause = params.workflowId ? sql`AND workflow_id = ${params.workflowId}::uuid` : sql``;
  const statusClause = params.status ? sql`AND status = ${params.status}` : sql``;
  const modeClause = params.mode ? sql`AND mode = ${params.mode}` : sql``;
  const channelClause = params.channel ? sql`AND channel = ${params.channel}` : sql``;
  const cursorClause = cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``;
  const rows = await sql<DbRow[]>`
    SELECT ${runColumns}
    FROM grids.workflow_runs
    WHERE base_id = ${params.baseId}::uuid
      AND workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowClause}
      ${statusClause}
      ${modeClause}
      ${channelClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap + 1}
  `;
  const mapped = rows.map(mapRun);
  const items = mapped.slice(0, cap);
  return {
    items,
    nextCursor: mapped.length > cap && items.length > 0 ? encodeCursor(items[items.length - 1]!) : null,
  };
};

export const listWorkflowStepRuns = async (runId: string): Promise<GridsWorkflowStepRun[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, run_id, step_key, source_path, to_json(iteration_path) AS iteration_path, kind, action,
           status, outcome, execution_generation, started_at, finished_at
    FROM grids.workflow_step_runs
    WHERE run_id = ${runId}::uuid
    ORDER BY started_at, id
  `;
  return rows.map((row) => ({
    id: row.id as string,
    runId: row.run_id as string,
    key: row.step_key as string,
    sourcePath: parseJsonbRow<Array<string | number>>(row.source_path, []),
    iterationPath: parseJsonbRow<number[]>(row.iteration_path, []),
    kind: row.kind as string,
    action: (row.action as string | null) ?? null,
    status: row.status as GridsWorkflowStepRun["status"],
    outcome: parseJsonbRow<GridsWorkflowStepRun["outcome"]>(row.outcome, null),
    executionGeneration: Number(row.execution_generation),
    startedAt: row.started_at ? toIsoString(row.started_at as Date | string) : null,
    finishedAt: row.finished_at ? toIsoString(row.finished_at as Date | string) : null,
  }));
};

type DeliveryRow = {
  id: string;
  workflow_id: string | null;
  workflow_run_id: string | null;
  template_id: string | null;
  recipient_kind: "email" | "user";
  recipient_summary: string;
  notification_id: string | null;
  provider_status: string | null;
  status: "pending" | "sent" | "failed";
  subject: string | null;
  error: string | null;
  created_at: Date | string;
};

const mapDelivery = (row: DeliveryRow): GridsWorkflowEmailDelivery => ({
  id: row.id,
  workflowId: row.workflow_id,
  workflowRunId: row.workflow_run_id,
  templateId: row.template_id,
  subject: row.subject,
  recipients: [
    {
      kind: row.recipient_kind,
      recipient: row.recipient_summary,
      ...(row.notification_id ? { notificationId: row.notification_id } : {}),
      ...(row.provider_status ? { status: row.provider_status } : {}),
    },
  ],
  status: row.status,
  error: row.error,
  createdAt: toIsoString(row.created_at),
});

export const listWorkflowEmailDeliveriesPage = async (params: {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  cursor?: string | null;
  limit?: number | null;
}): Promise<{ items: GridsWorkflowEmailDelivery[]; nextCursor: string | null }> => {
  if (params.workflowIds.length === 0) return { items: [], nextCursor: null };
  const cap = pageSize(params.limit);
  const workflowIds = toPgUuidArray(params.workflowIds);
  const cursor = parseCursor(params.cursor);
  const workflowClause = params.workflowId ? sql`AND delivery.workflow_id = ${params.workflowId}::uuid` : sql``;
  const cursorClause = cursor
    ? sql`AND (delivery.created_at, delivery.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : sql``;
  const rows = await sql<DeliveryRow[]>`
    SELECT delivery.id, delivery.workflow_id, delivery.workflow_run_id, delivery.template_id,
           delivery.recipient_kind, delivery.recipient_summary, delivery.notification_id,
           COALESCE(notification_state.provider_status, delivery.provider_status) AS provider_status,
           CASE
             WHEN delivery.status = 'failed' THEN 'failed'
             WHEN notification_state.current_status IS NOT NULL THEN notification_state.current_status
             ELSE delivery.status
           END AS status,
           delivery.subject,
           COALESCE(delivery.error, notification_state.error) AS error,
           delivery.created_at
    FROM grids.workflow_email_deliveries delivery
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN bool_or(required AND status IN ('failed', 'suppressed')) THEN 'failed'
          WHEN bool_or(required AND status IN ('deferred', 'pending', 'sending')) THEN 'pending'
          ELSE 'sent'
        END AS current_status,
        string_agg(DISTINCT status, ', ' ORDER BY status) AS provider_status,
        max(CASE WHEN required AND status IN ('failed', 'suppressed') THEN COALESCE(error_message, error_code) END) AS error
      FROM notifications.deliveries
      WHERE event_id = delivery.notification_id
    ) notification_state ON delivery.notification_id IS NOT NULL
    WHERE delivery.base_id = ${params.baseId}::uuid
      AND delivery.workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowClause}
      ${cursorClause}
    ORDER BY delivery.created_at DESC, delivery.id DESC
    LIMIT ${cap + 1}
  `;
  const mapped = rows.map(mapDelivery);
  const items = mapped.slice(0, cap);
  return {
    items,
    nextCursor: mapped.length > cap && items.length > 0 ? encodeCursor(items[items.length - 1]!) : null,
  };
};

type StatsSqlRow = {
  total: number | string;
  queued: number | string;
  running: number | string;
  waiting: number | string;
  succeeded: number | string;
  failed: number | string;
  canceled: number | string;
  needs_attention: number | string;
  failed_last_24h?: number | string;
  avg_duration_ms: number | string | null;
  p99_duration_ms: number | string | null;
  last_run_at: Date | string | null;
};

type WorkflowStatsSqlRow = StatsSqlRow & {
  workflow_id: string;
  latest_status: GridsWorkflowRun["status"] | null;
};

const count = (value: number | string | null | undefined): number => Math.max(0, Math.trunc(Number(value) || 0));
const numberOrNull = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const statsCounts = (row: StatsSqlRow | undefined) => {
  const total = count(row?.total);
  const failed = count(row?.failed);
  const needsAttention = count(row?.needs_attention);
  return {
    total,
    queued: count(row?.queued),
    running: count(row?.running),
    waiting: count(row?.waiting),
    succeeded: count(row?.succeeded),
    failed,
    canceled: count(row?.canceled),
    needsAttention,
    errorRate: total > 0 ? ((failed + needsAttention) / total) * 100 : 0,
    avgDurationMs: numberOrNull(row?.avg_duration_ms),
    p99DurationMs: numberOrNull(row?.p99_duration_ms),
    lastRunAt: row?.last_run_at ? toIsoString(row.last_run_at) : null,
  };
};

export const getWorkflowRunStats = async (
  baseId: string,
  workflowIds: string[],
  options: { window?: GridsWorkflowRunStatsWindow | null } = {},
): Promise<GridsWorkflowRunStats> => {
  const window = options.window ?? DEFAULT_STATS_WINDOW;
  if (workflowIds.length === 0) return { window, ...statsCounts(undefined), failedLast24h: 0, byWorkflow: [] };
  const ids = toPgUuidArray(workflowIds);
  const windowSeconds = STATS_WINDOW_SECONDS[window];
  const [row] = await sql<Array<StatsSqlRow & { by_workflow: unknown }>>`
    WITH filtered AS (
      SELECT id, workflow_id::text AS workflow_id, status, created_at,
             CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
               THEN GREATEST(0, EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)
               ELSE NULL
             END AS duration_ms
      FROM grids.workflow_runs
      WHERE base_id = ${baseId}::uuid
        AND workflow_id = ANY(${ids}::uuid[])
        AND created_at >= now() - (${windowSeconds} * interval '1 second')
    ),
    failed_24h AS (
      SELECT count(*)::int AS failed_last_24h
      FROM grids.workflow_runs
      WHERE base_id = ${baseId}::uuid
        AND workflow_id = ANY(${ids}::uuid[])
        AND status IN ('failed', 'needs_attention')
        AND created_at >= now() - interval '24 hours'
    ),
    overall AS (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'queued')::int AS queued,
             count(*) FILTER (WHERE status = 'running')::int AS running,
             count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
             count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE status = 'canceled')::int AS canceled,
             count(*) FILTER (WHERE status = 'needs_attention')::int AS needs_attention,
             round((avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
             round((percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)
               FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
             max(created_at) AS last_run_at
      FROM filtered
    ),
    latest AS (
      SELECT DISTINCT ON (workflow_id) workflow_id, status AS latest_status
      FROM filtered
      ORDER BY workflow_id, created_at DESC, id DESC
    ),
    per_workflow AS (
      SELECT f.workflow_id,
             count(*)::int AS total,
             count(*) FILTER (WHERE f.status = 'queued')::int AS queued,
             count(*) FILTER (WHERE f.status = 'running')::int AS running,
             count(*) FILTER (WHERE f.status = 'waiting')::int AS waiting,
             count(*) FILTER (WHERE f.status = 'succeeded')::int AS succeeded,
             count(*) FILTER (WHERE f.status = 'failed')::int AS failed,
             count(*) FILTER (WHERE f.status = 'canceled')::int AS canceled,
             count(*) FILTER (WHERE f.status = 'needs_attention')::int AS needs_attention,
             round((avg(f.duration_ms) FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
             round((percentile_cont(0.99) WITHIN GROUP (ORDER BY f.duration_ms)
               FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
             max(f.created_at) AS last_run_at,
             latest.latest_status
      FROM filtered f
      JOIN latest ON latest.workflow_id = f.workflow_id
      GROUP BY f.workflow_id, latest.latest_status
    )
    SELECT overall.*, failed_24h.failed_last_24h,
           COALESCE((SELECT jsonb_agg(to_jsonb(per_workflow) ORDER BY per_workflow.last_run_at DESC, per_workflow.workflow_id)
                     FROM per_workflow), '[]'::jsonb) AS by_workflow
    FROM overall
    CROSS JOIN failed_24h
  `;
  const byWorkflow = parseJsonbRow<WorkflowStatsSqlRow[]>(row?.by_workflow, []).map((item) => ({
    workflowId: item.workflow_id,
    ...statsCounts(item),
    latestStatus: item.latest_status,
  }));
  return {
    window,
    ...statsCounts(row),
    failedLast24h: count(row?.failed_last_24h),
    byWorkflow,
  };
};
