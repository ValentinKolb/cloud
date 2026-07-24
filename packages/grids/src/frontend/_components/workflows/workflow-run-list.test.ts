import { describe, expect, test } from "bun:test";
import type { GridsWorkflowRun } from "../../../workflows/contracts";
import { reconcileWorkflowRunList, type WorkflowRunListFilter } from "./workflow-run-list";

const baseRun: GridsWorkflowRun = {
  id: "11111111-1111-4111-8111-111111111111",
  workflowId: "22222222-2222-4222-8222-222222222222",
  launcherId: null,
  baseId: "33333333-3333-4333-8333-333333333333",
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
  createdAt: "2026-07-24T18:51:59.701Z",
  startedAt: "2026-07-24T18:51:59.721Z",
  finishedAt: null,
};

const allRuns: WorkflowRunListFilter = {
  workflowId: null,
  status: null,
  channel: null,
};

describe("reconcileWorkflowRunList", () => {
  test("keeps a terminal detail update ahead of a stale list response", () => {
    const failed: GridsWorkflowRun = {
      ...baseRun,
      status: "failed",
      error: { code: "WORKFLOW_FAILED", message: "Loan must be approved.", retryable: false },
      finishedAt: "2026-07-24T18:51:59.821Z",
    };

    expect(reconcileWorkflowRunList([baseRun], failed, allRuns, true)).toEqual([failed]);
  });

  test("adds a newly selected run when the list request did not include it yet", () => {
    expect(reconcileWorkflowRunList([], baseRun, allRuns, true)).toEqual([baseRun]);
  });

  test("removes a run after its status no longer matches the active filter", () => {
    const failed = { ...baseRun, status: "failed" as const };
    expect(reconcileWorkflowRunList([baseRun], failed, { ...allRuns, status: "running" }, true)).toEqual([]);
  });
});
