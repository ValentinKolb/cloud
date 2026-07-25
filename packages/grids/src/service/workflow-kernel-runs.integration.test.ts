import { describe, expect, test } from "bun:test";
import type { WorkflowInvocation } from "@valentinkolb/cloud/workflows";
import type { WorkflowDryRunResult, WorkflowRuntimeRunIdentity } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import { testShortId } from "../integration-test-utils";
import { migrate } from "../migrate";
import type { GridsWorkflowChannel, GridsWorkflowPrincipal } from "../workflows/contracts";
import {
  cancelWorkflowRun,
  claimWorkflowRun,
  finishWorkflowRun,
  GridsWorkflowRuntimeRepository,
  gridsWorkflowEffectJournal,
  listExpiredWaitingWorkflowRuns,
  materializeWorkflowInvocation,
  resumeWaitingWorkflowRun,
} from "./workflow-kernel-runs";
import { finishDryRun } from "./workflow-kernel-runtime";
import { insertTestWorkflow, renameTestWorkflow } from "./workflow-test-fixture";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

describe("workflow run materialization", () => {
  postgresTest("cancels active runs and fences late worker completion", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Workflow cancel test')`;
      await insertTestWorkflow({
        id: workflowId,
        shortId: testShortId("W"),
        baseId: baseId,
        name: "Cancelable workflow",
        source: "steps: []",
        enabled: true,
      });
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
          run_id, step_key, source_path, iteration_path, kind, action, mode, status, execution_generation,
          effect_key, effect_state, effect_started_at
        ) VALUES
          (${runId}::uuid, 'steps.0', '["steps",0]'::jsonb, '{}'::int[], 'action', 'httpRequest', 'execute', 'running', 7,
           'cancel-started', 'executing', now()),
          (${runId}::uuid, 'steps.1', '["steps",1]'::jsonb, '{}'::int[], 'action', 'wait', 'execute', 'running', 7,
           NULL, NULL, NULL)
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
      const steps = await sql<Array<{ step_key: string; status: string; outcome: { state?: string }; effect_state: string | null }>>`
        SELECT step_key, status, outcome, effect_state
        FROM grids.workflow_step_runs
        WHERE run_id = ${runId}::uuid
        ORDER BY step_key
      `;
      expect(storedRun).toEqual({ status: "canceled", lease_expires_at: null });
      // Cancelling stops the run; it cannot un-send what already left. The
      // effect that was in flight stays unsettled for a human to judge, and the
      // step that never started one has nothing to settle.
      expect(steps.map(({ step_key, status, outcome, effect_state }) => [step_key, status, outcome.state, effect_state])).toEqual([
        ["steps.0", "canceled", "terminal", "ambiguous"],
        ["steps.1", "canceled", "terminal", null],
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: workflowShortId,
        baseId: baseId,
        name: "Scalar workflow",
        source: "steps: []",
        enabled: true,
      });
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: workflowShortId,
        baseId: baseId,
        name: "Path workflow",
        source: "steps: []",
        enabled: true,
      });
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
        await insertTestWorkflow({
          id: workflowId,
          shortId: workflowShortId,
          baseId: baseId,
          name: "Concurrent no-op workflow",
          source: "steps: []",
          enabled: true,
        });
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR010",
        baseId: baseId,
        name: "Original name",
        source: "steps: []",
        enabled: true,
      });

      const first = await materializeWorkflowInvocation({ baseId, invocation });
      expect(first.ok).toBe(true);
      await renameTestWorkflow(workflowId, "Renamed workflow");
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR002",
        baseId: baseId,
        name: "Revision workflow",
        source: "steps: []",
        enabled: true,
      });

      const first = await materializeWorkflowInvocation({ baseId, invocation });
      expect(first.ok).toBe(true);
      await renameTestWorkflow(workflowId, "Revision workflow 2");

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
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR004",
        baseId: baseId,
        name: "Park workflow",
        source: "steps: []",
        enabled: true,
      });
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

  postgresTest("fences an effect journal write against a lease the worker no longer holds", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const runId = Bun.randomUUIDv7();
    const step = { runId, key: "steps.0", executionGeneration: 1 };

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WR007', 'Effect fence test')`;
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR008",
        baseId: baseId,
        name: "Effect fence workflow",
        source: "steps: []",
        enabled: true,
      });
      await sql`
        INSERT INTO grids.workflow_runs (
          id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
          workflow_plan, status, occurred_at, execution_generation, heartbeat_at, lease_expires_at
        ) VALUES (
          ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'effect-fence', 'effect-fence',
          '{}'::jsonb, 'running', now(), 1, now(), now() + interval '2 minutes'
        )
      `;
      await sql`
        INSERT INTO grids.workflow_step_runs (
          run_id, step_key, source_path, iteration_path, kind, action, mode, status, execution_generation
        ) VALUES (${runId}::uuid, 'steps.0', '["steps",0]'::jsonb, '{}'::int[], 'action', 'httpRequest', 'execute', 'running', 1)
      `;

      expect(await gridsWorkflowEffectJournal.read(step)).toBeNull();
      await gridsWorkflowEffectJournal.begin(step, `workflow:${runId}:step:steps.0`);
      // Marked before it acts: that is the only ordering that leaves evidence
      // when the process dies mid-effect.
      expect(await gridsWorkflowEffectJournal.read(step)).toMatchObject({ state: "executing" });

      // Another worker claims the run, which bumps the generation.
      await sql`
        UPDATE grids.workflow_runs
        SET execution_generation = 2, heartbeat_at = now(), lease_expires_at = now() + interval '2 minutes'
        WHERE id = ${runId}::uuid
      `;
      await expect(gridsWorkflowEffectJournal.begin(step, "stale")).rejects.toThrow("lost its execution lease");
      await expect(sql.begin(async (tx) => gridsWorkflowEffectJournal.record(tx, step, "stale", { sent: true }))).rejects.toThrow(
        "lost its execution lease",
      );

      const [unchanged] = await sql<Array<{ effect_key: string; effect_state: string }>>`
        SELECT effect_key, effect_state FROM grids.workflow_step_runs WHERE run_id = ${runId}::uuid
      `;
      expect(unchanged).toEqual({ effect_key: `workflow:${runId}:step:steps.0`, effect_state: "executing" });

      // The worker that does hold the lease settles it, and the record commits
      // with the work that produced it.
      const held = { ...step, executionGeneration: 2 };
      await sql.begin(async (tx) => gridsWorkflowEffectJournal.record(tx, held, `workflow:${runId}:step:steps.0`, { sent: true }));
      expect(await gridsWorkflowEffectJournal.read(held)).toMatchObject({ state: "succeeded", output: { sent: true } });
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR021",
        baseId: baseId,
        name: "Dry-run workflow",
        source: "steps: []",
        enabled: true,
      });
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
      await insertTestWorkflow({
        id: workflowId,
        shortId: "WR006",
        baseId: baseId,
        name: "Credential workflow",
        source: "steps: []",
        enabled: true,
      });

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
