import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { WorkflowRun, WorkflowRunStats, WorkflowRunStatsWindow } from "../contracts";
import { parseJsonbRow } from "./jsonb";

const DEFAULT_STATS_WINDOW: WorkflowRunStatsWindow = "24h";
const STATS_WINDOW_SECONDS: Record<WorkflowRunStatsWindow, number> = {
  "10m": 10 * 60,
  "1h": 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

type WorkflowRunStatsRow = WorkflowRunStats["byWorkflow"][number];

type RunStatsSqlRow = {
  total: number | string;
  queued: number | string;
  running: number | string;
  succeeded: number | string;
  failed: number | string;
  canceled: number | string;
  failed_last_24h?: number | string;
  avg_duration_ms: number | string | null;
  p99_duration_ms: number | string | null;
  last_run_at: Date | string | null;
};

type RunStatsResultRow = RunStatsSqlRow & { by_workflow: unknown };

type WorkflowRunStatsSqlRow = RunStatsSqlRow & {
  workflow_id: string;
  latest_status: WorkflowRun["status"] | null;
};

const emptyRunStats = (window: WorkflowRunStatsWindow): WorkflowRunStats => ({
  window,
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failedLast24h: 0,
  errorRate: 0,
  avgDurationMs: null,
  p99DurationMs: null,
  lastRunAt: null,
  byWorkflow: [],
});

const numberOrNull = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const intCount = (value: number | string | null | undefined): number => Math.max(0, Math.trunc(numberOrNull(value) ?? 0));

const errorRate = (failed: number, total: number): number => (total > 0 ? (failed / total) * 100 : 0);

const mapStatsRow = (
  row: RunStatsSqlRow | undefined,
  window: WorkflowRunStatsWindow,
  byWorkflow: WorkflowRunStatsRow[],
): WorkflowRunStats => {
  const total = intCount(row?.total);
  const failed = intCount(row?.failed);
  return {
    window,
    total,
    queued: intCount(row?.queued),
    running: intCount(row?.running),
    succeeded: intCount(row?.succeeded),
    failed,
    canceled: intCount(row?.canceled),
    failedLast24h: intCount(row?.failed_last_24h),
    errorRate: errorRate(failed, total),
    avgDurationMs: numberOrNull(row?.avg_duration_ms),
    p99DurationMs: numberOrNull(row?.p99_duration_ms),
    lastRunAt: row?.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    byWorkflow,
  };
};

const mapWorkflowStatsRow = (row: WorkflowRunStatsSqlRow): WorkflowRunStatsRow => {
  const total = intCount(row.total);
  const failed = intCount(row.failed);
  return {
    workflowId: row.workflow_id,
    total,
    queued: intCount(row.queued),
    running: intCount(row.running),
    succeeded: intCount(row.succeeded),
    failed,
    canceled: intCount(row.canceled),
    errorRate: errorRate(failed, total),
    avgDurationMs: numberOrNull(row.avg_duration_ms),
    p99DurationMs: numberOrNull(row.p99_duration_ms),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    latestStatus: row.latest_status,
  };
};

export const runStats = async (
  baseId: string,
  workflowIds: string[],
  options: { window?: WorkflowRunStatsWindow | null } = {},
): Promise<WorkflowRunStats> => {
  const window = options.window ?? DEFAULT_STATS_WINDOW;
  if (workflowIds.length === 0) return emptyRunStats(window);
  const ids = toPgUuidArray(workflowIds);
  const windowSeconds = STATS_WINDOW_SECONDS[window];
  const [row] = await sql<RunStatsResultRow[]>`
    WITH filtered AS (
      SELECT
        id,
        workflow_id::text AS workflow_id,
        status,
        created_at,
        CASE
          WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
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
        AND status = 'failed'
        AND created_at >= now() - interval '24 hours'
    ),
    overall AS (
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'queued')::int AS queued,
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'canceled')::int AS canceled,
        round((avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
        round((percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
        max(created_at) AS last_run_at
      FROM filtered
    ),
    latest AS (
      SELECT DISTINCT ON (workflow_id) workflow_id, status AS latest_status
      FROM filtered
      ORDER BY workflow_id, created_at DESC, id DESC
    ),
    per_workflow AS (
      SELECT
        f.workflow_id,
        count(*)::int AS total,
        count(*) FILTER (WHERE f.status = 'queued')::int AS queued,
        count(*) FILTER (WHERE f.status = 'running')::int AS running,
        count(*) FILTER (WHERE f.status = 'succeeded')::int AS succeeded,
        count(*) FILTER (WHERE f.status = 'failed')::int AS failed,
        count(*) FILTER (WHERE f.status = 'canceled')::int AS canceled,
        round((avg(f.duration_ms) FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS avg_duration_ms,
        round((percentile_cont(0.99) WITHIN GROUP (ORDER BY f.duration_ms) FILTER (WHERE f.duration_ms IS NOT NULL))::numeric)::int AS p99_duration_ms,
        max(f.created_at) AS last_run_at,
        latest.latest_status
      FROM filtered f
      JOIN latest ON latest.workflow_id = f.workflow_id
      GROUP BY f.workflow_id, latest.latest_status
    )
    SELECT
      overall.*,
      failed_24h.failed_last_24h,
      COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(per_workflow) ORDER BY per_workflow.last_run_at DESC, per_workflow.workflow_id)
          FROM per_workflow
        ),
        '[]'::jsonb
      ) AS by_workflow
    FROM overall
    CROSS JOIN failed_24h
  `;
  const workflowRows = parseJsonbRow<WorkflowRunStatsSqlRow[]>(row?.by_workflow, []);
  return mapStatsRow(row, window, workflowRows.map(mapWorkflowStatsRow));
};
