import { describe, expect, mock, test } from "bun:test";
import type { WorkflowInvocationReceipt } from "@valentinkolb/cloud/workflows";
import type { GridsWorkflow } from "../workflows/contracts";
import { WORKFLOW_RUN_LEASE_MS } from "./workflow-kernel-runs";
import {
  applyWorkflowRuntimeEvent,
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
  revision: 3,
  mode: "execute",
  channel: "api",
  created: true,
  status,
});

const schedulePlan = (cron: string, timezone = "UTC"): GridsWorkflow["plan"] =>
  ({ triggers: [{ kind: "schedule", config: { cron, timezone }, with: {} }] }) as unknown as GridsWorkflow["plan"];

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

    expect(workflowScheduleId(workflow)).toBe(`grids:workflow:${workflow.id}:revision:3`);
    expect(workflowScheduleId({ ...workflow, revision: 4 })).not.toBe(workflowScheduleId(workflow));
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
