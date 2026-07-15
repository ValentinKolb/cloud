import { describe, expect, test } from "bun:test";
import { toWorkflowRunEventSummary } from "../lib/workflow-run-events";
import type { GridsWorkflowRun, GridsWorkflowStepRun } from "../workflows/contracts";
import {
  createWorkflowRunEventNotifier,
  latestWorkflowRunEventCursor,
  liveWorkflowRunEvents,
  notifyWorkflowRunEvent,
} from "./workflow-run-events";

const redisTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("workflow run events", () => {
  test("uses explicit transition ids to distinguish repeated run states", async () => {
    const idempotencyKeys: string[] = [];
    const notify = createWorkflowRunEventNotifier(async (event) => {
      if (event.idempotencyKey) idempotencyKeys.push(event.idempotencyKey);
    });
    const run: GridsWorkflowRun = {
      id: Bun.randomUUIDv7(),
      workflowId: Bun.randomUUIDv7(),
      launcherId: null,
      baseId: Bun.randomUUIDv7(),
      workflowRevision: 1,
      mode: "execute",
      channel: "api",
      actorUserId: null,
      serviceAccountId: null,
      inputs: {},
      status: "running",
      result: null,
      error: null,
      resultMessage: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: null,
    };

    await notify(run, [], { kind: "workflow" }, "generation:2");
    expect(idempotencyKeys).toEqual([`${run.id}:running:generation:2`]);
  });

  test("treats post-persist publish failures as best effort", async () => {
    const notify = createWorkflowRunEventNotifier(async () => {
      throw new Error("topic unavailable");
    });
    const run: GridsWorkflowRun = {
      id: Bun.randomUUIDv7(),
      workflowId: Bun.randomUUIDv7(),
      launcherId: null,
      baseId: Bun.randomUUIDv7(),
      workflowRevision: 1,
      mode: "execute",
      channel: "api",
      actorUserId: null,
      serviceAccountId: null,
      inputs: {},
      status: "succeeded",
      result: null,
      error: null,
      resultMessage: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    };

    await expect(notify(run)).resolves.toBeUndefined();
  });

  redisTest("publishes run state and terminal step summaries across replicas", async () => {
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const run: GridsWorkflowRun = {
      id: Bun.randomUUIDv7(),
      workflowId,
      launcherId: null,
      baseId,
      workflowRevision: 1,
      mode: "execute",
      channel: "scanner",
      actorUserId: null,
      serviceAccountId: null,
      inputs: {},
      status: "succeeded",
      result: null,
      error: null,
      resultMessage: "Returned",
      createdAt: "2026-07-11T00:00:00.000Z",
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    };
    const step: GridsWorkflowStepRun = {
      id: Bun.randomUUIDv7(),
      runId: run.id,
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      kind: "action",
      action: "grids.updateRecord",
      status: "succeeded" as const,
      outcome: { updated: true },
      executionGeneration: 1,
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    };
    const streamKey = `cloud:grids:workflow-runs:${baseId}:${workflowId}:runs:stream`;
    const idempotencyKey = `cloud:grids:workflow-runs:${baseId}:${workflowId}:runs:idempotency:${run.id}:${run.status}:${run.finishedAt}`;
    const abort = new AbortController();
    try {
      const after = (await latestWorkflowRunEventCursor(baseId, workflowId)) ?? "0-0";
      const iterator = liveWorkflowRunEvents({ baseId, workflowId, after, signal: abort.signal })[Symbol.asyncIterator]();
      const delivery = iterator.next();
      await notifyWorkflowRunEvent(run, [step]);
      const event = await delivery;

      expect(event.done).toBe(false);
      expect(event.value?.data.run).toEqual(toWorkflowRunEventSummary(run));
      expect(event.value?.data.scope).toEqual({ kind: "workflow" });
      expect(event.value?.data.steps).toEqual([
        {
          id: step.id,
          runId: step.runId,
          key: "steps.0",
          sourcePath: ["steps", 0],
          iterationPath: [],
          kind: "action",
          action: "grids.updateRecord",
          status: "succeeded",
          outcome: { updated: true },
          executionGeneration: 1,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
        },
      ]);
    } finally {
      abort.abort();
      await Bun.redis.send("DEL", [streamKey, idempotencyKey]);
    }
  });
});
