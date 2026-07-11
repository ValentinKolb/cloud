import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Workflow, WorkflowRun } from "../contracts";
import { createWorkflowTriggerRuntime } from "./workflow-trigger-runtime";
import type { RecoverableQueuedWorkflowRun } from "./workflows";

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
} satisfies RecoverableQueuedWorkflowRun;

const schedulerState = {
  created: [] as Array<{
    id: string;
    cron: string;
    tz?: string;
    meta?: Record<string, unknown>;
    process: (cfg: { ctx: never }) => Promise<unknown> | unknown;
  }>,
  deleted: [] as string[],
  listed: [] as Array<{ id: string }>,
  runNow: [] as string[],
  started: 0,
  stopped: 0,
};

const jobState = {
  submitted: [] as Array<{
    key: string;
    leaseMs: number;
    input: {
      triggerKind: string;
      workflowId: string;
      runId: string;
      actorUserId: string | null;
      actorGroupIds: string[];
      serviceAccountId: string | null;
      triggerInput: Record<string, unknown>;
      resolvedInput: Record<string, unknown>;
      authorization: { kind: string; dashboardId?: string; dashboardWidgetId?: string };
    };
  }>,
  failSubmit: false,
  stopped: 0,
};

let getWorkflowResult: Workflow | null = scheduledWorkflow;
let listScheduledResult: Workflow[] = [];
let createRunResult: RecoverableQueuedWorkflowRun | null = null;
let createRunInputs: Array<Record<string, unknown>> = [];
let staleQueuedRuns: RecoverableQueuedWorkflowRun[] = [];
let failQueuedAttemptAllowed = true;
let currentRunResult: WorkflowRun | null = workflowRun;
let finishedRuns: Array<{ runId: string; status: "succeeded" | "failed" | "canceled"; error?: string | null }> = [];
let recordEventBaseIds: string[] = [];
let recordEventReadersStarted = 0;
let recordEventReadersAborted = 0;
let workflowTriggerRuntime: ReturnType<typeof createWorkflowTriggerRuntime>;

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
      }) => {
        schedulerState.created.push(cfg);
        return { created: true, updated: false };
      },
      delete: async (cfg: { id: string }) => {
        schedulerState.deleted.push(cfg.id);
      },
      list: async () => schedulerState.listed,
      runNow: async (cfg: { id: string }) => {
        schedulerState.runNow.push(cfg.id);
      },
    } as never,
    workflowJob: {
      submit: async (cfg: {
        key: string;
        leaseMs: number;
        input: {
          triggerKind: string;
          workflowId: string;
          runId: string;
          actorUserId: string | null;
          actorGroupIds: string[];
          serviceAccountId: string | null;
          triggerInput: Record<string, unknown>;
          resolvedInput: Record<string, unknown>;
          authorization: { kind: string; dashboardId?: string; dashboardWidgetId?: string };
        };
      }) => {
        if (jobState.failSubmit) throw new Error("queue unavailable");
        jobState.submitted.push(cfg);
      },
      stop: () => {
        jobState.stopped += 1;
      },
    } as never,
    workflows: {
      get: async () => getWorkflowResult,
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
          }
        );
      },
      claimStaleQueuedRuns: async () => {
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
  });

beforeEach(async () => {
  schedulerState.created = [];
  schedulerState.deleted = [];
  schedulerState.listed = [];
  schedulerState.runNow = [];
  schedulerState.started = 0;
  schedulerState.stopped = 0;
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

    await process({ ctx: { slotTs: 1, trigger: "manual", runNumber: 1 } as never });

    expect(jobState.submitted).toHaveLength(1);
    expect(jobState.submitted[0]?.input).toMatchObject({
      workflowId,
      runId,
      triggerKind: "schedule",
      actorUserId: scheduledWorkflow.ownerUserId,
      actorGroupIds: [ownerGroupId],
    });
  });

  test("removes the app-scoped schedule id when a workflow has no active schedule", async () => {
    await workflowTriggerRuntime.sync({ ...scheduledWorkflow, enabled: false });

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
    await Bun.sleep(300);

    expect(recordEventReadersStarted).toBe(1);
  });

  test("stops readers after the last enabled recordEvent workflow is disabled", async () => {
    recordEventBaseIds = [baseId];
    await workflowTriggerRuntime.start();
    expect(recordEventReadersStarted).toBe(1);

    recordEventBaseIds = [];
    await workflowTriggerRuntime.sync(scheduledWorkflow);
    await Bun.sleep(300);

    expect(recordEventReadersAborted).toBe(1);
  });

  test("runScheduledNow uses scheduler.runNow for the app-scoped id", async () => {
    const result = await workflowTriggerRuntime.runScheduledNow(workflowId);

    expect(result.ok).toBe(true);
    expect(schedulerState.created[0]?.id).toBe(`grids:workflow:${workflowId}`);
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
    expect(jobState.submitted[0]?.input).toMatchObject({
      workflowId,
      runId,
      triggerKind: "form",
    });
    expect(createRunInputs[0]).toMatchObject({
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
    expect(jobState.submitted[0]?.input.authorization).toEqual({
      kind: "dashboard-widget",
      dashboardId: "66666666-6666-4666-8666-666666666666",
      dashboardWidgetId: "widget-1",
    });
  });

  test("duplicate triggers submit only the principal persisted on the canonical run", async () => {
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
    expect(jobState.submitted[0]?.input).toMatchObject({
      actorUserId: scheduledWorkflow.ownerUserId,
      actorGroupIds: [ownerGroupId],
      authorization: { kind: "workflow" },
    });
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
        input: {
          workflowId,
          runId,
          triggerKind: "dashboardButton",
          actorUserId: scheduledWorkflow.ownerUserId,
          actorGroupIds: [ownerGroupId],
          serviceAccountId: null,
          triggerInput: { value: "original" },
          resolvedInput: { value: "resolved" },
          authorization: {
            kind: "dashboard-widget",
            dashboardId: "66666666-6666-4666-8666-666666666666",
            dashboardWidgetId: "widget-1",
          },
        },
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
