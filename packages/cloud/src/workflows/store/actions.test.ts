import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan } from "../contracts";
import { workflowAction } from "../definition";
import { defineWorkflowModule } from "../module";
import type { WorkflowActionStep, WorkflowDryRunActionContext } from "../runtime/ports";
import { createWorkflowDryRunPort } from "./actions";

describe("declared workflow actions", () => {
  test("resolves action config at its compiler binding path", async () => {
    const module = defineWorkflowModule({
      id: "test",
      version: 1,
      inputs: [],
      triggers: [],
      limits: { maxSteps: 5 },
      actions: {
        capture: workflowAction.pure({
          label: "Capture",
          description: "Captures one value.",
          config: { kind: "object", properties: { value: { kind: "value" } } },
          run: async (_context, config) => ({ state: "succeeded", output: config.value }),
        }),
      },
    });
    const sourcePath = ["steps", 2] as Array<string | number>;
    const step: WorkflowActionStep = {
      kind: "action",
      action: "capture",
      config: { value: "${{ inputs.item.Name }}" },
      sourcePath,
    };
    const evaluatedPaths: Array<Array<string | number> | undefined> = [];
    const context = {
      mode: "dryRun",
      run: { runId: crypto.randomUUID(), rootRunId: crypto.randomUUID(), executionGeneration: 1 },
      step: {
        runId: crypto.randomUUID(),
        rootRunId: crypto.randomUUID(),
        executionGeneration: 1,
        key: "steps.2",
        sourcePath,
        iterationPath: [],
        path: sourcePath,
        kind: "action",
        action: "capture",
      },
      plan: { bindings: {} } as WorkflowBoundPlan,
      invocation: { inputs: {} },
      variables: { set: () => {}, get: () => undefined, snapshot: () => ({}) },
      evaluate: async (_value: unknown, path?: Array<string | number>) => {
        evaluatedPaths.push(path);
        return { value: "resolved" };
      },
      resolveReference: async () => undefined,
      heartbeat: async () => {},
    } as unknown as WorkflowDryRunActionContext;

    const handler = createWorkflowDryRunPort(module).get("capture");
    expect(handler).toBeDefined();
    expect(await handler!.plan(context, step)).toMatchObject({ state: "planned", output: "resolved" });
    expect(evaluatedPaths).toEqual([["steps", 2, "capture"]]);
  });
});
