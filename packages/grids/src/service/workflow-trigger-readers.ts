import type { logger } from "@valentinkolb/cloud/services";
import type { WorkflowRun } from "../contracts";
import type { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import type { GridsRecordEvent, reclaimRecordEventDeliveries, recordEventReader } from "./record-events";
import type { PreparedWorkflowTriggerRun, prepareRecordEvent } from "./workflow-runtime";
import type * as workflowStore from "./workflows";

const RECORD_EVENT_CONSUMER_GROUP = "workflow-triggers";

const eventJobKey = (workflowId: string, event: GridsRecordEvent): string =>
  `${workflowId}:${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type WorkflowTriggerReaderRuntimeDeps = {
  log: Pick<ReturnType<typeof logger>, "warn">;
  workflows: Pick<typeof workflowStore, "listRecordEventBaseIds" | "listRecordEventEnabled" | "recordMatchesWorkflowFilter">;
  prepareRecordEvent: typeof prepareRecordEvent;
  recordEventReader: typeof recordEventReader;
  reclaimRecordEventDeliveries: typeof reclaimRecordEventDeliveries;
  latestMetadataEventCursor: typeof latestMetadataEventCursor;
  liveMetadataEvents: typeof liveMetadataEvents;
  queuePreparedRun: (item: PreparedWorkflowTriggerRun, options?: { triggerKey?: string }) => Promise<WorkflowRun>;
  scheduleReconcile: () => void;
};

export const createWorkflowTriggerReaderRuntime = (deps: WorkflowTriggerReaderRuntimeDeps) => {
  const baseReaders = new Map<string, { record: AbortController; metadata: AbortController }>();

  const startReaderTask = (read: () => Promise<void>): void => {
    void read();
  };

  const dispatchRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
    const candidates = await deps.workflows.listRecordEventEnabled(event);
    for (const workflow of candidates) {
      const matched = await deps.workflows.recordMatchesWorkflowFilter(workflow, event);
      if (!matched.ok) {
        deps.log.warn("Workflow recordEvent filter failed", {
          workflowId: workflow.id,
          tableId: event.tableId,
          recordId: event.recordId,
          error: matched.error.message,
        });
        continue;
      }
      if (!matched.data) continue;
      const prepared = await deps.prepareRecordEvent({
        workflowId: workflow.id,
        event,
        actorUserId: event.actorId,
      });
      if (!prepared.ok) {
        deps.log.warn("Workflow recordEvent preparation failed", {
          workflowId: workflow.id,
          tableId: event.tableId,
          recordId: event.recordId,
          error: prepared.error.message,
        });
        continue;
      }
      const item = prepared.data;
      await deps.queuePreparedRun(
        {
          workflow: item.workflow,
          triggerKind: "recordEvent",
          actorUserId: item.actorUserId,
          actorGroupIds: item.actorGroupIds,
          serviceAccountId: item.serviceAccountId,
          triggerInput: item.triggerInput,
          resolvedInput: item.resolvedInput,
          authorization: { kind: "workflow" },
        },
        {
          triggerKey: eventJobKey(workflow.id, event),
        },
      );
    }
  };

  const startRecordEventReader = (baseId: string, controller: AbortController): void => {
    const reader = deps.recordEventReader(RECORD_EVENT_CONSUMER_GROUP);
    startReaderTask(async () => {
      while (!controller.signal.aborted) {
        try {
          const reclaimed = await deps.reclaimRecordEventDeliveries(baseId, RECORD_EVENT_CONSUMER_GROUP);
          for (const delivery of reclaimed) {
            try {
              await dispatchRecordEvent(delivery.data);
              await delivery.commit();
            } catch (error) {
              deps.log.warn("Reclaimed workflow record event failed", {
                baseId,
                recordId: delivery.data.recordId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          const delivery = await reader.recv({
            tenantId: baseId,
            wait: true,
            timeoutMs: 30_000,
            signal: controller.signal,
          });
          if (!delivery) continue;
          await dispatchRecordEvent(delivery.data);
          await delivery.commit();
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return;
          deps.log.warn("Workflow record event reader failed", {
            baseId,
            error: error instanceof Error ? error.message : String(error),
          });
          await wait(1_000);
        }
      }
    });
  };

  const startMetadataReader = (baseId: string, controller: AbortController): void => {
    startReaderTask(async () => {
      while (!controller.signal.aborted) {
        try {
          const after = await deps.latestMetadataEventCursor(baseId);
          for await (const event of deps.liveMetadataEvents({ baseId, after, signal: controller.signal })) {
            if (event.data.resource.kind === "workflow" || event.data.resource.kind === "base") deps.scheduleReconcile();
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return;
          deps.log.warn("Workflow metadata reader failed", {
            baseId,
            error: error instanceof Error ? error.message : String(error),
          });
          await wait(1_000);
        }
      }
    });
  };

  const startBaseReaders = (baseId: string): void => {
    if (baseReaders.has(baseId)) return;
    const record = new AbortController();
    const metadata = new AbortController();
    baseReaders.set(baseId, { record, metadata });
    startRecordEventReader(baseId, record);
    startMetadataReader(baseId, metadata);
  };

  const stopBaseReaders = (baseId: string): void => {
    const readers = baseReaders.get(baseId);
    if (!readers) return;
    readers.record.abort();
    readers.metadata.abort();
    baseReaders.delete(baseId);
  };

  const reconcile = async (): Promise<void> => {
    const active = new Set(await deps.workflows.listRecordEventBaseIds());
    for (const baseId of baseReaders.keys()) {
      if (!active.has(baseId)) stopBaseReaders(baseId);
    }
    for (const baseId of active) startBaseReaders(baseId);
  };

  const stopAll = (): void => {
    for (const baseId of [...baseReaders.keys()]) stopBaseReaders(baseId);
  };

  return { dispatchRecordEvent, reconcile, stopAll };
};
