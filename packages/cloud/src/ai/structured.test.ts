import { describe, expect, test } from "bun:test";
import { selectAiWorkflowModelId } from "./structured";

describe("workflow AI model selection", () => {
  test("uses action, workflow, background, then platform default precedence", () => {
    expect(selectAiWorkflowModelId({ requestedModelId: "action", workflowModelId: "workflow", backgroundModelId: "background" })).toBe(
      "action",
    );
    expect(selectAiWorkflowModelId({ workflowModelId: "workflow", backgroundModelId: "background" })).toBe("workflow");
    expect(selectAiWorkflowModelId({ backgroundModelId: "background" })).toBe("background");
    expect(selectAiWorkflowModelId({})).toBeUndefined();
  });

  test("ignores blank overrides", () => {
    expect(selectAiWorkflowModelId({ requestedModelId: " ", workflowModelId: "", backgroundModelId: "background" })).toBe("background");
  });
});
