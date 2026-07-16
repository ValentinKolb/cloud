import { describe, expect, test } from "bun:test";
import { evaluateWorkflowTriggerInputs } from "./trigger";

describe("workflow trigger input bindings", () => {
  test("resolves nested trigger values and now recursively", () => {
    expect(
      evaluateWorkflowTriggerInputs(
        { message: { id: "message-1" }, items: ["a", "b"] },
        {
          message: "${{ trigger.message }}",
          second: "${{ trigger.items.1 }}",
          nested: { at: "${{ now() }}" },
          literal: "plain text",
        },
        "2026-07-14T10:00:00.000Z",
      ),
    ).toEqual({
      message: { id: "message-1" },
      second: "b",
      nested: { at: "2026-07-14T10:00:00.000Z" },
      literal: "plain text",
    });
  });

  test("rejects unavailable and invalid trigger expressions", () => {
    expect(() => evaluateWorkflowTriggerInputs({}, { item: "${{ trigger.missing }}" }, "2026-07-14T10:00:00.000Z")).toThrow(
      'workflow trigger value "trigger.missing" is unavailable',
    );
    expect(() => evaluateWorkflowTriggerInputs({}, { item: "${{ broken" }, "2026-07-14T10:00:00.000Z")).toThrow(
      'invalid workflow trigger expression "${{ broken"',
    );
  });

  test("rejects inherited properties and non-canonical array indexes", () => {
    const inherited = Object.create({ secret: "leaked" }) as Record<string, string>;
    inherited.visible = "safe";

    expect(() => evaluateWorkflowTriggerInputs(inherited, { item: "${{ trigger.secret }}" }, "2026-07-14T10:00:00.000Z")).toThrow(
      'workflow trigger value "trigger.secret" is unavailable',
    );
    expect(() =>
      evaluateWorkflowTriggerInputs({ items: ["zero", "one"] }, { item: "${{ trigger.items.01 }}" }, "2026-07-14T10:00:00.000Z"),
    ).toThrow('workflow trigger value "trigger.items.01" is unavailable');
  });
});
