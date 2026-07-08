import { logger, trace } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import type { Result } from "@valentinkolb/stdlib";
import { job, scheduler } from "@valentinkolb/sync";
import type { Workflow, WorkflowRun } from "../contracts";
import { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import type { GridsRecordEvent } from "./record-events";
import { recordEventReader } from "./record-events";
import {
  type ExecuteBulkSelectionWorkflowParams,
  executePreparedRun,
  prepareBulkSelection,
  prepareRecordEvent,
  type WorkflowRuntimeInput,
} from "./workflow-runtime";
import * as workflows from "./workflows";

const log = logger("grids:workflows");
const workflowScheduler = scheduler({ id: "grids:workflows" });
const WORKFLOW_JOB_LEASE_MS = 30 * 60 * 1000;
const WORKFLOW_JOB_MAX_RETRIES = 3;
const RECORD_EVENT_CONSUMER_GROUP = "workflow-triggers";
const RUNTIME_RECONCILE_INTERVAL_MS = 15_000;
const RUNTIME_RECONCILE_DEBOUNCE_MS = 250;

type WorkflowTriggerJobInput =
  | PreparedTriggerJobInput<"schedule">
  | PreparedTriggerJobInput<"recordEvent">
  | PreparedTriggerJobInput<"bulkSelection">;

type PreparedTriggerJobInput<T extends "schedule" | "recordEvent" | "bulkSelection"> = {
  workflowId: string;
  runId: string;
  triggerKind: T;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
  triggerInput: WorkflowRuntimeInput;
  resolvedInput: WorkflowRuntimeInput;
};

const workflowJob = job<WorkflowTriggerJobInput, { runId: string | null; status: string }>({
  id: "grids:workflows:trigger",
  defaults: { leaseMs: WORKFLOW_JOB_LEASE_MS, keyTtlMs: 24 * 60 * 60 * 1000 },
  trace: trace.fromSyncJob<WorkflowTriggerJobInput, { runId: string | null; status: string }>({
    name: "Grid workflow trigger",
    source: "grids:workflows:trigger",
    appId: "grids",
    attributes: (event) =>
      "input" in event && event.input
        ? {
            "cloud.grids.workflow_id": event.input.workflowId,
            "cloud.grids.workflow_run_id": event.input.runId,
            "cloud.grids.workflow_trigger": event.input.triggerKind,
          }
        : {},
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    const input = ctx.input;
    const result = await executePreparedRun({
      workflowId: input.workflowId,
      runId: input.runId,
      triggerKind: input.triggerKind,
      actorUserId: input.actorUserId,
      actorGroupIds: input.actorGroupIds,
      serviceAccountId: input.serviceAccountId,
      triggerInput: input.triggerInput,
      resolvedInput: input.resolvedInput,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      heartbeat: () => ctx.heartbeat({ leaseMs: WORKFLOW_JOB_LEASE_MS }),
    });
    if (!result.ok) {
      log.warn("Workflow trigger execution failed before run completion", {
        workflowId: input.workflowId,
        triggerKind: input.triggerKind,
        error: result.error.message,
      });
      return { runId: null, status: "failed" };
    }
    return { runId: result.data.id, status: result.data.status };
  },
  after: async ({ ctx }) => {
    if (!ctx.error) return;
    if (ctx.failureCount < WORKFLOW_JOB_MAX_RETRIES) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
      return;
    }
    await workflows.finishRun(ctx.input.runId, {
      status: "failed",
      error: ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
    });
  },
});

let started = false;
let reconcilePromise: Promise<void> | null = null;
let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let reconcileDebounce: ReturnType<typeof setTimeout> | null = null;
const baseReaders = new Map<string, { record: AbortController; metadata: AbortController }>();

const scheduleId = (workflowId: string): string => `workflow:${workflowId}`;
const scheduleTriggerKey = (workflowId: string, trigger: "cron" | "manual", slotTs: number, runNumber: number): string =>
  `schedule:${workflowId}:${trigger}:${slotTs}:${runNumber}`;
const eventJobKey = (workflowId: string, event: GridsRecordEvent): string =>
  `${workflowId}:${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

const getScheduleTimezone = async (workflow: Workflow): Promise<string> => {
  const schedule = workflow.compiled.triggers.schedule;
  if (schedule?.timezone) return schedule.timezone;
  const configured = String((await settingsGet<string>("app.timezone")) || "").trim();
  return normalizeTimeZone(configured, "Europe/Berlin");
};

const createSchedule = async (workflow: Workflow): Promise<void> => {
  const schedule = workflow.compiled.triggers.schedule;
  if (!workflow.enabled || !schedule) {
    await workflowScheduler.delete({ id: scheduleId(workflow.id) });
    return;
  }
  const tz = await getScheduleTimezone(workflow);
  await workflowScheduler.create({
    id: scheduleId(workflow.id),
    cron: schedule.cron,
    tz,
    trace: trace.fromSyncSchedule<void>({
      name: "Grid workflow schedule",
      source: "grids:workflows:schedule",
      appId: "grids",
      attributes: {
        "cloud.grids.workflow_id": workflow.id,
        "cloud.grids.base_id": workflow.baseId,
      },
    }),
    process: async ({ ctx }) => {
      const triggerInput = { slotTs: ctx.slotTs, trigger: ctx.trigger, runNumber: ctx.runNumber };
      const run = await workflows.createRun({
        workflowId: workflow.id,
        baseId: workflow.baseId,
        actorUserId: workflow.ownerUserId,
        serviceAccountId: null,
        triggerKind: "schedule",
        triggerKey: scheduleTriggerKey(workflow.id, ctx.trigger, ctx.slotTs, ctx.runNumber),
        triggerInput,
        resolvedInput: {},
      });
      if (run.status !== "queued") return;
      await workflowJob.submit({
        key: `schedule:${run.id}`,
        leaseMs: WORKFLOW_JOB_LEASE_MS,
        input: {
          workflowId: workflow.id,
          runId: run.id,
          triggerKind: "schedule",
          actorUserId: workflow.ownerUserId,
          actorGroupIds: [],
          serviceAccountId: null,
          triggerInput,
          resolvedInput: {},
        },
      });
    },
    after: async ({ ctx }) => {
      if (ctx.error && ctx.failureCount < WORKFLOW_JOB_MAX_RETRIES) {
        ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
      }
    },
  });
  log.info("Workflow schedule registered", {
    workflowId: workflow.id,
    cron: schedule.cron,
    timezone: tz,
  });
};

const registerAll = async (): Promise<void> => {
  const scheduled = await workflows.listScheduledEnabled();
  const activeIds = new Set(scheduled.map((workflow) => scheduleId(workflow.id)));
  for (const workflow of scheduled) {
    try {
      await createSchedule(workflow);
    } catch (error) {
      log.warn("Workflow schedule registration failed", {
        workflowId: workflow.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const registered = await workflowScheduler.list();
  for (const item of registered) {
    if (item.id.startsWith("workflow:") && !activeIds.has(item.id)) {
      await workflowScheduler.delete({ id: item.id });
      log.info("Orphan workflow schedule removed", { scheduleId: item.id });
    }
  }
};

const dispatchRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
  const candidates = await workflows.listRecordEventEnabled(event);
  for (const workflow of candidates) {
    const matched = await workflows.recordMatchesWorkflowFilter(workflow, event);
    if (!matched.ok) {
      log.warn("Workflow recordEvent filter failed", {
        workflowId: workflow.id,
        tableId: event.tableId,
        recordId: event.recordId,
        error: matched.error.message,
      });
      continue;
    }
    if (!matched.data) continue;
    const prepared = await prepareRecordEvent({
      workflowId: workflow.id,
      event,
      actorUserId: event.actorId,
    });
    if (!prepared.ok) {
      log.warn("Workflow recordEvent preparation failed", {
        workflowId: workflow.id,
        tableId: event.tableId,
        recordId: event.recordId,
        error: prepared.error.message,
      });
      continue;
    }
    const item = prepared.data;
    const run = await workflows.createRun({
      workflowId: item.workflow.id,
      baseId: item.workflow.baseId,
      actorUserId: item.actorUserId,
      serviceAccountId: item.serviceAccountId,
      triggerKind: "recordEvent",
      triggerKey: eventJobKey(workflow.id, event),
      triggerInput: item.triggerInput,
      resolvedInput: item.resolvedInput,
    });
    if (run.status !== "queued") continue;
    await workflowJob.submit({
      key: `recordEvent:${run.id}`,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      input: {
        workflowId: item.workflow.id,
        runId: run.id,
        triggerKind: "recordEvent",
        actorUserId: item.actorUserId,
        actorGroupIds: item.actorGroupIds,
        serviceAccountId: item.serviceAccountId,
        triggerInput: item.triggerInput,
        resolvedInput: item.resolvedInput,
      },
    });
  }
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const startRecordEventReader = (baseId: string, controller: AbortController): void => {
  const reader = recordEventReader(RECORD_EVENT_CONSUMER_GROUP);
  void (async () => {
    while (!controller.signal.aborted) {
      try {
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
        log.warn("Workflow record event reader failed", {
          baseId,
          error: error instanceof Error ? error.message : String(error),
        });
        await wait(1_000);
      }
    }
  })();
};

const startMetadataReader = (baseId: string, controller: AbortController): void => {
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const after = await latestMetadataEventCursor(baseId);
        for await (const event of liveMetadataEvents({ baseId, after, signal: controller.signal })) {
          if (event.data.resource.kind === "workflow" || event.data.resource.kind === "base") scheduleRuntimeReconcile();
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        log.warn("Workflow metadata reader failed", {
          baseId,
          error: error instanceof Error ? error.message : String(error),
        });
        await wait(1_000);
      }
    }
  })();
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

const reconcileBaseReaders = async (): Promise<void> => {
  const active = new Set(await workflows.listRuntimeBaseIds());
  for (const baseId of baseReaders.keys()) {
    if (!active.has(baseId)) stopBaseReaders(baseId);
  }
  for (const baseId of active) startBaseReaders(baseId);
};

const reconcileRuntime = async (): Promise<void> => {
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = (async () => {
    await registerAll();
    await reconcileBaseReaders();
  })().finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
};

function scheduleRuntimeReconcile(): void {
  if (!started) return;
  if (reconcileDebounce) clearTimeout(reconcileDebounce);
  reconcileDebounce = setTimeout(() => {
    reconcileDebounce = null;
    void reconcileRuntime().catch((error) => {
      log.warn("Workflow runtime reconcile failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, RUNTIME_RECONCILE_DEBOUNCE_MS);
}

const queueBulkSelection = async (params: ExecuteBulkSelectionWorkflowParams): Promise<Result<WorkflowRun>> => {
  const prepared = await prepareBulkSelection(params);
  if (!prepared.ok) return prepared;
  const item = prepared.data;
  const run = await workflows.createRun({
    workflowId: item.workflow.id,
    baseId: item.workflow.baseId,
    actorUserId: item.actorUserId,
    serviceAccountId: item.serviceAccountId,
    triggerKind: "bulkSelection",
    triggerInput: item.triggerInput,
    resolvedInput: item.resolvedInput,
  });
  await workflowJob.submit({
    key: `bulk:${run.id}`,
    leaseMs: WORKFLOW_JOB_LEASE_MS,
    input: {
      workflowId: item.workflow.id,
      runId: run.id,
      triggerKind: "bulkSelection",
      actorUserId: item.actorUserId,
      actorGroupIds: item.actorGroupIds,
      serviceAccountId: item.serviceAccountId,
      triggerInput: item.triggerInput,
      resolvedInput: item.resolvedInput,
    },
  });
  return { ok: true, data: run };
};

const ensureStarted = () => {
  if (!started) {
    workflowScheduler.start();
    started = true;
    reconcileInterval = setInterval(() => {
      void reconcileRuntime().catch((error) => {
        log.warn("Workflow periodic reconcile failed", { error: error instanceof Error ? error.message : String(error) });
      });
    }, RUNTIME_RECONCILE_INTERVAL_MS);
  }
};

export const workflowTriggerRuntime = {
  start: async (): Promise<void> => {
    ensureStarted();
    await reconcileRuntime();
  },

  stop: async (): Promise<void> => {
    if (!started) return;
    if (reconcileInterval) clearInterval(reconcileInterval);
    reconcileInterval = null;
    if (reconcileDebounce) clearTimeout(reconcileDebounce);
    reconcileDebounce = null;
    for (const baseId of [...baseReaders.keys()]) stopBaseReaders(baseId);
    await workflowScheduler.stop();
    workflowJob.stop();
    started = false;
    reconcilePromise = null;
  },

  sync: async (workflow: Workflow): Promise<void> => {
    ensureStarted();
    await createSchedule(workflow);
    scheduleRuntimeReconcile();
  },

  delete: async (workflowId: string): Promise<void> => {
    await workflowScheduler.delete({ id: scheduleId(workflowId) });
    scheduleRuntimeReconcile();
  },

  dispatchRecordEvent,

  queueBulkSelection,
};
