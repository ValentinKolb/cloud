import type { WorkflowBoundPlan, WorkflowDependency, WorkflowInvocationMode, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type {
  WorkflowCoordinatorClaim,
  WorkflowCoordinatorFinishState,
  WorkflowCoordinatorLeaseState,
  WorkflowCoordinatorPort,
  WorkflowCoordinatorReleaseState,
  WorkflowDryRunResult,
  WorkflowExecutionResult,
  WorkflowHeartbeatOutcome,
  WorkflowRestoredStep,
  WorkflowRuntimeRepositoryPort,
  WorkflowRuntimeRunIdentity,
  WorkflowRuntimeStepIdentity,
  WorkflowRuntimeStepResult,
} from "@valentinkolb/cloud/workflows/runtime";
import { WorkflowRetryableStepError } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import type { WorkflowRunChannel } from "../contracts";
import type { MailWorkflowAuthorizationSnapshot } from "./workflow-runtime-context";

type SqlClient = typeof sql;
type TargetState = "queued" | "running" | "waiting" | "succeeded" | "failed" | "canceled" | "needs_attention";

export const MAIL_WORKFLOW_TARGET_LEASE_MS = 120_000;
export type MailWorkflowTargetResult = WorkflowExecutionResult | WorkflowDryRunResult;

export type ClaimedMailWorkflowTarget = WorkflowCoordinatorClaim & {
  parentRunId: string;
  mailboxId: string;
  workflowId: string;
  workflowVersionId: string;
  versionIdentity: string;
  sourceHash: string;
  mode: WorkflowInvocationMode;
  channel: WorkflowRunChannel;
  idempotencyKey: string;
  occurredAt: string;
  executionClockAt: string;
  leaseOwner: string;
  leaseToken: string;
  plan: WorkflowBoundPlan;
  inputs: Record<string, WorkflowJsonValue>;
  source: WorkflowJsonValue;
  preconditions: WorkflowJsonValue;
  authorization: MailWorkflowAuthorizationSnapshot;
};

type ClaimRow = {
  id: string;
  parent_run_id: string;
  execution_generation: string | number;
  execution_clock_at: Date | string;
  lease_owner: string;
  lease_token: string;
  workflow_id: string;
  mailbox_id: string;
  workflow_version_id: string;
  version_identity: string;
  source_hash: string;
  mode: WorkflowInvocationMode;
  channel: WorkflowRunChannel;
  idempotency_key: string;
  occurred_at: Date | string;
  bound_plan: WorkflowBoundPlan | string;
  frozen_inputs: Record<string, WorkflowJsonValue> | string;
  frozen_source: WorkflowJsonValue | string;
  frozen_preconditions: WorkflowJsonValue | string;
  authorization_snapshot: MailWorkflowAuthorizationSnapshot | string;
};

type TargetRow = {
  parent_run_id: string;
  state: TargetState;
  execution_generation: string | number;
  lease_token: string | null;
};

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class MailWorkflowLeaseLostError extends Error {
  override readonly name = "MailWorkflowLeaseLostError";
}

const refreshParentState = async (db: SqlClient, parentRunId: string): Promise<void> => {
  await db`
    UPDATE mail.workflow_runs
    SET
      state = CASE
        WHEN state = 'canceled' THEN 'canceled'
        WHEN running_targets > 0 THEN 'running'
        WHEN queued_targets > 0 THEN 'queued'
        WHEN waiting_targets > 0 THEN 'waiting'
        WHEN needs_attention_targets > 0 THEN 'needs_attention'
        WHEN failed_targets > 0 THEN 'failed'
        WHEN canceled_targets > 0 THEN 'canceled'
        ELSE 'succeeded'
      END,
      started_at = CASE
        WHEN started_at IS NULL AND (running_targets > 0 OR succeeded_targets > 0 OR failed_targets > 0 OR needs_attention_targets > 0)
          THEN now()
        ELSE started_at
      END,
      finished_at = CASE
        WHEN queued_targets = 0 AND running_targets = 0 AND waiting_targets = 0 THEN COALESCE(finished_at, now())
        ELSE NULL
      END
    WHERE id = ${parentRunId}::uuid
  `;
};

const updateParentCounters = async (db: SqlClient, parentRunId: string, from: TargetState, to: TargetState): Promise<void> => {
  if (from === to) return;
  await db`
    UPDATE mail.workflow_runs
    SET
      queued_targets = queued_targets - CASE WHEN ${from} = 'queued' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'queued' THEN 1 ELSE 0 END,
      running_targets = running_targets - CASE WHEN ${from} = 'running' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'running' THEN 1 ELSE 0 END,
      waiting_targets = waiting_targets - CASE WHEN ${from} = 'waiting' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'waiting' THEN 1 ELSE 0 END,
      succeeded_targets = succeeded_targets - CASE WHEN ${from} = 'succeeded' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'succeeded' THEN 1 ELSE 0 END,
      failed_targets = failed_targets - CASE WHEN ${from} = 'failed' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'failed' THEN 1 ELSE 0 END,
      canceled_targets = canceled_targets - CASE WHEN ${from} = 'canceled' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'canceled' THEN 1 ELSE 0 END,
      needs_attention_targets = needs_attention_targets - CASE WHEN ${from} = 'needs_attention' THEN 1 ELSE 0 END + CASE WHEN ${to} = 'needs_attention' THEN 1 ELSE 0 END
    WHERE id = ${parentRunId}::uuid
  `;
  await refreshParentState(db, parentRunId);
};

const transitionTarget = async (params: {
  db: SqlClient;
  targetId: string;
  executionGeneration: number;
  leaseToken?: string;
  from: TargetState[];
  to: TargetState;
  result?: WorkflowJsonValue | null;
  error?: { code: string; message: string; retryable: boolean } | null;
}): Promise<boolean> => {
  const [target] = await params.db<TargetRow[]>`
    SELECT parent_run_id, state, execution_generation, lease_token
    FROM mail.workflow_run_targets
    WHERE id = ${params.targetId}::uuid
    FOR UPDATE
  `;
  if (
    !target ||
    Number(target.execution_generation) !== params.executionGeneration ||
    !params.from.includes(target.state) ||
    (params.leaseToken !== undefined && target.lease_token !== params.leaseToken)
  ) {
    return false;
  }
  await params.db`
    UPDATE mail.workflow_run_targets
    SET
      state = ${params.to},
      result = ${params.result ?? null}::jsonb,
      last_error = ${params.error ?? null}::jsonb,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = CASE WHEN ${params.to} IN ('succeeded', 'failed', 'canceled', 'needs_attention') THEN now() ELSE NULL END
    WHERE id = ${params.targetId}::uuid
  `;
  await updateParentCounters(params.db, target.parent_run_id, target.state, params.to);
  return true;
};

const cancelRunInTransaction = async (params: {
  db: SqlClient;
  runId: string;
  reason: string;
  activeClaim?: ClaimedMailWorkflowTarget;
}): Promise<boolean> => {
  const [run] = await params.db<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_runs
    WHERE id = ${params.runId}::uuid AND state IN ('queued', 'running', 'waiting', 'canceled')
    FOR UPDATE
  `;
  if (!run) return false;

  if (params.activeClaim) {
    const canceled = await transitionTarget({
      db: params.db,
      targetId: params.activeClaim.runId,
      executionGeneration: params.activeClaim.executionGeneration,
      leaseToken: params.activeClaim.leaseToken,
      from: ["running"],
      to: "canceled",
      error: { code: "CANCELED", message: params.reason, retryable: false },
    });
    if (!canceled) return false;
  }

  const targets = await params.db<{ id: string; state: TargetState; execution_generation: string | number }[]>`
    SELECT id, state, execution_generation
    FROM mail.workflow_run_targets
    WHERE parent_run_id = ${params.runId}::uuid AND state IN ('queued', 'waiting')
    FOR UPDATE
  `;
  for (const target of targets) {
    await transitionTarget({
      db: params.db,
      targetId: target.id,
      executionGeneration: Number(target.execution_generation),
      from: [target.state],
      to: "canceled",
      error: { code: "CANCELED", message: params.reason, retryable: false },
    });
  }

  await params.db`
    UPDATE mail.workflow_run_targets
    SET cancel_requested_at = COALESCE(cancel_requested_at, now()), cancel_reason = ${params.reason}
    WHERE parent_run_id = ${params.runId}::uuid AND state IN ('running', 'waiting')
  `;
  await params.db`
    UPDATE mail.workflow_runs
    SET
      state = 'canceled',
      finished_at = now(),
      last_error = ${{ code: "CANCELED", message: params.reason, retryable: false }}::jsonb
    WHERE id = ${params.runId}::uuid
  `;
  return true;
};

export const claimMailWorkflowTarget = async (params: {
  targetId: string;
  workerId: string;
  leaseMs?: number;
}): Promise<ClaimedMailWorkflowTarget | null> =>
  sql.begin(async (tx) => {
    const [current] = await tx<{ state: TargetState; parent_run_id: string }[]>`
      SELECT target.state, target.parent_run_id
      FROM mail.workflow_run_targets target
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE target.id = ${params.targetId}::uuid
        AND run.state IN ('queued', 'running', 'waiting')
        AND target.cancel_requested_at IS NULL
        AND target.state IN ('queued', 'running')
        AND (target.state = 'queued' OR target.lease_expires_at < now())
      FOR UPDATE OF target SKIP LOCKED
    `;
    if (!current) return null;
    const leaseToken = crypto.randomUUID();
    const leaseMs = params.leaseMs ?? MAIL_WORKFLOW_TARGET_LEASE_MS;
    const [claimed] = await tx<ClaimRow[]>`
      UPDATE mail.workflow_run_targets target
      SET
        state = 'running',
        execution_generation = target.execution_generation + 1,
        execution_clock_at = COALESCE(target.execution_clock_at, now()),
        lease_owner = ${params.workerId},
        lease_token = ${leaseToken}::uuid,
        lease_expires_at = now() + (${leaseMs}::bigint * interval '1 millisecond'),
        started_at = COALESCE(target.started_at, now()),
        finished_at = NULL
      FROM mail.workflow_runs run, mail.workflow_versions version
      WHERE target.id = ${params.targetId}::uuid
        AND run.id = target.parent_run_id
        AND version.id = run.workflow_version_id
      RETURNING
        target.id, target.parent_run_id, target.execution_generation, target.execution_clock_at,
        target.lease_owner, target.lease_token, run.mailbox_id, run.workflow_id, run.workflow_version_id,
        run.version_identity, run.source_hash, run.mode, run.channel, run.idempotency_key, run.occurred_at,
        run.authorization_snapshot, version.bound_plan,
        target.frozen_inputs, target.frozen_source, target.frozen_preconditions
    `;
    if (!claimed) return null;
    await updateParentCounters(tx, current.parent_run_id, current.state, "running");
    return {
      runId: claimed.id,
      executionGeneration: Number(claimed.execution_generation),
      parentRunId: claimed.parent_run_id,
      mailboxId: claimed.mailbox_id,
      workflowId: claimed.workflow_id,
      workflowVersionId: claimed.workflow_version_id,
      versionIdentity: claimed.version_identity,
      sourceHash: claimed.source_hash,
      mode: claimed.mode,
      channel: claimed.channel,
      idempotencyKey: claimed.idempotency_key,
      occurredAt: toIso(claimed.occurred_at),
      executionClockAt: toIso(claimed.execution_clock_at),
      leaseOwner: claimed.lease_owner,
      leaseToken: claimed.lease_token,
      plan: parseJson(claimed.bound_plan),
      inputs: parseJson(claimed.frozen_inputs),
      source: parseJson(claimed.frozen_source),
      preconditions: parseJson(claimed.frozen_preconditions),
      authorization: parseJson(claimed.authorization_snapshot),
    };
  });

const renewClaim = async (claim: ClaimedMailWorkflowTarget): Promise<WorkflowCoordinatorLeaseState> =>
  sql.begin(async (tx) => {
    const [row] = await tx<{ cancel_requested_at: Date | string | null }[]>`
      UPDATE mail.workflow_run_targets
      SET lease_expires_at = now() + (${MAIL_WORKFLOW_TARGET_LEASE_MS}::bigint * interval '1 millisecond')
      WHERE id = ${claim.runId}::uuid
        AND state = 'running'
        AND execution_generation = ${claim.executionGeneration}
        AND lease_token = ${claim.leaseToken}::uuid
      RETURNING cancel_requested_at
    `;
    if (!row) return { state: "stale" };
    if (!row.cancel_requested_at) return { state: "active" };
    const canceled = await transitionTarget({
      db: tx,
      targetId: claim.runId,
      executionGeneration: claim.executionGeneration,
      leaseToken: claim.leaseToken,
      from: ["running"],
      to: "canceled",
      error: { code: "CANCELED", message: "Workflow run was canceled", retryable: false },
    });
    return canceled ? { state: "canceled", message: "Workflow run was canceled" } : { state: "stale" };
  });

const executionResultState = (result: WorkflowExecutionResult): TargetState => {
  if (result.state === "succeeded") return "succeeded";
  if (result.state === "needs_attention") return "needs_attention";
  if (result.state === "canceled") return "canceled";
  if (result.state === "waiting") return "waiting";
  return "failed";
};

const targetResultState = (result: MailWorkflowTargetResult): TargetState => {
  if ("effects" in result) {
    if (result.state === "planned") return "succeeded";
    if (result.state === "terminal") return result.status === "succeeded" ? "succeeded" : "failed";
    if (result.state === "canceled") return "canceled";
    return "failed";
  }
  return executionResultState(result);
};

const resultError = (result: WorkflowExecutionResult): { code: string; message: string; retryable: boolean } | null =>
  result.state === "failed" || result.state === "needs_attention" ? result.error : null;

const finishClaim = async (claim: ClaimedMailWorkflowTarget, result: MailWorkflowTargetResult): Promise<WorkflowCoordinatorFinishState> => {
  if (!("effects" in result) && result.state === "waiting") {
    const [waiting] = await sql<{ id: string }[]>`
      SELECT id
      FROM mail.workflow_run_targets
      WHERE id = ${claim.runId}::uuid
        AND state = 'waiting'
        AND execution_generation = ${claim.executionGeneration}
    `;
    return waiting ? { state: "finished" } : { state: "stale" };
  }
  if (!("effects" in result) && result.state === "canceled") {
    const canceled = await sql.begin((tx) =>
      cancelRunInTransaction({
        db: tx,
        runId: claim.parentRunId,
        reason: result.message ?? "Workflow execution was canceled",
        activeClaim: claim,
      }),
    );
    return canceled ? { state: "finished" } : { state: "stale" };
  }
  let output: WorkflowJsonValue | null = null;
  if ("effects" in result) output = result as unknown as WorkflowJsonValue;
  else if (result.state === "succeeded") output = { output: result.output ?? null, message: result.message ?? null };
  const transitioned = await sql.begin((tx) =>
    transitionTarget({
      db: tx,
      targetId: claim.runId,
      executionGeneration: claim.executionGeneration,
      leaseToken: claim.leaseToken,
      from: ["running"],
      to: targetResultState(result),
      result: output,
      error:
        "effects" in result
          ? result.state === "unsupported" || result.state === "indeterminate"
            ? { code: `MAIL_WORKFLOW_DRY_RUN_${result.state.toUpperCase()}`, message: result.reason, retryable: false }
            : result.state === "terminal" && result.status === "failed"
              ? { code: "MAIL_WORKFLOW_DRY_RUN_FAILED", message: result.message ?? "Dry run failed", retryable: false }
              : null
          : resultError(result),
    }),
  );
  return transitioned ? { state: "finished" } : { state: "stale" };
};

const releaseClaim = async (claim: ClaimedMailWorkflowTarget, error: unknown): Promise<WorkflowCoordinatorReleaseState> => {
  const retryable = error instanceof WorkflowRetryableStepError;
  const transitioned = await sql.begin(async (tx) => {
    const [current] = await tx<{ cancel_requested_at: Date | string | null; cancel_reason: string | null }[]>`
      SELECT cancel_requested_at, cancel_reason
      FROM mail.workflow_run_targets
      WHERE id = ${claim.runId}::uuid
        AND state = 'running'
        AND execution_generation = ${claim.executionGeneration}
        AND lease_token = ${claim.leaseToken}::uuid
      FOR UPDATE
    `;
    if (!current) return "stale" as const;
    const canceled = current.cancel_requested_at !== null;
    const changed = await transitionTarget({
      db: tx,
      targetId: claim.runId,
      executionGeneration: claim.executionGeneration,
      leaseToken: claim.leaseToken,
      from: ["running"],
      to: canceled ? "canceled" : retryable ? "queued" : "failed",
      error: canceled
        ? { code: "CANCELED", message: current.cancel_reason ?? "Workflow run was canceled", retryable: false }
        : retryable
          ? null
          : { code: "MAIL_WORKFLOW_RUNTIME_ERROR", message: errorMessage(error), retryable: false },
    });
    return changed ? (canceled ? "canceled" : "transitioned") : "stale";
  });
  if (transitioned === "stale") return { state: "stale" };
  if (transitioned === "canceled") return { state: "canceled", message: "Workflow run was canceled" };
  return retryable ? { state: "retry" } : { state: "released" };
};

export const createMailWorkflowCoordinatorPort = (
  workerId: string,
): WorkflowCoordinatorPort<string, ClaimedMailWorkflowTarget, MailWorkflowTargetResult> => ({
  claim: (targetId) => claimMailWorkflowTarget({ targetId, workerId }),
  renew: renewClaim,
  finish: finishClaim,
  release: releaseClaim,
});

const stepState = (result: WorkflowRuntimeStepResult): string => {
  if (result.mode === "execute") {
    if (result.outcome.state === "completed" || result.outcome.state === "terminal") return "succeeded";
    if (result.outcome.state === "needs_attention") return "needs_attention";
    if (result.outcome.state === "failed") return "failed";
    return "waiting";
  }
  if (result.outcome.state === "planned" || result.outcome.state === "terminal") return "succeeded";
  if (result.outcome.state === "unsupported") return "skipped";
  if (result.outcome.state === "indeterminate") return "indeterminate";
  return "failed";
};

export class MailWorkflowRuntimeRepository implements WorkflowRuntimeRepositoryPort {
  constructor(readonly claim: ClaimedMailWorkflowTarget) {}

  async heartbeat(_run: WorkflowRuntimeRunIdentity): Promise<WorkflowHeartbeatOutcome> {
    const state = await renewClaim(this.claim);
    return state.state === "active"
      ? { state: "active" }
      : { state: "canceled", message: state.state === "canceled" ? state.message : "Workflow execution lease was lost" };
  }

  async restoreStepOutcome(step: WorkflowRuntimeStepIdentity): Promise<WorkflowRestoredStep | null> {
    const [row] = await sql<{ state: string; outcome: WorkflowRestoredStep | string | null }[]>`
      SELECT state, outcome
      FROM mail.workflow_step_runs
      WHERE target_id = ${this.claim.runId}::uuid AND step_key = ${step.key}
    `;
    if (!row?.outcome || !["succeeded", "failed", "skipped", "indeterminate", "needs_attention"].includes(row.state)) return null;
    return parseJson(row.outcome);
  }

  async startStep(step: WorkflowRuntimeStepIdentity): Promise<void> {
    const rows = await sql<{ step_key: string }[]>`
      INSERT INTO mail.workflow_step_runs (
        target_id, step_key, source_path, iteration_path, path, mode, state, execution_generation, attempt, started_at
      )
      SELECT
        ${this.claim.runId}::uuid, ${step.key}, ${step.sourcePath}::jsonb, ${step.iterationPath}::jsonb,
        ${step.path}::jsonb, ${step.mode}, 'running', ${this.claim.executionGeneration}, 1, now()
      WHERE EXISTS (
        SELECT 1 FROM mail.workflow_run_targets target
        WHERE target.id = ${this.claim.runId}::uuid
          AND target.state = 'running'
          AND target.execution_generation = ${this.claim.executionGeneration}
          AND target.lease_token = ${this.claim.leaseToken}::uuid
          AND target.cancel_requested_at IS NULL
      )
      ON CONFLICT (target_id, step_key) DO UPDATE SET
        source_path = EXCLUDED.source_path,
        iteration_path = EXCLUDED.iteration_path,
        path = EXCLUDED.path,
        mode = EXCLUDED.mode,
        state = 'running',
        outcome = NULL,
        dependency = NULL,
        execution_generation = EXCLUDED.execution_generation,
        attempt = mail.workflow_step_runs.attempt + 1,
        started_at = now(),
        finished_at = NULL
      RETURNING step_key
    `;
    if (rows.length === 0) throw new MailWorkflowLeaseLostError("Workflow execution lease was lost before starting a step");
  }

  async finishStep(step: WorkflowRuntimeStepIdentity, result: WorkflowRuntimeStepResult): Promise<void> {
    const rows = await sql<{ step_key: string }[]>`
      UPDATE mail.workflow_step_runs step_run
      SET
        state = ${stepState(result)},
        outcome = ${result}::jsonb,
        dependency = NULL,
        finished_at = now()
      WHERE step_run.target_id = ${this.claim.runId}::uuid
        AND step_run.step_key = ${step.key}
        AND step_run.execution_generation = ${this.claim.executionGeneration}
        AND EXISTS (
          SELECT 1 FROM mail.workflow_run_targets target
          WHERE target.id = step_run.target_id
            AND target.state = 'running'
            AND target.execution_generation = ${this.claim.executionGeneration}
            AND target.lease_token = ${this.claim.leaseToken}::uuid
            AND target.cancel_requested_at IS NULL
        )
      RETURNING step_key
    `;
    if (rows.length === 0) throw new MailWorkflowLeaseLostError("Workflow execution lease was lost before finishing a step");
  }

  async parkStep(step: WorkflowRuntimeStepIdentity, dependency: WorkflowDependency): Promise<void> {
    const parked = await sql.begin(async (tx) => {
      const rows = await tx<{ step_key: string }[]>`
        UPDATE mail.workflow_step_runs step_run
        SET
          state = 'waiting',
          outcome = NULL,
          dependency = ${dependency}::jsonb,
          command_id = ${dependency.kind === "mail.command" ? dependency.key : null}::uuid,
          finished_at = NULL
        WHERE step_run.target_id = ${this.claim.runId}::uuid
          AND step_run.step_key = ${step.key}
          AND step_run.execution_generation = ${this.claim.executionGeneration}
          AND EXISTS (
            SELECT 1 FROM mail.workflow_run_targets target
            WHERE target.id = step_run.target_id
              AND target.state = 'running'
              AND target.execution_generation = ${this.claim.executionGeneration}
              AND target.lease_token = ${this.claim.leaseToken}::uuid
              AND target.cancel_requested_at IS NULL
          )
        RETURNING step_key
      `;
      if (rows.length === 0) return false;
      return transitionTarget({
        db: tx,
        targetId: this.claim.runId,
        executionGeneration: this.claim.executionGeneration,
        leaseToken: this.claim.leaseToken,
        from: ["running"],
        to: "waiting",
      });
    });
    if (!parked) throw new MailWorkflowLeaseLostError("Workflow execution lease was lost while parking a step");
  }
}

export const resumeMailWorkflowDependency = async (dependency: WorkflowDependency): Promise<string[]> =>
  sql.begin(async (tx) => {
    const rows = await tx<{ target_id: string; parent_run_id: string }[]>`
      SELECT step.target_id, target.parent_run_id
      FROM mail.workflow_step_runs step
      JOIN mail.workflow_run_targets target ON target.id = step.target_id
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE step.state = 'waiting'
        AND step.dependency ->> 'kind' = ${dependency.kind}
        AND step.dependency ->> 'key' = ${dependency.key}
        AND run.state IN ('queued', 'running', 'waiting')
        AND target.state = 'waiting'
        AND target.cancel_requested_at IS NULL
      FOR UPDATE OF run, target SKIP LOCKED
      LIMIT 500
    `;
    const resumed: string[] = [];
    for (const row of rows) {
      await tx`
        UPDATE mail.workflow_run_targets
        SET state = 'queued', finished_at = NULL
        WHERE id = ${row.target_id}::uuid AND state = 'waiting'
      `;
      await updateParentCounters(tx, row.parent_run_id, "waiting", "queued");
      resumed.push(row.target_id);
    }
    return resumed;
  });

export const listRecoverableMailWorkflowTargetIds = async (limit = 500): Promise<string[]> => {
  const rows = await sql<{ id: string }[]>`
    SELECT target.id
    FROM mail.workflow_run_targets target
    JOIN mail.workflow_runs run ON run.id = target.parent_run_id
    WHERE run.state IN ('queued', 'running', 'waiting')
      AND target.state IN ('queued', 'running')
      AND target.cancel_requested_at IS NULL
      AND (target.state = 'queued' OR target.lease_expires_at < now())
    ORDER BY target.updated_at, target.id
    LIMIT ${Math.min(Math.max(limit, 1), 5_000)}
  `;
  return rows.map((row) => row.id);
};

export const recoverCanceledMailWorkflowTargets = async (limit = 500): Promise<number> =>
  sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; execution_generation: string | number; cancel_reason: string | null }[]
    >`
      SELECT target.id, target.execution_generation, target.cancel_reason
      FROM mail.workflow_run_targets target
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE run.state IN ('queued', 'running', 'waiting', 'canceled')
        AND target.state = 'running'
        AND target.cancel_requested_at IS NOT NULL
        AND target.lease_expires_at < now()
      ORDER BY target.lease_expires_at, target.id
      FOR UPDATE OF target SKIP LOCKED
      LIMIT ${Math.min(Math.max(limit, 1), 5_000)}
    `;
    let recovered = 0;
    for (const row of rows) {
      const changed = await transitionTarget({
        db: tx,
        targetId: row.id,
        executionGeneration: Number(row.execution_generation),
        from: ["running"],
        to: "canceled",
        error: {
          code: "CANCELED",
          message: row.cancel_reason ?? "Workflow run was canceled",
          retryable: false,
        },
      });
      if (changed) recovered += 1;
    }
    return recovered;
  });

export const cancelMailWorkflowRun = async (runId: string, reason: string): Promise<boolean> =>
  sql.begin((tx) => cancelRunInTransaction({ db: tx, runId, reason }));
