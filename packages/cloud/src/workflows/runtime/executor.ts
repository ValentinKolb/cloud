import type {
  WorkflowCondition,
  WorkflowExecutionError,
  WorkflowIrStep,
  WorkflowJsonValue,
  WorkflowPlanningOutcome,
  WorkflowStepOutcome,
} from "../contracts";
import { workflowPathKey } from "../contracts";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowDryRunOptions,
  WorkflowDryRunResult,
  WorkflowExecuteActionContext,
  WorkflowExecuteOptions,
  WorkflowExecutionResult,
  WorkflowHeartbeatOutcome,
  WorkflowRestoredStep,
  WorkflowRuntimeRunIdentity,
  WorkflowRuntimeStepIdentity,
  WorkflowRuntimeStepResult,
  WorkflowTraceEvent,
  WorkflowVariableScope,
} from "./ports";

export const DEFAULT_MAX_LOOP_ITEMS = 100;

const EXACT_EXPRESSION = /^\$\{\{\s*([^{}]+?)\s*\}\}$/;

class RuntimeVariableScope implements WorkflowVariableScope {
  readonly #values = new Map<string, WorkflowJsonValue>();

  constructor(
    initial: Record<string, WorkflowJsonValue> = {},
    readonly parent?: RuntimeVariableScope,
  ) {
    for (const [name, value] of Object.entries(initial)) this.#values.set(name, value);
  }

  get(name: string): WorkflowJsonValue | undefined {
    return this.#values.has(name) ? this.#values.get(name) : this.parent?.get(name);
  }

  has(name: string): boolean {
    return this.#values.has(name) || this.parent?.has(name) === true;
  }

  set(name: string, value: WorkflowJsonValue): void {
    this.#values.set(name, value);
  }

  child(initial: Record<string, WorkflowJsonValue> = {}): RuntimeVariableScope {
    return new RuntimeVariableScope(initial, this);
  }
}

class WorkflowCancellation extends Error {
  constructor(readonly cancellation: Extract<WorkflowHeartbeatOutcome, { state: "canceled" }>) {
    super(cancellation.message ?? "workflow canceled");
  }
}

class WorkflowValueError extends Error {}

type RuntimeOptions = (WorkflowExecuteOptions & { mode: "execute" }) | (WorkflowDryRunOptions & { mode: "dryRun" });

type RuntimeState = {
  options: RuntimeOptions;
  run: WorkflowRuntimeRunIdentity;
  effects: WorkflowJsonValue[];
  cancellationTraced: boolean;
};

type Continue = { state: "continue"; output?: WorkflowJsonValue };
type Halt =
  | { state: "waiting"; dependency: Extract<WorkflowStepOutcome, { state: "waiting" }>["dependency"]; step: WorkflowRuntimeStepIdentity }
  | { state: "failed"; error: WorkflowExecutionError; step: WorkflowRuntimeStepIdentity }
  | { state: "needs_attention"; error: WorkflowExecutionError; step: WorkflowRuntimeStepIdentity }
  | { state: "canceled"; message?: string; step?: WorkflowRuntimeStepIdentity }
  | { state: "terminal_succeeded"; message?: string }
  | { state: "unsupported"; reason: string; step: WorkflowRuntimeStepIdentity }
  | { state: "indeterminate"; reason: string; step: WorkflowRuntimeStepIdentity };
type Flow = Continue | Halt;

type StepEvaluation = {
  flow: Flow;
  result?: WorkflowRuntimeStepResult;
};

const executionError = (code: string, message: string, retryable = false): WorkflowExecutionError => ({
  code,
  message,
  retryable,
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const optionalOutput = (output: WorkflowJsonValue | undefined): { output?: WorkflowJsonValue } => (output === undefined ? {} : { output });

const optionalMessage = (message: string | undefined): { message?: string } => (message === undefined ? {} : { message });

const emit = async (state: RuntimeState, event: WorkflowTraceEvent): Promise<void> => {
  await state.options.trace?.emit(event);
};

const stepIdentity = (state: RuntimeState, step: WorkflowIrStep, iterationPath: number[]): WorkflowRuntimeStepIdentity => {
  const iterationKey = iterationPath.length === 0 ? "" : `#${iterationPath.join(".")}`;
  const path = [...step.sourcePath];
  for (const iteration of iterationPath) path.push("$iteration", iteration);
  return {
    ...state.run,
    key: `${workflowPathKey(step.sourcePath)}${iterationKey}`,
    sourcePath: [...step.sourcePath],
    iterationPath: [...iterationPath],
    path,
    kind: step.kind,
    ...(step.kind === "action" ? { action: step.action } : {}),
  };
};

const readPath = (value: WorkflowJsonValue, path: string[]): WorkflowJsonValue | undefined => {
  let current: WorkflowJsonValue | undefined = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object" || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
};

const resolveReference = (state: RuntimeState, scope: RuntimeVariableScope, reference: string): WorkflowJsonValue | undefined => {
  const segments = reference.split(".");
  const rootName = segments.shift() ?? "";
  let root: WorkflowJsonValue | undefined;
  if (rootName === "inputs") root = state.options.invocation.inputs;
  else if (rootName === "bindings") root = state.options.plan.bindings;
  else if (rootName === "context") root = state.options.invocation.context ?? {};
  else root = scope.get(rootName);
  return root === undefined || segments.length === 0 ? root : readPath(root, segments);
};

const evaluateValue = (state: RuntimeState, scope: RuntimeVariableScope, value: WorkflowJsonValue): WorkflowJsonValue => {
  if (typeof value === "string") {
    const match = EXACT_EXPRESSION.exec(value);
    if (!match) return value;
    const expression = match[1]?.trim() ?? "";
    if (expression === "now()") return state.options.invocation.occurredAt;
    const resolved = resolveReference(state, scope, expression);
    if (resolved === undefined) throw new WorkflowValueError(`workflow reference "${expression}" is unavailable`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => evaluateValue(state, scope, item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evaluateValue(state, scope, item)]));
  }
  return value;
};

const jsonEqual = (left: WorkflowJsonValue, right: WorkflowJsonValue): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]!))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key]!, right[key]!))
  );
};

const evaluateCondition = (state: RuntimeState, scope: RuntimeVariableScope, condition: WorkflowCondition): boolean => {
  if (condition.operator === "exists") {
    const value = resolveReference(state, scope, condition.reference);
    return value !== undefined && value !== null && value !== "";
  }
  const left = evaluateValue(state, scope, condition.operands[0]);
  const right = evaluateValue(state, scope, condition.operands[1]);
  return condition.operator === "equals" ? jsonEqual(left, right) : !jsonEqual(left, right);
};

const traceCancellation = async (
  state: RuntimeState,
  cancellation: Extract<WorkflowHeartbeatOutcome, { state: "canceled" }>,
): Promise<void> => {
  if (state.cancellationTraced) return;
  state.cancellationTraced = true;
  await emit(state, { type: "run.canceled", run: state.run, ...optionalMessage(cancellation.message) });
};

const heartbeat = async (state: RuntimeState): Promise<Extract<WorkflowHeartbeatOutcome, { state: "canceled" }> | null> => {
  const outcome = await state.options.repository.heartbeat(state.run);
  if (outcome.state === "active") return null;
  await traceCancellation(state, outcome);
  return outcome;
};

const actionContext = (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  step: WorkflowRuntimeStepIdentity,
): WorkflowExecuteActionContext | WorkflowDryRunActionContext => {
  const common = {
    run: state.run,
    step,
    plan: state.options.plan,
    invocation: state.options.invocation,
    variables: scope,
    evaluate: (value: WorkflowJsonValue) => evaluateValue(state, scope, value),
    resolveReference: (reference: string) => resolveReference(state, scope, reference),
    heartbeat: async () => {
      const cancellation = await heartbeat(state);
      if (cancellation) throw new WorkflowCancellation(cancellation);
    },
  };
  return state.options.mode === "execute"
    ? ({ ...common, mode: "execute" } as WorkflowExecuteActionContext)
    : ({ ...common, mode: "dryRun" } as WorkflowDryRunActionContext);
};

const invalidRestoration = (state: RuntimeState, step: WorkflowRuntimeStepIdentity, message: string): Flow =>
  state.options.mode === "execute"
    ? { state: "needs_attention", error: executionError("WORKFLOW_RESTORE_INVALID", message), step }
    : { state: "indeterminate", reason: message, step };

const restoreStep = async (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  irStep: WorkflowIrStep,
  step: WorkflowRuntimeStepIdentity,
  restored: WorkflowRestoredStep,
): Promise<Flow> => {
  if (restored.mode !== state.options.mode) {
    return invalidRestoration(state, step, `restored step "${step.key}" belongs to ${restored.mode}, not ${state.options.mode}`);
  }
  try {
    if (irStep.kind === "action") {
      if (state.options.mode === "execute" && restored.mode === "execute") {
        const handler = state.options.actions.get(irStep.action);
        if (!handler) return invalidRestoration(state, step, `action "${irStep.action}" is unavailable while restoring step "${step.key}"`);
        await handler.restoreCompleted?.(actionContext(state, scope, step) as WorkflowExecuteActionContext, irStep, restored.outcome);
      } else if (state.options.mode === "dryRun" && restored.mode === "dryRun") {
        const handler = state.options.actions.get(irStep.action);
        if (!handler)
          return invalidRestoration(state, step, `planner for action "${irStep.action}" is unavailable while restoring step "${step.key}"`);
        await handler.restoreCompleted?.(actionContext(state, scope, step) as WorkflowDryRunActionContext, irStep, restored.outcome);
      }
    }
  } catch (error) {
    if (error instanceof WorkflowCancellation) {
      await traceCancellation(state, error.cancellation);
      return { state: "canceled", ...optionalMessage(error.cancellation.message), step };
    }
    return invalidRestoration(state, step, `restoring step "${step.key}" failed: ${errorMessage(error)}`);
  }
  if (restored.mode === "dryRun") state.effects.push(...restored.outcome.effects);
  await emit(state, { type: "step.restored", step, restored });
  const cancellation = await heartbeat(state);
  if (cancellation) return { state: "canceled", ...optionalMessage(cancellation.message), step };
  return { state: "continue", ...optionalOutput(restored.outcome.output) };
};

const flowFromExecutionOutcome = (outcome: WorkflowStepOutcome, step: WorkflowRuntimeStepIdentity): Flow => {
  if (outcome.state === "completed") return { state: "continue", ...optionalOutput(outcome.output) };
  if (outcome.state === "waiting") return { state: "waiting", dependency: outcome.dependency, step };
  if (outcome.state === "failed") return { state: "failed", error: outcome.error, step };
  if (outcome.state === "needs_attention") return { state: "needs_attention", error: outcome.error, step };
  return outcome.status === "succeeded"
    ? { state: "terminal_succeeded", ...optionalMessage(outcome.message) }
    : { state: "canceled", ...optionalMessage(outcome.message), step };
};

const flowFromPlanningOutcome = (outcome: WorkflowPlanningOutcome, step: WorkflowRuntimeStepIdentity): Flow => {
  if (outcome.state === "planned") return { state: "continue", ...optionalOutput(outcome.output) };
  return outcome.state === "unsupported"
    ? { state: "unsupported", reason: outcome.reason, step }
    : { state: "indeterminate", reason: outcome.reason, step };
};

const evaluateAction = async (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  irStep: WorkflowActionStep,
  step: WorkflowRuntimeStepIdentity,
): Promise<StepEvaluation> => {
  if (state.options.mode === "execute") {
    const handler = state.options.actions.get(irStep.action);
    const outcome: WorkflowStepOutcome = handler
      ? await handler.execute(actionContext(state, scope, step) as WorkflowExecuteActionContext, irStep)
      : {
          state: "failed",
          error: executionError("WORKFLOW_ACTION_UNSUPPORTED", `action "${irStep.action}" has no execute handler`),
        };
    return { flow: flowFromExecutionOutcome(outcome, step), result: { mode: "execute", outcome } };
  }
  const handler = state.options.actions.get(irStep.action);
  const outcome: WorkflowPlanningOutcome = handler
    ? await handler.plan(actionContext(state, scope, step) as WorkflowDryRunActionContext, irStep)
    : { state: "unsupported", reason: `action "${irStep.action}" has no dry-run handler` };
  if (outcome.state === "planned") state.effects.push(...outcome.effects);
  return { flow: flowFromPlanningOutcome(outcome, step), result: { mode: "dryRun", outcome } };
};

const resultForCompletedControl = (
  state: RuntimeState,
  output: WorkflowJsonValue | undefined,
  effectsStart: number,
): WorkflowRuntimeStepResult =>
  state.options.mode === "execute"
    ? { mode: "execute", outcome: { state: "completed", ...optionalOutput(output) } }
    : {
        mode: "dryRun",
        outcome: { state: "planned", ...optionalOutput(output), effects: state.effects.slice(effectsStart) },
      };

const evaluateControl = async (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  irStep: Exclude<WorkflowIrStep, { kind: "action" }>,
  iterationPath: number[],
): Promise<StepEvaluation> => {
  const effectsStart = state.effects.length;
  let flow: Flow;
  if (irStep.kind === "if") {
    const matched = evaluateCondition(state, scope, irStep.condition);
    flow = await runSteps(state, matched ? irStep.then : irStep.else, scope.child(), iterationPath);
  } else if (irStep.kind === "switch") {
    const value = evaluateValue(state, scope, irStep.value);
    const matched = irStep.cases.find((candidate) => jsonEqual(value, evaluateValue(state, scope, candidate.when)));
    flow = await runSteps(state, matched?.steps ?? irStep.default, scope.child(), iterationPath);
  } else {
    const value = resolveReference(state, scope, irStep.reference);
    if (!Array.isArray(value)) throw new WorkflowValueError(`forEach reference "${irStep.reference}" must resolve to a JSON array`);
    const limit = state.options.maxLoopItems ?? DEFAULT_MAX_LOOP_ITEMS;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new WorkflowValueError("maxLoopItems must be a non-negative safe integer");
    if (value.length > limit)
      throw new WorkflowValueError(`forEach reference "${irStep.reference}" has ${value.length} items; limit is ${limit}`);
    flow = { state: "continue" };
    for (let index = 0; index < value.length; index += 1) {
      const cancellation = await heartbeat(state);
      if (cancellation) return { flow: { state: "canceled", ...optionalMessage(cancellation.message) } };
      flow = await runSteps(state, irStep.steps, scope.child({ [irStep.alias]: value[index]! }), [...iterationPath, index]);
      if (flow.state !== "continue") break;
    }
  }
  return flow.state === "continue" ? { flow, result: resultForCompletedControl(state, flow.output, effectsStart) } : { flow };
};

const evaluateStep = async (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  irStep: WorkflowIrStep,
  step: WorkflowRuntimeStepIdentity,
  iterationPath: number[],
): Promise<StepEvaluation> => {
  try {
    return irStep.kind === "action"
      ? await evaluateAction(state, scope, irStep, step)
      : await evaluateControl(state, scope, irStep, iterationPath);
  } catch (error) {
    if (error instanceof WorkflowCancellation) {
      await traceCancellation(state, error.cancellation);
      const outcome: WorkflowStepOutcome = {
        state: "terminal",
        status: "canceled",
        ...optionalMessage(error.cancellation.message),
      };
      return {
        flow: { state: "canceled", ...optionalMessage(error.cancellation.message), step },
        ...(state.options.mode === "execute" ? { result: { mode: "execute", outcome } as const } : {}),
      };
    }
    if (state.options.mode === "dryRun") {
      const outcome: WorkflowPlanningOutcome = { state: "indeterminate", reason: errorMessage(error) };
      return { flow: { state: "indeterminate", reason: outcome.reason, step }, result: { mode: "dryRun", outcome } };
    }
    const outcome: WorkflowStepOutcome = {
      state: "failed",
      error: executionError(
        error instanceof WorkflowValueError ? "WORKFLOW_VALUE_UNAVAILABLE" : "WORKFLOW_ACTION_ERROR",
        errorMessage(error),
        !(error instanceof WorkflowValueError),
      ),
    };
    return { flow: { state: "failed", error: outcome.error, step }, result: { mode: "execute", outcome } };
  }
};

const runStep = async (
  state: RuntimeState,
  scope: RuntimeVariableScope,
  irStep: WorkflowIrStep,
  iterationPath: number[],
): Promise<Flow> => {
  const step = stepIdentity(state, irStep, iterationPath);
  const cancellation = await heartbeat(state);
  if (cancellation) return { state: "canceled", ...optionalMessage(cancellation.message), step };
  const restored = await state.options.repository.restoreCompletedStep(step);
  if (restored) return restoreStep(state, scope, irStep, step, restored);

  await state.options.repository.startStep(step);
  await emit(state, { type: "step.started", step });
  const evaluated = await evaluateStep(state, scope, irStep, step, iterationPath);
  if (evaluated.result) {
    await state.options.repository.finishStep(step, evaluated.result);
    await emit(state, { type: "step.finished", step, result: evaluated.result });
  }
  if (evaluated.flow.state !== "continue") return evaluated.flow;
  const after = await heartbeat(state);
  return after ? { state: "canceled", ...optionalMessage(after.message), step } : evaluated.flow;
};

const runSteps = async (
  state: RuntimeState,
  steps: WorkflowIrStep[],
  scope: RuntimeVariableScope,
  iterationPath: number[],
): Promise<Flow> => {
  let last: WorkflowJsonValue | undefined;
  for (const step of steps) {
    const flow = await runStep(state, scope, step, iterationPath);
    if (flow.state !== "continue") return flow;
    last = flow.output;
  }
  return { state: "continue", ...optionalOutput(last) };
};

const createState = (options: RuntimeOptions): RuntimeState => ({
  options,
  run: {
    runId: options.runId,
    executionGeneration: options.executionGeneration,
    mode: options.mode,
    workflowId: options.invocation.workflowId,
    sourceHash: options.plan.sourceHash,
    idempotencyKey: options.invocation.idempotencyKey,
  },
  effects: [],
  cancellationTraced: false,
});

export const executeWorkflowPlan = async (options: WorkflowExecuteOptions): Promise<WorkflowExecutionResult> => {
  const state = createState({ ...options, mode: "execute" });
  const flow = await runSteps(state, state.options.plan.steps, new RuntimeVariableScope(options.initialVariables), []);
  if (flow.state === "continue") return { state: "succeeded", ...optionalOutput(flow.output) };
  if (flow.state === "terminal_succeeded") return { state: "succeeded", ...optionalMessage(flow.message) };
  if (flow.state === "unsupported" || flow.state === "indeterminate") {
    return {
      state: "failed",
      error: executionError("WORKFLOW_RUNTIME_INVALID", flow.reason),
      step: flow.step,
    };
  }
  return flow;
};

export const dryRunWorkflowPlan = async (options: WorkflowDryRunOptions): Promise<WorkflowDryRunResult> => {
  const state = createState({ ...options, mode: "dryRun" });
  const flow = await runSteps(state, state.options.plan.steps, new RuntimeVariableScope(options.initialVariables), []);
  if (flow.state === "continue") return { state: "planned", ...optionalOutput(flow.output), effects: state.effects };
  if (flow.state === "unsupported" || flow.state === "indeterminate") {
    return { state: flow.state, reason: flow.reason, effects: state.effects, step: flow.step };
  }
  if (flow.state === "canceled") {
    return { state: "canceled", ...optionalMessage(flow.message), effects: state.effects, ...(flow.step ? { step: flow.step } : {}) };
  }
  const step = "step" in flow && flow.step ? flow.step : stepIdentity(state, state.options.plan.steps[0] ?? emptyActionStep, []);
  return { state: "indeterminate", reason: `dry-run traversal produced ${flow.state}`, effects: state.effects, step };
};

const emptyActionStep: WorkflowActionStep = { kind: "action", action: "<workflow>", config: {}, sourcePath: ["steps"] };
