import type { WorkflowBoundPlan, WorkflowIr } from "../contracts";
import { bindWorkflow, compileWorkflow } from "../language";
import {
  executeWorkflowPlan,
  type WorkflowExecutionResult,
  type WorkflowRuntimeRepositoryPort,
  type WorkflowRuntimeRunIdentity,
  type WorkflowRuntimeStepIdentity,
  type WorkflowRuntimeStepResult,
} from "../runtime";
import { type WorkflowProcessFixture, workflowProcessManifest } from "./process-fixtures";

class FixtureRepository implements WorkflowRuntimeRepositoryPort {
  readonly finished: Array<{ step: WorkflowRuntimeStepIdentity; result: WorkflowRuntimeStepResult }> = [];

  async heartbeat(_run: WorkflowRuntimeRunIdentity) {
    return { state: "active" } as const;
  }

  async restoreStepOutcome(_step: WorkflowRuntimeStepIdentity) {
    return null;
  }

  async startStep(_step: WorkflowRuntimeStepIdentity) {}

  async finishStep(step: WorkflowRuntimeStepIdentity, result: WorkflowRuntimeStepResult) {
    this.finished.push({ step, result });
  }
}

export type WorkflowProcessFixtureResult = {
  ir: WorkflowIr;
  plan: WorkflowBoundPlan;
  execution: WorkflowExecutionResult;
  finishedSteps: Array<{ step: WorkflowRuntimeStepIdentity; result: WorkflowRuntimeStepResult }>;
};

export const runWorkflowProcessFixture = async (fixture: WorkflowProcessFixture): Promise<WorkflowProcessFixtureResult> => {
  const compiled = await compileWorkflow(fixture.source, workflowProcessManifest);
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((diagnostic) => `${diagnostic.path.join(".")}: ${diagnostic.message}`).join("\n"));
  }
  const plan = await bindWorkflow(compiled.ir, workflowProcessManifest, () => ({
    catalog: fixture.catalog,
    bindings: fixture.bindings,
  }));
  const repository = new FixtureRepository();
  const execution = await executeWorkflowPlan({
    runId: `fixture:${fixture.id}`,
    executionGeneration: 1,
    plan,
    invocation: fixture.invocation,
    repository,
    actions: {
      get: (action) =>
        action === "capture"
          ? {
              execute: async (context, step) => ({
                state: "completed",
                output: await context.evaluate(step.config.value ?? null),
              }),
            }
          : undefined,
    },
  });
  return { ir: compiled.ir, plan, execution, finishedSteps: repository.finished };
};
