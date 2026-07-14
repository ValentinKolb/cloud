import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "../../../contracts";
import { activeWorkflowTriggers, buildWorkflowRunInput, directWorkflowRunTriggers } from "./workflow-trigger-actions";

const definition = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  inputs: {},
  triggers: { form: {}, api: { enabled: false }, schedule: { cron: "0 8 * * *" } },
  steps: [],
  ...overrides,
});

describe("workflow trigger actions", () => {
  test("excludes disabled triggers from summaries and direct runs", () => {
    const workflow = definition();

    expect(activeWorkflowTriggers(workflow)).toEqual(["form", "schedule"]);
    expect(directWorkflowRunTriggers(workflow)).toEqual(["form", "schedule"]);
  });

  test("requires declared inputs and preserves typed values", () => {
    const inputs: WorkflowDefinition["inputs"] = {
      loan: { type: "record", table: "Loans", label: "Loan", required: true },
      notify: { type: "boolean", required: true },
      amount: { type: "number" },
    };

    expect(buildWorkflowRunInput(inputs, {})).toEqual({
      ok: false,
      errors: { loan: "Loan is required.", notify: "notify is required." },
    });
    expect(buildWorkflowRunInput(inputs, { loan: "record-id", notify: false, amount: 12.5 })).toEqual({
      ok: true,
      input: { loan: "record-id", notify: false, amount: 12.5 },
    });
  });

  test("omits empty optional inputs instead of inventing values", () => {
    expect(
      buildWorkflowRunInput({ note: { type: "text" }, records: { type: "recordList", table: "Loans" } }, { note: "", records: [] }),
    ).toEqual({
      ok: true,
      input: {},
    });
  });
});
