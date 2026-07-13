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
    prepareRecordEvent: async () => ({
      ok: true,
      data: {
        workflow,
        workflowCatalog,
        actorUserId: null,
        actorGroupIds: [],
        serviceAccountId: null,
        triggerInput: { recordId: event.recordId },
        resolvedInput: {},
      },
    }),
    queuePreparedRun: async (item) => {
      queued.push(item);
      return { id: "55555555-5555-4555-8555-555555555555" } as never;
    },
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
