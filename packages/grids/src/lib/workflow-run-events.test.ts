import { describe, expect, test } from "bun:test";
import type { GridsWorkflowRun, GridsWorkflowStepRun } from "../workflows/contracts";
import { toWorkflowRunEventSummary, toWorkflowRunStepSummary } from "./workflow-run-events";

describe("workflow run event summaries", () => {
  test("preserves the observable workflow run fields", () => {
    const run = {
      id: "33333333-3333-4333-8333-333333333333",
      workflowId: "22222222-2222-4222-8222-222222222222",
      launcherId: null,
      baseId: "11111111-1111-4111-8111-111111111111",
      workflowRevision: 1,
      mode: "execute",
      channel: "customApp",
      actorUserId: null,
      serviceAccountId: null,
      inputs: {},
      status: "succeeded",
      result: null,
      error: null,
      resultMessage: "Done",
      createdAt: "2026-07-11T00:00:00.000Z",
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    } satisfies GridsWorkflowRun;

    expect(toWorkflowRunEventSummary(run)).toEqual({
      id: run.id,
      workflowId: run.workflowId,
      launcherId: run.launcherId,
      baseId: run.baseId,
      workflowRevision: run.workflowRevision,
      mode: run.mode,
      channel: run.channel,
      status: run.status,
      error: run.error,
      resultMessage: run.resultMessage,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
  });

  test("preserves the observable workflow step fields", () => {
    const step = {
      runId: "33333333-3333-4333-8333-333333333333",
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      kind: "action",
      action: "updateRecord",
      status: "completed",
      outcome: { updated: true },
      executionGeneration: 1,
      startedAt: "2026-07-11T00:00:00.100Z",
      finishedAt: "2026-07-11T00:00:00.200Z",
    } satisfies GridsWorkflowStepRun;

    expect(toWorkflowRunStepSummary(step)).toEqual(step);
  });
});
