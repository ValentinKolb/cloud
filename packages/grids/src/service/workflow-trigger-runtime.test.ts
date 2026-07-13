import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Workflow, WorkflowRun } from "../contracts";
import { createWorkflowTriggerRuntime } from "./workflow-trigger-runtime";
import type { PersistedWorkflowRun, RecoverableQueuedWorkflowRun } from "./workflows";

const workflowId = "11111111-1111-4111-8111-111111111111";
const baseId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const ownerGroupId = "55555555-5555-4555-8555-555555555555";
const base = {
  id: baseId,
  shortId: "bs001",
  name: "Demo base",
  description: null,
  documentProfile: {},
  createdBy: null,
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
};
const workflowCatalog = { tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] };

const scheduledWorkflow = {
  id: workflowId,
  shortId: "wf001",
  baseId,
  name: "Scheduled workflow",
  description: null,
  source: 'triggers:\n  schedule:\n    cron: "0 8 * * *"\nsteps: []',
  compiled: {
    triggers: { schedule: { cron: "0 8 * * *" } },
    steps: [],
  },
  enabled: true,
  position: 0,
  revision: 1,
  ownerUserId: "44444444-4444-4444-8444-444444444444",
  deletedAt: null,
  createdAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
} satisfies Workflow;

const workflowRun = {
  id: runId,
  workflowId,
  baseId,
  actorUserId: scheduledWorkflow.ownerUserId,
  actorGroupIds: [],
  serviceAccountId: null,
  authorization: { kind: "workflow" },
  triggerKind: "schedule",
  triggerInput: {},
  resolvedInput: {},
  status: "queued",
  error: null,
  resultMessage: null,
  createdAt: "2026-07-08T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  queueAttempts: 0,
  workflowDefinition: scheduledWorkflow.compiled,
  workflowCatalog,
} satisfies PersistedWorkflowRun;

const schedulerState = {
  created: [] as Array<{
    id: string;
    cron: string;
    tz?: string;
    meta?: Record<string, unknown>;
    process: (cfg: { ctx: never }) => Promise<unknown> | unknown;
    after?: (cfg: { ctx: never }) => Promise<void> | void;
  }>,
  deleted: [] as string[],
  listed: [] as Array<{ id: string; meta?: Record<string, unknown> }>,
  registered: new Map<
    string,
    {
      id: string;
      cron: string;
      tz: string;
      createdAt: number;
      updatedAt: number;
      nextRunAt: number;
      runNumber: number;
      failureCount: number;
      meta?: Record<string, unknown>;
    }
  >(),
  runNow: [] as string[],
  started: 0,
  stopped: 0,
  createFailures: 0,
};

const jobState = {
  submitted: [] as Array<{
    key: string;
    leaseMs: number;
    input: { runId: string; queueAttempt: number };
  }>,
  failSubmit: false,
  stopped: 0,
};

let getWorkflowResult: Workflow | null = scheduledWorkflow;
let listScheduledResult: Workflow[] = [];
let createRunResult: PersistedWorkflowRun | null = null;
let createRunInputs: Array<Record<string, unknown>> = [];
let staleQueuedRuns: RecoverableQueuedWorkflowRun[] = [];
let failQueuedAttemptAllowed = true;
let currentRunResult: WorkflowRun | null = workflowRun;
let finishedRuns: Array<{ runId: string; status: "succeeded" | "failed" | "canceled"; error?: string | null }> = [];
let recordEventBaseIds: string[] = [];
let recordEventReadersStarted = 0;
let recordEventReadersAborted = 0;
let runtimeEvents: Array<{ data: { workflowId: string }; cursor: string }> = [];
let runtimeEventReadersStarted = 0;
let runtimeEventCursorError: Error | null = null;
let runtimeEventCursorFailures = 0;
let runtimeEventAfterValues: string[] = [];
let onWorkflowLock: (() => void) | null = null;
let workflowTriggerRuntime: ReturnType<typeof createWorkflowTriggerRuntime>;

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for workflow trigger runtime state");
};

const createTestRuntime = () =>
  createWorkflowTriggerRuntime({
    log: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    workflowScheduler: {
      start: () => {
        schedulerState.started += 1;
      },
      stop: async () => {
        schedulerState.stopped += 1;
      },
      create: async (cfg: {
        id: string;
        cron: string;
        tz?: string;
        meta?: Record<string, unknown>;
        process: (arg: { ctx: never }) => Promise<unknown> | unknown;
        after?: (arg: { ctx: never }) => Promise<void> | void;
      }) => {
        if (schedulerState.createFailures > 0) {
          schedulerState.createFailures -= 1;
          throw new Error("scheduler unavailable");
        }
        schedulerState.created.push(cfg);
        schedulerState.registered.set(cfg.id, {
          id: cfg.id,
          cron: cfg.cron,
          tz: cfg.tz ?? "UTC",
          createdAt: 1,
          updatedAt: 1,
          nextRunAt: 1,
          runNumber: 0,
          failureCount: 0,
          meta: cfg.meta,
        });
        return { created: true, updated: false };
      },
      delete: async (cfg: { id: string }) => {
        schedulerState.deleted.push(cfg.id);
        schedulerState.registered.delete(cfg.id);
      },
      get: async (cfg: { id: string }) => schedulerState.registered.get(cfg.id) ?? null,
      list: async () => schedulerState.listed,
      runNow: async (cfg: { id: string }) => {
        schedulerState.runNow.push(cfg.id);
      },
    } as never,
    workflowSyncMutex: {
      withLockOrThrow: async (_resource: string, fn: () => Promise<unknown>) => {
        onWorkflowLock?.();
        return fn();
      },
    } as never,
    workflowJob: {
      submit: async (cfg: { key: string; leaseMs: number; input: { runId: string; queueAttempt: number } }) => {
        if (jobState.failSubmit) throw new Error("queue unavailable");
        jobState.submitted.push(cfg);
      },
      stop: () => {
        jobState.stopped += 1;
      },
    } as never,
    workflows: {
      get: async (id) => (id === workflowId ? getWorkflowResult : null),
      createWorkflowRun: async (input) => {
        createRunInputs.push(input);
        return (
          createRunResult ?? {
            ...workflowRun,
            actorUserId: input.actorUserId ?? null,
            actorGroupIds: input.actorGroupIds ?? [],
            serviceAccountId: input.serviceAccountId ?? null,
            authorization: input.authorization ?? { kind: "workflow" },
            triggerKind: input.triggerKind,
            triggerInput: input.triggerInput ?? null,
            resolvedInput: input.resolvedInput ?? null,
            workflowDefinition: input.workflowDefinition,
          }
        );
      },
      claimRecoverableRuns: async () => {
        const claimed = staleQueuedRuns;
        staleQueuedRuns = [];
        return claimed;
      },
      failQueuedRunAttempt: async (id, _attempt, error) => {
        if (!failQueuedAttemptAllowed) return null;
        finishedRuns.push({ runId: id, status: "failed", error });
        return { ...workflowRun, id, status: "failed", error, finishedAt: "2026-07-08T00:00:01.000Z" };
      },
      getWorkflowRun: async () => currentRunResult,
      listRecordEventBaseIds: async () => recordEventBaseIds,
      listScheduledEnabled: async () => listScheduledResult,
      listRecordEventEnabled: async () => [],
      recordMatchesWorkflowFilter: async () => ({ ok: true, data: false }),
    },
    getBase: async () => base,
    prepareBulkSelection: async () => ({ ok: true, data: null as never }),
    prepareRecordEvent: async () => ({ ok: true, data: null as never }),
    prepareScanner: async () => ({ ok: true, data: null as never }),
    prepareWorkflowTriggerRun: async () => ({
      ok: true,
      data: {
        workflow: scheduledWorkflow,
        triggerKind: "form",
        triggerInput: { value: "ok" },
        resolvedInput: { value: "ok" },
        actorUserId: null,
        actorGroupIds: [],
        serviceAccountId: null,
        authorization: { kind: "workflow" },
      },
    }),
    prepareDashboardWorkflowTriggerRun: async (params) => ({
      ok: true,
      data: {
        workflow: scheduledWorkflow,
        triggerKind: "dashboardButton",
        triggerInput: params.triggerInput ?? null,
        resolvedInput: params.triggerInput ?? {},
        actorUserId: params.actorUserId ?? null,
        actorGroupIds: params.actorGroupIds ?? [],
        serviceAccountId: params.serviceAccountId ?? null,
        authorization: {
          kind: "dashboard-widget",
          dashboardId: params.dashboardId,
          dashboardWidgetId: params.dashboardWidgetId,
        },
      },
    }),
    loadWorkflowPrincipal: async (workflow) => ({
      actorUserId: workflow.ownerUserId,
      actorGroupIds: [ownerGroupId],
      serviceAccountId: null,
    }),
    settingsGet: async <T>() => "Europe/Berlin" as T,
    normalizeTimeZone: (value: string | null | undefined, fallback = "Europe/Berlin") => value || fallback,
    recordEventReader: () => {
      recordEventReadersStarted += 1;
      return {
        recv: ({ signal }: { signal: AbortSignal }) =>
          new Promise<null>((resolve) => {
            if (signal.aborted) {
              recordEventReadersAborted += 1;
              resolve(null);
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                recordEventReadersAborted += 1;
                resolve(null);
              },
              { once: true },
            );
          }),
      } as never;
    },
    latestMetadataEventCursor: async () => null,
    liveMetadataEvents: async function* ({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    latestWorkflowRuntimeEventCursor: async () => {
      if (runtimeEventCursorError && runtimeEventCursorFailures > 0) {
        runtimeEventCursorFailures -= 1;
        throw runtimeEventCursorError;
      }
      return "0-0";
    },
    runtimeEventRetryDelayMs: 1,
    liveWorkflowRuntimeEvents: async function* ({ after, signal }) {
      runtimeEventReadersStarted += 1;
      runtimeEventAfterValues.push(after ?? "0-0");
      for (const event of runtimeEvents) yield event as never;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    loadWorkflowCatalogSnapshot: async () => workflowCatalog,
  });

beforeEach(async () => {
  schedulerState.created = [];
  schedulerState.deleted = [];
  schedulerState.listed = [];
  schedulerState.registered.clear();
  schedulerState.runNow = [];
  schedulerState.started = 0;
  schedulerState.stopped = 0;
  schedulerState.createFailures = 0;
  jobState.submitted = [];
  jobState.failSubmit = false;
  jobState.stopped = 0;
  getWorkflowResult = scheduledWorkflow;
  listScheduledResult = [];
  createRunResult = null;
  createRunInputs = [];
  staleQueuedRuns = [];
  failQueuedAttemptAllowed = true;
  currentRunResult = workflowRun;
  finishedRuns = [];
  recordEventBaseIds = [];
  recordEventReadersStarted = 0;
  recordEventReadersAborted = 0;
  runtimeEvents = [];
  runtimeEventReadersStarted = 0;
  runtimeEventCursorError = null;
  runtimeEventCursorFailures = 0;
  runtimeEventAfterValues = [];
  onWorkflowLock = null;
  workflowTriggerRuntime = createTestRuntime();
});

afterEach(async () => {
  await workflowTriggerRuntime.stop();
});

describe("workflow trigger runtime", () => {
  test("registers schedules with app-scoped ids", async () => {
    await workflowTriggerRuntime.sync(scheduledWorkflow);

    expect(schedulerState.created[0]?.id).toBe(`grids:workflow:${workflowId}`);
    expect(schedulerState.created[0]?.meta).toMatchObject({
      appId: "grids",
      family: "grids:workflows",
      label: "Scheduled workflow",
      source: `grids:workflow:${workflowId}:schedule`,
      resourceKind: "workflow",
      resourceId: workflowId,
      resourceLabel: "Demo base / Scheduled workflow",
      detailHref: "/app/grids/bs001/workflows/wf001",
    });
  });

  test("scheduled runs enqueue with the workflow owner principal", async () => {
    await workflowTriggerRuntime.sync(scheduledWorkflow);
    const process = schedulerState.created[0]?.process;
    if (!process) throw new Error("Expected schedule process");
    getWorkflowResult = {
      ...scheduledWorkflow,
      revision: scheduledWorkflow.revision + 1,
      compiled: {
        ...scheduledWorkflow.compiled,
        steps: [{ succeed: { message: "Current definition" } }],
      },
    };

    await process({ ctx: { slotTs: 1, trigger: "manual", runNumber: 1 } as never });

    expect(jobState.submitted).toHaveLength(1);
    expect(jobState.submitted[0]?.input).toEqual({ runId, queueAttempt: 0 });
    expect(createRunInputs[0]).toMatchObject({
      workflowDefinition: getWorkflowResult.compiled,
      actorUserId: scheduledWorkflow.ownerUserId,
      actorGroupIds: [ownerGroupId],
    });
  });

  test("stale scheduler handlers skip runs after the schedule changes", async () => {
    await workflowTriggerRuntime.sync(scheduledWorkflow);
    const process = schedulerState.created[0]?.process;
    if (!process) throw new Error("Expected schedule process");
    getWorkflowResult = {
      ...scheduledWorkflow,
      revision: scheduledWorkflow.revision + 1,
      compiled: {
        ...scheduledWorkflow.compiled,
        triggers: { schedule: { cron: "30 9 * * *" } },
      },
    };

    const result = await process({ ctx: { slotTs: 1, trigger: "cron", runNumber: 1 } as never });

    expect(result).toEqual({ runId: null, queued: false, status: "skipped" });
    expect(jobState.submitted).toHaveLength(0);
    expect(createRunInputs).toHaveLength(0);
  });

  test("dispatch skips a schedule snapshot that was rolled back after registration", async () => {
    getWorkflowResult = {
      ...scheduledWorkflow,
      revision: scheduledWorkflow.revision + 1,
      compiled: {
        ...scheduledWorkflow.compiled,
        triggers: { schedule: { cron: "30 9 * * *" } },
      },
    };
    await workflowTriggerRuntime.sync(getWorkflowResult);
    const process = schedulerState.created[0]?.process;
    if (!process) throw new Error("Expected schedule process");
    schedulerState.registered.set(`grids:workflow:${workflowId}`, {
      id: `grids:workflow:${workflowId}`,
      cron: scheduledWorkflow.compiled.triggers.schedule.cron,
      tz: "Europe/Berlin",
      createdAt: 1,
      updatedAt: 1,
      nextRunAt: 1,
      runNumber: 0,
      failureCount: 0,
    });

    const result = await process({ ctx: { slotTs: 1, trigger: "cron", runNumber: 1 } as never });

    expect(result).toEqual({ runId: null, queued: false, status: "skipped" });
    expect(createRunInputs).toHaveLength(0);
  });

  test("stale deleted handlers trigger a targeted schedule repair", async () => {
    await workflowTriggerRuntime.sync(scheduledWorkflow);
    const schedule = schedulerState.created[0];
    if (!schedule) throw new Error("Expected schedule");
    getWorkflowResult = null;

    const data = await schedule.process({ ctx: { slotTs: 1, trigger: "cron", runNumber: 1 } as never });
    await schedule.after?.({ ctx: { data } as never });
    await waitFor(() => schedulerState.deleted.includes(`grids:workflow:${workflowId}`));

    expect(schedulerState.deleted).toContain(`grids:workflow:${workflowId}`);
  });

  test("sync reloads the latest persisted workflow instead of applying a stale caller snapshot", async () => {
    getWorkflowResult = {
      ...scheduledWorkflow,
      revision: scheduledWorkflow.revision + 1,
      compiled: {
        ...scheduledWorkflow.compiled,
        triggers: { schedule: { cron: "30 9 * * *" } },
      },
    };

    await workflowTriggerRuntime.sync(scheduledWorkflow);

    expect(schedulerState.created[0]?.cron).toBe("30 9 * * *");
  });

  test("reconcile registers the current scheduled workflow list", async () => {
    listScheduledResult = [
      {
        ...scheduledWorkflow,
        revision: scheduledWorkflow.revision + 1,
        compiled: {
          ...scheduledWorkflow.compiled,
          triggers: { schedule: { cron: "45 10 * * *" } },
        },
      },
    ];

    await workflowTriggerRuntime.start();

    expect(schedulerState.created[0]?.cron).toBe("45 10 * * *");
  });

  test("reconcile does not overwrite a newer registered workflow revision", async () => {
    listScheduledResult = [scheduledWorkflow];
    schedulerState.listed = [{ id: `grids:workflow:${workflowId}`, meta: { workflowRevision: scheduledWorkflow.revision + 1 } }];
    schedulerState.registered.set(`grids:workflow:${workflowId}`, {
      id: `grids:workflow:${workflowId}`,
      cron: scheduledWorkflow.compiled.triggers.schedule.cron,
      tz: "Europe/Berlin",
      createdAt: 1,
      updatedAt: 1,
      nextRunAt: 1,
      runNumber: 0,
      failureCount: 0,
      meta: { workflowRevision: scheduledWorkflow.revision + 1 },
    });

    await workflowTriggerRuntime.start();

    expect(schedulerState.created).toHaveLength(0);
  });

  test("reconcile checks the registered revision after acquiring the workflow lock", async () => {
    listScheduledResult = [scheduledWorkflow];
    schedulerState.listed = [{ id: `grids:workflow:${workflowId}`, meta: { workflowRevision: scheduledWorkflow.revision } }];
    onWorkflowLock = () => {
      onWorkflowLock = null;
      schedulerState.registered.set(`grids:workflow:${workflowId}`, {
        id: `grids:workflow:${workflowId}`,
        cron: scheduledWorkflow.compiled.triggers.schedule.cron,
        tz: "Europe/Berlin",
        createdAt: 1,
        updatedAt: 2,
        nextRunAt: 1,
        runNumber: 0,
        failureCount: 0,
        meta: { workflowRevision: scheduledWorkflow.revision + 1 },
      });
    };

    await workflowTriggerRuntime.start();

    expect(schedulerState.created).toHaveLength(0);
  });

  test("runtime events register changed schedules on every pod", async () => {
    runtimeEvents = [{ data: { workflowId }, cursor: "1-0" }];

    await workflowTriggerRuntime.start();
    await waitFor(() => schedulerState.created.length === 1);

    expect(runtimeEventReadersStarted).toBe(1);
    expect(schedulerState.created[0]?.id).toBe(`grids:workflow:${workflowId}`);
  });

  test("runtime events replay when applying an event fails", async () => {
    runtimeEvents = [{ data: { workflowId }, cursor: "1-0" }];
    schedulerState.createFailures = 1;

    await workflowTriggerRuntime.start();
    await waitFor(() => schedulerState.created.length === 1);

    expect(runtimeEventAfterValues.slice(0, 2)).toEqual(["0-0", "0-0"]);
  });

  test("event fan-out initialization retries after a transient failure", async () => {
    runtimeEventCursorError = new Error("redis unavailable");
    runtimeEventCursorFailures = 1;

    await workflowTriggerRuntime.start();
    await waitFor(() => runtimeEventReadersStarted === 1);

    expect(schedulerState.started).toBe(1);
    expect(runtimeEventReadersStarted).toBe(1);
  });

  test("removes the app-scoped schedule id when a workflow has no active schedule", async () => {
    getWorkflowResult = { ...scheduledWorkflow, enabled: false };
    await workflowTriggerRuntime.sync(getWorkflowResult);

    expect(schedulerState.deleted).toContain(`grids:workflow:${workflowId}`);
  });

  test("removes orphaned app-scoped workflow schedule ids during reconcile", async () => {
    listScheduledResult = [scheduledWorkflow];
    schedulerState.listed = [{ id: "grids:workflow:orphaned" }, { id: `grids:workflow:${workflowId}` }];

    await workflowTriggerRuntime.start();

    expect(schedulerState.created[0]?.id).toBe(`grids:workflow:${workflowId}`);
    expect(schedulerState.deleted).toEqual(["grids:workflow:orphaned"]);
  });

  test("does not start record event readers for bases without enabled recordEvent workflows", async () => {
    await workflowTriggerRuntime.start();

    expect(recordEventReadersStarted).toBe(0);
  });

  test("discovers the first enabled recordEvent workflow without restarting", async () => {
    await workflowTriggerRuntime.start();
    recordEventBaseIds = [baseId];

    await workflowTriggerRuntime.sync(scheduledWorkflow);
    await waitFor(() => recordEventReadersStarted === 1);

    expect(recordEventReadersStarted).toBe(1);
  });

  test("stops readers after the last enabled recordEvent workflow is disabled", async () => {
    recordEventBaseIds = [baseId];
    await workflowTriggerRuntime.start();
    expect(recordEventReadersStarted).toBe(1);

    recordEventBaseIds = [];
    await workflowTriggerRuntime.sync(scheduledWorkflow);
    await waitFor(() => recordEventReadersAborted === 1);

    expect(recordEventReadersAborted).toBe(1);
  });

  test("runScheduledNow uses scheduler.runNow for the app-scoped id", async () => {
    getWorkflowResult = {
      ...scheduledWorkflow,
      revision: scheduledWorkflow.revision + 1,
      compiled: {
        ...scheduledWorkflow.compiled,
        triggers: { schedule: { cron: "15 11 * * *" } },
      },
    };

    const result = await workflowTriggerRuntime.runScheduledNow(workflowId);

    expect(result.ok).toBe(true);
    expect(schedulerState.created[0]?.id).toBe(`grids:workflow:${workflowId}`);
    expect(schedulerState.created[0]?.cron).toBe("15 11 * * *");
    expect(schedulerState.runNow).toEqual([`grids:workflow:${workflowId}`]);
  });

  test("queueDirectRun creates a run and submits it to the traced workflow job", async () => {
    const result = await workflowTriggerRuntime.queueDirectRun({
      workflowId,
      triggerKind: "form",
      triggerInput: { value: "ok" },
    });

    expect(result.ok).toBe(true);
    expect(jobState.submitted).toHaveLength(1);
    expect(jobState.submitted[0]?.key).toBe(`run:${runId}:attempt:0`);
    expect(jobState.submitted[0]?.input).toEqual({ runId, queueAttempt: 0 });
    expect(createRunInputs[0]).toMatchObject({
      workflowDefinition: scheduledWorkflow.compiled,
      actorGroupIds: [],
      authorization: { kind: "workflow" },
    });
  });

  test("queueDashboardRun preserves explicit dashboard authorization provenance", async () => {
    const result = await workflowTriggerRuntime.queueDashboardRun({
      workflowId,
      triggerKind: "dashboardButton",
      dashboardId: "66666666-6666-4666-8666-666666666666",
      dashboardWidgetId: "widget-1",
      triggerInput: { value: "ok" },
    });

    expect(result.ok).toBe(true);
    expect(jobState.submitted[0]?.input).toEqual({ runId, queueAttempt: 0 });
    expect(createRunInputs[0]?.authorization).toEqual({
      kind: "dashboard-widget",
      dashboardId: "66666666-6666-4666-8666-666666666666",
      dashboardWidgetId: "widget-1",
    });
  });

  test("duplicate triggers submit only the canonical run identity", async () => {
    createRunResult = {
      ...workflowRun,
      actorUserId: scheduledWorkflow.ownerUserId,
      actorGroupIds: [ownerGroupId],
      authorization: { kind: "workflow" },
    };

    const result = await workflowTriggerRuntime.queueDashboardRun({
      workflowId,
      triggerKind: "dashboardButton",
      dashboardId: "66666666-6666-4666-8666-666666666666",
      dashboardWidgetId: "widget-1",
    });

    expect(result.ok).toBe(true);
    expect(jobState.submitted[0]?.input).toEqual({ runId, queueAttempt: 0 });
  });

  test("queueDirectRun fails the created run when submit fails", async () => {
    jobState.failSubmit = true;

    const result = await workflowTriggerRuntime.queueDirectRun({
      workflowId,
      triggerKind: "form",
      triggerInput: { value: "ok" },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.status).toBe("failed");
    expect(jobState.submitted).toHaveLength(0);
    expect(finishedRuns).toEqual([
      {
        runId,
        status: "failed",
        error: "Could not enqueue workflow run: queue unavailable",
      },
    ]);
  });

  test("submit failures do not overwrite a run that has already started", async () => {
    jobState.failSubmit = true;
    failQueuedAttemptAllowed = false;
    currentRunResult = { ...workflowRun, status: "running", startedAt: "2026-07-08T00:00:01.000Z" };

    const result = await workflowTriggerRuntime.queueDirectRun({
      workflowId,
      triggerKind: "form",
      triggerInput: { value: "ok" },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.status).toBe("running");
    expect(finishedRuns).toHaveLength(0);
  });

  test("reconciles stale queued runs with their stored principal and authorization", async () => {
    staleQueuedRuns = [
      {
        ...workflowRun,
        triggerKind: "dashboardButton",
        triggerInput: { value: "original" },
        resolvedInput: { value: "resolved" },
        actorGroupIds: [ownerGroupId],
        authorization: {
          kind: "dashboard-widget",
          dashboardId: "66666666-6666-4666-8666-666666666666",
          dashboardWidgetId: "widget-1",
        },
        queueAttempts: 1,
      },
    ];

    await workflowTriggerRuntime.start();

    expect(jobState.submitted).toEqual([
      {
        key: `run:${runId}:attempt:1`,
        leaseMs: 30 * 60 * 1000,
        input: { runId, queueAttempt: 1 },
      },
    ]);
  });

  test("fails stale queued runs whose workflow no longer exists", async () => {
    getWorkflowResult = null;
    staleQueuedRuns = [
      {
        ...workflowRun,
        actorGroupIds: [],
        authorization: { kind: "workflow" },
        queueAttempts: 1,
      },
    ];

    await workflowTriggerRuntime.start();

    expect(jobState.submitted).toHaveLength(0);
    expect(finishedRuns).toEqual([
      {
        runId,
        status: "failed",
        error: "Could not recover workflow run: workflow no longer exists",
      },
    ]);
  });

  test("fails stale queued runs when recovery cannot submit the job", async () => {
    jobState.failSubmit = true;
    staleQueuedRuns = [
      {
        ...workflowRun,
        actorGroupIds: [],
        authorization: { kind: "workflow" },
        queueAttempts: 1,
      },
    ];

    await workflowTriggerRuntime.start();

    expect(finishedRuns).toEqual([
      {
        runId,
        status: "failed",
        error: "Could not recover workflow run: queue unavailable",
      },
    ]);
  });
});
