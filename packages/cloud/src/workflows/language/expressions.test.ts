import { describe, expect, test } from "bun:test";
import {
  hasInvalidWorkflowMessageExpression,
  parseWorkflowValueString,
  workflowMessageExpressions,
  workflowValueExpression,
} from "./expressions";

describe("workflow expressions", () => {
  test("distinguishes explicit expressions from literals", () => {
    expect(parseWorkflowValueString("inputs.item.Name")).toEqual({ kind: "literal" });
    expect(parseWorkflowValueString("${{ inputs.item.Name }}")).toEqual({
      kind: "expression",
      expression: { kind: "reference", reference: "inputs.item.Name" },
    });
    expect(parseWorkflowValueString("${{ now() }}")).toEqual({ kind: "expression", expression: { kind: "now" } });
    expect(workflowValueExpression("inputs.item.Name")).toBe("${{ inputs.item.Name }}");
  });

  test("reports malformed and embedded expressions", () => {
    expect(parseWorkflowValueString("before ${{ inputs.item }}")).toEqual({ kind: "invalid" });
    expect(workflowMessageExpressions("Returned ${{ inputs.item.Name }} at ${{ now() }}")).toHaveLength(2);
    expect(hasInvalidWorkflowMessageExpression("Returned ${{ inputs.item.Name }}")).toBe(false);
    expect(hasInvalidWorkflowMessageExpression("Returned ${{ inputs.item.Name }")).toBe(true);
  });
});
