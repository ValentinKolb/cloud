import { logger, trace } from "@valentinkolb/cloud/services";
import type { WorkflowInvocation, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import {
  coordinateWorkflowExecution,
  dryRunWorkflowPlan,
  executeWorkflowPlan,
  type WorkflowTraceEvent,
  type WorkflowTracePort,
} from "@valentinkolb/cloud/workflows/runtime";
import { job, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import { requireMailboxPermission } from "./access";
import { latestMailWorkflowDependencyCursor, liveMailWorkflowDependencies } from "./workflow-dependencies";
import { createMailWorkflowActionPorts } from "./workflow-runtime-actions";
import { resolveMailWorkflowExecutionAuthority } from "./workflow-runtime-context";
import {
  createMailWorkflowCoordinatorPort,
  listRecoverableMailWorkflowTargetIds,
  MAIL_WORKFLOW_TARGET_LEASE_MS,
  MailWorkflowRuntimeRepository,
  type MailWorkflowTargetResult,
  resumeMailWorkflowDependency,
} from "./workflow-runtime-repository";
import { createMailWorkflowValueResolver } from "./workflow-runtime-values";
import {
  reconcileMailWorkflowSchedules,
  startMailWorkflowScheduleRuntime,
  stopMailWorkflowScheduleRuntime,
} from "./workflow-schedule-runtime";
import { reconcileMailWorkflowTriggerEvents, stopMailWorkflowTriggerRuntime } from "./workflow-trigger-runtime";

const log = logger("mail:workflow-runtime");
const WORKFLOW_JOB_ID = "mail:workflow-targets:v1";
const WORKFLOW_JOB_MAX_RETRIES = 3;
const WORKFLOW_HEARTBEAT_MS = Math.floor(MAIL_WORKFLOW_TARGET_LEASE_MS / 3);
const RECONCILE_LIMIT = 500;

const isObject = (value: WorkflowJsonValue): value is Record<string, WorkflowJsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const traceAttributes = (event: WorkflowTraceEvent, parentRunId: string, targetId: string) => {
  const step = "step" in event ? event.step : null;
  return {
    "cloud.mail.workflow_run_id": parentRunId,
    "cloud.mail.workflow_target_id": targetId,
    "workflow.event": event.type,
    "workflow.step.action": step?.action,
    "workflow.step.key": step?.key,
    "workflow.step.kind": step?.kind,
    "workflow.step.outcome": event.type === "step.finished" ? event.result.outcome.state : undefined,
  };
};

const workflowStepTrace = (jobId: string, parentRunId: string, targetId: string): WorkflowTracePort => ({
  emit: async (event) => {
    await trace.record({
      spanKey: `sync:job:${WORKFLOW_JOB_ID}:${jobId}`,
      name: "Mail workflow target",
      source: WORKFLOW_JOB_ID,
      appId: "mail",
      category: "job",
      kind: "consumer",
      event: `workflow.${event.type}`,
      attributes: traceAttributes(event, parentRunId, targetId),
    });
  },
});

export const processMailWorkflowTarget = async (params: {
  targetId: string;
  workerId: string;
  jobId?: string;
}): Promise<{ state: string; result?: MailWorkflowTargetResult }> => {
  const coordinated = await coordinateWorkflowExecution({
    input: params.targetId,
    heartbeatMs: WORKFLOW_HEARTBEAT_MS,
    port: createMailWorkflowCoordinatorPort(params.workerId),
    execute: async ({ claim }): Promise<MailWorkflowTargetResult> => {
      const authority = await resolveMailWorkflowExecutionAuthority({
        snapshot: claim.authorization,
        mailboxId: claim.mailboxId,
        workflowVersionId: claim.workflowVersionId,
        runId: claim.parentRunId,
      });
      if (!authority) return { state: "canceled", message: "Workflow execution authority is no longer active" };
      if (authority.kind === "actor") {
        const allowed = await requireMailboxPermission(authority.context, claim.mailboxId, "write");
        if (!allowed.ok) return { state: "canceled", message: "Workflow actor's mailbox write access was revoked" };
      }
      const repository = new MailWorkflowRuntimeRepository(claim);
      const sourceContext = isObject(claim.source) ? claim.source : {};
      const actorSnapshot = claim.authorization.authority === "actor" ? claim.authorization.actor : null;
      const invocationActor = {
        userId: actorSnapshot?.kind === "user" ? actorSnapshot.userId : null,
        groupIds: [],
        serviceAccountId: actorSnapshot?.kind === "service_account" ? actorSnapshot.serviceAccountId : null,
      };
      const invocation: WorkflowInvocation = {
        workflowId: claim.workflowId,
        expectedRevision: claim.versionIdentity,
        mode: claim.mode,
        channel: claim.channel,
        actor: invocationActor,
        inputs: claim.inputs,
        idempotencyKey: `${claim.idempotencyKey}:${claim.runId}`,
        occurredAt: claim.occurredAt,
        context: {
          ...sourceContext,
          mailboxId: claim.mailboxId,
          actor: invocationActor,
          occurredAt: claim.occurredAt,
          workflow: { id: claim.workflowId, versionId: claim.workflowVersionId },
        },
      };
      const ports = createMailWorkflowActionPorts({
        authority,
        mailboxId: claim.mailboxId,
        workflowVersionId: claim.workflowVersionId,
        targetId: claim.runId,
        preconditions: claim.preconditions,
      });
      const common = {
        runId: claim.runId,
        executionGeneration: claim.executionGeneration,
        plan: claim.plan,
        invocation,
        repository,
        clock: { now: () => claim.executionClockAt },
        values: createMailWorkflowValueResolver({ targetId: claim.runId, inputs: claim.inputs }),
        trace: params.jobId ? workflowStepTrace(params.jobId, claim.parentRunId, claim.runId) : undefined,
      };
      return claim.mode === "execute"
        ? await executeWorkflowPlan({ ...common, invocation: { ...invocation, mode: "execute" }, actions: ports.execute })
        : await dryRunWorkflowPlan({ ...common, invocation: { ...invocation, mode: "dryRun" }, actions: ports.dryRun });
    },
  });

  if (coordinated.state === "retry") throw coordinated.error;
  if (coordinated.state === "released") throw coordinated.error;
  if (coordinated.state === "finished") return { state: coordinated.result.state, result: coordinated.result };
  return { state: coordinated.state };
};

const workflowTargetJob = job<{ targetId: string }, { state: string }>({
  id: WORKFLOW_JOB_ID,
  defaults: { leaseMs: MAIL_WORKFLOW_TARGET_LEASE_MS, keyTtlMs: 7 * 24 * 60 * 60_000 },
  trace: trace.fromSyncJob({
    name: "Mail workflow target",
    source: WORKFLOW_JOB_ID,
    appId: "mail",
    attributes: (event) => ("input" in event && event.input ? { "cloud.mail.workflow_target_id": event.input.targetId } : {}),
  }),
  process: async ({ ctx }) => {
    const result = await processMailWorkflowTarget({ targetId: ctx.input.targetId, workerId: ctx.jobId, jobId: ctx.jobId });
    return { state: result.state };
  },
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < WORKFLOW_JOB_MAX_RETRIES) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 2_000, maxMs: 60_000 }) });
    }
  },
});

export const enqueueWorkflowTarget = async (targetId: string): Promise<void> => {
  await workflowTargetJob.submit({
    key: `target:${targetId}`,
    input: { targetId },
    leaseMs: MAIL_WORKFLOW_TARGET_LEASE_MS,
  });
};

const submitTargetIds = async (targetIds: readonly string[]): Promise<void> => {
  for (let offset = 0; offset < targetIds.length; offset += 50) {
    await Promise.all(targetIds.slice(offset, offset + 50).map((targetId) => enqueueWorkflowTarget(targetId)));
  }
};

export const enqueueWorkflowRun = async (runId: string): Promise<void> => {
  let after: string | null = null;
  while (true) {
    const rows: { id: string }[] = await sql<{ id: string }[]>`
      SELECT id
      FROM mail.workflow_run_targets
      WHERE parent_run_id = ${runId}::uuid
        AND state = 'queued'
        AND (${after}::uuid IS NULL OR id > ${after}::uuid)
      ORDER BY id
      LIMIT ${RECONCILE_LIMIT}
    `;
    if (rows.length === 0) return;
    await submitTargetIds(rows.map((row) => row.id));
    after = rows.at(-1)!.id;
    if (rows.length < RECONCILE_LIMIT) return;
  }
};

const reconcileTerminalDependencies = async (): Promise<number> => {
  const dependencies = await sql<{ kind: string; key: string }[]>`
    SELECT DISTINCT step.dependency ->> 'kind' AS kind, step.dependency ->> 'key' AS key
    FROM mail.workflow_step_runs step
    JOIN mail.workflow_run_targets target ON target.id = step.target_id
    LEFT JOIN mail.commands command
      ON step.dependency ->> 'kind' = 'mail.command'
     AND command.id = (step.dependency ->> 'key')::uuid
    LEFT JOIN mail.message_contents message
      ON step.dependency ->> 'kind' = 'mail.hydration'
     AND message.id = (step.dependency ->> 'key')::uuid
    WHERE step.state = 'waiting'
      AND target.state = 'waiting'
      AND (
        (step.dependency ->> 'kind' = 'mail.command' AND command.state IN ('confirmed', 'failed', 'cancelled', 'reconciled', 'needs_attention'))
        OR (
          step.dependency ->> 'kind' = 'mail.hydration'
          AND (
            message.hydration_status = 'complete'
            OR (message.hydration_status = 'failed' AND message.hydration_attempt >= 5)
          )
        )
      )
    ORDER BY kind, key
    LIMIT ${RECONCILE_LIMIT}
  `;
  let resumed = 0;
  for (const dependency of dependencies) {
    const targetIds = await resumeMailWorkflowDependency(dependency);
    resumed += targetIds.length;
    await submitTargetIds(targetIds);
  }
  return resumed;
};

const reconcileWorkflowTargets = async (): Promise<number> => {
  const targetIds = await listRecoverableMailWorkflowTargetIds(RECONCILE_LIMIT);
  await submitTargetIds(targetIds);
  return targetIds.length;
};

const workflowRuntimeScheduler = scheduler({ id: "mail:workflow-runtime" });
const dependencyReaders = new Map<string, { abort: AbortController; task: Promise<void> }>();
let runtimeStarted = false;

const startDependencyReader = async (mailboxId: string): Promise<void> => {
  if (dependencyReaders.has(mailboxId)) return;
  const after = await latestMailWorkflowDependencyCursor(mailboxId);
  const abort = new AbortController();
  const task = (async () => {
    try {
      for await (const event of liveMailWorkflowDependencies({ mailboxId, after, signal: abort.signal })) {
        const targetIds = await resumeMailWorkflowDependency({ kind: event.data.kind, key: event.data.key });
        await submitTargetIds(targetIds);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        log.error("Mail workflow dependency reader stopped", {
          mailboxId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      dependencyReaders.delete(mailboxId);
    }
  })();
  dependencyReaders.set(mailboxId, { abort, task });
};

const ensureDependencyReaders = async (): Promise<void> => {
  const rows = await sql<{ mailbox_id: string }[]>`
    SELECT DISTINCT mailbox_id
    FROM mail.workflow_runs
    WHERE state IN ('queued', 'running', 'waiting')
    ORDER BY mailbox_id
  `;
  await Promise.all(rows.map((row) => startDependencyReader(row.mailbox_id)));
};

const reconcileRuntime = async (): Promise<{ targets: number; dependencies: number; triggerEvents: number }> => {
  await ensureDependencyReaders();
  const result = {
    targets: await reconcileWorkflowTargets(),
    dependencies: await reconcileTerminalDependencies(),
    triggerEvents: await reconcileMailWorkflowTriggerEvents(),
  };
  await reconcileMailWorkflowSchedules();
  return result;
};

export const workflowRuntime = {
  start: async (): Promise<void> => {
    if (runtimeStarted) return;
    await workflowRuntimeScheduler.create({
      id: "mail:workflow-runtime:reconcile",
      cron: "* * * * *",
      meta: { appId: "mail", family: "mail:workflows", label: "Mail workflow recovery" },
      process: reconcileRuntime,
    });
    await startMailWorkflowScheduleRuntime();
    workflowRuntimeScheduler.start();
    await reconcileRuntime();
    runtimeStarted = true;
  },
  stop: async (): Promise<void> => {
    for (const reader of dependencyReaders.values()) reader.abort.abort();
    await Promise.all([...dependencyReaders.values()].map((reader) => reader.task.catch(() => undefined)));
    dependencyReaders.clear();
    if (runtimeStarted) await workflowRuntimeScheduler.stop();
    await stopMailWorkflowScheduleRuntime();
    workflowTargetJob.stop();
    stopMailWorkflowTriggerRuntime();
    runtimeStarted = false;
  },
};
