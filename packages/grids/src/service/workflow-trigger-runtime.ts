import { logger, trace } from "@valentinkolb/cloud/services";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, scheduler } from "@valentinkolb/sync";
import type { Workflow, WorkflowRun, WorkflowTriggerKind } from "../contracts";
import * as bases from "./bases";
import { latestMetadataEventCursor, liveMetadataEvents } from "./metadata-events";
import type { GridsRecordEvent } from "./record-events";
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
  type WorkflowRuntimeInput,
  type WorkflowTriggerAuthorization,
  workflowOwnerPrincipal,
} from "./workflow-runtime";
import type { RecoverableQueuedWorkflowRun } from "./workflows";
import * as workflowStore from "./workflows";

const defaultLog = logger("grids:workflows");
const defaultWorkflowScheduler = scheduler({ id: "grids:workflows" });
const WORKFLOW_JOB_LEASE_MS = 30 * 60 * 1000;
const WORKFLOW_JOB_MAX_RETRIES = 3;
const RECORD_EVENT_CONSUMER_GROUP = "workflow-triggers";
const RUNTIME_RECONCILE_INTERVAL_MS = 15_000;
const RUNTIME_RECONCILE_DEBOUNCE_MS = 250;

type QueuedWorkflowTriggerKind = Extract<
  WorkflowTriggerKind,
  "form" | "api" | "scanner" | "bulkSelection" | "dashboardButton" | "schedule" | "recordEvent"
>;

type DirectWorkflowTriggerKind = Extract<WorkflowTriggerKind, "form" | "api" | "dashboardButton">;

type WorkflowTriggerJobInput = PreparedTriggerJobInput<QueuedWorkflowTriggerKind>;

type PreparedTriggerJobInput<T extends QueuedWorkflowTriggerKind> = {
  workflowId: string;
  runId: string;
  triggerKind: T;
  actorUserId: string | null;
  actorGroupIds: string[];
  serviceAccountId: string | null;
  triggerInput: WorkflowRuntimeInput;
  resolvedInput: WorkflowRuntimeInput;
  authorization: WorkflowTriggerAuthorization;
};

const parseStoredAuthorization = (value: unknown): WorkflowTriggerAuthorization | null => {
  if (!value || typeof value !== "object") return null;
  const authorization = value as Record<string, unknown>;
  if (authorization.kind === "workflow") return { kind: "workflow" };
  if (
    authorization.kind === "dashboard-widget" &&
    typeof authorization.dashboardId === "string" &&
    authorization.dashboardId.length > 0 &&
    typeof authorization.dashboardWidgetId === "string" &&
    authorization.dashboardWidgetId.length > 0
  ) {
    return {
      kind: "dashboard-widget",
      dashboardId: authorization.dashboardId,
      dashboardWidgetId: authorization.dashboardWidgetId,
    };
  }
  return null;
};

const defaultWorkflowJob = job<WorkflowTriggerJobInput, { runId: string | null; status: string }>({
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
      authorization: input.authorization,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      heartbeat: () => ctx.heartbeat({ leaseMs: WORKFLOW_JOB_LEASE_MS }),
    });
    if (!result.ok) {
      defaultLog.warn("Workflow trigger execution failed before run completion", {
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
    await workflowStore.finishRun(ctx.input.runId, {
      status: "failed",
      error: ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
    });
  },
});

const SCHEDULE_ID_PREFIX = "grids:workflow:";
const LEGACY_SCHEDULE_ID_PREFIX = "workflow:";
const scheduleId = (workflowId: string): string => `${SCHEDULE_ID_PREFIX}${workflowId}`;
const scheduleSource = (workflowId: string): string => `${SCHEDULE_ID_PREFIX}${workflowId}:schedule`;
const isManagedScheduleId = (id: string): boolean => id.startsWith(SCHEDULE_ID_PREFIX);
const isLegacyScheduleId = (id: string): boolean => id.startsWith(LEGACY_SCHEDULE_ID_PREFIX);
const scheduleTriggerKey = (workflowId: string, trigger: "cron" | "manual", slotTs: number, runNumber: number): string =>
  `schedule:${workflowId}:${trigger}:${slotTs}:${runNumber}`;
const eventJobKey = (workflowId: string, event: GridsRecordEvent): string =>
  `${workflowId}:${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

type WorkflowTriggerRuntimeDeps = {
  log?: typeof defaultLog;
  workflowScheduler?: typeof defaultWorkflowScheduler;
  workflowJob?: typeof defaultWorkflowJob;
  loadWorkflowPrincipal?: typeof workflowOwnerPrincipal;
  workflows?: Pick<
    typeof workflowStore,
    | "createWorkflowRun"
    | "claimStaleQueuedRuns"
    | "failQueuedRunAttempt"
    | "get"
    | "getWorkflowRun"
    | "listRuntimeBaseIds"
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

  let started = false;
  let reconcilePromise: Promise<void> | null = null;
  let reconcileInterval: ReturnType<typeof setInterval> | null = null;
  let reconcileDebounce: ReturnType<typeof setTimeout> | null = null;
  const baseReaders = new Map<string, { record: AbortController; metadata: AbortController }>();

  const submitWorkflowJob = async (workflow: Workflow, run: RecoverableQueuedWorkflowRun): Promise<void> => {
    const authorization = parseStoredAuthorization(run.authorization);
    if (!authorization) throw new Error("stored authorization is invalid");
    await workflowJob.submit({
      key: `run:${run.id}:attempt:${run.queueAttempts}`,
      leaseMs: WORKFLOW_JOB_LEASE_MS,
      input: {
        workflowId: workflow.id,
        runId: run.id,
        triggerKind: run.triggerKind as QueuedWorkflowTriggerKind,
        actorUserId: run.actorUserId,
        actorGroupIds: run.actorGroupIds,
        serviceAccountId: run.serviceAccountId,
        triggerInput: run.triggerInput ?? {},
        resolvedInput: run.resolvedInput ?? {},
        authorization,
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
    const run = await workflows.createWorkflowRun({
      workflowId: item.workflow.id,
      baseId: item.workflow.baseId,
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
        await submitWorkflowJob(item.workflow, run);
      } catch (error) {
        return failQueuedAttempt(run, `Could not enqueue workflow run: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return run;
  };

  const recoverStaleQueuedRuns = async (): Promise<void> => {
    const runs = await workflows.claimStaleQueuedRuns();
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
        await submitWorkflowJob(workflow, run);
      } catch (error) {
        await failQueuedAttempt(run, `Could not recover workflow run: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const getScheduleTimezone = async (workflow: Workflow): Promise<string> => {
    const schedule = workflow.compiled.triggers.schedule;
    if (schedule?.timezone) return schedule.timezone;
    const configured = String((await settingsGetImpl<string>("app.timezone")) || "").trim();
    return normalizeTimeZoneImpl(configured, "Europe/Berlin");
  };

  const createSchedule = async (workflow: Workflow): Promise<void> => {
    const schedule = workflow.compiled.triggers.schedule;
    if (!workflow.enabled || !schedule) {
      await workflowScheduler.delete({ id: scheduleId(workflow.id) });
      return;
    }
    const tz = await getScheduleTimezone(workflow);
    const base = await getBaseImpl(workflow.baseId);
    const source = scheduleSource(workflow.id);
    await workflowScheduler.create({
      id: scheduleId(workflow.id),
      cron: schedule.cron,
      tz,
      meta: {
        appId: "grids",
        family: "grids:workflows",
        label: workflow.name,
        source,
        resourceKind: "workflow",
        resourceId: workflow.id,
        resourceLabel: base ? `${base.name} / ${workflow.name}` : workflow.name,
        ...(base ? { detailHref: `/app/grids/${base.shortId}/workflows/${workflow.shortId}` } : {}),
      },
      trace: trace.fromSyncSchedule<{ runId: string; queued: boolean; status: string }>({
        name: "Grid workflow schedule",
        source,
        appId: "grids",
        attributes: {
          "cloud.grids.workflow_id": workflow.id,
          "cloud.grids.base_id": workflow.baseId,
        },
        summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
      }),
      process: async ({ ctx }) => {
        const triggerInput = { slotTs: ctx.slotTs, trigger: ctx.trigger, runNumber: ctx.runNumber };
        const principal = await loadWorkflowPrincipal(workflow);
        const item: PreparedWorkflowTriggerRun = {
          workflow,
          triggerKind: "schedule",
          actorUserId: principal.actorUserId,
          actorGroupIds: principal.actorGroupIds,
          serviceAccountId: principal.serviceAccountId,
          triggerInput,
          resolvedInput: {},
          authorization: { kind: "workflow" },
        };
        const run = await queuePreparedRun(item, {
          triggerKey: scheduleTriggerKey(workflow.id, ctx.trigger, ctx.slotTs, ctx.runNumber),
        });
        return { runId: run.id, queued: run.status === "queued", status: run.status };
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
      if (isLegacyScheduleId(item.id) || (isManagedScheduleId(item.id) && !activeIds.has(item.id))) {
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
      const prepared = await prepareRecordEventImpl({
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
      await queuePreparedRun(
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

  const isAbortError = (error: unknown): boolean =>
    error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const startRecordEventReader = (baseId: string, controller: AbortController): void => {
    const reader = recordEventReaderImpl(RECORD_EVENT_CONSUMER_GROUP);
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const reclaimed = await reclaimRecordEventDeliveriesImpl(baseId, RECORD_EVENT_CONSUMER_GROUP);
          for (const delivery of reclaimed) {
            try {
              await dispatchRecordEvent(delivery.data);
              await delivery.commit();
            } catch (error) {
              log.warn("Reclaimed workflow record event failed", {
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
          const after = await latestMetadataEventCursorImpl(baseId);
          for await (const event of liveMetadataEventsImpl({ baseId, after, signal: controller.signal })) {
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
      await recoverStaleQueuedRuns();
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
    const prepared = await prepareBulkSelectionImpl(params);
    if (!prepared.ok) return prepared;
    const item = prepared.data;
    return ok(
      await queuePreparedRun(
        {
          workflow: item.workflow,
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
    await createSchedule(workflow);
    await workflowScheduler.runNow({ id: scheduleId(workflowId) });
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
      for (const baseId of [...baseReaders.keys()]) stopBaseReaders(baseId);
      await workflowScheduler.stop();
      workflowJob.stop();
      started = false;
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

    queueDirectRun,
    queueDashboardRun,
    queueBulkSelection,
    queueScanner,
    queueDashboardScanner,
    runScheduledNow,
  };
};

export const workflowTriggerRuntime = createWorkflowTriggerRuntime();
