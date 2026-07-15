import { logger, trace } from "@valentinkolb/cloud/services";
import type {
  WorkflowExecutionError,
  WorkflowInvocation,
  WorkflowInvocationMode,
  WorkflowInvocationReceipt,
  WorkflowJsonValue,
} from "@valentinkolb/cloud/workflows";
import {
  coordinateWorkflowExecution,
  dryRunWorkflowPlan,
  evaluateWorkflowTriggerInputs,
  executeWorkflowPlan,
  type WorkflowCoordinatorExecution,
  type WorkflowDryRunIssue,
  type WorkflowHeartbeatOutcome,
  type WorkflowRuntimeRunIdentity,
  type WorkflowTraceEvent,
  type WorkflowTracePort,
} from "@valentinkolb/cloud/workflows/runtime";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, scheduler } from "@valentinkolb/sync";
import {
  type GridsWorkflow,
  type GridsWorkflowChannel,
  type GridsWorkflowPrincipal,
  type GridsWorkflowRun,
  toWorkflowRevision,
} from "../workflows/contracts";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import { get as getDashboard } from "./dashboards";
import { authorizeWorkflowTarget, revalidateWorkflowPrincipal, workflowPermissionAllows } from "./workflow-authorization";
import { workflowConflict } from "./workflow-errors";
import { createGridsWorkflowActionPorts } from "./workflow-kernel-actions";
import { createWorkflowRecordEventRuntime } from "./workflow-kernel-record-events";
import {
  type ClaimedWorkflowRun,
  createGridsWorkflowCoordinatorPort,
  failQueuedWorkflowRun,
  findMaterializedWorkflowInvocation,
  finishWorkflowRun,
  type GridsWorkflowAuthorization,
  type GridsWorkflowRunCompletion,
  GridsWorkflowRuntimeRepository,
  getWorkflowRun,
  listExpiredWaitingWorkflowRunIds,
  listRecoverableWorkflowRunIds,
  materializeWorkflowInvocation,
  resumeWaitingWorkflowRun,
  WORKFLOW_RUN_LEASE_MS,
  workflowInvocationFingerprint,
} from "./workflow-kernel-runs";
import { getWorkflow, listScheduledWorkflows } from "./workflow-kernel-store";
import {
  createGridsWorkflowValueResolver,
  createWorkflowInputPreparationDeps,
  loadWorkflowUserGroupIds,
  prepareWorkflowInputs,
  WorkflowInputPreparationError,
} from "./workflow-kernel-values";
import { latestWorkflowRuntimeEventCursor, liveWorkflowRuntimeEvents } from "./workflow-runtime-events";

const log = logger("grids:workflow-kernel");
const workflowScheduler = scheduler({ id: "grids:workflows" });
export const WORKFLOW_JOB_LEASE_MS = WORKFLOW_RUN_LEASE_MS;
export const WORKFLOW_LEASE_HEARTBEAT_MS = Math.floor(WORKFLOW_RUN_LEASE_MS / 3);
const WORKFLOW_JOB_MAX_RETRIES = 3;
const WORKFLOW_SCHEDULE_MAX_RETRIES = 3;
const RECONCILE_INTERVAL_MS = 60_000;
const SCHEDULE_PREFIX = "grids:workflow:";

export const workflowScheduleId = (workflow: Pick<GridsWorkflow, "id" | "revision">): string => `${SCHEDULE_PREFIX}${workflow.id}`;

const workflowScheduleIdPrefix = (workflowId: string): string => `${SCHEDULE_PREFIX}${workflowId}:revision:`;

const deleteWorkflowSchedules = async (workflowId: string): Promise<void> => {
  const prefix = workflowScheduleIdPrefix(workflowId);
  await Promise.all(
    (await workflowScheduler.list())
      .filter((schedule) => schedule.id === `${SCHEDULE_PREFIX}${workflowId}` || schedule.id.startsWith(prefix))
      .map((schedule) => workflowScheduler.delete({ id: schedule.id })),
  );
};

export const workflowScheduleMetadata = (workflow: Pick<GridsWorkflow, "id" | "name" | "revision">) => ({
  appId: "grids",
  family: "grids:workflows",
  label: `Workflow: ${workflow.name}`,
  source: "grids:workflow-schedules",
  resourceLabel: workflow.name,
  workflowId: workflow.id,
  revision: workflow.revision,
});

type WorkflowJobInput = { runId: string };
type WorkflowJobResult = { runId: string; status: string };

export type InvokeGridsWorkflowInput = {
  workflowId: string;
  mode: WorkflowInvocationMode;
  channel: GridsWorkflowChannel;
  inputs: Record<string, WorkflowJsonValue>;
  idempotencyKey: string;
  expectedRevision?: number;
  principal: GridsWorkflowPrincipal;
  launcherId?: string | null;
  authorization?: GridsWorkflowAuthorization;
  occurredAt?: string;
  context?: Record<string, WorkflowJsonValue>;
  trustedRecordIds?: ReadonlyMap<string, ReadonlySet<string>>;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const workflowStepTrace = (jobId: string, runId: string): WorkflowTracePort => ({
  emit: async (event: WorkflowTraceEvent) => {
    const step = "step" in event ? event.step : null;
    const outcome = event.type === "step.finished" ? event.result.outcome.state : undefined;
    await trace.record({
      spanKey: `sync:job:grids:workflow-runs:v1:${jobId}`,
      name: "Grid workflow run",
      source: "grids:workflow-runs:v1",
      appId: "grids",
      category: "job",
      kind: "consumer",
      event: `workflow.${event.type}`,
      attributes: {
        "cloud.grids.workflow_run_id": runId,
        "workflow.event": event.type,
        "workflow.step.action": step?.action,
        "workflow.step.key": step?.key,
        "workflow.step.kind": step?.kind,
        "workflow.step.outcome": outcome,
      },
    });
  },
});

const workflowPermission = async (
  workflowId: string,
  baseId: string,
  principal: GridsWorkflowPrincipal,
  required: "read" | "write" | "admin",
): Promise<boolean> => {
  return authorizeWorkflowTarget(principal, { baseId, workflowId }, required);
};

const canExecuteAcceptedRun = async (
  workflowId: string,
  baseId: string,
  principal: GridsWorkflowPrincipal,
  authorization: GridsWorkflowAuthorization,
  launcherId: string | null | undefined,
): Promise<boolean> => {
  if (authorization.kind === "workflow") return workflowPermission(workflowId, baseId, principal, "write");
  const revalidated = await revalidateWorkflowPrincipal(principal, baseId);
  if (!revalidated.ok || !workflowPermissionAllows(revalidated.permissionCap, "write")) return false;
  if (!launcherId) return false;
  const dashboard = await getDashboard(authorization.dashboardId);
  if (!dashboard || dashboard.baseId !== baseId) return false;
  if (
    !(await canReadDashboardIncludedData(dashboard, {
      userId: revalidated.subject.type === "user" ? revalidated.subject.userId : null,
      userGroups: [],
      serviceAccountId: revalidated.subject.type === "service_account" ? revalidated.subject.serviceAccountId : null,
    }))
  ) {
    return false;
  }
  const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === authorization.dashboardWidgetId);
  return widget?.kind === "workflow-button" && widget.launcherId === launcherId;
};

const finishExecution = async (result: Awaited<ReturnType<typeof executeWorkflowPlan>>): Promise<GridsWorkflowRunCompletion> => {
  if (result.state === "succeeded") {
    return { status: "succeeded", result: result.output ?? null, resultMessage: result.message ?? null };
  }
  if (result.state === "waiting") return { status: "waiting" };
  if (result.state === "canceled") {
    return { status: "canceled", resultMessage: result.message ?? null };
  }
  return { status: result.state, error: result.error };
};

const dryRunError = (code: string, message: string): WorkflowExecutionError => ({ code, message, retryable: false });

const persistedDryRunIssues = (issues: readonly WorkflowDryRunIssue[] | undefined) =>
  issues?.map((issue) => ({
    state: issue.state,
    reason: issue.reason,
    step: {
      key: issue.step.key,
      sourcePath: issue.step.sourcePath,
      action: issue.step.action ?? null,
    },
  })) ?? [];

const dryRunCompletion = (result: Awaited<ReturnType<typeof dryRunWorkflowPlan>>): GridsWorkflowRunCompletion => {
  if (result.state === "planned") {
    return {
      status: "succeeded",
      result: { effects: result.effects, ...(result.output === undefined ? {} : { output: result.output }) },
    };
  }
  if (result.state === "terminal") {
    const issues = persistedDryRunIssues(result.issues);
    if (issues.length > 0) {
      const primary = issues.find((issue) => issue.state === "indeterminate") ?? issues[0]!;
      return {
        status: "failed",
        result: { effects: result.effects, issues, terminal: { status: result.status, message: result.message ?? null } },
        error: dryRunError(
          primary.state === "indeterminate" ? "WORKFLOW_DRY_RUN_INDETERMINATE" : "WORKFLOW_DRY_RUN_UNSUPPORTED",
          primary.reason,
        ),
      };
    }
    const status = result.status === "succeeded" ? "succeeded" : "failed";
    return {
      status,
      result: { effects: result.effects },
      resultMessage: result.message ?? null,
      ...(status === "failed" ? { error: dryRunError("WORKFLOW_DRY_RUN_TERMINAL", result.message ?? "Workflow would fail.") } : {}),
    };
  }
  if (result.state === "canceled") {
    return {
      status: "canceled",
      result: { effects: result.effects, issues: persistedDryRunIssues(result.issues) },
      resultMessage: result.message ?? null,
    };
  }
  return {
    status: "failed",
    result: { effects: result.effects, issues: persistedDryRunIssues(result.issues) },
    error: dryRunError(result.state === "unsupported" ? "WORKFLOW_DRY_RUN_UNSUPPORTED" : "WORKFLOW_DRY_RUN_INDETERMINATE", result.reason),
  };
};

export const finishDryRun = async (
  identity: WorkflowRuntimeRunIdentity,
  result: Awaited<ReturnType<typeof dryRunWorkflowPlan>>,
): Promise<GridsWorkflowRun["status"]> => {
  const completion = dryRunCompletion(result);
  if (!(await finishWorkflowRun(identity, completion))) throw workflowConflict("Workflow run lost its execution lease.");
  return completion.status;
};

const leaseCancellation = (signal: AbortSignal, message?: string): WorkflowHeartbeatOutcome => ({
  state: "canceled",
  message: message ?? (signal.reason instanceof Error ? signal.reason.message : "workflow run lease is no longer active"),
});

const executeClaimedWorkflowRun = async (
  claimed: ClaimedWorkflowRun,
  execution: WorkflowCoordinatorExecution<ClaimedWorkflowRun>,
  workflowTrace?: WorkflowTracePort,
): Promise<GridsWorkflowRunCompletion> => {
  const runId = claimed.runId;
  const repository = new GridsWorkflowRuntimeRepository(async () => {
    if (execution.signal.aborted) return leaseCancellation(execution.signal);
    const outcome = await execution.heartbeat();
    return outcome.state === "active" && !execution.signal.aborted
      ? { state: "active" }
      : leaseCancellation(execution.signal, outcome.state === "canceled" ? outcome.message : undefined);
  });
  const storedWorkflow = claimed.context.workflow;
  const workflow =
    storedWorkflow && typeof storedWorkflow === "object" && !Array.isArray(storedWorkflow)
      ? {
          id: String(storedWorkflow.id ?? claimed.run.workflowId ?? ""),
          shortId: String(storedWorkflow.shortId ?? ""),
          baseId: claimed.run.baseId,
          name: String(storedWorkflow.name ?? "Workflow"),
        }
      : await getWorkflow(claimed.run.workflowId ?? "", true);
  if (!workflow) throw new Error("workflow metadata is unavailable for this run");
  const actor = {
    ...claimed.principal,
    groupIds: await loadWorkflowUserGroupIds(claimed.run.actorUserId),
  } satisfies GridsWorkflowPrincipal;
  if (!(await canExecuteAcceptedRun(workflow.id, claimed.run.baseId, actor, claimed.authorization, claimed.run.launcherId))) {
    throw err.forbidden("Workflow execution access was revoked.");
  }
  const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
    workflowId: workflow.id,
    mode: claimed.run.mode,
    channel: claimed.run.channel,
    actor,
    inputs: claimed.run.inputs,
    context: claimed.context,
    idempotencyKey: claimed.idempotencyKey,
    occurredAt: claimed.occurredAt,
  };
  const actions = createGridsWorkflowActionPorts({
    workflow,
    principal: actor,
    authorizeExecution: () => canExecuteAcceptedRun(workflow.id, claimed.run.baseId, actor, claimed.authorization, claimed.run.launcherId),
    authorizeTarget: (target, required) => authorizeWorkflowTarget(actor, { baseId: claimed.run.baseId, ...target }, required),
  });
  const values = createGridsWorkflowValueResolver(claimed.run.baseId, actor, {
    authorizeTable: (tableId) => authorizeWorkflowTarget(actor, { baseId: claimed.run.baseId, tableId }, "read"),
  });
  const clock = { now: () => claimed.executionClockAt };
  if (claimed.run.mode === "execute") {
    return finishExecution(
      await executeWorkflowPlan({
        runId,
        executionGeneration: claimed.executionGeneration,
        plan: claimed.plan,
        invocation: { ...invocation, mode: "execute" },
        repository,
        clock,
        actions: actions.execute,
        values,
        ...(workflowTrace ? { trace: workflowTrace } : {}),
      }),
    );
  }
  return dryRunCompletion(
    await dryRunWorkflowPlan({
      runId,
      executionGeneration: claimed.executionGeneration,
      plan: claimed.plan,
      invocation: { ...invocation, mode: "dryRun" },
      repository,
      clock,
      actions: actions.dryRun,
      values,
      ...(workflowTrace ? { trace: workflowTrace } : {}),
    }),
  );
};

export const processWorkflowRun = async (
  runId: string,
  heartbeat?: () => Promise<void>,
  workflowTrace?: WorkflowTracePort,
): Promise<WorkflowJobResult> => {
  const result = await coordinateWorkflowExecution({
    input: runId,
    heartbeatMs: WORKFLOW_LEASE_HEARTBEAT_MS,
    port: createGridsWorkflowCoordinatorPort(heartbeat),
    execute: (execution) => executeClaimedWorkflowRun(execution.claim, execution, workflowTrace),
  });
  if (result.state === "idle") return { runId, status: (await getWorkflowRun(runId))?.status ?? "missing" };
  if (result.state === "finished") return { runId, status: result.result.status };
  if (result.state === "released" || result.state === "retry") throw result.error;
  const persisted = await getWorkflowRun(runId);
  if (persisted?.status === "waiting") return { runId, status: "waiting" };
  throw workflowConflict(
    result.state === "canceled" ? (result.message ?? "Workflow run was canceled.") : "Workflow run lost its execution lease.",
  );
};

const workflowJob = job<WorkflowJobInput, WorkflowJobResult>({
  id: "grids:workflow-runs:v1",
  defaults: { leaseMs: WORKFLOW_JOB_LEASE_MS, keyTtlMs: 24 * 60 * 60 * 1_000 },
  trace: trace.fromSyncJob<WorkflowJobInput, WorkflowJobResult>({
    name: "Grid workflow run",
    source: "grids:workflow-runs:v1",
    appId: "grids",
    attributes: (event) => ("input" in event && event.input ? { "cloud.grids.workflow_run_id": event.input.runId } : {}),
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: ({ ctx }) =>
    processWorkflowRun(
      ctx.input.runId,
      () => ctx.heartbeat({ leaseMs: WORKFLOW_JOB_LEASE_MS }),
      workflowStepTrace(ctx.jobId, ctx.input.runId),
    ),
  after: async ({ ctx }) => {
    if (!ctx.error) return;
    if (ctx.failureCount < WORKFLOW_JOB_MAX_RETRIES) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
      return;
    }
    await failQueuedWorkflowRun(ctx.input.runId, errorMessage(ctx.error));
  },
});

export const submitWorkflowRun = async (runId: string): Promise<void> => {
  await workflowJob.submit({ key: `run:${runId}`, input: { runId }, leaseMs: WORKFLOW_JOB_LEASE_MS });
};

export const submitAcceptedWorkflowRun = async (
  receipt: WorkflowInvocationReceipt,
  submit: (runId: string) => Promise<void> = submitWorkflowRun,
): Promise<void> => {
  if (receipt.status !== "queued") return;
  try {
    await submit(receipt.runId);
  } catch (error) {
    log.warn("Workflow run was accepted but could not be submitted immediately", {
      runId: receipt.runId,
      error: errorMessage(error),
    });
  }
};

export const invokeGridsWorkflow = async (input: InvokeGridsWorkflowInput): Promise<Result<WorkflowInvocationReceipt>> => {
  const workflow = await getWorkflow(input.workflowId);
  if (!workflow) return fail(err.notFound("workflow"));
  const authorization = input.authorization ?? { kind: "workflow" };
  if (!(await canExecuteAcceptedRun(workflow.id, workflow.baseId, input.principal, authorization, input.launcherId))) {
    return fail(err.forbidden("Workflow actor cannot run this workflow."));
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) return fail(err.badInput("invalid idempotency key"));
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const rawInvocation: WorkflowInvocation<GridsWorkflowChannel> = {
    workflowId: workflow.id,
    expectedRevision: input.expectedRevision === undefined ? undefined : toWorkflowRevision(input.expectedRevision),
    mode: input.mode,
    channel: input.channel,
    actor: {
      userId: input.principal.userId,
      groupIds: input.principal.groupIds,
      serviceAccountId: input.principal.serviceAccountId,
    },
    inputs: input.inputs,
    idempotencyKey: input.idempotencyKey,
    occurredAt,
    context: input.context ?? {},
  };
  const requestFingerprint = await workflowInvocationFingerprint({ invocation: rawInvocation, principal: input.principal });
  const existing = await findMaterializedWorkflowInvocation({
    baseId: workflow.baseId,
    invocation: rawInvocation,
    principal: input.principal,
    requestFingerprint,
  });
  if (existing) {
    if (existing.ok) await submitAcceptedWorkflowRun(existing.data);
    return existing;
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== workflow.revision) {
    return fail(workflowConflict("Workflow changed since the caller loaded it."));
  }
  if (input.mode === "execute" && !workflow.enabled) return fail(err.badInput("workflow is disabled"));
  let preparedInputs: Record<string, WorkflowJsonValue>;
  try {
    preparedInputs = await prepareWorkflowInputs(
      workflow.plan,
      input.inputs,
      createWorkflowInputPreparationDeps(workflow.baseId, input.principal, { trustedRecordIds: input.trustedRecordIds }),
    );
  } catch (error) {
    if (error instanceof WorkflowInputPreparationError) {
      return fail(error.status === 403 ? err.forbidden(error.message) : err.badInput(error.message));
    }
    throw error;
  }
  const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
    ...rawInvocation,
    inputs: preparedInputs,
    context: {
      ...(input.context ?? {}),
      workflow: { id: workflow.id, shortId: workflow.shortId, name: workflow.name },
    },
  };
  const receipt = await materializeWorkflowInvocation({
    baseId: workflow.baseId,
    invocation,
    preparedRevision: workflow.revision,
    requestFingerprint,
    launcherId: input.launcherId,
    principal: input.principal,
    authorization: input.authorization,
  });
  if (!receipt.ok) return receipt;
  await submitAcceptedWorkflowRun(receipt.data);
  return ok(receipt.data);
};

const workflowRecordEvents = createWorkflowRecordEventRuntime(invokeGridsWorkflow);

export type WorkflowScheduleConfig = { cron: string; timezone: string };

export const workflowScheduleConfig = (workflow: Pick<GridsWorkflow, "plan">): WorkflowScheduleConfig | null => {
  const trigger = workflow.plan.triggers.find((item) => item.kind === "schedule");
  if (!trigger) return null;
  return {
    cron: String(trigger.config.cron ?? ""),
    timezone: typeof trigger.config.timezone === "string" ? trigger.config.timezone : "UTC",
  };
};

export const workflowScheduleMatches = (workflow: Pick<GridsWorkflow, "plan">, expected: WorkflowScheduleConfig): boolean => {
  const current = workflowScheduleConfig(workflow);
  return current?.cron === expected.cron && current.timezone === expected.timezone;
};

export const workflowScheduleShouldRetry = (status: number): boolean => status === 409 || status >= 500;

const registerSchedule = async (workflowId: string): Promise<void> => {
  const workflow = await getWorkflow(workflowId);
  const schedule = workflow ? workflowScheduleConfig(workflow) : null;
  if (!workflow?.enabled || !schedule) {
    await deleteWorkflowSchedules(workflowId);
    const refreshed = await getWorkflow(workflowId);
    if (refreshed?.enabled && workflowScheduleConfig(refreshed)) await registerSchedule(workflowId);
    return;
  }
  const trigger = workflow.plan.triggers.find((item) => item.kind === "schedule");
  if (!trigger) return;
  const scheduleId = workflowScheduleId(workflow);
  await workflowScheduler.create({
    id: scheduleId,
    cron: schedule.cron,
    tz: schedule.timezone,
    meta: workflowScheduleMetadata(workflow),
    trace: trace.fromSyncSchedule<WorkflowJobResult>({
      name: `Grid workflow schedule: ${workflow.name}`,
      source: scheduleId,
      appId: "grids",
      attributes: { "cloud.grids.workflow_id": workflow.id },
    }),
    process: async ({ ctx }) => {
      const current = await getWorkflow(workflow.id);
      if (!current?.enabled) return { runId: "", status: "disabled" };
      const currentTrigger = current.plan.triggers.find((item) => item.kind === "schedule");
      if (!currentTrigger) return { runId: "", status: "removed" };
      if (current.revision !== workflow.revision || !workflowScheduleMatches(current, schedule)) {
        // Registration is intentionally left to the external reconcile loop. Mutating this schedule inside its callback races its own persistence.
        return { runId: "", status: "stale" };
      }
      const principal: GridsWorkflowPrincipal = {
        userId: current.ownerUserId,
        groupIds: await loadWorkflowUserGroupIds(current.ownerUserId),
        serviceAccountId: null,
      };
      const slot = new Date(ctx.slotTs).toISOString();
      const result = await invokeGridsWorkflow({
        workflowId: current.id,
        mode: "execute",
        channel: "schedule",
        inputs: evaluateWorkflowTriggerInputs({ occurredAt: slot, slot }, currentTrigger.with, slot),
        idempotencyKey: `schedule:${current.id}:${ctx.slotTs}`,
        expectedRevision: current.revision,
        principal,
        occurredAt: slot,
      });
      if (!result.ok) {
        if (workflowScheduleShouldRetry(result.error.status)) throw new Error(result.error.message);
        log.warn("Scheduled workflow invocation was rejected", {
          workflowId: current.id,
          slot,
          status: result.error.status,
          error: result.error.message,
        });
        return { runId: "", status: "rejected" };
      }
      return { runId: result.data.runId, status: result.data.status };
    },
    after: async ({ ctx }) => {
      if (ctx.error && ctx.failureCount < WORKFLOW_SCHEDULE_MAX_RETRIES) {
        ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
      }
    },
  });
};

export const registerWorkflowSchedules = async (
  workflows: ReadonlyArray<Pick<GridsWorkflow, "id">>,
  register: (workflowId: string) => Promise<void> = registerSchedule,
): Promise<void> => {
  for (const workflow of workflows) {
    try {
      await register(workflow.id);
    } catch (error) {
      log.warn("Could not reconcile workflow schedule", { workflowId: workflow.id, error: errorMessage(error) });
    }
  }
};

export const reconcileWorkflowKernelRuntime = async (): Promise<void> => {
  const expiredWaiting = await listExpiredWaitingWorkflowRunIds();
  for (const runId of expiredWaiting) {
    if (await resumeWaitingWorkflowRun(runId)) {
      await submitWorkflowRun(runId).catch((error) =>
        log.warn("Could not submit resumed workflow run", { runId, error: errorMessage(error) }),
      );
    }
  }
  const recoverable = await listRecoverableWorkflowRunIds();
  await Promise.all(
    recoverable.map((runId) =>
      submitWorkflowRun(runId).catch((error) =>
        log.warn("Could not submit recoverable workflow run", { runId, error: errorMessage(error) }),
      ),
    ),
  );
  const workflows = await listScheduledWorkflows();
  const activeIds = new Set(workflows.map(workflowScheduleId));
  await registerWorkflowSchedules(workflows);
  for (const item of await workflowScheduler.list()) {
    if (!item.id.startsWith(SCHEDULE_PREFIX) || activeIds.has(item.id)) continue;
    await workflowScheduler.delete({ id: item.id });
  }
  await workflowRecordEvents.reconcile();
};

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let runtimeEventController: AbortController | null = null;
let runtimeEventTask: Promise<void> | null = null;

export const applyWorkflowRuntimeEvent = async <T>(
  event: { cursor: string; data: T },
  apply: (data: T) => Promise<void>,
): Promise<string> => {
  await apply(event.data);
  return event.cursor;
};

const startRuntimeEventReader = (after: string | null): void => {
  if (runtimeEventTask) return;
  runtimeEventController = new AbortController();
  const signal = runtimeEventController.signal;
  runtimeEventTask = (async () => {
    let cursor = after ?? "0-0";
    while (!signal.aborted) {
      try {
        for await (const event of liveWorkflowRuntimeEvents({ after: cursor, signal })) {
          cursor = await applyWorkflowRuntimeEvent(event, async (data) => {
            await Promise.all([registerSchedule(data.workflowId), workflowRecordEvents.reconcile()]);
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        log.warn("Workflow runtime event reader failed", { error: errorMessage(error) });
        await Bun.sleep(1_000);
      }
    }
  })();
};

export const startWorkflowKernelRuntime = async (): Promise<void> => {
  if (reconcileTimer) return;
  const eventCursor = await latestWorkflowRuntimeEventCursor().catch((error) => {
    log.warn("Could not initialize workflow runtime event reader", { error: errorMessage(error) });
    return null;
  });
  await reconcileWorkflowKernelRuntime();
  workflowScheduler.start();
  startRuntimeEventReader(eventCursor);
  reconcileTimer = setInterval(() => {
    void reconcileWorkflowKernelRuntime().catch((error) => log.warn("Workflow runtime reconcile failed", { error: errorMessage(error) }));
  }, RECONCILE_INTERVAL_MS);
};

export const stopWorkflowKernelRuntime = async (): Promise<void> => {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  runtimeEventController?.abort();
  if (runtimeEventTask) await runtimeEventTask;
  runtimeEventController = null;
  runtimeEventTask = null;
  await workflowRecordEvents.stop();
  workflowJob.stop();
  await workflowScheduler.stop();
};
