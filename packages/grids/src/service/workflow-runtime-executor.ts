import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { WorkflowStep, WorkflowStepRun, WorkflowValue } from "../contracts";
import { createStepRun, finishStepRun, getStepRunByPath } from "./workflow-step-runs";

export type RuntimeStep = Record<string, unknown>;

type RuntimeRecordList = { kind: "recordList"; tableId: string; recordIds: string[] };

type WorkflowStepExecutor<Value> = {
  executeAction: (item: RuntimeStep) => Promise<Result<Value | null> | null>;
  evaluateCondition: (condition: unknown) => Promise<Result<boolean>>;
  evaluateValue: (value: WorkflowValue) => Promise<Result<Value>>;
  heartbeat: () => Promise<void>;
  isRecordList: (value: Value) => value is Value & RuntimeRecordList;
  isSideEffectStep: (item: RuntimeStep) => boolean;
  isWorkflowSucceed: (value: Value | null) => boolean;
  maxLoopItems: number;
  restoreSucceededStep: (item: RuntimeStep, stepRun: WorkflowStepRun) => Result<Value | null>;
  setLoopRecord: (alias: string, tableId: string, recordId: string) => void;
  stepOutputValue: (value: Value | null) => unknown;
  valuesEqual: (left: Value, right: Value) => boolean;
};

const stepKind = (step: WorkflowStep): string => Object.keys(step as RuntimeStep)[0] ?? "unknown";

const executeIf = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  currentPath: string,
): Promise<Result<Value | null>> => {
  const matched = await executor.evaluateCondition(item.if);
  if (!matched.ok) return matched;
  const branches = item as { then?: WorkflowStep[]; else?: WorkflowStep[] };
  return executeWorkflowSteps(
    executor,
    matched.data ? (branches.then ?? []) : (branches.else ?? []),
    runId,
    `${currentPath}.${matched.data ? "then" : "else"}`,
  );
};

const executeSwitch = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
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
  return executeWorkflowSteps(executor, found?.do ?? (item as { default?: WorkflowStep[] }).default ?? [], runId, `${currentPath}.switch`);
};

const executeForEach = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  currentPath: string,
): Promise<Result<Value | null>> => {
  const list = await executor.evaluateValue(item.forEach as string);
  if (!list.ok) return list;
  if (!executor.isRecordList(list.data)) return fail(err.badInput("forEach must resolve to a recordList"));
  if (list.data.recordIds.length > executor.maxLoopItems) {
    return fail(err.badInput(`forEach supports at most ${executor.maxLoopItems} records per run`));
  }
  const alias = String((item as { as?: unknown }).as ?? "");
  const body = (item as { do?: WorkflowStep[] }).do ?? [];
  let result: Result<Value | null> = ok(null);
  for (const recordId of list.data.recordIds) {
    await executor.heartbeat();
    executor.setLoopRecord(alias, list.data.tableId, recordId);
    result = await executeWorkflowSteps(executor, body, runId, `${currentPath}.do.${recordId}`);
    if (!result.ok || executor.isWorkflowSucceed(result.data)) break;
  }
  return result;
};

const executeControlFlow = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  item: RuntimeStep,
  runId: string,
  currentPath: string,
): Promise<Result<Value | null> | null> => {
  if ("if" in item) return executeIf(executor, item, runId, currentPath);
  if ("switch" in item) return executeSwitch(executor, item, runId, currentPath);
  if ("forEach" in item) return executeForEach(executor, item, runId, currentPath);
  return null;
};

export const executeWorkflowSteps = async <Value>(
  executor: WorkflowStepExecutor<Value>,
  steps: WorkflowStep[],
  runId: string,
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
    if (previousStepRun?.status === "running" && executor.isSideEffectStep(item)) {
      return fail(err.conflict(`workflow step "${currentPath}" was interrupted during a side effect and cannot be retried safely`));
    }
    const stepRun = await createStepRun({ runId, stepIndex: index, stepPath: currentPath, kind, input: { kind } });
    if (stepRun.status === "succeeded") {
      const restored = executor.restoreSucceededStep(item, stepRun);
      if (!restored.ok) return restored;
      await executor.heartbeat();
      last = restored.data;
      if (executor.isWorkflowSucceed(last)) break;
      continue;
    }

    const result =
      (await executor.executeAction(item)) ??
      (await executeControlFlow(executor, item, runId, currentPath)) ??
      fail(err.badInput(`unsupported workflow step "${kind}"`));

    await finishStepRun(stepRun.id, {
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
