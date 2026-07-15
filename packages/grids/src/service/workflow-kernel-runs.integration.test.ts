import { describe, expect, test } from "bun:test";
import type { WorkflowInvocation } from "@valentinkolb/cloud/workflows";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { GridsWorkflowChannel } from "../workflows/contracts";
import { materializeWorkflowInvocation } from "./workflow-kernel-runs";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("workflow run materialization", () => {
  postgresTest("does not reuse an idempotency key across requested workflow revisions", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
      workflowId,
      expectedRevision: 1,
      mode: "execute",
      channel: "manual",
      actor: { groupIds: [] },
      inputs: {},
      context: {},
      idempotencyKey: "same-request",
      occurredAt: "2026-07-14T12:00:00.000Z",
    };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR001', 'Run revision test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR002', ${baseId}::uuid, 'Revision workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;

      const first = await materializeWorkflowInvocation({ baseId, invocation });
      expect(first.ok).toBe(true);
      await sql`UPDATE grids.workflows SET name = 'Revision workflow 2' WHERE id = ${workflowId}::uuid`;

      const second = await materializeWorkflowInvocation({
        baseId,
        invocation: { ...invocation, expectedRevision: 2 },
      });

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.message).toBe("Workflow changed since the caller loaded it.");
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
