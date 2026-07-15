import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { getWorkflowRunStats, listWorkflowEmailDeliveriesPage, listWorkflowRunsPage } from "./workflow-kernel-observability";
import { createWorkflow, listWorkflows } from "./workflow-kernel-store";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("workflow history integration", () => {
  postgresTest("retains runs, stats, and email deliveries after soft deletion", async () => {
    const baseId = uuid();
    const runId = uuid();

    try {
      await sql`
        INSERT INTO grids.bases (id, short_id, name)
        VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow history integration')
      `;
      const created = await createWorkflow(
        baseId,
        { name: "Deleted workflow", source: "steps:\n  - succeed:\n      message: retained", enabled: true },
        null,
      );
      if (!created.ok) throw created.error;
      const workflowId = created.data.id;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          inputs, context, workflow_plan, status, occurred_at, created_at, started_at, finished_at
        )
        VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api',
          ${`history-${runId}`}, 'history', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'succeeded', now(), now(), now(), now()
        )
      `;
      await sql`
        INSERT INTO grids.workflow_email_deliveries (
          base_id, workflow_id, workflow_run_id, recipient_index, recipient_kind, recipient_value,
          recipient_summary, idempotency_key, status, subject
        )
        VALUES (
          ${baseId}::uuid, ${workflowId}::uuid, ${runId}::uuid, 1, 'email', 'reader@example.test',
          'reader@example.test', ${`history-email-${runId}`}, 'sent', 'Retained delivery'
        )
      `;
      await sql`UPDATE grids.workflows SET deleted_at = now(), enabled = FALSE WHERE id = ${workflowId}::uuid`;

      expect(await listWorkflows(baseId)).toEqual([]);
      const historicalWorkflows = await listWorkflows(baseId, false, true);
      expect(historicalWorkflows.map((workflow) => workflow.id)).toEqual([workflowId]);
      expect(historicalWorkflows[0]?.deletedAt).not.toBeNull();
      expect(historicalWorkflows[0]?.plan.maxLoopItems).toBe(10_000);

      const runs = await listWorkflowRunsPage({ baseId, workflowIds: [workflowId] });
      expect(runs.items.map((run) => run.id)).toEqual([runId]);

      const deliveries = await listWorkflowEmailDeliveriesPage({ baseId, workflowIds: [workflowId] });
      expect(deliveries.items).toHaveLength(1);
      expect(deliveries.items[0]?.workflowId).toBe(workflowId);

      const stats = await getWorkflowRunStats(baseId, [workflowId]);
      expect(stats.total).toBe(1);
      expect(stats.succeeded).toBe(1);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
