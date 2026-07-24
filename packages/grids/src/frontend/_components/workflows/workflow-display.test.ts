import { describe, expect, test } from "bun:test";
import {
  isTerminalWorkflowRunStatus,
  workflowStepErrorMessage,
  workflowStepOutcomeSummary,
  workflowStepPlannedEffects,
} from "./workflow-display";

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

describe("workflow step outcomes", () => {
  test("describes waiting dependencies and selected control-flow branches", () => {
    expect(workflowStepOutcomeSummary({ state: "waiting", dependency: { kind: "approval", key: "loan-42" } })).toBe("Waiting for approval");
    expect(workflowStepOutcomeSummary({ state: "completed", control: { kind: "if", branches: ["then"] } })).toBe("if: then");
  });

  test("describes dry-run effects without exposing raw payloads", () => {
    expect(
      workflowStepPlannedEffects({
        effects: [
          { action: "updateRecord", recordId: "00000000-0000-4000-8000-000000000001", fieldIds: ["status"] },
          { action: "sendEmail", templateName: "Ready notice", recipientCount: 2 },
          { action: "httpRequest", method: "POST", host: "api.example.test", json: { secret: true } },
        ],
      }),
    ).toEqual([
      { title: "Update record", detail: "Record 00000000 · 1 field" },
      { title: "Send email", detail: "Ready notice · 2 recipients" },
      { title: "HTTP request", detail: "POST api.example.test" },
    ]);
  });

  test("never stringifies malformed effects as object placeholders", () => {
    expect(workflowStepPlannedEffects({ effects: [{ nested: true }, null] })).toEqual([
      { title: "Workflow effect", detail: null },
      { title: "Planned effect", detail: null },
    ]);
  });
});
