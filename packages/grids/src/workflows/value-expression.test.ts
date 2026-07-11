import { describe, expect, test } from "bun:test";
import {
  hasInvalidWorkflowMessageExpression,
  parseWorkflowValueString,
  workflowMessageExpressions,
  workflowValueExpression,
} from "./value-expression";

describe("workflow value expressions", () => {
  test("keeps ordinary and dotted strings literal", () => {
    expect(parseWorkflowValueString("person@example.com")).toEqual({ kind: "literal" });
    expect(parseWorkflowValueString("example.com.value")).toEqual({ kind: "literal" });
    expect(parseWorkflowValueString("inputs.item.Name")).toEqual({ kind: "literal" });
    expect(parseWorkflowValueString("literal }} text")).toEqual({ kind: "literal" });
  });

  test("parses explicit references and now", () => {
    expect(parseWorkflowValueString("${{ inputs.item.Name }}")).toEqual({
      kind: "expression",
      expression: { kind: "reference", reference: "inputs.item.Name" },
    });
    expect(parseWorkflowValueString("${{ now() }}")).toEqual({ kind: "expression", expression: { kind: "now" } });
    expect(workflowValueExpression("inputs.item.Name")).toBe("${{ inputs.item.Name }}");
  });

  test("rejects partial and malformed expression markers", () => {
    expect(parseWorkflowValueString("before ${{ inputs.item }}")).toEqual({ kind: "invalid" });
    expect(parseWorkflowValueString("${{ inputs.item }")).toEqual({ kind: "invalid" });
    expect(parseWorkflowValueString("${{ inputs item }}")).toEqual({ kind: "invalid" });
  });

  test("extracts embedded message expressions", () => {
    expect(workflowMessageExpressions("Returned ${{ inputs.item.Name }} at ${{ now() }}")).toEqual([
      {
        source: "inputs.item.Name",
        raw: "${{ inputs.item.Name }}",
        index: 9,
        expression: { kind: "reference", reference: "inputs.item.Name" },
      },
      { source: "now()", raw: "${{ now() }}", index: 36, expression: { kind: "now" } },
    ]);
    expect(hasInvalidWorkflowMessageExpression("Returned ${{ inputs.item.Name }}")).toBe(false);
    expect(hasInvalidWorkflowMessageExpression("Returned ${{ inputs.item.Name }")).toBe(true);
  });
});
