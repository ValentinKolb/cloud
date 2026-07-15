import { describe, expect, mock, test } from "bun:test";
import type { WorkflowInvocationReceipt } from "@valentinkolb/cloud/workflows";
import { submitAcceptedWorkflowRun, workflowScheduleMetadata } from "./workflow-kernel-runtime";

const receipt = (status: WorkflowInvocationReceipt["status"] = "queued"): WorkflowInvocationReceipt => ({
  runId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  revision: 3,
  mode: "execute",
  channel: "manual",
  created: true,
  status,
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
});
