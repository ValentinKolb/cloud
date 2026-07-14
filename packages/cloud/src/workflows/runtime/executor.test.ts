import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowInvocation, WorkflowJsonValue } from "../contracts";
import { dryRunWorkflowPlan, executeWorkflowPlan } from "./executor";
import type {
  WorkflowDryRunActionHandler,
  WorkflowDryRunActionPort,
  WorkflowExecuteActionHandler,
  WorkflowExecuteActionPort,
  WorkflowHeartbeatOutcome,
  WorkflowRestoredStep,
  WorkflowRuntimeRepositoryPort,
  WorkflowRuntimeRunIdentity,
  WorkflowRuntimeStepIdentity,
  WorkflowRuntimeStepResult,
} from "./ports";

const plan = (steps: WorkflowBoundPlan["steps"]): WorkflowBoundPlan => ({
  schemaVersion: 1,
  languageId: "test",
  languageVersion: 1,
  sourceHash: "source-1",
  manifestHash: "manifest-1",
  catalogHash: "catalog-1",
  inputs: [],
  triggers: [],
  steps,
  bindings: {},
});

const invocation = <Mode extends "execute" | "dryRun">(
  mode: Mode,
  inputs: Record<string, WorkflowJsonValue> = {},
): WorkflowInvocation & { mode: Mode } => ({
  workflowId: "workflow-1",
  mode,
  channel: "test",
  actor: { userId: "user-1" },
  inputs,
  idempotencyKey: "invocation-1",
  occurredAt: "2026-07-14T12:00:00.000Z",
});

class FakeRepository implements WorkflowRuntimeRepositoryPort {
  readonly completed = new Map<string, WorkflowRestoredStep>();
  readonly started: WorkflowRuntimeStepIdentity[] = [];
  readonly finished: Array<{ step: WorkflowRuntimeStepIdentity; result: WorkflowRuntimeStepResult }> = [];
  heartbeats: WorkflowHeartbeatOutcome[] = [];

  key(step: Pick<WorkflowRuntimeStepIdentity, "mode" | "key">): string {
    return `${step.mode}:${step.key}`;
  }

  async heartbeat(_run: WorkflowRuntimeRunIdentity): Promise<WorkflowHeartbeatOutcome> {
    return this.heartbeats.shift() ?? { state: "active" };
  }

  async restoreCompletedStep(step: WorkflowRuntimeStepIdentity): Promise<WorkflowRestoredStep | null> {
    return this.completed.get(this.key(step)) ?? null;
  }

  async startStep(step: WorkflowRuntimeStepIdentity): Promise<void> {
    this.started.push(step);
  }

  async finishStep(step: WorkflowRuntimeStepIdentity, result: WorkflowRuntimeStepResult): Promise<void> {
    this.finished.push({ step, result });
    if (result.mode === "execute" && result.outcome.state === "completed") {
      this.completed.set(this.key(step), { mode: "execute", outcome: result.outcome });
    }
    if (result.mode === "dryRun" && result.outcome.state === "planned") {
      this.completed.set(this.key(step), { mode: "dryRun", outcome: result.outcome });
    }
  }
}

const executeActions = (handlers: Record<string, WorkflowExecuteActionHandler>): WorkflowExecuteActionPort => ({
  get: (action) => handlers[action],
});

const dryRunActions = (handlers: Record<string, WorkflowDryRunActionHandler>): WorkflowDryRunActionPort => ({
  get: (action) => handlers[action],
});

const runtime = {
  runId: "run-1",
  executionGeneration: 3,
};

describe("workflow runtime executor", () => {
  test("executes actions, if, switch, and bounded arrays with lexical source paths", async () => {
    const repository = new FakeRepository();
    const observations: string[] = [];
    const workflow = plan([
      {
        kind: "forEach",
        reference: "inputs.items",
        alias: "item",
        sourcePath: ["steps", 4],
        steps: [
          { kind: "action", action: "capture", config: {}, sourcePath: ["steps", 4, "do", 0] },
          { kind: "action", action: "inspect", config: {}, sourcePath: ["steps", 4, "do", 1] },
        ],
      },
      {
        kind: "if",
        condition: { operator: "equals", operands: ["${{ inputs.enabled }}", true] },
        then: [{ kind: "action", action: "then", config: {}, sourcePath: ["steps", 8, "then", 0] }],
        else: [{ kind: "action", action: "else", config: {}, sourcePath: ["steps", 8, "else", 0] }],
        sourcePath: ["steps", 8],
      },
      {
        kind: "switch",
        value: "${{ inputs.status }}",
        cases: [
          {
            when: "ready",
            steps: [{ kind: "action", action: "ready", config: {}, sourcePath: ["steps", 12, "cases", 0, "do", 0] }],
          },
        ],
        default: [{ kind: "action", action: "default", config: {}, sourcePath: ["steps", 12, "default", 0] }],
        sourcePath: ["steps", 12],
      },
      { kind: "action", action: "outer", config: {}, sourcePath: ["steps", 20] },
    ]);

    const actions = executeActions({
      capture: {
        execute: async (context) => {
          const name = context.resolveReference("item.name");
          observations.push(`capture:${name}:${context.step.key}`);
          context.variables.set("iterationValue", name ?? null);
          return { state: "completed", output: name };
        },
      },
      inspect: {
        execute: async (context) => {
          observations.push(`inspect:${context.variables.get("iterationValue")}`);
          return { state: "completed" };
        },
      },
      then: { execute: async () => ({ state: "completed", output: "then" }) },
      else: { execute: async () => ({ state: "failed", error: { code: "WRONG_BRANCH", message: "wrong branch", retryable: false } }) },
      ready: { execute: async () => ({ state: "completed", output: "ready" }) },
      default: { execute: async () => ({ state: "failed", error: { code: "WRONG_CASE", message: "wrong case", retryable: false } }) },
      outer: {
        execute: async (context) => {
          expect(context.variables.has("iterationValue")).toBe(false);
          return { state: "completed", output: "done" };
        },
      },
    });

    const result = await executeWorkflowPlan({
      ...runtime,
      plan: workflow,
      invocation: invocation("execute", { items: [{ name: "a" }, { name: "b" }], enabled: true, status: "ready" }),
      repository,
      actions,
      maxLoopItems: 2,
    });

    expect(result).toEqual({ state: "succeeded", output: "done" });
    expect(observations).toEqual(["capture:a:steps.4.do.0#0", "inspect:a", "capture:b:steps.4.do.0#1", "inspect:b"]);
    expect(repository.started.some((step) => step.key === "steps.8.then.0")).toBe(true);
    expect(repository.started.some((step) => step.key === "steps.12.cases.0.do.0")).toBe(true);
    expect(repository.started.some((step) => step.action === "else" || step.action === "default")).toBe(false);
  });

  test("keeps dry-run structurally isolated from execute handlers", async () => {
    const repository = new FakeRepository();
    let executeCalls = 0;
    let planCalls = 0;
    const effect = { kind: "record.update", id: "record-1" };
    const executePort = executeActions({
      mutate: {
        execute: async () => {
          executeCalls += 1;
          return { state: "completed" };
        },
      },
    });
    const planningPort = dryRunActions({
      mutate: {
        plan: async () => {
          planCalls += 1;
          return { state: "planned", output: "predicted", effects: [effect] };
        },
      },
    });

    const result = await dryRunWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "mutate", config: {}, sourcePath: ["steps", 0] }]),
      invocation: invocation("dryRun"),
      repository,
      actions: planningPort,
    });

    expect(executePort.get("mutate")).toBeDefined();
    expect(executeCalls).toBe(0);
    expect(planCalls).toBe(1);
    expect(result).toEqual({ state: "planned", output: "predicted", effects: [effect] });
  });

  test("restores a completed action and lets its hook rebuild variable state", async () => {
    const repository = new FakeRepository();
    repository.completed.set("execute:steps.0", { mode: "execute", outcome: { state: "completed", output: "persisted" } });
    let restored = 0;
    let executed = 0;
    const actions = executeActions({
      produce: {
        execute: async () => {
          executed += 1;
          return { state: "completed", output: "new" };
        },
        restoreCompleted: (context, _step, outcome) => {
          restored += 1;
          context.variables.set("saved", outcome.output ?? null);
        },
      },
      consume: {
        execute: async (context) => ({ state: "completed", output: context.evaluate("${{ saved }}") }),
      },
    });

    const result = await executeWorkflowPlan({
      ...runtime,
      plan: plan([
        { kind: "action", action: "produce", config: {}, sourcePath: ["steps", 0] },
        { kind: "action", action: "consume", config: {}, sourcePath: ["steps", 1] },
      ]),
      invocation: invocation("execute"),
      repository,
      actions,
    });

    expect(result).toEqual({ state: "succeeded", output: "persisted" });
    expect({ restored, executed }).toEqual({ restored: 1, executed: 0 });
    expect(repository.started.map((step) => step.key)).toEqual(["steps.1"]);
  });

  test("returns and persists an opaque waiting dependency", async () => {
    const repository = new FakeRepository();
    const dependency = { kind: "approval", key: "approval-1", deadline: "2026-07-15T12:00:00.000Z" };
    const result = await executeWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "wait", config: {}, sourcePath: ["steps", 2] }]),
      invocation: invocation("execute"),
      repository,
      actions: executeActions({ wait: { execute: async () => ({ state: "waiting", dependency }) } }),
    });

    expect(result).toMatchObject({ state: "waiting", dependency, step: { key: "steps.2" } });
    expect(repository.finished[0]?.result).toEqual({ mode: "execute", outcome: { state: "waiting", dependency } });
  });

  test("cancels cooperatively from a handler heartbeat", async () => {
    const repository = new FakeRepository();
    repository.heartbeats = [{ state: "active" }, { state: "canceled", message: "stopped by user" }];
    let reachedAfterHeartbeat = false;
    const result = await executeWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "long", config: {}, sourcePath: ["steps", 3] }]),
      invocation: invocation("execute"),
      repository,
      actions: executeActions({
        long: {
          execute: async (context) => {
            await context.heartbeat();
            reachedAfterHeartbeat = true;
            return { state: "completed" };
          },
        },
      }),
    });

    expect(result).toMatchObject({ state: "canceled", message: "stopped by user", step: { key: "steps.3" } });
    expect(reachedAfterHeartbeat).toBe(false);
    expect(repository.finished[0]?.result).toEqual({
      mode: "execute",
      outcome: { state: "terminal", status: "canceled", message: "stopped by user" },
    });
  });

  test("reports cancellation explicitly during dry-run", async () => {
    const repository = new FakeRepository();
    repository.heartbeats = [{ state: "canceled", message: "preview stopped" }];
    const result = await dryRunWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "plan", config: {}, sourcePath: ["steps", 6] }]),
      invocation: invocation("dryRun"),
      repository,
      actions: dryRunActions({ plan: { plan: async () => ({ state: "planned", effects: [] }) } }),
    });

    expect(result).toMatchObject({ state: "canceled", message: "preview stopped", step: { key: "steps.6" }, effects: [] });
  });

  test("preserves terminal success and needs-attention outcomes", async () => {
    const terminalRepository = new FakeRepository();
    let skippedCalls = 0;
    const terminal = await executeWorkflowPlan({
      ...runtime,
      plan: plan([
        { kind: "action", action: "stop", config: {}, sourcePath: ["steps", 0] },
        { kind: "action", action: "skipped", config: {}, sourcePath: ["steps", 1] },
      ]),
      invocation: invocation("execute"),
      repository: terminalRepository,
      actions: executeActions({
        stop: { execute: async () => ({ state: "terminal", status: "succeeded", message: "complete early" }) },
        skipped: {
          execute: async () => {
            skippedCalls += 1;
            return { state: "completed" };
          },
        },
      }),
    });
    expect(terminal).toEqual({ state: "succeeded", message: "complete early" });
    expect(skippedCalls).toBe(0);

    const attentionRepository = new FakeRepository();
    const error = { code: "UNKNOWN_EXTERNAL_RESULT", message: "provider outcome is ambiguous", retryable: false };
    const attention = await executeWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "ambiguous", config: {}, sourcePath: ["steps", 7] }]),
      invocation: invocation("execute"),
      repository: attentionRepository,
      actions: executeActions({ ambiguous: { execute: async () => ({ state: "needs_attention", error }) } }),
    });
    expect(attention).toMatchObject({ state: "needs_attention", error, step: { key: "steps.7" } });
  });

  test("reports unsupported and indeterminate dry-run plans without execution", async () => {
    const unsupported = await dryRunWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "action", action: "external", config: {}, sourcePath: ["steps", 0] }]),
      invocation: invocation("dryRun"),
      repository: new FakeRepository(),
      actions: dryRunActions({}),
    });
    expect(unsupported).toMatchObject({
      state: "unsupported",
      reason: 'action "external" has no dry-run handler',
      effects: [],
      step: { key: "steps.0" },
    });

    const indeterminate = await dryRunWorkflowPlan({
      ...runtime,
      plan: plan([{ kind: "forEach", reference: "inputs.unknown", alias: "item", steps: [], sourcePath: ["steps", 5] }]),
      invocation: invocation("dryRun"),
      repository: new FakeRepository(),
      actions: dryRunActions({}),
    });
    expect(indeterminate).toMatchObject({
      state: "indeterminate",
      reason: 'forEach reference "inputs.unknown" must resolve to a JSON array',
      effects: [],
      step: { key: "steps.5" },
    });
  });

  test("rejects arrays beyond the configured loop bound", async () => {
    const result = await executeWorkflowPlan({
      ...runtime,
      plan: plan([
        {
          kind: "forEach",
          reference: "inputs.items",
          alias: "item",
          steps: [{ kind: "action", action: "never", config: {}, sourcePath: ["steps", 0, "do", 0] }],
          sourcePath: ["steps", 0],
        },
      ]),
      invocation: invocation("execute", { items: [1, 2] }),
      repository: new FakeRepository(),
      actions: executeActions({ never: { execute: async () => ({ state: "completed" }) } }),
      maxLoopItems: 1,
    });

    expect(result).toMatchObject({
      state: "failed",
      error: { code: "WORKFLOW_VALUE_UNAVAILABLE", message: 'forEach reference "inputs.items" has 2 items; limit is 1' },
      step: { key: "steps.0" },
    });
  });
});
