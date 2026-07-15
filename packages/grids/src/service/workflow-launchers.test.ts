import { describe, expect, test } from "bun:test";
import type { GridsWorkflow } from "../workflows/contracts";
import { validateLauncherConfig } from "./workflow-launchers";

const workflow = {
  plan: {
    inputs: [
      { name: "message", type: "text", config: { required: true } },
      { name: "count", type: "number", config: {} },
    ],
  },
} as GridsWorkflow;

describe("workflow launcher validation", () => {
  test("requires complete type-safe dashboard input bindings", () => {
    expect(validateLauncherConfig(workflow, { kind: "dashboard", inputBindings: { count: "many" } })).toEqual([
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "message" is required' }),
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "count" must be a finite number' }),
    ]);
    expect(validateLauncherConfig(workflow, { kind: "dashboard", inputBindings: { message: "Run", count: 2 } })).toEqual([]);
  });
});
