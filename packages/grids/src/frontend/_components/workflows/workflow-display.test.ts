import { describe, expect, test } from "bun:test";
import { isTerminalWorkflowRunStatus, workflowStepErrorMessage } from "./workflow-display";

describe("isTerminalWorkflowRunStatus", () => {
  test("distinguishes active and terminal runs", () => {
    expect(isTerminalWorkflowRunStatus("running")).toBeFalse();
    expect(isTerminalWorkflowRunStatus("waiting")).toBeFalse();
    expect(isTerminalWorkflowRunStatus("succeeded")).toBeTrue();
    expect(isTerminalWorkflowRunStatus("failed")).toBeTrue();
  });
});

describe("workflowStepErrorMessage", () => {
  test("reads structured workflow errors", () => {
    expect(
      workflowStepErrorMessage({
        error: {
          code: "WORKFLOW_FAILED",
          message: "Approve this loan before sending its agreement.",
          retryable: false,
        },
        state: "failed",
      }),
    ).toBe("Approve this loan before sending its agreement.");
  });

  test("preserves string errors", () => {
    expect(workflowStepErrorMessage({ error: "Request timed out" })).toBe("Request timed out");
  });

  test("uses a readable fallback for unknown error shapes", () => {
    expect(workflowStepErrorMessage({ error: { code: "UNKNOWN" } })).toBe("Step failed");
    expect(workflowStepErrorMessage({ state: "succeeded" })).toBeNull();
  });
});
