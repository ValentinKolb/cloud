import { logger } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import type {
  BackfillWorkflowInput,
  DryRunWorkflowInput,
  InvokeWorkflowInput,
  MailWorkflowRun,
  OneShotWorkflowInput,
  WorkflowRunChannel,
  WorkflowRunKind,
  WorkflowRunMode,
  WorkflowRunState,
} from "../contracts";
import type { MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveMailExecution } from "./execution";
import { createRuntimeLifecycle } from "./runtime-lifecycle";
import type { SqlClient } from "./workflow-data";
import { loadWorkflowVersion, mapWorkflowVersion } from "./workflow-definition-service";
import {
  insertWorkflowTargets,
  loadRunByIdempotency,
  recordWorkflowRunRequest,
  type WorkflowActorColumns,
  workflowActorColumns,
  workflowAuthorizationIdentity,
} from "./workflow-materialization-store";
import {
  initialWorkflowTargetDigest,
  prepareWorkflowPreflight,
  prepareWorkflowTargetBatch,
  streamPreparedWorkflowTargets,
  type WorkflowTargetCursor,
} from "./workflow-preflight-service";
import { dispatchMailWorkflowRun } from "./workflow-run-dispatch";
import { type DbWorkflowRun, mapWorkflowRun, parseWorkflowDbJson, workflowRunColumns, workflowTimestamp } from "./workflow-run-model";
import {
  type MailWorkflowAuthorizationSnapshot,
  restoreMailWorkflowContext,
  snapshotMailWorkflowAuthorization,
} from "./workflow-runtime-context";

type DbBackfillMaterializationRun = DbWorkflowRun & {
  authorization_snapshot: MailWorkflowAuthorizationSnapshot | string;
  idempotency_key: string;
  request_hash: string;
  occurred_at: Date | string;
  materialization_cursor_internal_date: Date | string | null;
  materialization_cursor_target_key: string | null;
  materialization_digest: string | null;
  materialization_expected_digest: string | null;
  materialization_action_counts: Record<string, number> | string | null;
};

const loadBackfillMaterializationRun = async (runId: string, db: SqlClient, lock = false): Promise<DbBackfillMaterializationRun | null> => {
  const [run] = await db<DbBackfillMaterializationRun[]>`
    SELECT
      ${workflowRunColumns},
      run.authorization_snapshot,
      run.idempotency_key,
      run.request_hash,
      run.occurred_at,
      run.materialization_cursor_internal_date,
      run.materialization_cursor_target_key,
      run.materialization_digest,
      run.materialization_expected_digest,
      run.materialization_action_counts
    FROM mail.workflow_runs run
    WHERE run.id = ${runId}::uuid
    ${lock ? sql`FOR UPDATE` : sql``}
  `;
  return run ?? null;
};

type WorkflowRunInput = DryRunWorkflowInput | InvokeWorkflowInput | BackfillWorkflowInput | OneShotWorkflowInput;

const BACKFILL_MATERIALIZATION_BATCH_SIZE = 1_000;

const resumeBackfillWorkflowRun = async (params: {
  run: DbWorkflowRun;
  context: MailRequestContext;
  actor: WorkflowActorColumns;
  requestHash: string;
  idempotencyKey: string;
  enqueue: boolean;
}): Promise<Result<MailWorkflowRun>> => {
  let run = params.run;
  const resumedMaterialization = run.state === "materializing";
  while (run.state === "materializing") {
    const materialized = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${run.mailbox_id}:${run.workflow_id}:execute:${params.idempotencyKey}`}, 0))`;
      const current = await loadBackfillMaterializationRun(run.id, tx, true);
      if (!current) return fail(err.notFound("Workflow run"));
      if (current.request_hash !== params.requestHash) {
        return fail(err.conflict("Idempotency key was used for a different workflow invocation"));
      }
      if (current.state !== "materializing") return ok(current);

      const currentPermission = await resolveMailExecution({
        mailboxId: current.mailbox_id,
        operation: "actorMutation",
        context: params.context,
        db: tx,
      });
      if (!currentPermission.ok) return currentPermission;

      if (!current.materialization_digest || !current.materialization_expected_digest || !current.materialization_action_counts) {
        throw new Error("Workflow materialization metadata is incomplete");
      }
      const versionRow = await loadWorkflowVersion({
        mailboxId: current.mailbox_id,
        workflowId: current.workflow_id,
        versionId: current.workflow_version_id,
        db: tx,
      });
      if (!versionRow) throw new Error("Workflow materialization version is unavailable");
      const version = mapWorkflowVersion(versionRow);
      const remaining = current.target_count - current.queued_targets;
      if (remaining <= 0) throw new Error("Workflow materialization progress is invalid");
      const limit = Math.min(BACKFILL_MATERIALIZATION_BATCH_SIZE, remaining);
      const after: WorkflowTargetCursor | null =
        current.materialization_cursor_internal_date && current.materialization_cursor_target_key
          ? {
              internalDate: workflowTimestamp(current.materialization_cursor_internal_date),
              remoteMessageRefId: current.materialization_cursor_target_key,
            }
          : null;
      const batch = await prepareWorkflowTargetBatch({
        mailboxId: current.mailbox_id,
        workflowId: current.workflow_id,
        versionIdentity: current.version_identity,
        plan: version.boundPlan,
        inputs: parseWorkflowDbJson(current.inputs),
        query: parseWorkflowDbJson(current.target_query) as BackfillWorkflowInput["query"],
        occurredAt: workflowTimestamp(current.occurred_at),
        targetDigest: current.materialization_digest,
        after,
        limit,
        db: tx,
      });
      const stale =
        !batch.ok || batch.data.targets.length === 0 || (batch.data.targets.length < limit && remaining > batch.data.targets.length);
      if (stale) {
        await tx`DELETE FROM mail.workflow_runs WHERE id = ${current.id}::uuid AND state = 'materializing'`;
        return fail(err.conflict("Workflow preflight is stale"));
      }
      await insertWorkflowTargets(tx, current.id, batch.data.targets, current.queued_targets);
      const queuedTargets = current.queued_targets + batch.data.targets.length;
      if (queuedTargets === current.target_count) {
        if (batch.data.targetDigest !== current.materialization_expected_digest) {
          await tx`DELETE FROM mail.workflow_runs WHERE id = ${current.id}::uuid AND state = 'materializing'`;
          return fail(err.conflict("Workflow preflight is stale"));
        }
        const [completed] = await tx<DbWorkflowRun[]>`
          UPDATE mail.workflow_runs AS run
          SET
            state = 'queued',
            queued_targets = ${queuedTargets},
            materialization_cursor_internal_date = NULL,
            materialization_cursor_target_key = NULL,
            materialization_digest = NULL,
            materialization_expected_digest = NULL,
            materialization_action_counts = NULL
          WHERE run.id = ${current.id}::uuid AND run.state = 'materializing'
          RETURNING ${workflowRunColumns}
        `;
        if (!completed) throw new Error("Workflow materialization finalization lost its run");
        await recordWorkflowRunRequest({
          db: tx,
          context: params.context,
          actor: params.actor,
          mailboxId: current.mailbox_id,
          workflowId: current.workflow_id,
          runId: current.id,
          version,
          targetCount: current.target_count,
          actionCounts: parseWorkflowDbJson(current.materialization_action_counts),
          kind: "backfill",
          mode: "execute",
          channel: current.channel,
          idempotencyKey: params.idempotencyKey,
        });
        return ok(completed);
      }
      if (!batch.data.cursor) throw new Error("Workflow materialization cursor did not advance");
      const [updated] = await tx<DbWorkflowRun[]>`
        UPDATE mail.workflow_runs AS run
        SET
          queued_targets = ${queuedTargets},
          materialization_cursor_internal_date = ${batch.data.cursor.internalDate}::timestamptz,
          materialization_cursor_target_key = ${batch.data.cursor.remoteMessageRefId}::uuid,
          materialization_digest = ${batch.data.targetDigest}
        WHERE run.id = ${current.id}::uuid AND run.state = 'materializing'
        RETURNING ${workflowRunColumns}
      `;
      if (!updated) throw new Error("Workflow materialization progress update lost its run");
      return ok(updated);
    });
    if (!materialized.ok) return materialized;
    run = materialized.data;
  }
  if (params.enqueue && resumedMaterialization && run.state === "queued") {
    await dispatchMailWorkflowRun(run.id);
  }
  return ok(mapWorkflowRun(run));
};

const materializeBackfillWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  channel: WorkflowRunChannel;
  input: BackfillWorkflowInput;
  occurredAt: string;
  enqueue: boolean;
  authorizationSnapshot: MailWorkflowAuthorizationSnapshot;
  requestHash: string;
}): Promise<Result<MailWorkflowRun>> => {
  const actor = workflowActorColumns(params.authorizationSnapshot, params.input.expectedVersionId);
  const existing = await loadRunByIdempotency({
    mailboxId: params.mailboxId,
    workflowId: params.workflowId,
    mode: "execute",
    idempotencyKey: params.input.idempotencyKey,
  });
  if (existing && existing.request_hash !== params.requestHash) {
    return fail(err.conflict("Idempotency key was used for a different workflow invocation"));
  }

  let run: DbWorkflowRun | null = existing;
  if (!run) {
    const prepared = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      return prepareWorkflowPreflight({
        context: params.context,
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        input: params.input,
        occurredAt: params.occurredAt,
        db: tx,
      });
    });
    if (!prepared.ok) return prepared;
    if (prepared.data.preflight.preflightHash !== params.input.preflightHash) {
      return fail(err.conflict("Workflow preflight is stale"));
    }

    const initialized = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '30s'`;
      const currentPermission = await resolveMailExecution({
        mailboxId: params.mailboxId,
        operation: "actorMutation",
        context: params.context,
        db: tx,
      });
      if (!currentPermission.ok) return currentPermission;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:${params.workflowId}:execute:${params.input.idempotencyKey}`}, 0))`;
      const concurrent = await loadRunByIdempotency({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        mode: "execute",
        idempotencyKey: params.input.idempotencyKey,
        db: tx,
        lock: true,
      });
      if (concurrent) {
        return concurrent.request_hash === params.requestHash
          ? ok(concurrent)
          : fail(err.conflict("Idempotency key was used for a different workflow invocation"));
      }
      const versionRow = await loadWorkflowVersion({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        versionId: params.input.expectedVersionId,
        db: tx,
        lock: true,
      });
      if (!versionRow) return fail(err.notFound("Workflow version"));
      const version = mapWorkflowVersion(versionRow);
      if (
        version.id !== prepared.data.preflight.workflowVersionId ||
        version.identity !== prepared.data.preflight.versionIdentity ||
        version.sourceHash !== prepared.data.preflight.sourceHash
      ) {
        return fail(err.conflict("Workflow preflight is stale"));
      }
      const runId = crypto.randomUUID();
      const targetCount = prepared.data.preflight.targetCount;
      const initialState: WorkflowRunState = targetCount === 0 ? "succeeded" : "materializing";
      const [created] = await tx<DbWorkflowRun[]>`
        INSERT INTO mail.workflow_runs AS run (
          id, mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
          kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
          inputs, target_query, preflight_hash, idempotency_key, request_hash, occurred_at,
          target_count, queued_targets, succeeded_targets, finished_at,
          materialization_digest, materialization_expected_digest, materialization_action_counts
        ) VALUES (
          ${runId}::uuid, ${params.mailboxId}::uuid, ${params.workflowId}::uuid, ${version.id}::uuid,
          ${version.identity}, ${version.sourceHash}, 'backfill', 'execute', ${params.channel}, ${initialState},
          ${actor.kind}, ${actor.id}::uuid, ${params.authorizationSnapshot}::jsonb,
          ${params.input.inputs}::jsonb, ${params.input.query}::jsonb, ${params.input.preflightHash},
          ${params.input.idempotencyKey}, ${params.requestHash}, ${params.occurredAt}::timestamptz,
          ${targetCount}, 0, 0, ${targetCount === 0 ? params.occurredAt : null}::timestamptz,
          ${targetCount === 0 ? null : initialWorkflowTargetDigest()},
          ${targetCount === 0 ? null : prepared.data.targetDigest},
          ${targetCount === 0 ? null : prepared.data.actionCounts}::jsonb
        )
        RETURNING ${workflowRunColumns}
      `;
      if (!created) throw new Error("Workflow run insert returned no row");
      if (targetCount === 0) {
        await recordWorkflowRunRequest({
          db: tx,
          context: params.context,
          actor,
          mailboxId: params.mailboxId,
          workflowId: params.workflowId,
          runId,
          version,
          targetCount,
          actionCounts: prepared.data.actionCounts,
          kind: "backfill",
          mode: "execute",
          channel: params.channel,
          idempotencyKey: params.input.idempotencyKey,
        });
      }
      return ok(created);
    });
    if (!initialized.ok) return initialized;
    run = initialized.data;
  }
  if (!run) throw new Error("Workflow materialization initialization returned no run");

  return resumeBackfillWorkflowRun({
    run,
    context: params.context,
    actor,
    requestHash: params.requestHash,
    idempotencyKey: params.input.idempotencyKey,
    enqueue: params.enqueue,
  });
};

const cancelRejectedMaterialization = async (
  run: DbBackfillMaterializationRun,
  failure: { code: string; message: string; reason: string },
): Promise<boolean> =>
  sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${run.mailbox_id}:${run.workflow_id}:execute:${run.idempotency_key}`}, 0))`;
    const current = await loadBackfillMaterializationRun(run.id, tx, true);
    if (!current || current.state !== "materializing") return false;

    await tx`DELETE FROM mail.workflow_run_targets WHERE parent_run_id = ${current.id}::uuid`;
    await tx`
      UPDATE mail.workflow_runs
      SET
        state = 'canceled',
        target_count = 0,
        queued_targets = 0,
        last_error = ${{
          code: failure.code,
          message: failure.message,
          retryable: false,
        }}::jsonb,
        materialization_cursor_internal_date = NULL,
        materialization_cursor_target_key = NULL,
        materialization_digest = NULL,
        materialization_expected_digest = NULL,
        materialization_action_counts = NULL,
        finished_at = now()
      WHERE id = ${current.id}::uuid AND state = 'materializing'
    `;
    await tx`
      INSERT INTO mail.activity_events (
        mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
      ) VALUES (
        ${current.mailbox_id}::uuid, 'workflow', ${current.workflow_version_id}::uuid,
        'workflow.run', 'failed', 'workflow_run', ${current.id}::uuid,
        ${{ reason: failure.reason }}::jsonb
      )
    `;
    return true;
  });

type MailWorkflowMaterializationRecovery = {
  scanned: number;
  recovered: number;
  canceled: number;
  failed: number;
};

type MaterializationRecoveryOutcome = "recovered" | "canceled" | "failed" | "ignored";

const recoverMaterializationCandidate = async (runId: string, enqueue: boolean): Promise<MaterializationRecoveryOutcome> => {
  const run = await loadBackfillMaterializationRun(runId, sql);
  if (!run || run.state !== "materializing") return "ignored";
  const authorization = parseWorkflowDbJson(run.authorization_snapshot);
  const context = await restoreMailWorkflowContext(authorization, run.id);
  if (!context) {
    const canceled = await cancelRejectedMaterialization(run, {
      code: "WORKFLOW_AUTHORIZATION_REVOKED",
      message: "Workflow actor or credential is no longer active",
      reason: "authorization_revoked_during_materialization",
    });
    return canceled ? "canceled" : "ignored";
  }

  const resumed = await resumeBackfillWorkflowRun({
    run,
    context,
    actor: workflowActorColumns(authorization, run.workflow_version_id),
    requestHash: run.request_hash,
    idempotencyKey: run.idempotency_key,
    enqueue,
  });
  if (resumed.ok) return "recovered";
  if (resumed.error.status === 401 || resumed.error.status === 403) {
    const canceled = await cancelRejectedMaterialization(run, {
      code: "WORKFLOW_PERMISSION_REVOKED",
      message: "Workflow actor no longer has mailbox write access",
      reason: "permission_revoked_during_materialization",
    });
    return canceled ? "canceled" : "ignored";
  }

  materializationLog.error("Mail workflow materialization could not be resumed", {
    runId: run.id,
    code: resumed.error.code,
    message: resumed.error.message,
  });
  return "failed";
};

export const reconcileMailWorkflowMaterializations = async (
  options: { enqueue?: boolean; limit?: number; staleAfterMs?: number } = {},
): Promise<MailWorkflowMaterializationRecovery> => {
  const requestedLimit = options.limit ?? 10;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) throw new Error("Workflow recovery limit must be a positive integer");
  const limit = Math.min(requestedLimit, 100);
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) throw new Error("Workflow recovery delay must be non-negative");
  const candidates = await sql<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_runs
    WHERE state = 'materializing'
      AND updated_at <= now() - (${staleAfterMs}::double precision * interval '1 millisecond')
    ORDER BY updated_at, id
    LIMIT ${limit}
  `;
  const result: MailWorkflowMaterializationRecovery = {
    scanned: candidates.length,
    recovered: 0,
    canceled: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      const outcome = await recoverMaterializationCandidate(candidate.id, options.enqueue ?? true);
      if (outcome !== "ignored") result[outcome] += 1;
    } catch (error) {
      await sql`
        UPDATE mail.workflow_runs
        SET last_error = ${{
          code: "WORKFLOW_MATERIALIZATION_RECOVERY_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        }}::jsonb
        WHERE id = ${candidate.id}::uuid AND state = 'materializing'
      `.catch(() => undefined);
      materializationLog.error("Mail workflow materialization recovery threw", {
        runId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  }
  return result;
};

const materializationLog = logger("mail:workflow-materialization");
const materializationScheduler = scheduler({ id: "mail:workflow-materialization" });

const runMaterializationRecovery = async (): Promise<MailWorkflowMaterializationRecovery> => {
  const result = await reconcileMailWorkflowMaterializations();
  if (result.failed > 0) materializationLog.error("Mail workflow materialization recovery failed", result);
  return result;
};

const materializationRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    await materializationScheduler.create({
      id: "mail:workflow-materialization:reconcile",
      cron: "* * * * *",
      meta: { appId: "mail", family: "mail:workflows", label: "Mail workflow materialization recovery" },
      process: runMaterializationRecovery,
    });
    materializationScheduler.start();
    await runMaterializationRecovery();
  },
  stop: async () => {
    await materializationScheduler.stop();
  },
});

export const workflowMaterializationRuntime = {
  start: materializationRuntimeLifecycle.start,
  stop: materializationRuntimeLifecycle.stop,
};

const materializeWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  input: WorkflowRunInput;
  occurredAt?: string;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await resolveMailExecution({
    mailboxId: params.mailboxId,
    operation: "actorMutation",
    context: params.context,
  });
  if (!allowed.ok) return allowed;
  const authorizationSnapshot = snapshotMailWorkflowAuthorization(params.context);
  if (!authorizationSnapshot) return fail(err.forbidden("Durable Mail work requires a current credential"));
  const actor = workflowActorColumns(authorizationSnapshot, params.input.expectedVersionId);
  const occurredAt = "occurredAt" in params.input ? params.input.occurredAt : (params.occurredAt ?? new Date().toISOString());
  if (!Number.isFinite(Date.parse(occurredAt))) return fail(err.badInput("Workflow occurrence time is invalid"));
  const requestHash = sha256Json({
    workflowId: params.workflowId,
    workflowVersionId: params.input.expectedVersionId,
    kind: params.kind,
    mode: params.mode,
    authorization: workflowAuthorizationIdentity(authorizationSnapshot),
    inputs: params.input.inputs,
    query: params.input.query,
    preflightHash: "preflightHash" in params.input ? params.input.preflightHash : null,
    occurredAt: "occurredAt" in params.input ? occurredAt : null,
  });
  if (params.kind === "backfill") {
    try {
      return await materializeBackfillWorkflowRun({
        context: params.context,
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        channel: params.channel,
        input: params.input as BackfillWorkflowInput,
        occurredAt,
        enqueue: params.enqueue !== false,
        authorizationSnapshot,
        requestHash,
      });
    } catch (error) {
      if (isServiceError(error)) return fail(error);
      return fail(err.internal("Failed to materialize workflow run"));
    }
  }
  try {
    const materialized = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      const currentPermission = await resolveMailExecution({
        mailboxId: params.mailboxId,
        operation: "actorMutation",
        context: params.context,
        db: tx,
      });
      if (!currentPermission.ok) return currentPermission;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:${params.workflowId}:${params.mode}:${params.input.idempotencyKey}`}, 0))`;
      const existing = await loadRunByIdempotency({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        mode: params.mode,
        idempotencyKey: params.input.idempotencyKey,
        db: tx,
        lock: true,
      });
      if (existing) {
        return existing.request_hash === requestHash
          ? ok({ run: mapWorkflowRun(existing), created: false })
          : fail(err.conflict("Idempotency key was used for a different workflow invocation"));
      }
      const versionRow = await loadWorkflowVersion({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        versionId: params.input.expectedVersionId,
        db: tx,
        lock: true,
      });
      if (!versionRow) return fail(err.notFound("Workflow version"));
      const version = mapWorkflowVersion(versionRow);
      const prepared = await prepareWorkflowPreflight({
        context: params.context,
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        input: params.input,
        occurredAt,
        db: tx,
      });
      if (!prepared.ok) return prepared;
      if (
        params.mode === "execute" &&
        (!("preflightHash" in params.input) || prepared.data.preflight.preflightHash !== params.input.preflightHash)
      ) {
        return fail(err.conflict("Workflow preflight is stale"));
      }
      const runId = crypto.randomUUID();
      const targetCount = prepared.data.preflight.targetCount;
      const initialState: WorkflowRunState = targetCount === 0 ? "succeeded" : "queued";
      const [run] = await tx<DbWorkflowRun[]>`
        INSERT INTO mail.workflow_runs AS run (
          id, mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
          kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
          inputs, target_query, preflight_hash, idempotency_key, request_hash, occurred_at,
          target_count, queued_targets, succeeded_targets, finished_at
        ) VALUES (
          ${runId}::uuid, ${params.mailboxId}::uuid, ${params.workflowId}::uuid, ${version.id}::uuid,
          ${version.identity}, ${version.sourceHash}, ${params.kind}, ${params.mode}, ${params.channel}, ${initialState},
          ${actor.kind}, ${actor.id}::uuid, ${authorizationSnapshot}::jsonb,
          ${params.input.inputs}::jsonb, ${params.input.query}::jsonb,
          ${"preflightHash" in params.input ? params.input.preflightHash : null},
          ${params.input.idempotencyKey}, ${requestHash}, ${occurredAt}::timestamptz,
          ${targetCount}, ${targetCount}, 0, ${targetCount === 0 ? occurredAt : null}::timestamptz
        )
        RETURNING ${workflowRunColumns}
      `;
      if (!run) throw new Error("Workflow run insert returned no row");
      const streamed = await streamPreparedWorkflowTargets({
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        versionIdentity: version.identity,
        plan: version.boundPlan,
        effectBudget: version.effectBudget,
        inputs: params.input.inputs,
        query: params.input.query,
        occurredAt,
        db: tx,
        onBatch: (targets, ordinal) => insertWorkflowTargets(tx, runId, targets, ordinal),
      });
      if (!streamed.ok) throw streamed.error;
      if (streamed.data.targetCount !== targetCount || streamed.data.targetDigest !== prepared.data.targetDigest) {
        throw new Error("Workflow target set changed inside a repeatable-read materialization");
      }
      await recordWorkflowRunRequest({
        db: tx,
        context: params.context,
        actor,
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        runId,
        version,
        targetCount,
        actionCounts: prepared.data.actionCounts,
        kind: params.kind,
        mode: params.mode,
        channel: params.channel,
        idempotencyKey: params.input.idempotencyKey,
      });
      return ok({ run: mapWorkflowRun(run), created: true });
    });
    if (!materialized.ok) return materialized;
    if (params.enqueue !== false && materialized.data.created) {
      await dispatchMailWorkflowRun(materialized.data.run.id);
    }
    return ok(materialized.data.run);
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to materialize workflow run"));
  }
};

export const invokeWorkflow = (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  channel: WorkflowRunChannel;
  input: InvokeWorkflowInput;
  occurredAt?: string;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => materializeWorkflowRun({ ...params, kind: "invoke", mode: "execute" });

export const dryRunWorkflow = (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  channel: WorkflowRunChannel;
  input: DryRunWorkflowInput;
  occurredAt?: string;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => materializeWorkflowRun({ ...params, kind: "invoke", mode: "dryRun" });

export const backfillWorkflow = (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  channel: WorkflowRunChannel;
  input: BackfillWorkflowInput;
  occurredAt?: string;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => materializeWorkflowRun({ ...params, kind: "backfill", mode: "execute" });

export const oneShotWorkflow = (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  channel: WorkflowRunChannel;
  input: OneShotWorkflowInput;
  occurredAt?: string;
  enqueue?: boolean;
}): Promise<Result<MailWorkflowRun>> => materializeWorkflowRun({ ...params, kind: "oneShot", mode: "execute" });
