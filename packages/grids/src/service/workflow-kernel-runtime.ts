import { logger, trace } from "@valentinkolb/cloud/services";
import type {
  WorkflowExecutionError,
  WorkflowInvocation,
  WorkflowInvocationMode,
  WorkflowInvocationReceipt,
  WorkflowJsonValue,
} from "@valentinkolb/cloud/workflows";
import {
  dryRunWorkflowPlan,
  executeWorkflowPlan,
  type WorkflowRuntimeRunIdentity,
  type WorkflowTraceEvent,
  type WorkflowTracePort,
} from "@valentinkolb/cloud/workflows/runtime";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { job, scheduler } from "@valentinkolb/sync";
import type { GridsWorkflow, GridsWorkflowChannel, GridsWorkflowRun } from "../workflows/contracts";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import { get as getDashboard } from "./dashboards";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { workflowConflict } from "./workflow-errors";
import { createGridsWorkflowActionPorts } from "./workflow-kernel-actions";
import { createWorkflowRecordEventRuntime } from "./workflow-kernel-record-events";
import {
  claimWorkflowRun,
  deferWorkflowRun,
  failQueuedWorkflowRun,
  finishWorkflowRun,
  type GridsWorkflowAuthorization,
  GridsWorkflowRuntimeRepository,
  getWorkflowRun,
  listRecoverableWorkflowRunIds,
  materializeWorkflowInvocation,
} from "./workflow-kernel-runs";
import { getWorkflow, listScheduledWorkflows } from "./workflow-kernel-store";
import { evaluateWorkflowTriggerInputs } from "./workflow-kernel-trigger-values";
import {
  createGridsWorkflowValueResolver,
  createWorkflowInputPreparationDeps,
  type GridsWorkflowPrincipal,
  loadWorkflowUserGroupIds,
  prepareWorkflowInputs,
} from "./workflow-kernel-values";
import { latestWorkflowRuntimeEventCursor, liveWorkflowRuntimeEvents } from "./workflow-runtime-events";

const log = logger("grids:workflow-kernel");
const workflowScheduler = scheduler({ id: "grids:workflows" });
const WORKFLOW_JOB_LEASE_MS = 30 * 60 * 1_000;
const WORKFLOW_JOB_MAX_RETRIES = 3;
const RECONCILE_INTERVAL_MS = 60_000;
const SCHEDULE_PREFIX = "grids:workflow:";

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
  const grants = await loadGrantsForUser({
    userId: principal.userId,
    userGroups: principal.groupIds,
    serviceAccountId: principal.serviceAccountId,
    baseId,
    workflowId,
  });
  return hasAtLeast(resolveEffectivePermission(grants, { baseId, workflowId }), required);
};

const canExecuteAcceptedRun = async (
  workflowId: string,
  baseId: string,
  principal: GridsWorkflowPrincipal,
  authorization: GridsWorkflowAuthorization,
  launcherId: string | null | undefined,
): Promise<boolean> => {
  if (authorization.kind === "workflow") return workflowPermission(workflowId, baseId, principal, "write");
  if (!launcherId) return false;
  const dashboard = await getDashboard(authorization.dashboardId);
  if (!dashboard || dashboard.baseId !== baseId) return false;
  if (
    !(await canReadDashboardIncludedData(dashboard, {
      userId: principal.userId,
      userGroups: principal.groupIds,
      serviceAccountId: principal.serviceAccountId,
    }))
  ) {
    return false;
  }
  const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === authorization.dashboardWidgetId);
  return widget?.kind === "workflow-button" && widget.launcherId === launcherId;
};

const runtimeIdentity = (
  run: Pick<GridsWorkflowRun, "id" | "workflowId" | "mode">,
  sourceHash: string,
  idempotencyKey: string,
  executionGeneration: number,
): WorkflowRuntimeRunIdentity => ({
  runId: run.id,
  executionGeneration,
  mode: run.mode,
  workflowId: run.workflowId ?? "deleted",
  sourceHash,
  idempotencyKey,
});

const finishExecution = async (
  identity: WorkflowRuntimeRunIdentity,
  result: Awaited<ReturnType<typeof executeWorkflowPlan>>,
): Promise<GridsWorkflowRun["status"]> => {
  if (result.state === "succeeded") {
    if (
      !(await finishWorkflowRun(identity, {
        status: "succeeded",
        result: result.output ?? null,
        resultMessage: result.message ?? null,
      }))
    )
      throw workflowConflict("Workflow run lost its execution lease.");
    return "succeeded";
  }
  if (result.state === "waiting") {
    if (!(await finishWorkflowRun(identity, { status: "waiting", result: { dependency: result.dependency } }))) {
      throw workflowConflict("Workflow run lost its execution lease.");
    }
    return "waiting";
  }
  if (result.state === "canceled") {
    if (!(await finishWorkflowRun(identity, { status: "canceled", resultMessage: result.message ?? null }))) {
      throw workflowConflict("Workflow run lost its execution lease.");
    }
    return "canceled";
  }
  if (!(await finishWorkflowRun(identity, { status: result.state, error: result.error }))) {
    throw workflowConflict("Workflow run lost its execution lease.");
  }
  return result.state;
};

const dryRunError = (code: string, message: string): WorkflowExecutionError => ({ code, message, retryable: false });

const finishDryRun = async (
  identity: WorkflowRuntimeRunIdentity,
  result: Awaited<ReturnType<typeof dryRunWorkflowPlan>>,
): Promise<GridsWorkflowRun["status"]> => {
  if (result.state === "planned") {
    if (
      !(await finishWorkflowRun(identity, {
        status: "succeeded",
        result: { effects: result.effects, ...(result.output === undefined ? {} : { output: result.output }) },
      }))
    )
      throw workflowConflict("Workflow run lost its execution lease.");
    return "succeeded";
  }
  if (result.state === "terminal") {
    const status = result.status === "succeeded" ? "succeeded" : "failed";
    if (
      !(await finishWorkflowRun(identity, {
        status,
        result: { effects: result.effects },
        resultMessage: result.message ?? null,
        ...(status === "failed" ? { error: dryRunError("WORKFLOW_DRY_RUN_TERMINAL", result.message ?? "Workflow would fail.") } : {}),
      }))
    ) {
      throw workflowConflict("Workflow run lost its execution lease.");
    }
    return status;
  }
  if (result.state === "canceled") {
    if (!(await finishWorkflowRun(identity, { status: "canceled", resultMessage: result.message ?? null }))) {
      throw workflowConflict("Workflow run lost its execution lease.");
    }
    return "canceled";
  }
  if (
    !(await finishWorkflowRun(identity, {
      status: "failed",
      result: { effects: result.effects },
      error: dryRunError(result.state === "unsupported" ? "WORKFLOW_DRY_RUN_UNSUPPORTED" : "WORKFLOW_DRY_RUN_INDETERMINATE", result.reason),
    }))
  )
    throw workflowConflict("Workflow run lost its execution lease.");
  return "failed";
};

export const processWorkflowRun = async (
  runId: string,
  heartbeat?: () => Promise<void>,
  workflowTrace?: WorkflowTracePort,
): Promise<WorkflowJobResult> => {
  const claimed = await claimWorkflowRun(runId);
  if (!claimed) return { runId, status: (await getWorkflowRun(runId))?.status ?? "missing" };
  const identity = runtimeIdentity(claimed.run, claimed.plan.sourceHash, claimed.idempotencyKey, claimed.executionGeneration);
  try {
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
      userId: claimed.run.actorUserId,
      groupIds: await loadWorkflowUserGroupIds(claimed.run.actorUserId),
      serviceAccountId: claimed.run.serviceAccountId,
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
    const repository = new GridsWorkflowRuntimeRepository();
    const runtimeRepository = heartbeat
      ? {
          heartbeat: async (run: WorkflowRuntimeRunIdentity) => {
            await heartbeat();
            return repository.heartbeat(run);
          },
          restoreStepOutcome: repository.restoreStepOutcome.bind(repository),
          startStep: repository.startStep.bind(repository),
          finishStep: repository.finishStep.bind(repository),
        }
      : repository;
    const actions = createGridsWorkflowActionPorts({
      workflow,
      authorizeExecution: () =>
        canExecuteAcceptedRun(workflow.id, claimed.run.baseId, actor, claimed.authorization, claimed.run.launcherId),
    });
    const values = createGridsWorkflowValueResolver(claimed.run.baseId, actor);
    const status =
      claimed.run.mode === "execute"
        ? await finishExecution(
            identity,
            await executeWorkflowPlan({
              runId,
              executionGeneration: claimed.executionGeneration,
              plan: claimed.plan,
              invocation: { ...invocation, mode: "execute" },
              repository: runtimeRepository,
              actions: actions.execute,
              values,
              ...(workflowTrace ? { trace: workflowTrace } : {}),
            }),
          )
        : await finishDryRun(
            identity,
            await dryRunWorkflowPlan({
              runId,
              executionGeneration: claimed.executionGeneration,
              plan: claimed.plan,
              invocation: { ...invocation, mode: "dryRun" },
              repository: runtimeRepository,
              actions: actions.dryRun,
              values,
              ...(workflowTrace ? { trace: workflowTrace } : {}),
            }),
          );
    return { runId, status };
  } catch (error) {
    await deferWorkflowRun(identity);
    throw error;
  }
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
  if (input.expectedRevision !== undefined && input.expectedRevision !== workflow.revision) {
    return fail(workflowConflict("Workflow changed since the caller loaded it."));
  }
  if (input.mode === "execute" && !workflow.enabled) return fail(err.badInput("workflow is disabled"));
  const authorization = input.authorization ?? { kind: "workflow" };
  if (!(await canExecuteAcceptedRun(workflow.id, workflow.baseId, input.principal, authorization, input.launcherId))) {
    return fail(err.forbidden("Workflow actor cannot run this workflow."));
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) return fail(err.badInput("invalid idempotency key"));
  try {
    const preparedInputs = await prepareWorkflowInputs(
      workflow.plan,
      input.inputs,
      createWorkflowInputPreparationDeps(workflow.baseId, input.principal, { trustedRecordIds: input.trustedRecordIds }),
    );
    const invocation: WorkflowInvocation<GridsWorkflowChannel> = {
      workflowId: workflow.id,
      expectedRevision: input.expectedRevision,
      mode: input.mode,
      channel: input.channel,
      actor: {
        userId: input.principal.userId,
        groupIds: input.principal.groupIds,
        serviceAccountId: input.principal.serviceAccountId,
      },
      inputs: preparedInputs,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      context: {
        ...(input.context ?? {}),
        workflow: { id: workflow.id, shortId: workflow.shortId, name: workflow.name },
      },
    };
    const receipt = await materializeWorkflowInvocation({
      baseId: workflow.baseId,
      invocation,
      launcherId: input.launcherId,
      authorization: input.authorization,
    });
    if (!receipt.ok) return receipt;
    await submitAcceptedWorkflowRun(receipt.data);
    return ok(receipt.data);
  } catch (error) {
    return fail(err.badInput(errorMessage(error)));
  }
};

const workflowRecordEvents = createWorkflowRecordEventRuntime(invokeGridsWorkflow);

const registerSchedule = async (workflowId: string): Promise<void> => {
  const workflow = await getWorkflow(workflowId);
  const trigger = workflow?.plan.triggers.find((item) => item.kind === "schedule");
  if (!workflow?.enabled || !trigger) {
    await workflowScheduler.delete({ id: `${SCHEDULE_PREFIX}${workflowId}` });
    return;
  }
  const cron = String(trigger.config.cron ?? "");
  const timezone = typeof trigger.config.timezone === "string" ? trigger.config.timezone : "UTC";
  await workflowScheduler.create({
    id: `${SCHEDULE_PREFIX}${workflow.id}`,
    cron,
    tz: timezone,
    meta: workflowScheduleMetadata(workflow),
    trace: trace.fromSyncSchedule<WorkflowJobResult>({
      name: `Grid workflow schedule: ${workflow.name}`,
      source: `${SCHEDULE_PREFIX}${workflow.id}`,
      appId: "grids",
      attributes: { "cloud.grids.workflow_id": workflow.id },
    }),
    process: async ({ ctx }) => {
      const current = await getWorkflow(workflow.id);
      if (!current?.enabled) return { runId: "", status: "disabled" };
      const currentTrigger = current.plan.triggers.find((item) => item.kind === "schedule");
      if (!currentTrigger) return { runId: "", status: "removed" };
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
      if (!result.ok) throw new Error(result.error.message);
      return { runId: result.data.runId, status: result.data.status };
    },
  });
};

export const reconcileWorkflowKernelRuntime = async (): Promise<void> => {
  const recoverable = await listRecoverableWorkflowRunIds();
  await Promise.all(
    recoverable.map((runId) =>
      submitWorkflowRun(runId).catch((error) =>
        log.warn("Could not submit recoverable workflow run", { runId, error: errorMessage(error) }),
      ),
    ),
  );
  const workflows = await listScheduledWorkflows();
  const activeIds = new Set(workflows.map((workflow) => `${SCHEDULE_PREFIX}${workflow.id}`));
  for (const workflow of workflows) await registerSchedule(workflow.id);
  for (const item of await workflowScheduler.list()) {
    if (item.id.startsWith(SCHEDULE_PREFIX) && !activeIds.has(item.id)) await workflowScheduler.delete({ id: item.id });
  }
  await workflowRecordEvents.reconcile();
};

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let runtimeEventController: AbortController | null = null;
let runtimeEventTask: Promise<void> | null = null;

const startRuntimeEventReader = (after: string | null): void => {
  if (runtimeEventTask) return;
  runtimeEventController = new AbortController();
  const signal = runtimeEventController.signal;
  runtimeEventTask = (async () => {
    let cursor = after ?? "0-0";
    while (!signal.aborted) {
      try {
        for await (const event of liveWorkflowRuntimeEvents({ after: cursor, signal })) {
          cursor = event.cursor;
          await Promise.all([registerSchedule(event.data.workflowId), workflowRecordEvents.reconcile()]);
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
  workflowScheduler.start();
  await reconcileWorkflowKernelRuntime();
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
