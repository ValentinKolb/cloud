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
        message: 'scanner launcher cannot supply required workflow input "confirm"',
      }),
    ]);
  });

  test("accepts arbitrary staged scanner input names and validates each source against its input", () => {
    const stagedWorkflow = {
      plan: {
        inputs: [
          { name: "agreement", type: "record", config: { required: true } },
          { name: "asset", type: "record", config: { required: true } },
          { name: "assessment", type: "select", config: { required: true, options: ["good", "damaged"] } },
          { name: "operatorNote", type: "text", config: {} },
        ],
      },
    } as unknown as GridsWorkflow;

    expect(
      validateLauncherConfig(stagedWorkflow, {
        kind: "scanner",
        inputSources: {
          agreement: { kind: "session" },
          asset: { kind: "scan", value: "record", resolve: { by: "scanCode" } },
          assessment: { kind: "afterScan" },
          operatorNote: { kind: "fixed", value: "scanner station 1" },
        },
      }),
    ).toEqual([]);
  });

  test("rejects missing, mistyped, and multiple scan sources", () => {
    const stagedWorkflow = {
      plan: {
        inputs: [
          { name: "code", type: "text", config: { required: true } },
          { name: "confirm", type: "boolean", config: { required: true } },
        ],
      },
    } as unknown as GridsWorkflow;

    expect(
      validateLauncherConfig(stagedWorkflow, {
        kind: "scanner",
        inputSources: {
          code: { kind: "scan", value: "record", resolve: { by: "scanCode" } },
          other: { kind: "scan", value: "text" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "launcher.scan.count" }),
        expect.objectContaining({ code: "launcher.input.type" }),
        expect.objectContaining({ code: "launcher.input.unknown" }),
        expect.objectContaining({ code: "launcher.input.unsupplied", message: expect.stringContaining('"confirm"') }),
      ]),
    );
  });

  test("requires complete type-safe Custom App input bindings", () => {
    expect(validateLauncherConfig(workflow, { kind: "customApp", inputMode: "fixed", inputBindings: { count: "many" } })).toEqual([
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "message" is required' }),
      expect.objectContaining({ code: "launcher.input.invalid", message: 'Workflow input "count" must be a finite number' }),
    ]);
    expect(
      validateLauncherConfig(workflow, {
        kind: "customApp",
        inputMode: "fixed",
        inputBindings: { message: "Run", count: 2 },
      }),
    ).toEqual([]);
  });

  test("accepts runtime input launchers without fixed values", () => {
    expect(validateLauncherConfig(workflow, { kind: "customApp", inputMode: "prompt" })).toEqual([]);
  });
});
