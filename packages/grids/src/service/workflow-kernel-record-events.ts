import { logger } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { WorkflowInvocation, WorkflowInvocationReceipt, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { workflowPathKey } from "@valentinkolb/cloud/workflows";
import type { Result } from "@valentinkolb/stdlib";
import { type TopicInvalidDelivery, TopicPayloadError } from "@valentinkolb/sync";
import { sql } from "bun";
import type { FilterTree } from "../contracts";
import type { GridsWorkflow, GridsWorkflowChannel } from "../workflows/contracts";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause } from "./filter-compiler";
import { recordInvalidRecordEventDelivery } from "./record-event-delivery-failures";
import { type GridsRecordEvent, GridsRecordEventSchema, recordEventReader } from "./record-events";
import { failQueuedWorkflowRun, materializeWorkflowInvocation } from "./workflow-kernel-runs";
import { listRecordEventBaseIds, listRecordEventWorkflows } from "./workflow-kernel-store";
import { evaluateWorkflowTriggerInputs } from "./workflow-kernel-trigger-values";
import { type GridsWorkflowPrincipal, loadWorkflowUserGroupIds } from "./workflow-kernel-values";

const log = logger("grids:workflow-kernel-record-events");
const CONSUMER_GROUP = "workflow-kernel";
const RETRY_DELAY_MS = 1_000;

export const processInvalidWorkflowRecordEventDelivery = async (
  baseId: string,
  delivery: TopicInvalidDelivery,
  recordFailure: typeof recordInvalidRecordEventDelivery = recordInvalidRecordEventDelivery,
): Promise<void> => {
  const failure = await recordFailure({
    baseId,
    consumerGroup: CONSUMER_GROUP,
    eventId: delivery.eventId,
    payload: delivery.rawPayload,
    error: delivery.error,
  });
  if (failure.dead && !(await delivery.commit())) throw new Error("record event acknowledgement was not accepted");
};

type InvokeWorkflow = (input: {
  workflowId: string;
  mode: "execute";
  channel: "recordEvent";
  inputs: Record<string, WorkflowJsonValue>;
  idempotencyKey: string;
  expectedRevision: number;
  principal: GridsWorkflowPrincipal;
  occurredAt: string;
  context: Record<string, WorkflowJsonValue>;
  trustedRecordIds: ReadonlyMap<string, ReadonlySet<string>>;
}) => Promise<Result<WorkflowInvocationReceipt>>;

type Snapshot = { data: Record<string, WorkflowJsonValue>; matched: boolean };

const eventName = (event: GridsRecordEvent): "created" | "updated" | "deleted" | null => {
  if (event.type === "record.created") return "created";
  if (event.type === "record.updated") return "updated";
  if (event.type === "record.deleted") return "deleted";
  return null;
};

const eventKey = (workflowId: string, event: GridsRecordEvent): string =>
  `record-event:${workflowId}:${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

const triggerFor = (workflow: GridsWorkflow) => workflow.plan.triggers.find((trigger) => trigger.kind === "recordEvent") ?? null;

const triggerTableId = (workflow: GridsWorkflow): string | null => {
  const value = workflow.plan.bindings["triggers.recordEvent.table"];
  return typeof value === "string" ? value : null;
};

const bindFilter = (
  workflow: GridsWorkflow,
  value: WorkflowJsonValue,
  path: Array<string | number> = ["triggers", "recordEvent", "filter"],
): WorkflowJsonValue => {
  if (Array.isArray(value)) return value.map((item, index) => bindFilter(workflow, item, [...path, index]));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const itemPath = [...path, key];
      if (key === "fieldId") {
        const binding = workflow.plan.bindings[workflowPathKey(itemPath)];
        if (typeof binding !== "string") throw new Error(`record event filter binding is unavailable at "${workflowPathKey(itemPath)}"`);
        return [key, binding];
      }
      return [key, bindFilter(workflow, item, itemPath)];
    }),
  );
};

const loadSnapshot = async (workflow: GridsWorkflow, event: GridsRecordEvent): Promise<Snapshot> => {
  const trigger = triggerFor(workflow);
  if (!trigger) throw new Error("workflow record event trigger is unavailable");
  const tableId = triggerTableId(workflow) ?? event.tableId;
  if (tableId !== event.tableId) throw new Error("record event table does not match workflow trigger");

  const rawFilter = trigger.config.filter;
  let clause = null;
  if (rawFilter !== undefined && rawFilter !== null) {
    const fields = await listFields(tableId);
    const filter = bindFilter(workflow, rawFilter) as FilterTree;
    const timeZone = normalizeTimeZone(String((await settingsGet<string>("app.timezone")) || "").trim(), "UTC");
    const compiled = compileFilter(filter, fields, { timeZone });
    if (!compiled.ok) throw new Error(`workflow record event filter is invalid: ${compiled.error}`);
    clause = renderClause(compiled.clause, { recordAlias: "event_record", relationSource: "recordData" });
  }

  const [row] = clause
    ? await sql<Array<{ snapshot_id: string; data: Record<string, WorkflowJsonValue>; matched: boolean }>>`
        SELECT snapshot.id::text AS snapshot_id, snapshot.data, COALESCE((${clause}), false) AS matched
        FROM grids.record_event_outbox outbox
        JOIN grids.record_event_snapshots snapshot ON snapshot.id = outbox.id
        CROSS JOIN LATERAL (SELECT snapshot.record_id AS id, snapshot.data AS data) event_record
        WHERE outbox.base_id = ${event.baseId}::uuid
          AND snapshot.table_id = ${tableId}::uuid
          AND snapshot.record_id = ${event.recordId}::uuid
          AND snapshot.event_type = ${event.type}
          AND (${event.version}::int IS NULL OR snapshot.record_version = ${event.version})
          AND outbox.payload->>'occurredAt' = ${event.occurredAt}
      `
    : await sql<Array<{ snapshot_id: string; data: Record<string, WorkflowJsonValue>; matched: boolean }>>`
        SELECT snapshot.id::text AS snapshot_id, snapshot.data, TRUE AS matched
        FROM grids.record_event_outbox outbox
        JOIN grids.record_event_snapshots snapshot ON snapshot.id = outbox.id
        WHERE outbox.base_id = ${event.baseId}::uuid
          AND snapshot.table_id = ${tableId}::uuid
          AND snapshot.record_id = ${event.recordId}::uuid
          AND snapshot.event_type = ${event.type}
          AND (${event.version}::int IS NULL OR snapshot.record_version = ${event.version})
          AND outbox.payload->>'occurredAt' = ${event.occurredAt}
      `;
  if (!row?.snapshot_id) throw new Error("record event snapshot is missing or inconsistent");
  return { data: row.data, matched: Boolean(row.matched) };
};

const ownerPrincipal = async (workflow: GridsWorkflow): Promise<GridsWorkflowPrincipal> => ({
  userId: workflow.ownerUserId,
  groupIds: await loadWorkflowUserGroupIds(workflow.ownerUserId),
  serviceAccountId: null,
});

const failedInvocation = async (
  workflow: GridsWorkflow,
  event: GridsRecordEvent,
  principal: GridsWorkflowPrincipal,
  message: string,
): Promise<void> => {
  const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    mode: "execute",
    channel: "recordEvent",
    actor: principal,
    inputs: {},
    idempotencyKey: eventKey(workflow.id, event),
    occurredAt: event.occurredAt,
    context: { workflow: { id: workflow.id, shortId: workflow.shortId, name: workflow.name }, recordEvent: event },
  };
  const receipt = await materializeWorkflowInvocation({
    baseId: workflow.baseId,
    invocation,
  });
  if (!receipt.ok) throw new Error(receipt.error.message);
  await failQueuedWorkflowRun(receipt.data.runId, message);
};

export const createWorkflowRecordEventRuntime = (invoke: InvokeWorkflow) => {
  const readers = new Map<string, { controller: AbortController; task: Promise<void> }>();

  const dispatch = async (event: GridsRecordEvent): Promise<void> => {
    const name = eventName(event);
    if (!name) return;
    for (const workflow of await listRecordEventWorkflows(event.baseId, event.occurredAt)) {
      const trigger = triggerFor(workflow);
      if (!trigger || trigger.config.event !== name) continue;
      if (triggerTableId(workflow) && triggerTableId(workflow) !== event.tableId) continue;
      const principal = await ownerPrincipal(workflow);
      try {
        const snapshot = await loadSnapshot(workflow, event);
        if (!snapshot.matched) continue;
        const inputs = evaluateWorkflowTriggerInputs(
          { record: event.recordId, event: name, occurredAt: event.occurredAt },
          trigger.with,
          event.occurredAt,
        );
        const result = await invoke({
          workflowId: workflow.id,
          mode: "execute",
          channel: "recordEvent",
          inputs,
          idempotencyKey: eventKey(workflow.id, event),
          expectedRevision: workflow.revision,
          principal,
          occurredAt: event.occurredAt,
          context: {
            recordEvent: event,
            workflowRecordSnapshots: { [`${event.tableId}:${event.recordId}`]: snapshot.data },
          },
          trustedRecordIds: new Map([[event.tableId, new Set([event.recordId])]]),
        });
        if (!result.ok) await failedInvocation(workflow, event, principal, result.error.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn("Workflow record event dispatch failed", { workflowId: workflow.id, recordId: event.recordId, error: message });
        await failedInvocation(workflow, event, principal, message);
      }
    }
  };

  const processDelivery = async (baseId: string, delivery: Awaited<ReturnType<ReturnType<typeof recordEventReader>["recv"]>>) => {
    if (!delivery) return;
    const parsed = GridsRecordEventSchema.safeParse(delivery.data);
    if (!parsed.success || parsed.data.baseId !== baseId) {
      const failure = await recordInvalidRecordEventDelivery({
        baseId,
        consumerGroup: CONSUMER_GROUP,
        eventId: delivery.eventId,
        payload: JSON.stringify(delivery.data),
        error: parsed.success ? `baseId: expected ${baseId}, received ${parsed.data.baseId}` : parsed.error.message,
      });
      if (failure.dead && !(await delivery.commit())) throw new Error("record event acknowledgement was not accepted");
      return;
    }
    await dispatch(parsed.data);
    if (!(await delivery.commit())) throw new Error("record event acknowledgement was not accepted");
  };

  const startReader = (baseId: string): void => {
    if (readers.has(baseId)) return;
    const controller = new AbortController();
    const reader = recordEventReader(CONSUMER_GROUP);
    const task = (async () => {
      let reclaimCursor = "0-0";
      while (!controller.signal.aborted) {
        try {
          const reclaimed = await reader.reclaim({ tenantId: baseId, cursor: reclaimCursor });
          reclaimCursor = reclaimed.nextCursor;
          for (const entry of reclaimed.entries) {
            if (entry.kind === "invalid") {
              await processInvalidWorkflowRecordEventDelivery(baseId, entry);
              continue;
            }
            await processDelivery(baseId, entry.delivery);
          }
          const delivery = await reader.recv({
            tenantId: baseId,
            wait: reclaimCursor === "0-0",
            timeoutMs: 30_000,
            signal: controller.signal,
            invalidPayload: "throw",
          });
          if (delivery) await processDelivery(baseId, delivery);
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof TopicPayloadError) {
            await recordInvalidRecordEventDelivery({
              baseId,
              consumerGroup: CONSUMER_GROUP,
              eventId: error.eventId,
              payload: error.rawPayload,
              error: error.message,
            });
          } else {
            log.warn("Workflow record event reader failed", { baseId, error: error instanceof Error ? error.message : String(error) });
          }
          await Bun.sleep(RETRY_DELAY_MS);
        }
      }
    })();
    readers.set(baseId, { controller, task });
  };

  const stopReader = async (baseId: string): Promise<void> => {
    const active = readers.get(baseId);
    if (!active) return;
    readers.delete(baseId);
    active.controller.abort();
    await active.task;
  };

  return {
    dispatch,
    reconcile: async (): Promise<void> => {
      const active = new Set(await listRecordEventBaseIds());
      await Promise.all([...readers.keys()].filter((baseId) => !active.has(baseId)).map(stopReader));
      for (const baseId of active) startReader(baseId);
    },
    stop: async (): Promise<void> => Promise.all([...readers.keys()].map(stopReader)).then(() => undefined),
  };
};
