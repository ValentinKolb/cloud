import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { getWorkflowRunStats } from "./workflow-kernel-observability";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("workflow run statistics integration", () => {
  postgresTest("aggregates bounded totals, durations, latest status, and 24-hour failures", async () => {
    const baseId = uuid();
    const workflowAId = uuid();
    const workflowBId = uuid();

    try {
      await sql`
        INSERT INTO grids.bases (id, short_id, name)
        VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow run stats integration')
      `;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES
          (${workflowAId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Workflow A', 'steps: []', '{}'::jsonb, TRUE),
          (${workflowBId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Workflow B', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          inputs, context, workflow_plan, status, occurred_at, created_at, started_at, finished_at
        )
        VALUES
          (${uuid()}::uuid, ${workflowAId}::uuid, ${baseId}::uuid, 1, 'execute', 'manual', 'stats-a-1', 'a1', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'succeeded', now() - interval '5 minutes', now() - interval '5 minutes', now() - interval '5 minutes', now() - interval '5 minutes' + interval '1 second'),
          (${uuid()}::uuid, ${workflowAId}::uuid, ${baseId}::uuid, 1, 'execute', 'manual', 'stats-a-2', 'a2', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'failed', now() - interval '4 minutes', now() - interval '4 minutes', now() - interval '4 minutes', now() - interval '4 minutes' + interval '3 seconds'),
          (${uuid()}::uuid, ${workflowBId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'stats-b-1', 'b1', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'running', now() - interval '3 minutes', now() - interval '3 minutes', now() - interval '3 minutes', NULL),
          (${uuid()}::uuid, ${workflowAId}::uuid, ${baseId}::uuid, 1, 'execute', 'schedule', 'stats-a-3', 'a3', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'failed', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours' + interval '2 seconds')
      `;

      const stats = await getWorkflowRunStats(baseId, [workflowAId, workflowBId], { window: "1h" });

      expect(stats).toMatchObject({
        window: "1h",
        total: 3,
        queued: 0,
        running: 1,
        waiting: 0,
        succeeded: 1,
        failed: 1,
        canceled: 0,
        needsAttention: 0,
        failedLast24h: 2,
        avgDurationMs: 2000,
        p99DurationMs: 2980,
      });
      expect(stats.errorRate).toBeCloseTo(100 / 3);
      expect(stats.lastRunAt).not.toBeNull();
      expect(stats.byWorkflow).toHaveLength(2);
      expect(stats.byWorkflow.find((row) => row.workflowId === workflowBId)).toMatchObject({
        workflowId: workflowBId,
        total: 1,
        running: 1,
        avgDurationMs: null,
        p99DurationMs: null,
        latestStatus: "running",
      });
      expect(stats.byWorkflow.find((row) => row.workflowId === workflowAId)).toMatchObject({
        workflowId: workflowAId,
        total: 2,
        succeeded: 1,
        failed: 1,
        avgDurationMs: 2000,
        p99DurationMs: 2980,
        latestStatus: "failed",
      });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  test("returns an empty result without workflow scope", async () => {
    expect(await getWorkflowRunStats(uuid(), [], { window: "7d" })).toEqual({
      window: "7d",
      total: 0,
      queued: 0,
      running: 0,
      waiting: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
      needsAttention: 0,
      failedLast24h: 0,
      errorRate: 0,
      avgDurationMs: null,
      p99DurationMs: null,
      lastRunAt: null,
      byWorkflow: [],
    });
  });
});
