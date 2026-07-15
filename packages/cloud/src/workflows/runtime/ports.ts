import type {
  WorkflowBoundPlan,
  WorkflowDependency,
  WorkflowInvocation,
  WorkflowInvocationMode,
  WorkflowIrStep,
  WorkflowJsonValue,
  WorkflowPlanningIssue,
  WorkflowPlanningOutcome,
  WorkflowStepOutcome,
} from "../contracts";

export type WorkflowActionStep = Extract<WorkflowIrStep, { kind: "action" }>;

export type WorkflowRuntimeRunIdentity = {
  runId: string;
  executionGeneration: number;
  mode: WorkflowInvocationMode;
  workflowId: string;
  sourceHash: string;
  idempotencyKey: string;
};

export type WorkflowRuntimeStepIdentity = WorkflowRuntimeRunIdentity & {
  key: string;
  sourcePath: Array<string | number>;
  iterationPath: number[];
  path: Array<string | number>;
  kind: WorkflowIrStep["kind"];
  action?: string;
};

export type WorkflowHeartbeatOutcome = { state: "active" } | { state: "canceled"; message?: string };

export type WorkflowRestoredStep =
  | { mode: "execute"; outcome: Exclude<WorkflowStepOutcome, { state: "waiting" }> }
  | { mode: "dryRun"; outcome: WorkflowPlanningOutcome };

export type WorkflowRuntimeStepResult =
  | { mode: "execute"; outcome: WorkflowStepOutcome }
  | { mode: "dryRun"; outcome: WorkflowPlanningOutcome };

export interface WorkflowRuntimeRepositoryPort {
  heartbeat(run: WorkflowRuntimeRunIdentity): Promise<WorkflowHeartbeatOutcome>;
  restoreStepOutcome(step: WorkflowRuntimeStepIdentity): Promise<WorkflowRestoredStep | null>;
  startStep(step: WorkflowRuntimeStepIdentity): Promise<void>;
  finishStep(step: WorkflowRuntimeStepIdentity, result: WorkflowRuntimeStepResult): Promise<void>;
  parkStep(step: WorkflowRuntimeStepIdentity, dependency: WorkflowDependency): Promise<void>;
}

export interface WorkflowVariableScope {
  get(name: string): WorkflowJsonValue | undefined;
  has(name: string): boolean;
  set(name: string, value: WorkflowJsonValue): void;
}

export type WorkflowValueResolution =
  | { state: "resolved"; value: WorkflowJsonValue }
  | { state: "missing" }
  | { state: "waiting"; dependency: WorkflowDependency };

export interface WorkflowExecutionClock {
  now(): string;
}

type WorkflowActionContextBase<Mode extends WorkflowInvocationMode> = {
  mode: Mode;
  run: WorkflowRuntimeRunIdentity & { mode: Mode };
  step: WorkflowRuntimeStepIdentity & { mode: Mode };
  plan: WorkflowBoundPlan;
  invocation: WorkflowInvocation & { mode: Mode };
  variables: WorkflowVariableScope;
  evaluate(value: WorkflowJsonValue, path?: Array<string | number>): Promise<WorkflowJsonValue>;
  resolveReference(reference: string, path?: Array<string | number>): Promise<WorkflowJsonValue | undefined>;
  heartbeat(): Promise<void>;
};

export type WorkflowExecuteActionContext = WorkflowActionContextBase<"execute">;
export type WorkflowDryRunActionContext = WorkflowActionContextBase<"dryRun">;

export type WorkflowExecuteActionHandler = {
  execute(context: WorkflowExecuteActionContext, step: WorkflowActionStep): Promise<WorkflowStepOutcome>;
  restoreCompleted?(
    context: WorkflowExecuteActionContext,
    step: WorkflowActionStep,
    outcome: Extract<WorkflowStepOutcome, { state: "completed" }>,
  ): Promise<void> | void;
};

export type WorkflowDryRunActionHandler = {
  plan(context: WorkflowDryRunActionContext, step: WorkflowActionStep): Promise<WorkflowPlanningOutcome>;
  restoreCompleted?(
    context: WorkflowDryRunActionContext,
    step: WorkflowActionStep,
    outcome: Extract<WorkflowPlanningOutcome, { state: "planned" }>,
  ): Promise<void> | void;
};

export interface WorkflowExecuteActionPort {
  get(action: string): WorkflowExecuteActionHandler | undefined;
}

export interface WorkflowDryRunActionPort {
  get(action: string): WorkflowDryRunActionHandler | undefined;
}

export type WorkflowTraceEvent =
  | { type: "step.started"; step: WorkflowRuntimeStepIdentity }
  | { type: "step.restored"; step: WorkflowRuntimeStepIdentity; restored: WorkflowRestoredStep }
  | { type: "step.waiting"; step: WorkflowRuntimeStepIdentity; dependency: WorkflowDependency }
  | { type: "step.finished"; step: WorkflowRuntimeStepIdentity; result: WorkflowRuntimeStepResult }
  | { type: "run.canceled"; run: WorkflowRuntimeRunIdentity; message?: string };

export interface WorkflowTracePort {
  emit(event: WorkflowTraceEvent): Promise<void> | void;
}

export interface WorkflowValueResolverPort {
  resolve(input: {
    reference: string;
    path: Array<string | number>;
    plan: WorkflowBoundPlan;
    invocation: WorkflowInvocation;
    variables: WorkflowVariableScope;
    fallback: () => WorkflowJsonValue | undefined;
  }): Promise<WorkflowValueResolution>;
}

type WorkflowRuntimeOptionsBase = {
  runId: string;
  executionGeneration: number;
  plan: WorkflowBoundPlan;
  invocation: WorkflowInvocation;
  repository: WorkflowRuntimeRepositoryPort;
  clock: WorkflowExecutionClock;
  trace?: WorkflowTracePort;
  values?: WorkflowValueResolverPort;
  maxLoopItems?: number;
  initialVariables?: Record<string, WorkflowJsonValue>;
};

export type WorkflowExecuteOptions = Omit<WorkflowRuntimeOptionsBase, "invocation"> & {
  invocation: WorkflowInvocation & { mode: "execute" };
  actions: WorkflowExecuteActionPort;
};

export type WorkflowDryRunOptions = Omit<WorkflowRuntimeOptionsBase, "invocation"> & {
  invocation: WorkflowInvocation & { mode: "dryRun" };
  actions: WorkflowDryRunActionPort;
};

export type WorkflowExecutionResult =
  | { state: "succeeded"; output?: WorkflowJsonValue; message?: string }
  | { state: "waiting"; dependency: Extract<WorkflowStepOutcome, { state: "waiting" }>["dependency"]; step: WorkflowRuntimeStepIdentity }
  | { state: "failed"; error: Extract<WorkflowStepOutcome, { state: "failed" }>["error"]; step: WorkflowRuntimeStepIdentity }
  | {
      state: "needs_attention";
      error: Extract<WorkflowStepOutcome, { state: "needs_attention" }>["error"];
      step: WorkflowRuntimeStepIdentity;
    }
  | { state: "canceled"; message?: string; step?: WorkflowRuntimeStepIdentity };

export type WorkflowDryRunIssue = Omit<WorkflowPlanningIssue, "step"> & {
  step: WorkflowRuntimeStepIdentity;
};

export type WorkflowDryRunResult =
  | { state: "planned"; output?: WorkflowJsonValue; effects: WorkflowJsonValue[] }
  | {
      state: "terminal";
      status: "succeeded" | "failed";
      message?: string;
      effects: WorkflowJsonValue[];
      issues?: WorkflowDryRunIssue[];
    }
  | {
      state: "unsupported";
      reason: string;
      effects: WorkflowJsonValue[];
      step: WorkflowRuntimeStepIdentity;
      issues: WorkflowDryRunIssue[];
    }
  | {
      state: "indeterminate";
      reason: string;
      effects: WorkflowJsonValue[];
      step: WorkflowRuntimeStepIdentity;
      issues: WorkflowDryRunIssue[];
    }
  | {
      state: "canceled";
      message?: string;
      effects: WorkflowJsonValue[];
      step?: WorkflowRuntimeStepIdentity;
      issues?: WorkflowDryRunIssue[];
    };
