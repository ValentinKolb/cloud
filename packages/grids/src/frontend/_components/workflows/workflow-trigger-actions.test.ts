import { describe, expect, test } from "bun:test";
import type { WorkflowIrInput } from "@valentinkolb/cloud/workflows";
import { buildWorkflowRunInput } from "./workflow-trigger-actions";

describe("workflow run inputs", () => {
  test("requires declared inputs and preserves typed values", () => {
    const inputs: WorkflowIrInput[] = [
      { name: "loan", type: "record", config: { table: "Loans", label: "Loan", required: true } },
      { name: "notify", type: "boolean", config: { required: true } },
      { name: "amount", type: "number", config: {} },
    ];

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
      buildWorkflowRunInput(
        [
          { name: "note", type: "text", config: {} },
          { name: "records", type: "recordList", config: { table: "Loans" } },
        ],
        { note: "", records: [] },
      ),
    ).toEqual({
      ok: true,
      input: {},
    });
  });
});
