import type { WorkflowDependency, WorkflowJsonValue } from "../contracts";

const opaqueKey = (prefix: string, parts: readonly string[]): string =>
  `${prefix}:${parts.map((part) => `${part.length}:${part}`).join("")}`;

export const normalizeWorkflowInstant = (name: string, value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error(`${name} must be an ISO date-time with a timezone`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be an ISO date-time with a timezone`);
  return new Date(timestamp).toISOString();
};

const assertExecutionGeneration = (executionGeneration: number): void => {
  if (!Number.isSafeInteger(executionGeneration) || executionGeneration < 1) {
    throw new Error("executionGeneration must be a positive integer");
  }
};

export const workflowDependencyIdentity = (dependency: Pick<WorkflowDependency, "kind" | "key">): string =>
  opaqueKey("workflow-dependency", [dependency.kind, dependency.key]);

export type WorkflowDependencyWake = {
  dependencyId: string;
  wakeId: string;
  deliveryKey: string;
  occurredAt: string;
  data?: Record<string, WorkflowJsonValue>;
};

export type WorkflowDependencyWakeResult =
  | { state: "resumed"; runId: string; executionGeneration: number }
  | { state: "duplicate"; runId: string; executionGeneration: number }
  | { state: "ignored"; reason: "missing" | "stale" | "canceled" };

export interface WorkflowDependencyWakePort {
  // wake must deduplicate wakeId and atomically transition only a currently waiting run.
  wake(input: WorkflowDependencyWake): Promise<WorkflowDependencyWakeResult>;
}

export const createWorkflowDependencyWake = (
  dependency: Pick<WorkflowDependency, "kind" | "key">,
  input: { deliveryKey: string; occurredAt: string; data?: Record<string, WorkflowJsonValue> },
): WorkflowDependencyWake => {
  if (!input.deliveryKey.trim()) throw new Error("deliveryKey must not be empty");
  const dependencyId = workflowDependencyIdentity(dependency);
  return {
    dependencyId,
    wakeId: opaqueKey("workflow-wake", [dependencyId, input.deliveryKey]),
    deliveryKey: input.deliveryKey,
    occurredAt: normalizeWorkflowInstant("occurredAt", input.occurredAt),
    ...(input.data ? { data: input.data } : {}),
  };
};

export const wakeWorkflowDependency = (
  port: WorkflowDependencyWakePort,
  wake: WorkflowDependencyWake,
): Promise<WorkflowDependencyWakeResult> => port.wake(wake);

export type WorkflowDependencyDeadline = {
  dependencyId: string;
  deadlineId: string;
  runId: string;
  executionGeneration: number;
  deadline: string;
};

export type WorkflowDependencyDeadlineResult =
  | { state: "expired"; runId: string; executionGeneration: number }
  | { state: "duplicate"; runId: string; executionGeneration: number }
  | { state: "ignored"; reason: "missing" | "stale" | "canceled" | "not_due" };

export interface WorkflowDependencyDeadlinePort {
  // Due deadlines come from durable waiting state so a fresh process can recover them.
  listDueDeadlines(input: { now: string; limit: number }): Promise<readonly WorkflowDependencyDeadline[]>;
  // Expiration atomically compares the stored token before making a new generation runnable; deadlineId deduplicates retries.
  expireDeadline(deadline: WorkflowDependencyDeadline): Promise<WorkflowDependencyDeadlineResult>;
}

export const createWorkflowDependencyDeadline = (
  dependency: Pick<WorkflowDependency, "kind" | "key"> & { deadline: string },
  run: { runId: string; executionGeneration: number },
): WorkflowDependencyDeadline => {
  const runId = run.runId.trim();
  if (!runId) throw new Error("runId must not be empty");
  assertExecutionGeneration(run.executionGeneration);
  const dependencyId = workflowDependencyIdentity(dependency);
  const deadline = normalizeWorkflowInstant("deadline", dependency.deadline);
  return {
    dependencyId,
    deadlineId: opaqueKey("workflow-deadline", [dependencyId, runId, String(run.executionGeneration), deadline]),
    runId,
    executionGeneration: run.executionGeneration,
    deadline,
  };
};

export type WorkflowDependencyDeadlineRecovery = {
  deadline: WorkflowDependencyDeadline;
  result: WorkflowDependencyDeadlineResult;
};

export const recoverWorkflowDependencyDeadlines = async (input: {
  now: string;
  limit: number;
  port: WorkflowDependencyDeadlinePort;
}): Promise<WorkflowDependencyDeadlineRecovery[]> => {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("deadline recovery limit must be a positive integer");
  const now = normalizeWorkflowInstant("now", input.now);
  const deadlines = await input.port.listDueDeadlines({ now, limit: input.limit });
  if (deadlines.length > input.limit) throw new Error("deadline recovery exceeded its limit");

  const recovered: WorkflowDependencyDeadlineRecovery[] = [];
  for (const deadline of deadlines) {
    assertExecutionGeneration(deadline.executionGeneration);
    if (Date.parse(normalizeWorkflowInstant("deadline", deadline.deadline)) > Date.parse(now)) {
      throw new Error(`deadline recovery returned a future deadline: ${deadline.deadlineId}`);
    }
    recovered.push({ deadline, result: await input.port.expireDeadline(deadline) });
  }
  return recovered;
};
