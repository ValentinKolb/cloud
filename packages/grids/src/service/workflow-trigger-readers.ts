import type { logger } from "@valentinkolb/cloud/services";
import { type TopicDelivery, type TopicInvalidDelivery, TopicPayloadError } from "@valentinkolb/sync";
import type { WorkflowRun } from "../contracts";
import type { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import type { RecordEventDeliveryFailure, recordInvalidRecordEventDelivery } from "./record-event-delivery-failures";
import { type GridsRecordEvent, GridsRecordEventSchema, type recordEventReader } from "./record-events";
import type { PreparedWorkflowTriggerRun, prepareRecordEvent } from "./workflow-runtime";
import type * as workflowStore from "./workflows";

const RECORD_EVENT_CONSUMER_GROUP = "workflow-triggers";

const eventJobKey = (workflowId: string, event: GridsRecordEvent): string =>
  `${workflowId}:${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });

type WorkflowTriggerReaderRuntimeDeps = {
  log: Pick<ReturnType<typeof logger>, "warn">;
  workflows: Pick<typeof workflowStore, "listRecordEventBaseIds" | "listRecordEventEnabled" | "recordMatchesWorkflowFilter">;
  prepareRecordEvent: typeof prepareRecordEvent;
  recordEventReader: typeof recordEventReader;
  recordInvalidRecordEventDelivery: typeof recordInvalidRecordEventDelivery;
  latestMetadataEventCursor: typeof latestMetadataEventCursor;
  liveMetadataEvents: typeof liveMetadataEvents;
  queuePreparedRun: (
    item: PreparedWorkflowTriggerRun,
    options?: { triggerKey?: string; submitFailure?: "defer" | "fail" },
  ) => Promise<WorkflowRun>;
  recordDispatchFailure: (input: {
    workflow: PreparedWorkflowTriggerRun["workflow"];
    event: GridsRecordEvent;
    triggerKey: string;
    stage: "filter" | "preparation" | "queue";
    error: string;
  }) => Promise<void>;
  scheduleReconcile: () => void;
  retryDelayMs?: number;
};

export const createWorkflowTriggerReaderRuntime = (deps: WorkflowTriggerReaderRuntimeDeps) => {
  const retryDelayMs = deps.retryDelayMs ?? 1_000;
  const baseReaders = new Map<
    string,
    { record: AbortController; metadata: AbortController; tasks: [record: Promise<void>, metadata: Promise<void>] }
  >();

  const startReaderTask = (read: () => Promise<void>): Promise<void> => {
    const task = read();
    void task.catch((error) => {
      deps.log.warn("Workflow reader task stopped unexpectedly", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return task;
  };

  const dispatchRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
    const candidates = await deps.workflows.listRecordEventEnabled(event);
    const failures: Error[] = [];
    const persistFailure = async (
      workflow: PreparedWorkflowTriggerRun["workflow"],
      stage: "filter" | "preparation" | "queue",
      error: string,
    ): Promise<void> => {
      deps.log.warn(`Workflow recordEvent ${stage} failed`, {
        workflowId: workflow.id,
        tableId: event.tableId,
        recordId: event.recordId,
        error,
      });
      try {
        await deps.recordDispatchFailure({
          workflow,
          event,
          triggerKey: eventJobKey(workflow.id, event),
          stage,
          error,
        });
      } catch (persistError) {
        const message = persistError instanceof Error ? persistError.message : String(persistError);
        deps.log.warn("Workflow recordEvent failure could not be persisted", {
          workflowId: workflow.id,
          tableId: event.tableId,
          recordId: event.recordId,
          stage,
          error: message,
        });
        failures.push(new Error(`Workflow ${workflow.id} ${stage} failure could not be persisted: ${message}`));
      }
    };

    for (const workflow of candidates) {
      let matched: Awaited<ReturnType<typeof deps.workflows.recordMatchesWorkflowFilter>>;
      try {
        matched = await deps.workflows.recordMatchesWorkflowFilter(workflow, event);
      } catch (error) {
        await persistFailure(workflow, "filter", error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!matched.ok) {
        await persistFailure(workflow, "filter", matched.error.message);
        continue;
      }
      if (!matched.data) continue;
      let prepared: Awaited<ReturnType<typeof deps.prepareRecordEvent>>;
      try {
        prepared = await deps.prepareRecordEvent({
          workflowId: workflow.id,
          event,
          actorUserId: event.actorId,
        });
      } catch (error) {
        await persistFailure(workflow, "preparation", error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!prepared.ok) {
        await persistFailure(workflow, "preparation", prepared.error.message);
        continue;
      }
      const item = prepared.data;
      try {
        await deps.queuePreparedRun(
          {
            workflow: item.workflow,
            workflowCatalog: item.workflowCatalog,
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
            submitFailure: "defer",
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistFailure(workflow, "queue", message);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, `${failures.length} workflow dispatch failures could not be persisted`);
  };

  const commitRecordEvent = async (commit: () => Promise<boolean>): Promise<void> => {
    if (!(await commit())) throw new Error("Workflow record event acknowledgement was not accepted");
  };

  const invalidEventError = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): string => {
    const issue = issues[0];
    const path = issue?.path.length ? `${issue.path.map(String).join(".")}: ` : "";
    return `${path}${issue?.message ?? "record event schema mismatch"}`;
  };

  const serializeInvalidEvent = (data: unknown): string | null => {
    try {
      return JSON.stringify(data) ?? null;
    } catch {
      return null;
    }
  };

  const recordInvalidDelivery = async (input: {
    baseId: string;
    eventId: string;
    payload: string | null;
    error: string;
    commit?: () => Promise<boolean>;
  }): Promise<RecordEventDeliveryFailure> => {
    const failure = await deps.recordInvalidRecordEventDelivery({
      baseId: input.baseId,
      consumerGroup: RECORD_EVENT_CONSUMER_GROUP,
      eventId: input.eventId,
      payload: input.payload,
      error: input.error,
    });
    deps.log.warn(failure.dead ? "Workflow record event moved to dead letter" : "Workflow record event is invalid", {
      baseId: input.baseId,
      eventId: input.eventId,
      attempts: failure.attempts,
      dead: failure.dead,
      error: input.error,
    });
    if (failure.dead && input.commit) await commitRecordEvent(input.commit);
    return failure;
  };

  const processDelivery = async (baseId: string, delivery: TopicDelivery<GridsRecordEvent>): Promise<void> => {
    const parsed = GridsRecordEventSchema.safeParse(delivery.data);
    if (!parsed.success) {
      await recordInvalidDelivery({
        baseId,
        eventId: delivery.eventId,
        payload: serializeInvalidEvent(delivery.data),
        error: invalidEventError(parsed.error.issues),
        commit: delivery.commit,
      });
      return;
    }
    if (parsed.data.baseId !== baseId) {
      await recordInvalidDelivery({
        baseId,
        eventId: delivery.eventId,
        payload: serializeInvalidEvent(delivery.data),
        error: `baseId: expected ${baseId}, received ${parsed.data.baseId}`,
        commit: delivery.commit,
      });
      return;
    }
    await dispatchRecordEvent(parsed.data);
    await commitRecordEvent(delivery.commit);
  };

  const processInvalidTransportDelivery = async (baseId: string, delivery: TopicInvalidDelivery): Promise<void> => {
    await recordInvalidDelivery({
      baseId,
      eventId: delivery.eventId,
      payload: delivery.rawPayload,
      error: delivery.error,
      commit: delivery.commit,
    });
  };

  const startRecordEventReader = (baseId: string, controller: AbortController): Promise<void> => {
    const reader = deps.recordEventReader(RECORD_EVENT_CONSUMER_GROUP);
    if (!reader.reclaim) throw new Error("Installed @valentinkolb/sync does not support topic recovery");
    let reclaimCursor = "0-0";
    return startReaderTask(async () => {
      while (!controller.signal.aborted) {
        try {
          const reclaimed = await reader.reclaim({ tenantId: baseId, cursor: reclaimCursor });
          reclaimCursor = reclaimed.nextCursor;
          for (const entry of reclaimed.entries) {
            try {
              if (entry.kind === "invalid") await processInvalidTransportDelivery(baseId, entry);
              else await processDelivery(baseId, entry.delivery);
            } catch (error) {
              deps.log.warn("Reclaimed workflow record event failed", {
                baseId,
                eventId: entry.kind === "invalid" ? entry.eventId : entry.delivery.eventId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (reclaimCursor !== "0-0") {
            const fresh = await reader.recv({
              tenantId: baseId,
              wait: false,
              signal: controller.signal,
              invalidPayload: "throw",
            });
            if (fresh) await processDelivery(baseId, fresh);
            continue;
          }
          const delivery = await reader.recv({
            tenantId: baseId,
            wait: true,
            timeoutMs: 30_000,
            signal: controller.signal,
            invalidPayload: "throw",
          });
          if (!delivery) continue;
          await processDelivery(baseId, delivery);
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return;
          if (error instanceof TopicPayloadError) {
            try {
              await recordInvalidDelivery({
                baseId,
                eventId: error.eventId,
                payload: error.rawPayload,
                error: error.message,
              });
              continue;
            } catch (persistError) {
              error = persistError;
            }
          }
          deps.log.warn("Workflow record event reader failed", {
            baseId,
            error: error instanceof Error ? error.message : String(error),
          });
          await wait(retryDelayMs, controller.signal);
        }
      }
    });
  };

  const startMetadataReader = (baseId: string, controller: AbortController): Promise<void> => {
    return startReaderTask(async () => {
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
          await wait(retryDelayMs, controller.signal);
        }
      }
    });
  };

  const startBaseReaders = (baseId: string): void => {
    if (baseReaders.has(baseId)) return;
    const record = new AbortController();
    const metadata = new AbortController();
    const tasks: [Promise<void>, Promise<void>] = [startRecordEventReader(baseId, record), startMetadataReader(baseId, metadata)];
    baseReaders.set(baseId, { record, metadata, tasks });
  };

  const stopBaseReaders = async (baseId: string): Promise<void> => {
    const readers = baseReaders.get(baseId);
    if (!readers) return;
    readers.record.abort();
    readers.metadata.abort();
    baseReaders.delete(baseId);
    await Promise.allSettled(readers.tasks);
  };

  const reconcile = async (): Promise<void> => {
    const active = new Set(await deps.workflows.listRecordEventBaseIds());
    const stopping: Promise<void>[] = [];
    for (const baseId of baseReaders.keys()) {
      if (!active.has(baseId)) stopping.push(stopBaseReaders(baseId));
    }
    await Promise.all(stopping);
    for (const baseId of active) startBaseReaders(baseId);
  };

  const stopAll = async (): Promise<void> => Promise.all([...baseReaders.keys()].map(stopBaseReaders)).then(() => undefined);

  return { dispatchRecordEvent, reconcile, stopAll };
};
