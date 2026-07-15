import { describe, expect, test } from "bun:test";
import { evaluateWorkflowTriggerInputs } from "./workflow-kernel-trigger-values";

describe("workflow kernel trigger values", () => {
  test("resolves nested trigger values and now recursively", () => {
    expect(
      evaluateWorkflowTriggerInputs(
        { record: { id: "record-1", nested: ["first"] }, occurredAt: "ignored" },
        {
          item: "${{ trigger.record }}",
          nested: { value: "${{ trigger.record.nested.0 }}", at: "${{ now() }}" },
          literal: "trigger.record",
        },
        "2026-07-14T10:00:00.000Z",
      ),
    ).toEqual({
      item: { id: "record-1", nested: ["first"] },
      nested: { value: "first", at: "2026-07-14T10:00:00.000Z" },
      literal: "trigger.record",
    });
  });

  test("refuses unavailable and malformed expressions", () => {
    expect(() => evaluateWorkflowTriggerInputs({}, { item: "${{ trigger.missing }}" }, "2026-07-14T10:00:00.000Z")).toThrow(
      'workflow trigger value "trigger.missing" is unavailable',
    );
    expect(() => evaluateWorkflowTriggerInputs({}, { item: "${{ broken" }, "2026-07-14T10:00:00.000Z")).toThrow(
      'invalid workflow trigger expression "${{ broken"',
    );
  });
});
