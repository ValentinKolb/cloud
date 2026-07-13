import { logger, trace } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, scheduler } from "@valentinkolb/sync";
import type { Workflow, WorkflowRun, WorkflowTriggerKind } from "../contracts";
import * as bases from "./bases";
import { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import { reclaimRecordEventDeliveries, recordEventReader } from "./record-events";
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
import { createWorkflowTriggerReaderRuntime } from "./workflow-trigger-readers";
import { createWorkflowScheduleRuntime } from "./workflow-trigger-schedules";
import type { RecoverableQueuedWorkflowRun } from "./workflows";
import * as workflowStore from "./workflows";

const defaultLog = logger("grids:workflows");
const defaultWorkflowScheduler = scheduler({ id: "grids:workflows" });
const WORKFLOW_JOB_LEASE_MS = 30 * 60 * 1000;
const WORKFLOW_JOB_MAX_RETRIES = 3;
const RUNTIME_RECONCILE_INTERVAL_MS = 15_000;
const RUNTIME_RECONCILE_DEBOUNCE_MS = 250;

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
  workflowJob?: typeof defaultWorkflowJob;
  loadWorkflowPrincipal?: typeof workflowOwnerPrincipal;
  workflows?: Pick<
    typeof workflowStore,
    | "createWorkflowRun"
    | "claimRecoverableRuns"
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
  loadWorkflowCatalogSnapshot?: (baseId: string) => Promise<import("./workflows").WorkflowCatalogSnapshot>;
};

export const createWorkflowTriggerRuntime = (deps: WorkflowTriggerRuntimeDeps = {}) => {
  const log = deps.log ?? defaultLog;
  const workflowScheduler = deps.workflowScheduler ?? defaultWorkflowScheduler;
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
  const loadWorkflowCatalogSnapshot =
    deps.loadWorkflowCatalogSnapshot ??
    (async (baseId: string) => workflowStore.snapshotWorkflowCatalog(await workflowStore.loadWorkflowCatalog(baseId)));

  let started = false;
  let reconcilePromise: Promise<void> | null = null;
  let reconcileInterval: ReturnType<typeof setInterval> | null = null;
  let reconcileDebounce: ReturnType<typeof setTimeout> | null = null;

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

  const queuePreparedRun = async (item: PreparedWorkflowTriggerRun, options: { triggerKey?: string } = {}): Promise<WorkflowRun> => {
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
        return failQueuedAttempt(run, `Could not enqueue workflow run: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return run;
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
        await failQueuedAttempt(run, `Could not recover workflow run: ${error instanceof Error ? error.message : String(error)}`);
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
    scheduleReconcile: scheduleRuntimeReconcile,
  });

  const reconcileRuntime = async (): Promise<void> => {
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      await recoverStaleQueuedRuns();
      await schedules.registerAll();
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
    const workflow = await workflows.get(workflowId);
    if (!workflow) return fail(err.notFound("workflow"));
    if (!workflow.enabled) return fail(err.badInput("workflow is disabled"));
    if (!workflow.compiled.triggers.schedule) return fail(err.badInput("workflow does not define a schedule trigger"));
    ensureStarted();
    await schedules.create(workflow);
    await schedules.runNow(workflowId);
    return ok();
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
      await reconcileRuntime();
    },

    stop: async (): Promise<void> => {
      if (!started) return;
      if (reconcileInterval) clearInterval(reconcileInterval);
      reconcileInterval = null;
      if (reconcileDebounce) clearTimeout(reconcileDebounce);
      reconcileDebounce = null;
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
      await schedules.create(workflow);
      scheduleRuntimeReconcile();
    },

    delete: async (workflowId: string): Promise<void> => {
      await schedules.delete(workflowId);
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
