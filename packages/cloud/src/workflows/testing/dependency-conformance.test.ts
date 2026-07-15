import type { WorkflowDependency } from "../contracts";
import {
  createWorkflowDependencyDeadline,
  createWorkflowDependencyWake,
  type WorkflowDependencyDeadline,
  type WorkflowDependencyDeadlinePort,
  type WorkflowDependencyDeadlineResult,
  type WorkflowDependencyWakePort,
  type WorkflowDependencyWakeResult,
} from "../runtime/dependency";
import { testWorkflowDependencyConformance } from "./dependency-conformance";

type DependencyPort = WorkflowDependencyWakePort & WorkflowDependencyDeadlinePort;

type Store = {
  dependency: WorkflowDependency & { deadline: string };
  runId: string;
  executionGeneration: number;
  state: "waiting" | "queued" | "canceled";
  wakeResults: Map<string, Extract<WorkflowDependencyWakeResult, { state: "resumed" }>>;
  deadlineResults: Map<string, Extract<WorkflowDependencyDeadlineResult, { state: "expired" }>>;
};

const currentDeadline = (store: Store): WorkflowDependencyDeadline =>
  createWorkflowDependencyDeadline(store.dependency, {
    runId: store.runId,
    executionGeneration: store.executionGeneration,
  });

const createPort = (store: Store): DependencyPort => ({
  wake: async (wake) => {
    const duplicate = store.wakeResults.get(wake.wakeId);
    if (duplicate) return { ...duplicate, state: "duplicate" };
    if (store.state === "canceled") return { state: "ignored", reason: "canceled" };
    if (store.state !== "waiting" || wake.dependencyId !== currentDeadline(store).dependencyId) {
      return { state: "ignored", reason: "stale" };
    }
    store.state = "queued";
    store.executionGeneration += 1;
    const resumed = { state: "resumed", runId: store.runId, executionGeneration: store.executionGeneration } as const;
    store.wakeResults.set(wake.wakeId, resumed);
    return resumed;
  },
  listDueDeadlines: async ({ now, limit }) => {
    const deadline = currentDeadline(store);
    return store.state === "waiting" && Date.parse(deadline.deadline) <= Date.parse(now) ? [deadline].slice(0, limit) : [];
  },
  expireDeadline: async (deadline) => {
    const duplicate = store.deadlineResults.get(deadline.deadlineId);
    if (duplicate) return { ...duplicate, state: "duplicate" };
    if (store.state === "canceled") return { state: "ignored", reason: "canceled" };
    const current = currentDeadline(store);
    if (
      store.state !== "waiting" ||
      deadline.dependencyId !== current.dependencyId ||
      deadline.runId !== current.runId ||
      deadline.executionGeneration !== current.executionGeneration ||
      deadline.deadlineId !== current.deadlineId
    ) {
      return { state: "ignored", reason: "stale" };
    }
    store.state = "queued";
    store.executionGeneration += 1;
    const expired = { state: "expired", runId: store.runId, executionGeneration: store.executionGeneration } as const;
    store.deadlineResults.set(deadline.deadlineId, expired);
    return expired;
  },
});

testWorkflowDependencyConformance("workflow dependency conformance", () => {
  const store: Store = {
    dependency: { kind: "test.child", key: "child-1", deadline: "2026-07-15T12:00:00.000Z" },
    runId: "run-1",
    executionGeneration: 1,
    state: "waiting",
    wakeResults: new Map(),
    deadlineResults: new Map(),
  };
  const deadline = currentDeadline(store);
  return {
    deadline,
    wake: createWorkflowDependencyWake(store.dependency, {
      deliveryKey: "delivery-1",
      occurredAt: "2026-07-15T11:00:00.000Z",
    }),
    port: createPort(store),
    cancel: async (expected) => {
      if (store.state !== "waiting" || expected.deadlineId !== currentDeadline(store).deadlineId) return false;
      store.state = "canceled";
      return true;
    },
    advanceGeneration: async () => {
      store.executionGeneration += 1;
    },
    restart: async () => createPort(store),
  };
});
