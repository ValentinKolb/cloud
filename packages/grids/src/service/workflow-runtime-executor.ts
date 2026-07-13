import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { WorkflowStep, WorkflowStepRun, WorkflowValue } from "../contracts";
import { createStepRun, finishStepRun, getStepRunByPath } from "./workflow-step-runs";

export type RuntimeStep = Record<string, unknown>;

type RuntimeRecordList = { kind: "recordList"; tableId: string; recordIds: string[] };

type WorkflowStepExecutor<Value> = {
  executeAction: (item: RuntimeStep, stepRun: WorkflowStepRun) => Promise<Result<Value | null> | null>;
  evaluateCondition: (condition: unknown) => Promise<Result<boolean>>;
  evaluateReference: (reference: string) => Promise<Result<Value>>;
  evaluateValue: (value: WorkflowValue) => Promise<Result<Value>>;
  heartbeat: () => Promise<void>;
  isRecordList: (value: Value) => value is Value & RuntimeRecordList;
  isRetryableSideEffectStep: (item: RuntimeStep) => boolean;
  isSideEffectStep: (item: RuntimeStep) => boolean;
  isWorkflowSucceed: (value: Value | null) => boolean;
  maxLoopItems: number;
  restoreSucceededStep: (item: RuntimeStep, stepRun: WorkflowStepRun) => Result<Value | null>;
  setLoopRecord: (alias: string, tableId: string, recordId: string) => void;
  stepOutputValue: (value: Value | null) => unknown;
  valuesEqual: (left: Value, right: Value) => boolean;
  withVariableScope: <T>(run: () => Promise<T>) => Promise<T>;
};

const stepKind = (step: WorkflowStep): string => Object.keys(step as RuntimeStep)[0] ?? "unknown";

const executeIf = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  executionGeneration: number,
  currentPath: string,
): Promise<Result<Value | null>> => {
  const matched = await executor.evaluateCondition(item.if);
  if (!matched.ok) return matched;
  const branches = item as { then?: WorkflowStep[]; else?: WorkflowStep[] };
  return executor.withVariableScope(() =>
    executeWorkflowSteps(
      executor,
      matched.data ? (branches.then ?? []) : (branches.else ?? []),
      runId,
      executionGeneration,
      `${currentPath}.${matched.data ? "then" : "else"}`,
    ),
  );
};

const executeSwitch = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  executionGeneration: number,
  currentPath: string,
): Promise<Result<Value | null>> => {
  const switched = await executor.evaluateValue(item.switch as WorkflowValue);
  if (!switched.ok) return switched;
  let found: { do: WorkflowStep[] } | null = null;
  for (const candidate of (item as { cases?: Array<{ when: WorkflowValue; do: WorkflowStep[] }> }).cases ?? []) {
    const when = await executor.evaluateValue(candidate.when);
    if (!when.ok) return when;
    if (executor.valuesEqual(switched.data, when.data)) {
      found = candidate;
      break;
    }
  }
  return executor.withVariableScope(() =>
    executeWorkflowSteps(
      executor,
      found?.do ?? (item as { default?: WorkflowStep[] }).default ?? [],
      runId,
      executionGeneration,
      `${currentPath}.switch`,
    ),
  );
};

const executeForEach = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  executionGeneration: number,
  currentPath: string,
): Promise<Result<Value | null>> => {
  const list = await executor.evaluateReference(item.forEach as string);
  if (!list.ok) return list;
  if (!executor.isRecordList(list.data)) return fail(err.badInput("forEach must resolve to a recordList"));
  if (list.data.recordIds.length > executor.maxLoopItems) {
    return fail(err.badInput(`forEach supports at most ${executor.maxLoopItems} records per run`));
  }
  const alias = String((item as { as?: unknown }).as ?? "");
  const body = (item as { do?: WorkflowStep[] }).do ?? [];
  const recordList = list.data;
  let result: Result<Value | null> = ok(null);
  for (const recordId of recordList.recordIds) {
    await executor.heartbeat();
    result = await executor.withVariableScope(() => {
      executor.setLoopRecord(alias, recordList.tableId, recordId);
      return executeWorkflowSteps(executor, body, runId, executionGeneration, `${currentPath}.do.${recordId}`);
    });
    if (!result.ok || executor.isWorkflowSucceed(result.data)) break;
  }
  return result;
};

const executeControlFlow = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  executionGeneration: number,
  currentPath: string,
): Promise<Result<Value | null> | null> => {
  if ("if" in item) return executeIf(executor, item, runId, executionGeneration, currentPath);
  if ("switch" in item) return executeSwitch(executor, item, runId, executionGeneration, currentPath);
  if ("forEach" in item) return executeForEach(executor, item, runId, executionGeneration, currentPath);
  return null;
};

export const executeWorkflowSteps = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  steps: WorkflowStep[],
  runId: string,
  executionGeneration: number,
  path: string,
): Promise<Result<Value | null>> => {
  let last: Value | null = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const item = step as RuntimeStep;
    const currentPath = `${path}.${index}`;
    const kind = stepKind(step);
    await executor.heartbeat();
    const previousStepRun = await getStepRunByPath(runId, currentPath);
    if (previousStepRun?.status === "running" && executor.isSideEffectStep(item) && !executor.isRetryableSideEffectStep(item)) {
      return fail(err.conflict(`workflow step "${currentPath}" was interrupted during a side effect and cannot be retried safely`));
    }
    const stepRun = await createStepRun({ runId, executionGeneration, stepIndex: index, stepPath: currentPath, kind, input: { kind } });
    if (stepRun.status === "succeeded") {
      const restored = executor.restoreSucceededStep(item, stepRun);
      if (!restored.ok) return restored;
      await executor.heartbeat();
      last = restored.data;
      if (executor.isWorkflowSucceed(last)) break;
      continue;
    }

    const result =
      (await executor.executeAction(item, stepRun)) ??
      (await executeControlFlow(executor, item, runId, executionGeneration, currentPath)) ??
      fail(err.badInput(`unsupported workflow step "${kind}"`));

    await finishStepRun(stepRun.id, executionGeneration, {
      status: result.ok ? "succeeded" : "failed",
      output: result.ok ? { ok: true, value: executor.stepOutputValue(result.data) } : null,
      error: result.ok ? null : result.error.message,
    });
    await executor.heartbeat();
    if (!result.ok) return result;
    last = result.data;
    if (executor.isWorkflowSucceed(last)) break;
  }
  return ok(last);
};
