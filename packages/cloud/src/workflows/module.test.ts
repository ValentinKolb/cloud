import { describe, expect, test } from "bun:test";
import { workflowAction, workflowEvent } from "./definition";
import { bindWorkflow, compileWorkflow } from "./language";
import { defineWorkflowModule, workflowLanguageManifest } from "./module";
import { createWorkflowActionPort, createWorkflowDryRunPort } from "./store";

const probeWorkflows = defineWorkflowModule({
  id: "probe",
  version: 1,
  inputs: [],
  triggers: [],
  limits: { maxSteps: 10 },
  events: {
    requested: workflowEvent({
      label: "Requested",
      description: "A probe was requested.",
      data: { kind: "object", properties: {} },
    }),
  },
  actions: {
    echo: workflowAction.pure({
      label: "Echo",
      description: "Returns the supplied message.",
      config: {
        kind: "object",
        properties: { message: { kind: "string", minLength: 1 } },
      },
      run: async (_ctx, input) => ({ state: "succeeded", output: input.message }),
    }),
  },
});

describe("defineWorkflowModule", () => {
  test("derives one serializable manifest from executable declarations", () => {
    expect(probeWorkflows.manifest.actions.map(({ kind }) => kind)).toEqual(["echo", "setVariable", "succeed", "fail"]);
    expect(JSON.parse(JSON.stringify(probeWorkflows.manifest))).toEqual(probeWorkflows.manifest);
    expect(workflowLanguageManifest(probeWorkflows)).toBe(probeWorkflows.manifest);
    expect(workflowLanguageManifest(probeWorkflows.manifest)).toBe(probeWorkflows.manifest);
  });

  test("drives compilation, binding, and runtime ports directly", async () => {
    const compiled = await compileWorkflow('steps:\n  - echo:\n      message: "hello"\n', probeWorkflows);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const plan = await bindWorkflow(compiled.ir, probeWorkflows, () => ({ catalog: null, bindings: {} }));
    expect(plan.actionPolicies.echo).toEqual({ effect: "pure", dryRun: "full" });
    expect(createWorkflowActionPort(probeWorkflows).get("echo")).toBeDefined();
    expect(createWorkflowDryRunPort(probeWorkflows).get("echo")).toBeDefined();
  });
});
