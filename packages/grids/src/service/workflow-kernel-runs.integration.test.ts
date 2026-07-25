import { describe, expect, test } from "bun:test";
import type { WorkflowInvocation } from "@valentinkolb/cloud/workflows";
import type { WorkflowDryRunResult, WorkflowRuntimeRunIdentity } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import { testShortId } from "../integration-test-utils";
import { migrate } from "../migrate";
import type { GridsWorkflowChannel, GridsWorkflowPrincipal } from "../workflows/contracts";
import { SqlGridsWorkflowEffectIntents } from "./workflow-kernel-actions";
import {
  cancelWorkflowRun,
  claimWorkflowRun,
  finishWorkflowRun,
  GridsWorkflowRuntimeRepository,
  listExpiredWaitingWorkflowRuns,
  materializeWorkflowInvocation,
  resumeWaitingWorkflowRun,
} from "./workflow-kernel-runs";
import { finishDryRun } from "./workflow-kernel-runtime";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

describe("workflow run materialization", () => {
  postgresTest("cancels active runs and fences late worker completion", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Workflow cancel test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, ${testShortId("W")}, ${baseId}::uuid, 'Cancelable workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'cancel-run', 'cancel-run',
          '{}'::jsonb, 'running', now(), 7, now(), now() + interval '2 minutes'
        )
      `;
      await sql`
        INSERT INTO grids.workflow_step_runs (
          run_id, step_key, source_path, iteration_path, kind, action, mode, status, execution_generation
        ) VALUES (${runId}::uuid, 'steps.0', '["steps",0]'::jsonb, '{}'::int[], 'action', 'wait', 'execute', 'running', 7)
      `;
      await sql`
        INSERT INTO grids.workflow_effect_intents (
          run_id, step_key, effect_kind, idempotency_key, status, request, execution_generation, effect_started_at
        ) VALUES
          (${runId}::uuid, 'steps.0', 'transactional', 'cancel-pending', 'pending', '{}'::jsonb, 7, NULL),
          (${runId}::uuid, 'steps.0', 'durable-intent', 'cancel-started', 'executing', '{}'::jsonb, 7, now())
      `;

      const canceled = await cancelWorkflowRun(runId, null);
      expect(canceled?.status).toBe("canceled");
      expect(
        await finishWorkflowRun(
          {
            runId,
            executionGeneration: 7,
            mode: "execute",
            workflowId,
            sourceHash: "source",
            idempotencyKey: "cancel-run",
          },
          { status: "succeeded" },
        ),
      ).toBe(false);
      expect(await cancelWorkflowRun(runId, null)).toBeNull();

      const [storedRun] = await sql<Array<{ status: string; lease_expires_at: Date | null }>>`
        SELECT status, lease_expires_at FROM grids.workflow_runs WHERE id = ${runId}::uuid
      `;
      const [storedStep] = await sql<Array<{ status: string; outcome: unknown }>>`
        SELECT status, outcome FROM grids.workflow_step_runs WHERE run_id = ${runId}::uuid
      `;
      const intents = await sql<Array<{ idempotency_key: string; status: string; error: { code?: string } | null }>>`
        SELECT idempotency_key, status, error
        FROM grids.workflow_effect_intents
        WHERE run_id = ${runId}::uuid
        ORDER BY idempotency_key
      `;
      expect(storedRun).toEqual({ status: "canceled", lease_expires_at: null });
      expect(storedStep).toMatchObject({ status: "canceled", outcome: { state: "terminal", status: "canceled" } });
      expect(intents).toEqual([
        {
          idempotency_key: "cancel-pending",
          status: "failed",
          error: expect.objectContaining({ code: "WORKFLOW_RUN_CANCELED" }),
        },
        {
          idempotency_key: "cancel-started",
          status: "needs_attention",
          error: expect.objectContaining({ code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN" }),
        },
      ]);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("finishes runs with scalar JSON results", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const baseShortId = testShortId("B");
    const workflowShortId = testShortId("W");

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Workflow scalar result test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, ${workflowShortId}, ${baseId}::uuid, 'Scalar workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'scalar-run', 'scalar-run',
          '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
        )
      `;

      expect(
        await finishWorkflowRun(
          {
            runId,
            executionGeneration: 1,
            mode: "execute",
            workflowId,
            sourceHash: "source",
            idempotencyKey: "scalar-run",
          },
          { status: "succeeded", result: true },
        ),
      ).toBe(true);
      const [stored] = await sql<Array<{ status: string; result: string; finished_at: Date | null }>>`
        SELECT status, result::text AS result, finished_at
        FROM grids.workflow_runs
        WHERE id = ${runId}::uuid
      `;
      expect(stored).toMatchObject({ status: "succeeded", result: "true" });
      expect(stored?.finished_at).toBeInstanceOf(Date);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("persists root and nested workflow iteration paths", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const baseShortId = testShortId("B");
    const workflowShortId = testShortId("W");

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Workflow path test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, ${workflowShortId}, ${baseId}::uuid, 'Path workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'path-run', 'path-run',
          '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
        )
      `;

      const repository = new GridsWorkflowRuntimeRepository();
      const run = {
        runId,
        executionGeneration: 1,
        mode: "execute" as const,
        workflowId,
        sourceHash: "source",
        idempotencyKey: "path-run",
      };
      await repository.startStep({
        ...run,
        key: "steps.0",
        sourcePath: ["steps", 0],
        iterationPath: [],
        path: ["steps", 0],
        kind: "action",
        action: "setVariable",
      });
      await repository.startStep({
        ...run,
        key: "steps.1.steps.0#2.3",
        sourcePath: ["steps", 1, "steps", 0],
        iterationPath: [2, 3],
        path: ["steps", 1, "steps", 0, "$iteration", 2, "$iteration", 3],
        kind: "action",
        action: "setVariable",
      });

      const rows = await sql<Array<{ step_key: string; iteration_path: number[] }>>`
        SELECT step_key, iteration_path
        FROM grids.workflow_step_runs
        WHERE run_id = ${runId}::uuid
        ORDER BY step_key
      `;
      expect(rows.map((row) => ({ ...row, iteration_path: Array.from(row.iteration_path) }))).toEqual([
        { step_key: "steps.0", iteration_path: [] },
        { step_key: "steps.1.steps.0#2.3", iteration_path: [2, 3] },
      ]);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest(
    "persists concurrent no-op run completions without protocol errors or leaked runs",
    async () => {
      await migrate();
      const baseId = Bun.randomUUIDv7();
      const workflowId = Bun.randomUUIDv7();
      const baseShortId = testShortId("B");
      const workflowShortId = testShortId("W");
      const runIds = Array.from({ length: 8 }, () => Bun.randomUUIDv7());

      try {
        await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Workflow concurrency test')`;
        await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, ${workflowShortId}, ${baseId}::uuid, 'Concurrent no-op workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
        await Promise.all(
          runIds.map(
            (runId, index) => sql`
          INSERT INTO grids.workflow_runs (
            id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
            workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
          ) VALUES (
            ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', ${`concurrent-${index}`},
            ${`concurrent-${index}`}, '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
          )
        `,
          ),
        );

        const completions = await Promise.all(
          runIds.map((runId, index) =>
            finishWorkflowRun(
              {
                runId,
                executionGeneration: 1,
                mode: "execute",
                workflowId,
                sourceHash: "source",
                idempotencyKey: `concurrent-${index}`,
              },
              { status: "succeeded", result: true },
            ),
          ),
        );
        expect(completions.every(Boolean)).toBe(true);

        const [stored] = await sql<Array<{ total: number; succeeded: number; active: number }>>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
               count(*) FILTER (WHERE status IN ('queued', 'running', 'waiting'))::int AS active
        FROM grids.workflow_runs
        WHERE id = ANY(${sql.array(runIds, "UUID")})
        `;
        expect(stored).toEqual({ total: runIds.length, succeeded: runIds.length, active: 0 });
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      }
    },
    15_000,
  );

  postgresTest("reuses an idempotent invocation after a workflow metadata revision", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
      workflowId,
      mode: "execute",
      channel: "api",
      actor: { groupIds: [] },
      inputs: {},
      context: {},
      idempotencyKey: "stable-request",
      occurredAt: "2026-07-14T11:00:00.000Z",
    };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR000', 'Stable run test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR010', ${baseId}::uuid, 'Original name', 'steps: []', '{}'::jsonb, TRUE)
      `;

      const first = await materializeWorkflowInvocation({ baseId, invocation });
      expect(first.ok).toBe(true);
      await sql`UPDATE grids.workflows SET name = 'Renamed workflow' WHERE id = ${workflowId}::uuid`;
      const repeated = await materializeWorkflowInvocation({ baseId, invocation });

      expect(repeated).toEqual(
        first.ok
          ? {
              ok: true,
              data: { ...first.data, created: false },
            }
          : first,
      );
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("does not reuse an idempotency key across requested workflow revisions", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
      workflowId,
      expectedRevision: "1",
      mode: "execute",
      channel: "api",
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
        invocation: { ...invocation, expectedRevision: "2" },
      });

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.message).toBe("Workflow changed since the caller loaded it.");
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("parks and resumes a waiting run atomically", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const dependency = { kind: "approval", key: "approval-1", deadline: "2000-01-01T00:00:00.000Z" };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR003', 'Park step test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR004', ${baseId}::uuid, 'Park workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'park-run', 'park-run',
          '{}'::jsonb, 'running', now(), 4, now(), now() + interval '2 minutes'
        )
      `;
      await sql`
        INSERT INTO grids.workflow_step_runs (
          run_id, step_key, source_path, iteration_path, kind, action, mode, status, execution_generation
        ) VALUES (${runId}::uuid, 'steps.0', '["steps",0]'::jsonb, '{}'::int[], 'action', 'wait', 'execute', 'running', 4)
      `;

      const repository = new GridsWorkflowRuntimeRepository();
      const stepIdentity = {
        runId,
        executionGeneration: 4,
        mode: "execute" as const,
        workflowId,
        sourceHash: "source",
        idempotencyKey: "park-run",
        key: "steps.0",
        sourcePath: ["steps", 0],
        iterationPath: [],
        path: ["steps", 0],
        kind: "action" as const,
        action: "wait",
      };

      await expect(repository.parkStep({ ...stepIdentity, key: "steps.missing" }, dependency)).rejects.toThrow(
        'Workflow step "steps.missing" lost its execution lease.',
      );
      const [stillRunning] = await sql<Array<{ status: string }>>`
        SELECT status FROM grids.workflow_runs WHERE id = ${runId}::uuid
      `;
      expect(stillRunning?.status).toBe("running");

      await repository.parkStep(stepIdentity, dependency);

      const [run] = await sql<Array<{ status: string; result: unknown; lease_expires_at: Date | null; waiting_deadline: Date | null }>>`
        SELECT status, result, lease_expires_at, waiting_deadline FROM grids.workflow_runs WHERE id = ${runId}::uuid
      `;
      const [step] = await sql<Array<{ status: string; outcome: unknown; finished_at: Date | null }>>`
        SELECT status, outcome, finished_at FROM grids.workflow_step_runs WHERE run_id = ${runId}::uuid AND step_key = 'steps.0'
      `;
      expect(run).toMatchObject({ status: "waiting", result: { dependency }, lease_expires_at: null });
      expect(run?.waiting_deadline?.toISOString()).toBe(dependency.deadline);
      expect(step).toMatchObject({ status: "waiting", outcome: { state: "waiting", dependency }, finished_at: null });

      const expired = (await listExpiredWaitingWorkflowRuns()).find((item) => item.runId === runId);
      expect(expired).toEqual({ runId, dependency });
      const nextDependency = { kind: "approval", key: "approval-2", deadline: "2000-01-02T00:00:00.000Z" };
      await sql`
        UPDATE grids.workflow_runs
        SET result = ${{ dependency: nextDependency }}::jsonb
        WHERE id = ${runId}::uuid
      `;
      expect(await resumeWaitingWorkflowRun(runId, expired!.dependency)).toBe(false);
      expect(await resumeWaitingWorkflowRun(runId, nextDependency)).toBe(true);
      expect(await resumeWaitingWorkflowRun(runId, nextDependency)).toBe(false);
      const [resumed] = await sql<Array<{ status: string; result: unknown; waiting_deadline: Date | null }>>`
        SELECT status, result, waiting_deadline FROM grids.workflow_runs WHERE id = ${runId}::uuid
      `;
      expect(resumed).toMatchObject({ status: "queued", result: null, waiting_deadline: null });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("fences recovered external effects by generation and attempt", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const intents = new SqlGridsWorkflowEffectIntents();

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR007', 'Effect fence test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR008', ${baseId}::uuid, 'Effect fence workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'effect-fence', 'effect-fence',
          '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
        )
      `;

      const durableRequest = { action: "sendEmail", templateId: "notice" };
      const first = await intents.prepare({
        runId,
        stepKey: "steps.0",
        executionGeneration: 1,
        effectKind: "durable-intent",
        idempotencyKey: `workflow:${runId}:step:steps.0`,
        request: durableRequest,
      });
      expect(first).toMatchObject({ state: "execute", executionGeneration: 1, attempt: 1 });
      if (first.state !== "execute") throw new Error("Durable effect was not claimed");
      await intents.begin(first, async () => undefined);

      await sql`
        UPDATE grids.workflow_runs
        SET execution_generation = 2, heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes'
        WHERE id = ${runId}::uuid
      `;
      await expect(intents.succeed(first, { sent: true })).rejects.toThrow("could not be completed");
      const recovered = await intents.prepare({
        runId,
        stepKey: "steps.0",
        executionGeneration: 2,
        effectKind: "durable-intent",
        idempotencyKey: `workflow:${runId}:step:steps.0`,
        request: durableRequest,
      });
      expect(recovered).toMatchObject({ state: "execute", executionGeneration: 2, attempt: 2 });
      if (recovered.state !== "execute") throw new Error("Durable effect was not recovered");
      await intents.begin(recovered, async () => undefined);
      await intents.succeed(recovered, { sent: true });

      const ambiguous = await intents.prepare({
        runId,
        stepKey: "steps.1",
        executionGeneration: 2,
        effectKind: "ambiguous-external",
        idempotencyKey: `workflow:${runId}:step:steps.1`,
        request: { action: "httpRequest", host: "example.test" },
      });
      if (ambiguous.state !== "execute") throw new Error("Ambiguous effect was not claimed");
      await intents.begin(ambiguous, async () => undefined);
      await sql`
        UPDATE grids.workflow_runs
        SET execution_generation = 3, heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes'
        WHERE id = ${runId}::uuid
      `;
      expect(
        await intents.prepare({
          runId,
          stepKey: "steps.1",
          executionGeneration: 3,
          effectKind: "ambiguous-external",
          idempotencyKey: `workflow:${runId}:step:steps.1`,
          request: { action: "httpRequest", host: "example.test" },
        }),
      ).toMatchObject({ state: "needs_attention", error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN" } });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("does not persist a terminal dry run as successful when planning has gaps", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const identity: WorkflowRuntimeRunIdentity = {
      runId,
      executionGeneration: 1,
      mode: "dryRun",
      workflowId,
      sourceHash: "source",
      idempotencyKey: "dry-run-issues",
    };
    const step = {
      ...identity,
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      path: ["steps", 0],
      kind: "action" as const,
      action: "unsupported",
    };
    const result: WorkflowDryRunResult = {
      state: "terminal",
      status: "succeeded",
      effects: [],
      issues: [{ state: "unsupported", reason: "No dry-run handler", step }],
    };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR020', 'Dry-run issue test')`;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR021', ${baseId}::uuid, 'Dry-run workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'dryRun', 'api', 'dry-run-issues', 'dry-run-issues',
          '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
        )
      `;

      expect(await finishDryRun(identity, result)).toBe("failed");
      const [stored] = await sql<Array<{ status: string; result: unknown; error: unknown }>>`
        SELECT status, result, error FROM grids.workflow_runs WHERE id = ${runId}::uuid
      `;
      expect(stored).toMatchObject({
        status: "failed",
        result: { terminal: { status: "succeeded" }, issues: [{ state: "unsupported" }] },
        error: { code: "WORKFLOW_DRY_RUN_UNSUPPORTED" },
      });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("persists and restores credential scope, binding, and actor provenance", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const serviceAccountId = Bun.randomUUIDv7();
    const credentialId = Bun.randomUUIDv7();
    const principal: GridsWorkflowPrincipal = {
      userId: null,
      groupIds: [],
      serviceAccountId,
      actorServiceAccountId: serviceAccountId,
      credential: {
        kind: "api_token",
        id: credentialId,
        scopes: ["grids:read", "grids:write"],
        permissionCap: "write",
        expiresAt: "2027-01-01T00:00:00.000Z",
        resourceBinding: { appId: "grids", resourceType: "base", resourceId: baseId },
      },
    };
    const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
      workflowId,
      expectedRevision: "1",
      mode: "execute",
      channel: "api",
      actor: { serviceAccountId, groupIds: [] },
      inputs: {},
      context: {},
      idempotencyKey: "credential-snapshot",
      occurredAt: "2026-07-15T12:00:00.000Z",
    };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR005', 'Credential snapshot test')`;
      await sql`
        INSERT INTO auth.service_accounts (id, name, kind, app_id, resource_type, resource_id)
        VALUES (${serviceAccountId}::uuid, 'Workflow credential test', 'resource_bound', 'grids', 'base', ${baseId})
      `;
      await sql`
        INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan, enabled)
        VALUES (${workflowId}::uuid, 'WR006', ${baseId}::uuid, 'Credential workflow', 'steps: []', '{}'::jsonb, TRUE)
      `;

      const materialized = await materializeWorkflowInvocation({ baseId, invocation, principal });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;

      const [stored] = await sql<Array<Record<string, unknown>>>`
        SELECT actor_service_account_id::text, credential_kind, credential_id::text,
               credential_scopes, credential_permission_cap, credential_expires_at,
               credential_resource_app_id, credential_resource_type, credential_resource_id,
               execution_clock_at
        FROM grids.workflow_runs
        WHERE id = ${materialized.data.runId}::uuid
      `;
      expect(stored).toMatchObject({
        actor_service_account_id: serviceAccountId,
        credential_kind: "api_token",
        credential_id: credentialId,
        credential_scopes: ["grids:read", "grids:write"],
        credential_permission_cap: "write",
        credential_resource_app_id: "grids",
        credential_resource_type: "base",
        credential_resource_id: baseId,
      });

      const claimed = await claimWorkflowRun(materialized.data.runId);
      expect(claimed?.principal).toEqual(principal);
      expect(claimed?.executionClockAt).toBe((stored?.execution_clock_at as Date).toISOString());
      expect(claimed?.executionClockAt).not.toBe(claimed?.occurredAt);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid`;
    }
  });
});
