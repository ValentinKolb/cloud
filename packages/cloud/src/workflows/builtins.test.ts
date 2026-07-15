import { describe, expect, mock, test } from "bun:test";
import { createWorkflowBuiltinActionPorts, workflowBuiltinActionDescriptors } from "./builtins";
import type { WorkflowBoundPlan, WorkflowInvocation, WorkflowIrStep, WorkflowJsonValue } from "./contracts";
import type { WorkflowDryRunActionContext, WorkflowExecuteActionContext, WorkflowVariableScope } from "./runtime/ports";

const step = (action: string, config: Record<string, WorkflowJsonValue>): Extract<WorkflowIrStep, { kind: "action" }> => ({
  kind: "action",
  action,
  config,
  sourcePath: ["steps", 0],
});

const context = <Mode extends "execute" | "dryRun">(mode: Mode) => {
  const values = new Map<string, WorkflowJsonValue>();
  const variables: WorkflowVariableScope = {
    get: (name) => values.get(name),
    has: (name) => values.has(name),
    set: (name, value) => values.set(name, value),
  };
  const plan = {
    schemaVersion: 2,
    languageId: "test",
    languageVersion: 1,
    sourceHash: "source",
    manifestHash: "manifest",
    catalogHash: "catalog",
    actionPolicies: {},
    inputs: [],
    triggers: [],
    steps: [],
    bindings: {},
  } satisfies WorkflowBoundPlan;
  const invocation = {
    workflowId: "workflow",
    mode,
    channel: "test",
    actor: {},
    inputs: {},
    idempotencyKey: "run",
    occurredAt: "2026-07-15T12:00:00.000Z",
  } satisfies WorkflowInvocation;
  const value = {
    mode,
    run: {
      runId: "run",
      executionGeneration: 1,
      mode,
      workflowId: "workflow",
      sourceHash: "source",
      idempotencyKey: "run",
    },
    step: {
      runId: "run",
      executionGeneration: 1,
      mode,
      workflowId: "workflow",
      sourceHash: "source",
      idempotencyKey: "run",
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      path: ["steps", 0],
      kind: "action" as const,
    },
    plan,
    invocation,
    variables,
    evaluate: mock(async (input: WorkflowJsonValue) => (input === "${{ now() }}" ? invocation.occurredAt : input)),
    resolveReference: mock(async (reference: string) => (reference === "inputs.name" ? "Ada" : undefined)),
    heartbeat: mock(async () => undefined),
  };
  return {
    value: value as unknown as Mode extends "execute" ? WorkflowExecuteActionContext : WorkflowDryRunActionContext,
    variables,
  };
};

describe("workflow built-in actions", () => {
  test("exposes the canonical pure descriptor set", () => {
    expect(workflowBuiltinActionDescriptors.map(({ kind, effect, dryRun }) => ({ kind, effect, dryRun }))).toEqual([
      { kind: "setVariable", effect: "pure", dryRun: "full" },
      { kind: "succeed", effect: "pure", dryRun: "full" },
      { kind: "fail", effect: "pure", dryRun: "full" },
    ]);
  });

  test("sets and restores variables in execute and dry-run modes", async () => {
    const ports = createWorkflowBuiltinActionPorts({ authorize: async () => undefined });
    const action = step("setVariable", { name: "result", value: { ok: true } });
    const executed = context("execute");
    const planned = context("dryRun");

    expect(await ports.execute.get("setVariable")!.execute(executed.value, action)).toEqual({
      state: "completed",
      output: { ok: true },
    });
    expect(await ports.dryRun.get("setVariable")!.plan(planned.value, action)).toEqual({
      state: "planned",
      output: { ok: true },
      effects: [],
    });
    expect(executed.variables.get("result")).toEqual({ ok: true });
    await ports.execute.get("setVariable")!.restoreCompleted!(executed.value, action, { state: "completed", output: "restored" });
    expect(executed.variables.get("result")).toBe("restored");
  });

  test("renders operator-facing terminal messages", async () => {
    const ports = createWorkflowBuiltinActionPorts({ authorize: async () => undefined });
    const succeed = step("succeed", { message: "Hello ${{ inputs.name }} at ${{ now() }}" });
    const fail = step("fail", { message: "Failed for ${{ inputs.name }}" });
    const executed = context("execute");
    const planned = context("dryRun");

    expect(await ports.execute.get("succeed")!.execute(executed.value, succeed)).toEqual({
      state: "terminal",
      status: "succeeded",
      message: "Hello Ada at 2026-07-15T12:00:00.000Z",
    });
    expect(await ports.execute.get("fail")!.execute(executed.value, fail)).toEqual({
      state: "failed",
      error: { code: "WORKFLOW_FAILED", message: "Failed for Ada", retryable: false },
    });
    expect(await ports.dryRun.get("fail")!.plan(planned.value, fail)).toEqual({
      state: "terminal",
      status: "failed",
      message: "Failed for Ada",
      effects: [],
    });
  });

  test("returns app authorization failures before evaluating actions", async () => {
    const authorize = mock(async () => ({ code: "FORBIDDEN", message: "Access was revoked", retryable: false }));
    const ports = createWorkflowBuiltinActionPorts({ authorize });
    const action = step("setVariable", { name: "result", value: true });
    const executed = context("execute");
    const planned = context("dryRun");

    expect(await ports.execute.get("setVariable")!.execute(executed.value, action)).toEqual({
      state: "failed",
      error: { code: "FORBIDDEN", message: "Access was revoked", retryable: false },
    });
    expect(await ports.dryRun.get("setVariable")!.plan(planned.value, action)).toEqual({
      state: "indeterminate",
      reason: "Access was revoked",
    });
    expect(executed.variables.has("result")).toBe(false);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(ports.execute.get("unknown")).toBeUndefined();
  });
});
