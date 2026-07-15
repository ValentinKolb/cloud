import { describe, expect, mock, test } from "bun:test";
import type { WorkflowInvocationReceipt } from "@valentinkolb/cloud/workflows";
import { coordinateWorkflowExecution } from "@valentinkolb/cloud/workflows/runtime";
import type { GridsWorkflow } from "../workflows/contracts";
import { type ClaimedWorkflowRun, createGridsWorkflowCoordinatorPort, WORKFLOW_RUN_LEASE_MS } from "./workflow-kernel-runs";
import {
  applyWorkflowRuntimeEvent,
  registerWorkflowSchedules,
  submitAcceptedWorkflowRun,
  WORKFLOW_JOB_LEASE_MS,
  workflowScheduleId,
  workflowScheduleMatches,
  workflowScheduleMetadata,
  workflowScheduleShouldRetry,
} from "./workflow-kernel-runtime";

const receipt = (status: WorkflowInvocationReceipt["status"] = "queued"): WorkflowInvocationReceipt => ({
  runId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  revision: "3",
  mode: "execute",
  channel: "api",
  created: true,
  status,
});

const schedulePlan = (cron: string, timezone = "UTC"): GridsWorkflow["plan"] =>
  ({ triggers: [{ kind: "schedule", config: { cron, timezone }, with: {} }] }) as unknown as GridsWorkflow["plan"];

const coordinatorClaim = {
  runId: receipt().runId,
  executionGeneration: 3,
  run: { id: receipt().runId, workflowId: receipt().workflowId, mode: "execute" },
  plan: { sourceHash: "source" },
  idempotencyKey: "request-1",
} as ClaimedWorkflowRun;

type CoordinatorPersistence = NonNullable<Parameters<typeof createGridsWorkflowCoordinatorPort>[1]>;

const coordinatorPersistence = (overrides: Partial<CoordinatorPersistence> = {}): CoordinatorPersistence => ({
  claim: async () => coordinatorClaim,
  renew: async () => ({ state: "active" }),
  finish: async () => true,
  release: async () => true,
  ...overrides,
});

describe("workflow kernel runtime boundaries", () => {
  test("keeps an accepted receipt successful when immediate queue submission fails", async () => {
    const submit = mock(async () => {
      throw new Error("queue unavailable");
    });

    await expect(submitAcceptedWorkflowRun(receipt(), submit)).resolves.toBeUndefined();
    expect(submit).toHaveBeenCalledWith(receipt().runId);
  });

  test("does not resubmit terminal idempotent receipts", async () => {
    const submit = mock(async () => undefined);

    await submitAcceptedWorkflowRun(receipt("succeeded"), submit);

    expect(submit).not.toHaveBeenCalled();
  });

  test("registers schedules with operator-facing metadata", () => {
    expect(workflowScheduleMetadata({ id: receipt().workflowId, name: "Morning inventory", revision: 3 })).toEqual({
      appId: "grids",
      family: "grids:workflows",
      label: "Workflow: Morning inventory",
      source: "grids:workflow-schedules",
      resourceLabel: "Morning inventory",
      workflowId: receipt().workflowId,
      revision: 3,
    });
  });

  test("fences schedule persistence by workflow revision", () => {
    const workflow = { id: receipt().workflowId, revision: 3 };

    expect(workflowScheduleId(workflow)).toBe(`grids:workflow:${workflow.id}`);
    expect(workflowScheduleId({ ...workflow, revision: 4 })).toBe(workflowScheduleId(workflow));
  });

  test("rejects claimed slots after cron or timezone changes", () => {
    const claimed = { cron: "0 8 * * *", timezone: "Europe/Berlin" };

    expect(workflowScheduleMatches({ plan: schedulePlan(claimed.cron, claimed.timezone) }, claimed)).toBe(true);
    expect(workflowScheduleMatches({ plan: schedulePlan("0 9 * * *", claimed.timezone) }, claimed)).toBe(false);
    expect(workflowScheduleMatches({ plan: schedulePlan(claimed.cron, "UTC") }, claimed)).toBe(false);
  });

  test("retries only transient scheduled invocation failures", () => {
    expect(workflowScheduleShouldRetry(409)).toBe(true);
    expect(workflowScheduleShouldRetry(503)).toBe(true);
    expect(workflowScheduleShouldRetry(400)).toBe(false);
    expect(workflowScheduleShouldRetry(403)).toBe(false);
  });

  test("continues reconciling schedules after one workflow fails", async () => {
    const register = mock(async (workflowId: string) => {
      if (workflowId === "bad") throw new Error("invalid schedule");
    });

    await registerWorkflowSchedules([{ id: "bad" }, { id: "good" }], register);

    expect(register.mock.calls.map(([workflowId]) => workflowId)).toEqual(["bad", "good"]);
  });

  test("advances the runtime cursor only after the event applies", async () => {
    let cursor = "1-0";
    const event = { cursor: "2-0", data: { workflowId: receipt().workflowId } };

    await expect(
      (async () => {
        cursor = await applyWorkflowRuntimeEvent(event, async () => {
          throw new Error("apply failed");
        });
      })(),
    ).rejects.toThrow("apply failed");
    expect(cursor).toBe("1-0");

    cursor = await applyWorkflowRuntimeEvent(event, async () => undefined);
    expect(cursor).toBe("2-0");
  });

  test("aligns the distributed job lease with the PostgreSQL run lease", () => {
    expect(WORKFLOW_JOB_LEASE_MS).toBe(WORKFLOW_RUN_LEASE_MS);
  });
});

describe("workflow run coordinator adaptation", () => {
  test("aborts the execution boundary when the PostgreSQL lease is stale", async () => {
    const transportHeartbeat = mock(async () => undefined);
    const finish = mock(async () => true);
    const release = mock(async () => true);
    const result = await coordinateWorkflowExecution({
      input: coordinatorClaim.runId,
      heartbeatMs: 1_000,
      port: createGridsWorkflowCoordinatorPort(
        transportHeartbeat,
        coordinatorPersistence({ renew: async () => ({ state: "stale" }), finish, release }),
      ),
      execute: async ({ heartbeat, signal }) => {
        expect(await heartbeat()).toEqual({ state: "stale" });
        expect(signal.aborted).toBe(true);
        return { status: "succeeded" } as const;
      },
    });

    expect(result).toEqual({ state: "stale", claim: coordinatorClaim });
    expect(transportHeartbeat).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("releases a failed sync heartbeat once and preserves retry semantics", async () => {
    const error = new Error("sync heartbeat failed");
    const transportHeartbeat = mock(async () => {
      throw error;
    });
    const release = mock(async () => true);
    const result = await coordinateWorkflowExecution({
      input: coordinatorClaim.runId,
      heartbeatMs: 1_000,
      port: createGridsWorkflowCoordinatorPort(transportHeartbeat, coordinatorPersistence({ release })),
      execute: async ({ heartbeat }) => {
        await heartbeat();
        return { status: "succeeded" } as const;
      },
    });

    expect(result).toEqual({ state: "retry", claim: coordinatorClaim, error });
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("does not retry when release observes a stale generation", async () => {
    const release = mock(async () => false);
    const result = await coordinateWorkflowExecution({
      input: coordinatorClaim.runId,
      heartbeatMs: 1_000,
      port: createGridsWorkflowCoordinatorPort(undefined, coordinatorPersistence({ release })),
      execute: async () => {
        throw new Error("action failed");
      },
    });

    expect(result).toEqual({ state: "stale", claim: coordinatorClaim });
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("does not release after an uncertain finish", async () => {
    const finish = mock(async () => {
      throw new Error("finish response lost");
    });
    const release = mock(async () => true);

    await expect(
      coordinateWorkflowExecution({
        input: coordinatorClaim.runId,
        heartbeatMs: 1_000,
        port: createGridsWorkflowCoordinatorPort(undefined, coordinatorPersistence({ finish, release })),
        execute: async () => ({ status: "succeeded" }),
      }),
    ).rejects.toThrow("finish response lost");
    expect(finish).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});
