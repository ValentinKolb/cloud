import { describe, expect, test } from "bun:test";
import type { WorkflowRun } from "../contracts";
import { toWorkflowRunEventSummary } from "../lib/workflow-run-events";
import { latestWorkflowRunEventCursor, liveWorkflowRunEvents, notifyWorkflowRunEvent } from "./workflow-run-events";

const redisTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("workflow run events", () => {
  redisTest("publishes run state and terminal step summaries across replicas", async () => {
    const baseId = Bun.randomUUIDv7();
    const workflowId = Bun.randomUUIDv7();
    const run: WorkflowRun = {
      id: Bun.randomUUIDv7(),
      workflowId,
      baseId,
      actorUserId: null,
      serviceAccountId: null,
      triggerKind: "scanner",
      triggerInput: {},
      resolvedInput: {},
      status: "succeeded",
      error: null,
      resultMessage: "Returned",
      createdAt: "2026-07-11T00:00:00.000Z",
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    };
    const step = {
      id: Bun.randomUUIDv7(),
      runId: run.id,
      stepIndex: 0,
      stepPath: "steps.0",
      kind: "updateRecord",
      status: "succeeded" as const,
      input: { large: "not published" },
      output: { large: "not published" },
      error: null,
      durationMs: 12,
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
          stepIndex: 0,
          stepPath: "steps.0",
          kind: "updateRecord",
          status: "succeeded",
          error: null,
          durationMs: 12,
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
