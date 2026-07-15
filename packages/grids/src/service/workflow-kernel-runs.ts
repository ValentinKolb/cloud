import { toPgTextArray, toPgUuidArray } from "@valentinkolb/cloud/services";
import type {
  WorkflowBoundPlan,
  WorkflowDependency,
  WorkflowInvocation,
  WorkflowInvocationReceipt,
  WorkflowJsonValue,
} from "@valentinkolb/cloud/workflows";
import { hashWorkflowJson } from "@valentinkolb/cloud/workflows/language";
import type {
  WorkflowCoordinatorLeaseState,
  WorkflowCoordinatorPort,
  WorkflowHeartbeatOutcome,
  WorkflowRestoredStep,
  WorkflowRuntimeRepositoryPort,
  WorkflowRuntimeRunIdentity,
  WorkflowRuntimeStepIdentity,
  WorkflowRuntimeStepResult,
} from "@valentinkolb/cloud/workflows/runtime";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { WorkflowRunEventScope } from "../lib/workflow-run-events";
import {
  type GridsWorkflowChannel,
  type GridsWorkflowCredential,
  type GridsWorkflowPrincipal,
  type GridsWorkflowRun,
  toWorkflowRevision,
} from "../workflows/contracts";
import type { SqlClient } from "./audit";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { workflowConflict } from "./workflow-errors";
import { listWorkflowStepRuns } from "./workflow-kernel-observability";
import { notifyWorkflowRunEvent } from "./workflow-run-events";

type DbRow = Record<string, unknown>;

export const WORKFLOW_RUN_LEASE_MS = 120_000;

export type GridsWorkflowAuthorization =
  | { kind: "workflow" }
  | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

export type MaterializeWorkflowInvocation = {
  baseId: string;
  invocation: WorkflowInvocation<GridsWorkflowChannel>;
  preparedRevision?: number;
  requestFingerprint?: string;
  launcherId?: string | null;
  actorUserId?: string | null;
  actorGroupIds?: string[];
  serviceAccountId?: string | null;
  principal?: GridsWorkflowPrincipal;
  authorization?: GridsWorkflowAuthorization;
};

export type ClaimedWorkflowRun = {
  runId: string;
  run: GridsWorkflowRun;
  plan: WorkflowBoundPlan;
  context: Record<string, WorkflowJsonValue>;
  actorGroupIds: string[];
  principal: GridsWorkflowPrincipal;
  authorization: GridsWorkflowAuthorization;
  idempotencyKey: string;
  occurredAt: string;
  executionClockAt: string;
  executionGeneration: number;
};

const mapRun = (row: DbRow): GridsWorkflowRun => ({
  id: row.id as string,
  workflowId: (row.workflow_id as string | null) ?? null,
  launcherId: (row.launcher_id as string | null) ?? null,
  baseId: row.base_id as string,
  workflowRevision: Number(row.workflow_revision),
  mode: row.mode as GridsWorkflowRun["mode"],
  channel: row.channel as GridsWorkflowChannel,
  actorUserId: (row.actor_user_id as string | null) ?? null,
  serviceAccountId: (row.service_account_id as string | null) ?? null,
  inputs: parseJsonbRow<Record<string, WorkflowJsonValue>>(row.inputs, {}),
  status: row.status as GridsWorkflowRun["status"],
  result: parseJsonbRow<WorkflowJsonValue | null>(row.result, null),
  error: parseJsonbRow<GridsWorkflowRun["error"]>(row.error, null),
  resultMessage: (row.result_message as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

const materializedPrincipal = (
  input: Pick<MaterializeWorkflowInvocation, "invocation" | "principal" | "actorUserId" | "actorGroupIds" | "serviceAccountId">,
): GridsWorkflowPrincipal =>
  input.principal ?? {
    userId: input.actorUserId ?? input.invocation.actor.userId ?? null,
    groupIds: input.actorGroupIds ?? input.invocation.actor.groupIds ?? [],
    serviceAccountId: input.serviceAccountId ?? input.invocation.actor.serviceAccountId ?? null,
    actorServiceAccountId: null,
    credential: null,
  };

const credentialFromRow = (row: DbRow): GridsWorkflowCredential | null => {
  const kind = row.credential_kind;
  if (kind !== "api_token" && kind !== "oauth") return null;
  const resourceBinding =
    typeof row.credential_resource_app_id === "string" &&
    typeof row.credential_resource_type === "string" &&
    typeof row.credential_resource_id === "string"
      ? {
          appId: row.credential_resource_app_id,
          resourceType: row.credential_resource_type,
          resourceId: row.credential_resource_id,
        }
      : null;
  return {
    kind,
    id: (row.credential_id as string | null) ?? null,
    scopes: parseJsonbRow<string[]>(row.credential_scopes, []),
    permissionCap: (row.credential_permission_cap as GridsWorkflowCredential["permissionCap"] | null) ?? "none",
    expiresAt: row.credential_expires_at ? (row.credential_expires_at as Date).toISOString() : null,
    resourceBinding,
  };
};

const principalFromRow = (row: DbRow): GridsWorkflowPrincipal => ({
  userId: (row.actor_user_id as string | null) ?? null,
  groupIds: parseJsonbRow<string[]>(row.actor_group_ids, []),
  serviceAccountId: (row.service_account_id as string | null) ?? null,
  actorServiceAccountId: (row.actor_service_account_id as string | null) ?? null,
  credential: credentialFromRow(row),
});

const auditPrincipal = (row: DbRow) => ({
  actorUserId: (row.actor_user_id as string | null) ?? null,
  actorServiceAccountId: (row.actor_service_account_id as string | null) ?? null,
  credentialId: (row.credential_id as string | null) ?? null,
  credentialKind: (row.credential_kind as string | null) ?? null,
  credentialPermissionCap: (row.credential_permission_cap as string | null) ?? null,
  credentialResourceBinding:
    typeof row.credential_resource_app_id === "string" &&
    typeof row.credential_resource_type === "string" &&
    typeof row.credential_resource_id === "string"
      ? {
          appId: row.credential_resource_app_id,
          resourceType: row.credential_resource_type,
          resourceId: row.credential_resource_id,
        }
      : null,
});

export const workflowInvocationFingerprint = (
  input: Pick<MaterializeWorkflowInvocation, "invocation" | "principal" | "actorUserId" | "actorGroupIds" | "serviceAccountId">,
): Promise<string> => {
  const principal = materializedPrincipal(input);
  const context = Object.fromEntries(Object.entries(input.invocation.context ?? {}).filter(([key]) => key !== "workflow"));
  return hashWorkflowJson({
    workflowId: input.invocation.workflowId,
    mode: input.invocation.mode,
    channel: input.invocation.channel,
    actor: {
      userId: principal.userId,
      serviceAccountId: principal.serviceAccountId,
      actorServiceAccountId: principal.actorServiceAccountId ?? null,
      credential: principal.credential ?? null,
    },
    inputs: input.invocation.inputs,
    context,
  });
};

const existingInvocationReceipt = async (
  input: MaterializeWorkflowInvocation,
  existing: DbRow,
): Promise<Result<WorkflowInvocationReceipt>> => {
  const existingRevision = Number(existing.workflow_revision);
  if (input.invocation.expectedRevision !== undefined && input.invocation.expectedRevision !== toWorkflowRevision(existingRevision)) {
    return fail(workflowConflict("Workflow changed since the caller loaded it."));
  }
  const fingerprint = input.requestFingerprint ?? (await workflowInvocationFingerprint(input));
  if (existing.request_fingerprint !== fingerprint) {
    return fail(workflowConflict("Idempotency key was already used for a different workflow invocation."));
  }
  const run = mapRun(existing);
  return ok({
    runId: run.id,
    workflowId: input.invocation.workflowId,
    revision: toWorkflowRevision(existingRevision),
    mode: input.invocation.mode,
    channel: input.invocation.channel,
    created: false,
    status: run.status,
  });
};

export const findMaterializedWorkflowInvocation = async (
  input: MaterializeWorkflowInvocation,
): Promise<Result<WorkflowInvocationReceipt> | null> => {
  const [existing] = await sql<DbRow[]>`
    SELECT id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
           service_account_id, inputs, status, result, error, result_message, request_fingerprint,
           created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE workflow_id = ${input.invocation.workflowId}::uuid
      AND mode = ${input.invocation.mode}
      AND channel = ${input.invocation.channel}
      AND idempotency_key = ${input.invocation.idempotencyKey}
  `;
  return existing ? existingInvocationReceipt(input, existing) : null;
};

export const materializeWorkflowInvocation = async (input: MaterializeWorkflowInvocation): Promise<Result<WorkflowInvocationReceipt>> => {
  const result = await sql.begin(async (tx): Promise<Result<WorkflowInvocationReceipt>> => {
    const [existing] = await tx<DbRow[]>`
      SELECT id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
             service_account_id, inputs, status, result, error, result_message, request_fingerprint,
             created_at, started_at, finished_at
      FROM grids.workflow_runs
      WHERE workflow_id = ${input.invocation.workflowId}::uuid
        AND mode = ${input.invocation.mode}
        AND channel = ${input.invocation.channel}
        AND idempotency_key = ${input.invocation.idempotencyKey}
    `;
    if (existing) return existingInvocationReceipt(input, existing);

    const [workflow] = await tx<DbRow[]>`
      SELECT base_id, revision, plan, enabled
      FROM grids.workflows
      WHERE id = ${input.invocation.workflowId}::uuid AND deleted_at IS NULL
      FOR SHARE
    `;
    if (!workflow) return fail(err.notFound("workflow"));
    if (workflow.base_id !== input.baseId) return fail(err.badInput("workflow base does not match invocation"));
    const workflowRevision = Number(workflow.revision);
    if (input.preparedRevision !== undefined && input.preparedRevision !== workflowRevision) {
      return fail(workflowConflict("Workflow changed while the invocation was being prepared."));
    }
    if (input.invocation.expectedRevision !== undefined && input.invocation.expectedRevision !== toWorkflowRevision(workflowRevision)) {
      return fail(workflowConflict("Workflow changed since the caller loaded it."));
    }
    if (input.invocation.mode === "execute" && workflow.enabled !== true) return fail(err.badInput("workflow is disabled"));
    const plan = parseJsonbRow<WorkflowBoundPlan>(workflow.plan, {} as WorkflowBoundPlan);
    const fingerprint = input.requestFingerprint ?? (await workflowInvocationFingerprint(input));
    const principal = materializedPrincipal(input);
    const credential = principal.credential ?? null;
    const binding = credential?.resourceBinding ?? null;
    const [inserted] = await tx<DbRow[]>`
      INSERT INTO grids.workflow_runs (
        workflow_id, launcher_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
        actor_user_id, service_account_id, actor_service_account_id,
        credential_kind, credential_id, credential_scopes, credential_permission_cap, credential_expires_at,
        credential_resource_app_id, credential_resource_type, credential_resource_id,
        actor_group_ids, authorization_snapshot, inputs, context, workflow_plan,
        status, occurred_at
      ) VALUES (
        ${input.invocation.workflowId}::uuid,
        ${input.launcherId ?? null}::uuid,
        ${input.baseId}::uuid,
        ${workflowRevision},
        ${input.invocation.mode},
        ${input.invocation.channel},
        ${input.invocation.idempotencyKey},
        ${fingerprint},
        ${principal.userId}::uuid,
        ${principal.serviceAccountId}::uuid,
        ${principal.actorServiceAccountId ?? null}::uuid,
        ${credential?.kind ?? null},
        ${credential?.id ?? null}::uuid,
        ${toPgTextArray(credential?.scopes ?? [])}::text[],
        ${credential?.permissionCap ?? null},
        ${credential?.expiresAt ?? null}::timestamptz,
        ${binding?.appId ?? null},
        ${binding?.resourceType ?? null},
        ${binding?.resourceId ?? null},
        ${toPgUuidArray(principal.groupIds)}::uuid[],
        ${input.authorization ?? { kind: "workflow" }}::jsonb,
        ${input.invocation.inputs}::jsonb,
        ${input.invocation.context ?? {}}::jsonb,
        ${plan}::jsonb,
        'queued',
        ${input.invocation.occurredAt}::timestamptz
      )
      ON CONFLICT (workflow_id, mode, channel, idempotency_key)
      WHERE workflow_id IS NOT NULL
      DO NOTHING
      RETURNING id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
                service_account_id, inputs, status, result, error, result_message, created_at, started_at, finished_at
    `;
    const row =
      inserted ??
      (
        await tx<DbRow[]>`
      SELECT id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
             service_account_id, inputs, status, result, error, result_message, request_fingerprint,
             created_at, started_at, finished_at
      FROM grids.workflow_runs
      WHERE workflow_id = ${input.invocation.workflowId}::uuid
        AND mode = ${input.invocation.mode}
        AND channel = ${input.invocation.channel}
        AND idempotency_key = ${input.invocation.idempotencyKey}
    `
      )[0];
    if (!row) return fail(err.internal("workflow invocation could not be materialized"));
    if (!inserted && row.request_fingerprint !== fingerprint) {
      return fail(workflowConflict("Idempotency key was already used for a different workflow invocation."));
    }
    const run = mapRun(row);
    return ok({
      runId: run.id,
      workflowId: input.invocation.workflowId,
      revision: toWorkflowRevision(Number(row.workflow_revision)),
      mode: input.invocation.mode,
      channel: input.invocation.channel,
      created: Boolean(inserted),
      status: run.status,
    });
  });
  if (result.ok && result.data.created) await notifyPersistedWorkflowRun(result.data.runId, "accepted");
  return result;
};

const claimColumns = sql`
  id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id, service_account_id,
  actor_service_account_id, credential_kind, credential_id, to_json(credential_scopes) AS credential_scopes,
  credential_permission_cap, credential_expires_at, credential_resource_app_id, credential_resource_type, credential_resource_id,
  to_json(actor_group_ids) AS actor_group_ids, authorization_snapshot AS authorization, inputs, context, workflow_plan, status, result,
  error, result_message, idempotency_key, occurred_at, execution_clock_at, execution_generation, queue_attempts,
  created_at, started_at, finished_at
`;

export const claimWorkflowRun = async (runId: string): Promise<ClaimedWorkflowRun | null> => {
  const row = await sql.begin(async (tx) => {
    const [claimed] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = 'running',
          started_at = COALESCE(started_at, now()),
          heartbeat_at = now(),
          lease_expires_at = now() + (${WORKFLOW_RUN_LEASE_MS} * interval '1 millisecond'),
          execution_generation = execution_generation + 1,
          queue_attempts = queue_attempts + 1,
          last_queue_attempt_at = now()
      WHERE id = ${runId}::uuid
        AND (
          status = 'queued'
          OR (status = 'running' AND lease_expires_at < now())
        )
      RETURNING ${claimColumns}
    `;
    if (!claimed) return null;
    await logAudit(
      {
        baseId: claimed.base_id as string,
        userId: (claimed.actor_user_id as string | null) ?? null,
        action: Number(claimed.queue_attempts) > 1 ? "workflow.run.recovered" : "workflow.run.started",
        diff: {
          workflowRun: {
            old: null,
            new: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              mode: claimed.mode,
              channel: claimed.channel,
              queueAttempt: claimed.queue_attempts,
              principal: auditPrincipal(claimed),
            },
          },
        },
      },
      tx,
    );
    return claimed;
  });
  if (!row) return null;
  await notifyPersistedWorkflowRun(row.id as string, `running:${row.execution_generation}`);
  return {
    runId: row.id as string,
    run: mapRun(row),
    plan: parseJsonbRow<WorkflowBoundPlan>(row.workflow_plan, {} as WorkflowBoundPlan),
    context: parseJsonbRow<Record<string, WorkflowJsonValue>>(row.context, {}),
    actorGroupIds: parseJsonbRow<string[]>(row.actor_group_ids, []),
    principal: principalFromRow(row),
    authorization: parseJsonbRow<GridsWorkflowAuthorization>(row.authorization, { kind: "workflow" }),
    idempotencyKey: row.idempotency_key as string,
    occurredAt: (row.occurred_at as Date).toISOString(),
    executionClockAt: (row.execution_clock_at as Date).toISOString(),
    executionGeneration: Number(row.execution_generation),
  };
};

export const listRecoverableWorkflowRunIds = async (limit = 200): Promise<string[]> => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM grids.workflow_runs
    WHERE status = 'queued'
       OR (status = 'running' AND lease_expires_at < now())
    ORDER BY created_at, id
    LIMIT ${Math.max(1, Math.min(limit, 1000))}
  `;
  return rows.map((row) => row.id);
};

export const listExpiredWaitingWorkflowRunIds = async (limit = 200): Promise<string[]> => {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM grids.workflow_runs
    WHERE status = 'waiting'
      AND result #>> '{dependency,deadline}' IS NOT NULL
      AND (result #>> '{dependency,deadline}')::timestamptz <= now()
    ORDER BY created_at, id
    LIMIT ${Math.max(1, Math.min(limit, 1000))}
  `;
  return rows.map((row) => row.id);
};

export const resumeWaitingWorkflowRun = async (runId: string, dependency?: WorkflowDependency): Promise<boolean> => {
  const rows = await sql`
    UPDATE grids.workflow_runs
    SET status = 'queued', result = NULL, error = NULL, result_message = NULL, heartbeat_at = now(), lease_expires_at = NULL
    WHERE id = ${runId}::uuid
      AND status = 'waiting'
      AND (${dependency === undefined} OR result->'dependency' = ${dependency ?? null}::jsonb)
    RETURNING id
  `;
  const changed = rows.length > 0;
  if (changed) await notifyPersistedWorkflowRun(runId, "resumed");
  return changed;
};

export const getWorkflowRun = async (runId: string): Promise<GridsWorkflowRun | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, workflow_id, launcher_id, base_id, workflow_revision, mode, channel, actor_user_id,
           service_account_id, inputs, status, result, error, result_message, created_at, started_at, finished_at
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? mapRun(row) : null;
};

export const getWorkflowRunAuthorization = async (runId: string): Promise<GridsWorkflowAuthorization | null> => {
  const [row] = await sql<Array<{ authorization: unknown }>>`
    SELECT authorization_snapshot AS authorization
    FROM grids.workflow_runs
    WHERE id = ${runId}::uuid
  `;
  return row ? parseJsonbRow<GridsWorkflowAuthorization>(row.authorization, { kind: "workflow" }) : null;
};

const eventScope = (authorization: GridsWorkflowAuthorization | null): WorkflowRunEventScope =>
  authorization?.kind === "dashboard-widget"
    ? { kind: "dashboard-widget", dashboardId: authorization.dashboardId, dashboardWidgetId: authorization.dashboardWidgetId }
    : { kind: "workflow" };

const notifyPersistedWorkflowRun = async (runId: string, transitionId: string): Promise<void> => {
  const [run, authorization] = await Promise.all([getWorkflowRun(runId), getWorkflowRunAuthorization(runId)]);
  if (!run) return;
  await notifyWorkflowRunEvent(run, await listWorkflowStepRuns(runId), eventScope(authorization), transitionId);
};

export const getActiveWorkflowStepRunId = async (
  step: Pick<WorkflowRuntimeStepIdentity, "runId" | "key" | "executionGeneration">,
): Promise<string> => {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT step_run.id::text AS id
    FROM grids.workflow_step_runs step_run
    JOIN grids.workflow_runs run ON run.id = step_run.run_id
    WHERE step_run.run_id = ${step.runId}::uuid
      AND step_run.step_key = ${step.key}
      AND step_run.status = 'running'
      AND step_run.execution_generation = ${step.executionGeneration}
      AND run.status = 'running'
      AND run.execution_generation = ${step.executionGeneration}
  `;
  if (!row) throw workflowConflict(`Workflow step "${step.key}" lost its execution lease.`);
  return row.id;
};

export const deferWorkflowRun = async (run: WorkflowRuntimeRunIdentity): Promise<boolean> => {
  const rows = await sql`
    UPDATE grids.workflow_runs
    SET status = 'queued', lease_expires_at = NULL, heartbeat_at = now()
    WHERE id = ${run.runId}::uuid
      AND status = 'running'
      AND execution_generation = ${run.executionGeneration}
    RETURNING id
  `;
  const changed = rows.length > 0;
  if (changed) await notifyPersistedWorkflowRun(run.runId, `queued:${run.executionGeneration}`);
  return changed;
};

export const renewWorkflowRunLease = async (
  run: Pick<WorkflowRuntimeRunIdentity, "runId" | "executionGeneration">,
): Promise<WorkflowCoordinatorLeaseState> => {
  const rows = await sql`
    UPDATE grids.workflow_runs
    SET heartbeat_at = now(), lease_expires_at = now() + (${WORKFLOW_RUN_LEASE_MS} * interval '1 millisecond')
    WHERE id = ${run.runId}::uuid
      AND status = 'running'
      AND execution_generation = ${run.executionGeneration}
    RETURNING id
  `;
  if (rows.length > 0) return { state: "active" };

  const [current] = await sql<Array<{ status: string; execution_generation: number }>>`
    SELECT status, execution_generation
    FROM grids.workflow_runs
    WHERE id = ${run.runId}::uuid
  `;
  return current?.status === "canceled" && Number(current.execution_generation) === run.executionGeneration
    ? { state: "canceled", message: "workflow run was canceled" }
    : { state: "stale" };
};

export const failQueuedWorkflowRun = async (runId: string, message: string): Promise<boolean> => {
  const error = { code: "WORKFLOW_RUNTIME_ERROR", message, retryable: false };
  const changed = await sql.begin(async (tx) => {
    const [row] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = 'failed', error = ${error}::jsonb, lease_expires_at = NULL, heartbeat_at = now(), finished_at = now()
      WHERE id = ${runId}::uuid AND status = 'queued'
      RETURNING id, workflow_id, base_id, actor_user_id, actor_service_account_id, credential_id, credential_kind,
                credential_permission_cap, credential_resource_app_id, credential_resource_type, credential_resource_id, mode, channel
    `;
    if (!row) return false;
    await tx`
      UPDATE grids.workflow_step_runs
      SET status = 'failed', outcome = ${{ state: "failed", error }}::jsonb, finished_at = now()
      WHERE run_id = ${runId}::uuid AND status IN ('running', 'waiting')
    `;
    await logAudit(
      {
        baseId: row.base_id as string,
        userId: (row.actor_user_id as string | null) ?? null,
        action: "workflow.run.failed",
        diff: {
          workflowRun: {
            old: null,
            new: {
              id: row.id,
              workflowId: row.workflow_id,
              mode: row.mode,
              channel: row.channel,
              status: "failed",
              principal: auditPrincipal(row),
            },
          },
        },
      },
      tx,
    );
    return true;
  });
  if (changed) await notifyPersistedWorkflowRun(runId, "failed:queued");
  return changed;
};

type PersistedStepStatus = "succeeded" | "failed" | "canceled" | "needs_attention" | "unsupported" | "indeterminate" | "waiting";

const resultStatus = (result: WorkflowRuntimeStepResult): PersistedStepStatus => {
  if (result.mode === "dryRun") {
    const outcome = result.outcome;
    if (outcome.state === "planned") return "succeeded";
    if (outcome.state === "terminal") return outcome.status;
    return outcome.state;
  }
  const outcome = result.outcome;
  if (outcome.state === "completed") return "succeeded";
  if (outcome.state === "terminal") return outcome.status;
  return outcome.state;
};

const restoredStep = (mode: string, outcome: unknown): WorkflowRestoredStep | null => {
  if (!outcome || typeof outcome !== "object") return null;
  const state = (outcome as { state?: unknown }).state;
  if (mode === "execute" && (state === "completed" || state === "failed" || state === "needs_attention" || state === "terminal")) {
    return { mode: "execute", outcome: outcome as Extract<WorkflowRestoredStep, { mode: "execute" }>["outcome"] };
  }
  if (mode === "dryRun" && (state === "planned" || state === "terminal" || state === "unsupported" || state === "indeterminate")) {
    return { mode: "dryRun", outcome: outcome as Extract<WorkflowRestoredStep, { mode: "dryRun" }>["outcome"] };
  }
  return null;
};

export class GridsWorkflowRuntimeRepository implements WorkflowRuntimeRepositoryPort {
  constructor(
    private readonly renewLease: (run: WorkflowRuntimeRunIdentity) => Promise<WorkflowHeartbeatOutcome> = async (run) => {
      const outcome = await renewWorkflowRunLease(run);
      return outcome.state === "active"
        ? outcome
        : {
            state: "canceled",
            message: outcome.state === "canceled" ? outcome.message : "workflow run lease is no longer active",
          };
    },
  ) {}

  async heartbeat(run: WorkflowRuntimeRunIdentity): Promise<WorkflowHeartbeatOutcome> {
    return this.renewLease(run);
  }

  async restoreStepOutcome(step: WorkflowRuntimeStepIdentity): Promise<WorkflowRestoredStep | null> {
    const [row] = await sql<Array<{ mode: string; outcome: unknown }>>`
      SELECT mode, outcome
      FROM grids.workflow_step_runs
      WHERE run_id = ${step.runId}::uuid
        AND step_key = ${step.key}
        AND status IN ('succeeded', 'failed', 'canceled', 'needs_attention', 'unsupported', 'indeterminate')
    `;
    return row ? restoredStep(row.mode, parseJsonbRow(row.outcome, null)) : null;
  }

  async startStep(step: WorkflowRuntimeStepIdentity): Promise<void> {
    const rows = await sql`
      WITH owner AS (
        SELECT id
        FROM grids.workflow_runs
        WHERE id = ${step.runId}::uuid
          AND status = 'running'
          AND execution_generation = ${step.executionGeneration}
        FOR UPDATE
      )
      INSERT INTO grids.workflow_step_runs (
        run_id, step_key, source_path, iteration_path, kind, action, mode, status, execution_generation, started_at, finished_at, outcome
      )
      SELECT owner.id, ${step.key}, ${step.sourcePath}::jsonb, ${step.iterationPath}::int[], ${step.kind}, ${step.action ?? null},
             ${step.mode}, 'running', ${step.executionGeneration}, now(), NULL, NULL
      FROM owner
      ON CONFLICT (run_id, step_key) DO UPDATE
      SET status = 'running',
          execution_generation = EXCLUDED.execution_generation,
          started_at = now(),
          finished_at = NULL,
          outcome = NULL
      WHERE grids.workflow_step_runs.status IN ('running', 'waiting')
        AND grids.workflow_step_runs.execution_generation <= EXCLUDED.execution_generation
      RETURNING id
    `;
    if (rows.length === 0) throw workflowConflict(`Workflow step "${step.key}" cannot be started.`);
    await notifyPersistedWorkflowRun(step.runId, `step:${step.key}:${step.executionGeneration}:running`);
  }

  async finishStep(step: WorkflowRuntimeStepIdentity, result: WorkflowRuntimeStepResult): Promise<void> {
    const rows = await sql`
      WITH owner AS (
        SELECT id
        FROM grids.workflow_runs
        WHERE id = ${step.runId}::uuid
          AND status = 'running'
          AND execution_generation = ${step.executionGeneration}
        FOR UPDATE
      )
      UPDATE grids.workflow_step_runs step_run
      SET status = ${resultStatus(result)}, outcome = ${result.outcome}::jsonb, finished_at = now()
      FROM owner
      WHERE step_run.run_id = owner.id
        AND step_run.step_key = ${step.key}
        AND step_run.status = 'running'
        AND step_run.execution_generation = ${step.executionGeneration}
      RETURNING step_run.id
    `;
    if (rows.length === 0) throw workflowConflict(`Workflow step "${step.key}" lost its execution lease.`);
    await notifyPersistedWorkflowRun(step.runId, `step:${step.key}:${step.executionGeneration}:${resultStatus(result)}`);
  }

  async parkStep(step: WorkflowRuntimeStepIdentity, dependency: WorkflowDependency): Promise<void> {
    if (!dependency.kind.trim() || !dependency.key.trim()) {
      throw new Error("Workflow dependencies require non-empty kind and key values.");
    }
    if (dependency.deadline !== undefined && !Number.isFinite(Date.parse(dependency.deadline))) {
      throw new Error("Workflow dependency deadline must be an ISO date-time.");
    }
    const outcome = { state: "waiting", dependency } as const;
    await sql.begin(async (tx) => {
      const stepRows = await tx`
        WITH owner AS (
          SELECT id
          FROM grids.workflow_runs
          WHERE id = ${step.runId}::uuid
            AND status = 'running'
            AND execution_generation = ${step.executionGeneration}
          FOR UPDATE
        )
        UPDATE grids.workflow_step_runs step_run
        SET status = 'waiting', outcome = ${outcome}::jsonb, finished_at = NULL
        FROM owner
        WHERE step_run.run_id = owner.id
          AND step_run.step_key = ${step.key}
          AND step_run.status = 'running'
          AND step_run.execution_generation = ${step.executionGeneration}
        RETURNING step_run.id
      `;
      if (stepRows.length === 0) throw workflowConflict(`Workflow step "${step.key}" lost its execution lease.`);

      const runRows = await tx`
        UPDATE grids.workflow_runs
        SET status = 'waiting',
            result = ${{ dependency }}::jsonb,
            error = NULL,
            result_message = NULL,
            heartbeat_at = now(),
            lease_expires_at = NULL,
            finished_at = NULL
        WHERE id = ${step.runId}::uuid
          AND status = 'running'
          AND execution_generation = ${step.executionGeneration}
        RETURNING id
      `;
      if (runRows.length === 0) throw workflowConflict("Workflow run lost its execution lease.");
    });
    await notifyPersistedWorkflowRun(step.runId, `step:${step.key}:${step.executionGeneration}:waiting`);
  }
}

export const finishWorkflowRun = async (
  run: WorkflowRuntimeRunIdentity,
  input: {
    status: GridsWorkflowRun["status"];
    result?: WorkflowJsonValue | null;
    error?: GridsWorkflowRun["error"];
    resultMessage?: string | null;
  },
  client: SqlClient = sql,
): Promise<boolean> => {
  const update = async (tx: SqlClient): Promise<boolean> => {
    const [row] = await tx<DbRow[]>`
      UPDATE grids.workflow_runs
      SET status = ${input.status},
          result = ${input.result ?? null}::jsonb,
          error = ${input.error ?? null}::jsonb,
          result_message = ${input.resultMessage ?? null},
          heartbeat_at = now(),
          lease_expires_at = NULL,
          finished_at = CASE WHEN ${input.status} = 'waiting' THEN NULL ELSE now() END
      WHERE id = ${run.runId}::uuid
        AND execution_generation = ${run.executionGeneration}
        AND status = 'running'
      RETURNING id, workflow_id, base_id, actor_user_id, actor_service_account_id, credential_id, credential_kind,
                credential_permission_cap, credential_resource_app_id, credential_resource_type, credential_resource_id, mode, channel
    `;
    if (!row) return false;
    if (input.status !== "waiting") {
      await logAudit(
        {
          baseId: row.base_id as string,
          userId: (row.actor_user_id as string | null) ?? null,
          action: input.status === "succeeded" ? "workflow.run.succeeded" : "workflow.run.failed",
          diff: {
            workflowRun: {
              old: null,
              new: {
                id: row.id,
                workflowId: row.workflow_id,
                mode: row.mode,
                channel: row.channel,
                status: input.status,
                principal: auditPrincipal(row),
              },
            },
          },
        },
        tx,
      );
    }
    return true;
  };
  const changed = client === sql ? await sql.begin(update) : await update(client);
  if (changed && client === sql) await notifyPersistedWorkflowRun(run.runId, `run:${run.executionGeneration}:${input.status}`);
  return changed;
};

export type GridsWorkflowRunCompletion = {
  status: GridsWorkflowRun["status"];
  result?: WorkflowJsonValue | null;
  error?: GridsWorkflowRun["error"];
  resultMessage?: string | null;
};

type GridsWorkflowCoordinatorPersistence = {
  claim: typeof claimWorkflowRun;
  renew: typeof renewWorkflowRunLease;
  finish: typeof finishWorkflowRun;
  release: typeof deferWorkflowRun;
};

const workflowRunIdentity = (claim: ClaimedWorkflowRun): WorkflowRuntimeRunIdentity => ({
  runId: claim.runId,
  executionGeneration: claim.executionGeneration,
  mode: claim.run.mode,
  workflowId: claim.run.workflowId ?? "deleted",
  sourceHash: claim.plan.sourceHash,
  idempotencyKey: claim.idempotencyKey,
});

export const createGridsWorkflowCoordinatorPort = (
  transportHeartbeat?: () => Promise<void>,
  persistence: GridsWorkflowCoordinatorPersistence = {
    claim: claimWorkflowRun,
    renew: renewWorkflowRunLease,
    finish: finishWorkflowRun,
    release: deferWorkflowRun,
  },
): WorkflowCoordinatorPort<string, ClaimedWorkflowRun, GridsWorkflowRunCompletion> => ({
  claim: persistence.claim,
  renew: async (claim) => {
    const outcome = await persistence.renew(workflowRunIdentity(claim));
    if (outcome.state === "active") await transportHeartbeat?.();
    return outcome;
  },
  finish: async (claim, result) => {
    if (result.status === "waiting") return { state: "finished" };
    return (await persistence.finish(workflowRunIdentity(claim), result)) ? { state: "finished" } : { state: "stale" };
  },
  release: async (claim) => ((await persistence.release(workflowRunIdentity(claim))) ? { state: "retry" } : { state: "stale" }),
});
