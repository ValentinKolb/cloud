import { expect, test } from "bun:test";
import type { Workflow } from "../contracts";
import type { GridsRecordEvent } from "./record-events";
import { createWorkflowTriggerReaderRuntime } from "./workflow-trigger-readers";
import type { WorkflowCatalogSnapshot } from "./workflows";

const workflow = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "wf001",
  baseId: "22222222-2222-4222-8222-222222222222",
  name: "Record event workflow",
  description: null,
  source: "steps: []",
  compiled: { triggers: { recordEvent: { event: "updated" } }, steps: [] },
  enabled: true,
  position: 0,
  revision: 1,
  ownerUserId: null,
  deletedAt: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
} satisfies Workflow;

const event: GridsRecordEvent = {
  v: 1,
  type: "record.updated",
  baseId: workflow.baseId,
  tableId: "33333333-3333-4333-8333-333333333333",
  recordId: "44444444-4444-4444-8444-444444444444",
  version: 2,
  changedFieldIds: [],
  actorId: null,
  occurredAt: "2026-07-13T00:00:00.000Z",
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for workflow reader state");
};

const preparedRecordEvent = (candidate: Workflow, workflowCatalog: WorkflowCatalogSnapshot) => ({
  ok: true as const,
  data: {
    workflow: candidate,
    workflowCatalog,
    actorUserId: null,
    actorGroupIds: [],
    serviceAccountId: null,
    triggerInput: { recordId: event.recordId },
    resolvedInput: {},
  },
});

test("record event dispatch preserves its prepared catalog snapshot", async () => {
  const workflowCatalog: WorkflowCatalogSnapshot = {
    tables: [{ id: event.tableId, shortId: "tbl01", name: "Original items" }],
    fieldsByTable: {},
    templates: [],
    emailTemplates: [],
  };
  const queued: Array<{ workflowCatalog?: WorkflowCatalogSnapshot }> = [];
  const runtime = createWorkflowTriggerReaderRuntime({
    log: { warn: () => undefined },
    workflows: {
      listRecordEventBaseIds: async () => [],
      listRecordEventEnabled: async () => [workflow],
      recordMatchesWorkflowFilter: async () => ({ ok: true, data: true }),
    },
    prepareRecordEvent: async () => preparedRecordEvent(workflow, workflowCatalog),
    queuePreparedRun: async (item) => {
      queued.push(item);
      return { id: "55555555-5555-4555-8555-555555555555" } as never;
    },
    recordDispatchFailure: async () => undefined,
    recordEventReader: (() => undefined) as never,
    reclaimRecordEventDeliveries: async () => [],
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* () {},
    scheduleReconcile: () => undefined,
  });

  await runtime.dispatchRecordEvent(event);

  expect(queued).toHaveLength(1);
  expect(queued[0]?.workflowCatalog).toEqual(workflowCatalog);
});

test("record event dispatch persists partial failures and keeps stable workflow keys", async () => {
  const secondWorkflow = { ...workflow, id: "55555555-5555-4555-8555-555555555555", shortId: "wf002" } satisfies Workflow;
  const workflowCatalog: WorkflowCatalogSnapshot = { tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] };
  const attempts: Array<{ workflowId: string; triggerKey?: string; submitFailure?: string }> = [];
  const persistedFailures: Array<{ workflowId: string; triggerKey: string }> = [];
  const runtime = createWorkflowTriggerReaderRuntime({
    log: { warn: () => undefined },
    workflows: {
      listRecordEventBaseIds: async () => [],
      listRecordEventEnabled: async () => [workflow, secondWorkflow],
      recordMatchesWorkflowFilter: async () => ({ ok: true, data: true }),
    },
    prepareRecordEvent: async ({ workflowId }) =>
      preparedRecordEvent(workflowId === workflow.id ? workflow : secondWorkflow, workflowCatalog),
    queuePreparedRun: async (item, options) => {
      attempts.push({ workflowId: item.workflow.id, ...options });
      if (item.workflow.id === secondWorkflow.id) throw new Error("queue unavailable");
      return { id: "66666666-6666-4666-8666-666666666666" } as never;
    },
    recordDispatchFailure: async (failure) => {
      persistedFailures.push({ workflowId: failure.workflow.id, triggerKey: failure.triggerKey });
    },
    recordEventReader: (() => undefined) as never,
    reclaimRecordEventDeliveries: async () => [],
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* () {},
    scheduleReconcile: () => undefined,
  });

  await runtime.dispatchRecordEvent(event);
  await runtime.dispatchRecordEvent(event);

  expect(attempts).toHaveLength(4);
  expect(attempts.every((attempt) => attempt.submitFailure === "defer")).toBe(true);
  expect(attempts[0]?.triggerKey).toBe(attempts[2]?.triggerKey);
  expect(attempts[1]?.triggerKey).toBe(attempts[3]?.triggerKey);
  expect(attempts[0]?.triggerKey).not.toBe(attempts[1]?.triggerKey);
  expect(persistedFailures).toHaveLength(2);
  expect(persistedFailures[0]).toEqual(persistedFailures[1]);
});

test("record event dispatch isolates thrown workflow failures", async () => {
  const secondWorkflow = { ...workflow, id: "55555555-5555-4555-8555-555555555555", shortId: "wf002" } satisfies Workflow;
  const persistedFailures: string[] = [];
  const queued: string[] = [];
  const runtime = createWorkflowTriggerReaderRuntime({
    log: { warn: () => undefined },
    workflows: {
      listRecordEventBaseIds: async () => [],
      listRecordEventEnabled: async () => [workflow, secondWorkflow],
      recordMatchesWorkflowFilter: async (candidate) => {
        if (candidate.id === workflow.id) throw new Error("database timeout");
        return { ok: true, data: true };
      },
    },
    prepareRecordEvent: async () =>
      preparedRecordEvent(secondWorkflow, { tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] }),
    queuePreparedRun: async (item) => {
      queued.push(item.workflow.id);
      return { id: "66666666-6666-4666-8666-666666666666" } as never;
    },
    recordDispatchFailure: async (failure) => {
      persistedFailures.push(`${failure.workflow.id}:${failure.stage}`);
    },
    recordEventReader: (() => undefined) as never,
    reclaimRecordEventDeliveries: async () => [],
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* () {},
    scheduleReconcile: () => undefined,
  });

  await runtime.dispatchRecordEvent(event);

  expect(persistedFailures).toEqual([`${workflow.id}:filter`]);
  expect(queued).toEqual([secondWorkflow.id]);
});

test("record event reader reclaims a delivery when no durable dispatch state could be written", async () => {
  const workflowCatalog: WorkflowCatalogSnapshot = { tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] };
  let delivered = false;
  let reclaimCalls = 0;
  let queueCalls = 0;
  let commitCalls = 0;
  const delivery = {
    data: event,
    commit: async () => {
      commitCalls += 1;
      return true;
    },
  };
  const runtime = createWorkflowTriggerReaderRuntime({
    log: { warn: () => undefined },
    workflows: {
      listRecordEventBaseIds: async () => [event.baseId],
      listRecordEventEnabled: async () => [workflow],
      recordMatchesWorkflowFilter: async () => ({ ok: true, data: true }),
    },
    prepareRecordEvent: async () => preparedRecordEvent(workflow, workflowCatalog),
    queuePreparedRun: async () => {
      queueCalls += 1;
      if (queueCalls === 1) throw new Error("queue unavailable");
      return { id: "66666666-6666-4666-8666-666666666666" } as never;
    },
    recordDispatchFailure: async () => {
      throw new Error("database unavailable");
    },
    recordEventReader: () =>
      ({
        recv: async ({ signal }: { signal: AbortSignal }) => {
          if (!delivered) {
            delivered = true;
            return delivery;
          }
          return new Promise<null>((resolve) => {
            if (signal.aborted) resolve(null);
            else signal.addEventListener("abort", () => resolve(null), { once: true });
          });
        },
      }) as never,
    reclaimRecordEventDeliveries: async () => {
      reclaimCalls += 1;
      return reclaimCalls === 2 ? [delivery] : [];
    },
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* ({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    scheduleReconcile: () => undefined,
    retryDelayMs: 1,
  });

  await runtime.reconcile();
  await waitFor(() => commitCalls === 1);
  await runtime.stopAll();

  expect(queueCalls).toBe(2);
  expect(commitCalls).toBe(1);
});

test("record event reader treats a rejected acknowledgement as a delivery failure", async () => {
  const warnings: string[] = [];
  let delivered = false;
  let commitCalls = 0;
  const runtime = createWorkflowTriggerReaderRuntime({
    log: {
      warn: (message) => {
        warnings.push(message);
      },
    },
    workflows: {
      listRecordEventBaseIds: async () => [event.baseId],
      listRecordEventEnabled: async () => [],
      recordMatchesWorkflowFilter: async () => ({ ok: true, data: true }),
    },
    prepareRecordEvent: async () => preparedRecordEvent(workflow, { tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] }),
    queuePreparedRun: async () => ({ id: "66666666-6666-4666-8666-666666666666" }) as never,
    recordDispatchFailure: async () => undefined,
    recordEventReader: () =>
      ({
        recv: async ({ signal }: { signal: AbortSignal }) => {
          if (!delivered) {
            delivered = true;
            return {
              data: event,
              commit: async () => {
                commitCalls += 1;
                return false;
              },
            };
          }
          return new Promise<null>((resolve) => {
            if (signal.aborted) resolve(null);
            else signal.addEventListener("abort", () => resolve(null), { once: true });
          });
        },
      }) as never,
    reclaimRecordEventDeliveries: async () => [],
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* ({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    scheduleReconcile: () => undefined,
    retryDelayMs: 1,
  });

  await runtime.reconcile();
  await waitFor(() => warnings.includes("Workflow record event reader failed"));
  await runtime.stopAll();

  expect(commitCalls).toBe(1);
});
