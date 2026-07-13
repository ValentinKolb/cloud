import { logger, trace } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, mutex, scheduler } from "@valentinkolb/sync";
import type { Workflow, WorkflowRun, WorkflowTriggerKind } from "../contracts";
import * as bases from "./bases";
import { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import { type GridsRecordEvent, reclaimRecordEventDeliveries, recordEventReader } from "./record-events";
import {
  type ExecuteBulkSelectionWorkflowParams,
  type ExecuteScannerWorkflowParams,
  type ExecuteWorkflowParams,
  executePreparedRun,
  type PreparedWorkflowTriggerRun,
  prepareBulkSelection,
  prepareDashboardScanner,
  prepareDashboardWorkflowTriggerRun,
  prepareRecordEvent,
  prepareScanner,
  prepareWorkflowTriggerRun,
  workflowOwnerPrincipal,
} from "./workflow-runtime";
import { latestWorkflowRuntimeEventCursor, liveWorkflowRuntimeEvents } from "./workflow-runtime-events";
import { createWorkflowTriggerReaderRuntime } from "./workflow-trigger-readers";
import { createWorkflowScheduleRuntime } from "./workflow-trigger-schedules";
import type { RecoverableQueuedWorkflowRun } from "./workflows";
import * as workflowStore from "./workflows";

const defaultLog = logger("grids:workflows");
const defaultWorkflowScheduler = scheduler({ id: "grids:workflows" });
const defaultWorkflowSyncMutex = mutex({
  id: "grids:workflow-runtime-sync",
  defaultTtl: 30_000,
  retryCount: 20,
  retryDelay: 50,
});
const WORKFLOW_JOB_LEASE_MS = 30 * 60 * 1000;
const WORKFLOW_JOB_MAX_RETRIES = 3;
const RUNTIME_RECONCILE_INTERVAL_MS = 60_000;
const RUNTIME_RECONCILE_DEBOUNCE_MS = 250;
const RUNTIME_EVENT_RETRY_DELAY_MS = 1_000;

type DirectWorkflowTriggerKind = Extract<WorkflowTriggerKind, "form" | "api" | "dashboardButton">;

type WorkflowTriggerJobInput = {
  runId: string;
  queueAttempt: number;
};

const defaultWorkflowJob = job<WorkflowTriggerJobInput, { runId: string | null; status: string }>({
  id: "grids:workflows:trigger:v2",
  defaults: { leaseMs: WORKFLOW_JOB_LEASE_MS, keyTtlMs: 24 * 60 * 60 * 1000 },
  trace: trace.fromSyncJob<WorkflowTriggerJobInput, { runId: string | null; status: string }>({
    name: "Grid workflow trigger",
    source: "grids:workflows:trigger:v2",
    appId: "grids",
    attributes: (event) =>
      "input" in event && event.input
        ? {
            "cloud.grids.workflow_run_id": event.input.runId,
          }
        : {},
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    const input = ctx.input;
    const result = await executePreparedRun({
      runId: input.runId,
      queueAttempt: input.queueAttempt,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      heartbeat: () => ctx.heartbeat({ leaseMs: WORKFLOW_JOB_LEASE_MS }),
    });
    if (!result.ok) {
      defaultLog.warn("Workflow trigger execution failed before run completion", {
        runId: input.runId,
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
    await workflowStore.failQueuedRunAttempt(
      ctx.input.runId,
      ctx.input.queueAttempt,
      ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
    );
  },
});

type WorkflowTriggerRuntimeDeps = {
  log?: typeof defaultLog;
  workflowScheduler?: typeof defaultWorkflowScheduler;
  workflowSyncMutex?: typeof defaultWorkflowSyncMutex;
  workflowJob?: typeof defaultWorkflowJob;
  loadWorkflowPrincipal?: typeof workflowOwnerPrincipal;
  workflows?: Pick<
    typeof workflowStore,
    | "createWorkflowRun"
    | "claimRecoverableRuns"
    | "createFailedWorkflowRun"
    | "failQueuedRunAttempt"
    | "get"
    | "getWorkflowRun"
    | "listRecordEventBaseIds"
    | "listRecordEventEnabled"
    | "listScheduledEnabled"
    | "recordMatchesWorkflowFilter"
  >;
  prepareBulkSelection?: typeof prepareBulkSelection;
  prepareRecordEvent?: typeof prepareRecordEvent;
  prepareScanner?: typeof prepareScanner;
  prepareDashboardScanner?: typeof prepareDashboardScanner;
  prepareWorkflowTriggerRun?: typeof prepareWorkflowTriggerRun;
  prepareDashboardWorkflowTriggerRun?: typeof prepareDashboardWorkflowTriggerRun;
  getBase?: typeof bases.get;
  settingsGet?: typeof settingsGet;
  normalizeTimeZone?: typeof normalizeTimeZone;
  recordEventReader?: typeof recordEventReader;
  reclaimRecordEventDeliveries?: typeof reclaimRecordEventDeliveries;
  latestMetadataEventCursor?: typeof latestMetadataEventCursor;
  liveMetadataEvents?: typeof liveMetadataEvents;
  latestWorkflowRuntimeEventCursor?: typeof latestWorkflowRuntimeEventCursor;
  liveWorkflowRuntimeEvents?: typeof liveWorkflowRuntimeEvents;
  runtimeEventRetryDelayMs?: number;
  loadWorkflowCatalogSnapshot?: (baseId: string) => Promise<import("./workflows").WorkflowCatalogSnapshot>;
};

export const createWorkflowTriggerRuntime = (deps: WorkflowTriggerRuntimeDeps = {}) => {
  const log = deps.log ?? defaultLog;
  const workflowScheduler = deps.workflowScheduler ?? defaultWorkflowScheduler;
  const workflowSyncMutex = deps.workflowSyncMutex ?? defaultWorkflowSyncMutex;
  const workflowJob = deps.workflowJob ?? defaultWorkflowJob;
  const workflows = deps.workflows ?? workflowStore;
  const prepareBulkSelectionImpl = deps.prepareBulkSelection ?? prepareBulkSelection;
  const prepareRecordEventImpl = deps.prepareRecordEvent ?? prepareRecordEvent;
  const prepareScannerImpl = deps.prepareScanner ?? prepareScanner;
  const prepareDashboardScannerImpl = deps.prepareDashboardScanner ?? prepareDashboardScanner;
  const prepareWorkflowTriggerRunImpl = deps.prepareWorkflowTriggerRun ?? prepareWorkflowTriggerRun;
  const prepareDashboardWorkflowTriggerRunImpl = deps.prepareDashboardWorkflowTriggerRun ?? prepareDashboardWorkflowTriggerRun;
  const loadWorkflowPrincipal = deps.loadWorkflowPrincipal ?? workflowOwnerPrincipal;
  const getBaseImpl = deps.getBase ?? bases.get;
  const settingsGetImpl = deps.settingsGet ?? settingsGet;
  const normalizeTimeZoneImpl = deps.normalizeTimeZone ?? normalizeTimeZone;
  const recordEventReaderImpl = deps.recordEventReader ?? recordEventReader;
  const reclaimRecordEventDeliveriesImpl = deps.reclaimRecordEventDeliveries ?? reclaimRecordEventDeliveries;
  const latestMetadataEventCursorImpl = deps.latestMetadataEventCursor ?? latestMetadataEventCursor;
  const liveMetadataEventsImpl = deps.liveMetadataEvents ?? liveMetadataEvents;
  const latestWorkflowRuntimeEventCursorImpl = deps.latestWorkflowRuntimeEventCursor ?? latestWorkflowRuntimeEventCursor;
  const liveWorkflowRuntimeEventsImpl = deps.liveWorkflowRuntimeEvents ?? liveWorkflowRuntimeEvents;
  const runtimeEventRetryDelayMs = deps.runtimeEventRetryDelayMs ?? RUNTIME_EVENT_RETRY_DELAY_MS;
  const loadWorkflowCatalogSnapshot =
    deps.loadWorkflowCatalogSnapshot ??
    (async (baseId: string) => workflowStore.snapshotWorkflowCatalog(await workflowStore.loadWorkflowCatalog(baseId)));

  let started = false;
  let reconcilePromise: Promise<void> | null = null;
  let reconcileInterval: ReturnType<typeof setInterval> | null = null;
  let reconcileDebounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleRepairTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let runtimeEventController: AbortController | null = null;
  let runtimeEventTask: Promise<void> | null = null;

  const submitWorkflowJob = async (run: RecoverableQueuedWorkflowRun): Promise<void> => {
    await workflowJob.submit({
      key: `run:${run.id}:attempt:${run.queueAttempts}`,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      input: {
        runId: run.id,
        queueAttempt: run.queueAttempts,
      },
    });
  };

  const failQueuedAttempt = async (run: RecoverableQueuedWorkflowRun, message: string): Promise<WorkflowRun> => {
    const failed = await workflows.failQueuedRunAttempt(run.id, run.queueAttempts, message);
    if (failed) return failed;
    const current = await workflows.getWorkflowRun(run.id);
    if (!current) throw err.notFound("workflow run");
    return current;
  };

  const queuePreparedRun = async (
    item: PreparedWorkflowTriggerRun,
    options: { triggerKey?: string; submitFailure?: "defer" | "fail" } = {},
  ): Promise<WorkflowRun> => {
    const workflowCatalog = item.workflowCatalog ?? (await loadWorkflowCatalogSnapshot(item.workflow.baseId));
    const run = await workflows.createWorkflowRun({
      workflowId: item.workflow.id,
      baseId: item.workflow.baseId,
      workflowDefinition: item.workflow.compiled,
      workflowCatalog,
      actorUserId: item.actorUserId,
      actorGroupIds: item.actorGroupIds,
      serviceAccountId: item.serviceAccountId,
      authorization: item.authorization,
      triggerKind: item.triggerKind,
      triggerKey: options.triggerKey,
      triggerInput: item.triggerInput,
      resolvedInput: item.resolvedInput,
    });
    if (run.status === "queued") {
      try {
        await submitWorkflowJob(run);
      } catch (error) {
        if (options.submitFailure === "defer") {
          log.warn("Workflow run remains queued after submission failure", {
            runId: run.id,
            workflowId: run.workflowId,
            error: error instanceof Error ? error.message : String(error),
          });
          return run;
        }
        return failQueuedAttempt(run, `Could not enqueue workflow run: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return run;
  };

  const recordDispatchFailure = async (input: {
    workflow: Workflow;
    event: GridsRecordEvent;
    triggerKey: string;
    stage: "filter" | "preparation" | "queue";
    error: string;
  }): Promise<void> => {
    await workflows.createFailedWorkflowRun({
      workflowId: input.workflow.id,
      baseId: input.workflow.baseId,
      workflowDefinition: input.workflow.compiled,
      workflowCatalog: await loadWorkflowCatalogSnapshot(input.workflow.baseId),
      actorUserId: input.workflow.ownerUserId,
      actorGroupIds: [],
      serviceAccountId: null,
      authorization: { kind: "workflow" },
      triggerKind: "recordEvent",
      triggerKey: input.triggerKey,
      triggerInput: {
        event: input.event.type,
        tableId: input.event.tableId,
        recordId: input.event.recordId,
        version: input.event.version,
        changedFieldIds: input.event.changedFieldIds,
        eventActorUserId: input.event.actorId,
        occurredAt: input.event.occurredAt,
      },
      resolvedInput: {},
      error: `Record event ${input.stage} failed: ${input.error}`,
    });
  };

  const recoverStaleQueuedRuns = async (): Promise<void> => {
    const runs = await workflows.claimRecoverableRuns();
    for (const run of runs) {
      const workflow = run.workflowId ? await workflows.get(run.workflowId) : null;
      if (!workflow || !workflow.enabled) {
        await failQueuedAttempt(
          run,
          workflow ? "Could not recover workflow run: workflow is disabled" : "Could not recover workflow run: workflow no longer exists",
        );
        continue;
      }
      try {
        await submitWorkflowJob(run);
      } catch (error) {
        log.warn("Could not resubmit recoverable workflow run", {
          runId: run.id,
          workflowId: run.workflowId,
          queueAttempt: run.queueAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const schedules = createWorkflowScheduleRuntime({
    log,
    workflowScheduler,
    workflows,
    loadWorkflowPrincipal,
    getBase: getBaseImpl,
    settingsGet: settingsGetImpl,
    normalizeTimeZone: normalizeTimeZoneImpl,
    queuePreparedRun,
    scheduleRepair: scheduleWorkflowRepair,
    maxRetries: WORKFLOW_JOB_MAX_RETRIES,
  });
  const readers = createWorkflowTriggerReaderRuntime({
    log,
    workflows,
    prepareRecordEvent: prepareRecordEventImpl,
    recordEventReader: recordEventReaderImpl,
    reclaimRecordEventDeliveries: reclaimRecordEventDeliveriesImpl,
    latestMetadataEventCursor: latestMetadataEventCursorImpl,
    liveMetadataEvents: liveMetadataEventsImpl,
    queuePreparedRun,
    recordDispatchFailure,
    scheduleReconcile: scheduleRuntimeReconcile,
  });

  const syncCurrentWorkflow = (workflowId: string): Promise<void> =>
    workflowSyncMutex.withLockOrThrow(workflowId, async () => {
      const current = await workflows.get(workflowId);
      if (current) await schedules.create(current);
      else await schedules.delete(workflowId);
    });

  const reconcileSchedules = async (): Promise<void> => {
    const scheduled = await workflows.listScheduledEnabled();
    const activeIds = new Set(scheduled.map((workflow) => workflow.id));
    const registered = await schedules.listManagedWorkflows();
    for (const workflow of scheduled) {
      try {
        await workflowSyncMutex.withLockOrThrow(workflow.id, async () => {
          const registeredRevision = await schedules.getManagedWorkflowRevision(workflow.id);
          if (registeredRevision > workflow.revision) return;
          await schedules.create(workflow);
        });
      } catch (error) {
        log.warn("Workflow schedule reconcile failed", {
          workflowId: workflow.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const { workflowId } of registered) {
      if (!activeIds.has(workflowId)) await syncCurrentWorkflow(workflowId);
    }
  };

  const startRuntimeEventReader = (after: string | null | undefined): void => {
    if (runtimeEventTask) return;
    runtimeEventController = new AbortController();
    const signal = runtimeEventController.signal;
    runtimeEventTask = (async () => {
      let cursor = after;
      while (cursor === undefined && !signal.aborted) {
        try {
          const initialCursor = await latestWorkflowRuntimeEventCursorImpl();
          await reconcileRuntime();
          cursor = initialCursor;
        } catch (error) {
          log.warn("Could not initialize workflow runtime event reader", {
            error: error instanceof Error ? error.message : String(error),
          });
          await Bun.sleep(runtimeEventRetryDelayMs);
        }
      }
      if (signal.aborted) return;
      cursor ??= "0-0";
      while (!signal.aborted) {
        try {
          for await (const event of liveWorkflowRuntimeEventsImpl({ after: cursor, signal })) {
            await syncCurrentWorkflow(event.data.workflowId);
            cursor = event.cursor;
          }
        } catch (error) {
          if (signal.aborted) return;
          log.warn("Workflow runtime event reader failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          await Bun.sleep(runtimeEventRetryDelayMs);
        }
      }
    })().finally(() => {
      runtimeEventTask = null;
      runtimeEventController = null;
    });
  };

  const reconcileRuntime = async (): Promise<void> => {
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      await recoverStaleQueuedRuns();
      await reconcileSchedules();
      await readers.reconcile();
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

  function scheduleWorkflowRepair(workflowId: string): void {
    const pending = scheduleRepairTimers.get(workflowId);
    if (pending) clearTimeout(pending);
    scheduleRepairTimers.set(
      workflowId,
      setTimeout(() => {
        scheduleRepairTimers.delete(workflowId);
        void syncCurrentWorkflow(workflowId).catch((error) => {
          log.warn("Workflow schedule repair failed", {
            workflowId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, 0),
    );
  }

  const queueBulkSelection = async (params: ExecuteBulkSelectionWorkflowParams): Promise<Result<WorkflowRun>> => {
    const prepared = await prepareBulkSelectionImpl(params);
    if (!prepared.ok) return prepared;
    const item = prepared.data;
    return ok(
      await queuePreparedRun(
        {
          workflow: item.workflow,
          workflowCatalog: item.workflowCatalog,
          triggerKind: "bulkSelection",
          actorUserId: item.actorUserId,
          actorGroupIds: item.actorGroupIds,
          serviceAccountId: item.serviceAccountId,
          triggerInput: item.triggerInput,
          resolvedInput: item.resolvedInput,
          authorization: { kind: "workflow" },
        },
        {},
      ),
    );
  };

  const queueDirectRun = async (
    params: ExecuteWorkflowParams & { triggerKind: DirectWorkflowTriggerKind },
  ): Promise<Result<WorkflowRun>> => {
    const prepared = await prepareWorkflowTriggerRunImpl(params);
    if (!prepared.ok) return prepared;
    return ok(await queuePreparedRun(prepared.data));
  };

  const queueDashboardRun = async (
    params: ExecuteWorkflowParams & {
      triggerKind: "dashboardButton";
      dashboardId: string;
      dashboardWidgetId: string;
    },
  ): Promise<Result<WorkflowRun>> => {
    const prepared = await prepareDashboardWorkflowTriggerRunImpl(params);
    if (!prepared.ok) return prepared;
    return ok(await queuePreparedRun(prepared.data));
  };

  const queueScanner = async (params: ExecuteScannerWorkflowParams): Promise<Result<WorkflowRun>> => {
    const prepared = await prepareScannerImpl(params);
    if (!prepared.ok) return prepared;
    return ok(await queuePreparedRun(prepared.data));
  };

  const queueDashboardScanner = async (
    params: ExecuteScannerWorkflowParams & { dashboardId: string; dashboardWidgetId: string },
  ): Promise<Result<WorkflowRun>> => {
    const prepared = await prepareDashboardScannerImpl(params);
    if (!prepared.ok) return prepared;
    return ok(await queuePreparedRun(prepared.data));
  };

  const runScheduledNow = async (workflowId: string): Promise<Result<void>> => {
    ensureStarted();
    return workflowSyncMutex.withLockOrThrow(workflowId, async () => {
      const workflow = await workflows.get(workflowId);
      if (!workflow) return fail(err.notFound("workflow"));
      if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
      if (!workflow.compiled.triggers.schedule) return fail(err.badInput("workflow does not define a schedule trigger"));
      await schedules.create(workflow);
      await schedules.runNow(workflowId);
      return ok();
    });
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

  return {
    start: async (): Promise<void> => {
      ensureStarted();
      let runtimeEventCursor: string | null | undefined;
      try {
        runtimeEventCursor = await latestWorkflowRuntimeEventCursorImpl();
      } catch (error) {
        log.warn("Could not initialize workflow runtime event reader", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await reconcileRuntime();
      startRuntimeEventReader(runtimeEventCursor);
    },

    stop: async (): Promise<void> => {
      if (!started) return;
      if (reconcileInterval) clearInterval(reconcileInterval);
      reconcileInterval = null;
      if (reconcileDebounce) clearTimeout(reconcileDebounce);
      reconcileDebounce = null;
      for (const timer of scheduleRepairTimers.values()) clearTimeout(timer);
      scheduleRepairTimers.clear();
      runtimeEventController?.abort();
      if (runtimeEventTask) await runtimeEventTask;
      if (reconcilePromise) {
        await reconcilePromise.catch((error) => {
          log.warn("Workflow runtime reconcile failed during shutdown", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      await readers.stopAll();
      await workflowScheduler.stop();
      workflowJob.stop();
      started = false;
    },

    sync: async (workflow: Workflow): Promise<void> => {
      ensureStarted();
      await syncCurrentWorkflow(workflow.id);
      scheduleRuntimeReconcile();
    },

    delete: async (workflowId: string): Promise<void> => {
      await syncCurrentWorkflow(workflowId);
      scheduleRuntimeReconcile();
    },

    dispatchRecordEvent: readers.dispatchRecordEvent,

    queueDirectRun,
    queueDashboardRun,
    queueBulkSelection,
    queueScanner,
    queueDashboardScanner,
    runScheduledNow,
  };
};

export const workflowTriggerRuntime = createWorkflowTriggerRuntime();
