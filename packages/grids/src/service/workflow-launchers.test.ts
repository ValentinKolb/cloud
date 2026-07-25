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
  test("rejects launchers that cannot supply another required input", () => {
    const scannerWorkflow = {
      plan: {
        inputs: [
          { name: "record", type: "record", config: { required: true } },
          { name: "confirm", type: "boolean", config: { required: true } },
        ],
      },
    } as unknown as GridsWorkflow;

    expect(
      validateLauncherConfig(scannerWorkflow, {
        kind: "scanner",
        input: "record",
        resolve: { by: "scanCode" },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "launcher.input.unsupplied",
        message: 'scanner run option cannot supply required workflow input "confirm"',
      }),
    ]);
  });

  test("requires complete type-safe dashboard input bindings", () => {
    expect(validateLauncherConfig(workflow, { kind: "dashboard", inputMode: "fixed", inputBindings: { count: "many" } })).toEqual([
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "message" is required' }),
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "count" must be a finite number' }),
    ]);
    expect(
      validateLauncherConfig(workflow, {
        kind: "dashboard",
        inputMode: "fixed",
        inputBindings: { message: "Run", count: 2 },
      }),
    ).toEqual([]);
  });

  test("accepts runtime input launchers without fixed values", () => {
    expect(validateLauncherConfig(workflow, { kind: "dashboard", inputMode: "prompt" })).toEqual([]);
  });
});
