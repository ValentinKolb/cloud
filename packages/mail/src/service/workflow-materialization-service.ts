import { audit, logger } from "@valentinkolb/cloud/services";
import type { WorkflowBoundPlan, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { evaluateWorkflowTriggerInputs } from "@valentinkolb/cloud/workflows/runtime";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import type {
  BackfillWorkflowInput,
  DryRunWorkflowInput,
  InvokeWorkflowInput,
  MailWorkflowRun,
  MailWorkflowRunTarget,
  MailWorkflowVersion,
  OneShotWorkflowInput,
  WorkflowEffectBudget,
  WorkflowRunChannel,
  WorkflowRunKind,
  WorkflowRunMode,
  WorkflowRunState,
  WorkflowRunTargetSelection,
  WorkflowTargetState,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { auditActorFromRequest, type MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveMailExecution } from "./execution";
import type { SqlClient } from "./workflow-data";
import { loadWorkflowVersion, mapWorkflowVersion } from "./workflow-definition-service";
import {
  initialWorkflowTargetDigest,
  type PreparedWorkflowTarget,
  prepareWorkflowPreflight,
  prepareWorkflowTargetBatch,
  streamPreparedWorkflowTargets,
  type WorkflowTargetCursor,
  workflowEffectBudgetExceeded,
} from "./workflow-preflight-service";
import { dispatchMailWorkflowRun } from "./workflow-run-dispatch";
import {
  type MailWorkflowAuthorizationSnapshot,
  restoreMailWorkflowContext,
  snapshotMailWorkflowAuthorization,
} from "./workflow-runtime-context";

type DbWorkflowRun = {
  id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  version_identity: string;
  source_hash: string;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  state: WorkflowRunState;
  inputs: Record<string, WorkflowJsonValue> | string;
  target_query: WorkflowRunTargetSelection | string;
  preflight_hash: string | null;
  target_count: number;
  queued_targets: number;
  running_targets: number;
  waiting_targets: number;
  succeeded_targets: number;
  failed_targets: number;
  canceled_targets: number;
  needs_attention_targets: number;
  result: WorkflowJsonValue | string | null;
  last_error: { code: string; message: string; retryable: boolean } | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

type DbWorkflowRunTarget = {
  id: string;
  parent_run_id: string;
  ordinal: number | bigint;
  target_key: string;
  state: WorkflowTargetState;
  execution_generation: number | bigint;
  frozen_inputs: Record<string, WorkflowJsonValue> | string;
  frozen_source: WorkflowJsonValue | string;
  frozen_preconditions: WorkflowJsonValue | string;
  result: WorkflowJsonValue | string | null;
  last_error: { code: string; message: string; retryable: boolean } | string | null;
  cancel_requested_at: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
};

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

export const workflowRunColumns = sql`
  run.id,
  run.mailbox_id,
  run.workflow_id,
  run.workflow_version_id,
  run.version_identity,
  run.source_hash,
  run.kind,
  run.mode,
  run.channel,
  run.state,
  run.inputs,
  run.target_query,
  run.preflight_hash,
  run.target_count,
  run.queued_targets,
  run.running_targets,
  run.waiting_targets,
  run.succeeded_targets,
  run.failed_targets,
  run.canceled_targets,
  run.needs_attention_targets,
  run.result,
  run.last_error,
  run.created_at,
  run.started_at,
  run.finished_at,
  run.updated_at
`;

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const toNullableIso = (value: Date | string | null): string | null => (value ? toIso(value) : null);

export const mapWorkflowRun = (row: DbWorkflowRun): MailWorkflowRun => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  workflowId: row.workflow_id,
  workflowVersionId: row.workflow_version_id,
  versionIdentity: row.version_identity,
  sourceHash: row.source_hash,
  kind: row.kind,
  mode: row.mode,
  channel: row.channel,
  state: row.state,
  inputs: parseJson(row.inputs),
  query: parseJson(row.target_query),
  preflightHash: row.preflight_hash,
  targetProgress: {
    total: row.target_count,
    queued: row.queued_targets,
    running: row.running_targets,
    waiting: row.waiting_targets,
    succeeded: row.succeeded_targets,
    failed: row.failed_targets,
    canceled: row.canceled_targets,
    needs_attention: row.needs_attention_targets,
  },
  result: row.result === null ? null : parseJson(row.result),
  lastError: row.last_error === null ? null : parseJson(row.last_error),
  createdAt: toIso(row.created_at),
  startedAt: toNullableIso(row.started_at),
  finishedAt: toNullableIso(row.finished_at),
  updatedAt: toIso(row.updated_at),
});

const mapWorkflowRunTarget = (row: DbWorkflowRunTarget): MailWorkflowRunTarget => ({
  id: row.id,
  parentRunId: row.parent_run_id,
  ordinal: Number(row.ordinal),
  targetKey: row.target_key,
  state: row.state,
  executionGeneration: Number(row.execution_generation),
  inputs: parseJson(row.frozen_inputs),
  source: parseJson(row.frozen_source),
  preconditions: parseJson(row.frozen_preconditions),
  result: row.result === null ? null : parseJson(row.result),
  lastError: row.last_error === null ? null : parseJson(row.last_error),
  cancelRequestedAt: toNullableIso(row.cancel_requested_at),
  createdAt: toIso(row.created_at),
  startedAt: toNullableIso(row.started_at),
  finishedAt: toNullableIso(row.finished_at),
  updatedAt: toIso(row.updated_at),
});

const actorColumns = (snapshot: MailWorkflowAuthorizationSnapshot, workflowVersionId: string) => {
  if (snapshot.authority === "mailbox") return { kind: "workflow" as const, id: workflowVersionId };
  return snapshot.actor.kind === "user"
    ? { kind: "user" as const, id: snapshot.actor.userId }
    : { kind: "service_account" as const, id: snapshot.actor.serviceAccountId };
};

type WorkflowActorColumns = ReturnType<typeof actorColumns>;

const authorizationIdentity = (snapshot: MailWorkflowAuthorizationSnapshot) =>
  snapshot.authority === "actor"
    ? {
        authority: snapshot.authority,
        actor: snapshot.actor,
        accessSubject: snapshot.accessSubject,
      }
    : {
        authority: snapshot.authority,
        mailboxId: snapshot.mailboxId,
        activatedBy: snapshot.activatedBy,
      };

const recordWorkflowRunRequest = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  actor: WorkflowActorColumns;
  mailboxId: string;
  workflowId: string;
  runId: string;
  version: MailWorkflowVersion;
  targetCount: number;
  actionCounts: Record<string, number>;
  kind: WorkflowRunKind;
  mode: WorkflowRunMode;
  channel: WorkflowRunChannel;
  idempotencyKey: string;
}): Promise<void> => {
  await params.db`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid, ${params.actor.kind}, ${params.actor.id}::uuid,
      'workflow.run', 'requested', 'workflow_run', ${params.runId}::uuid,
      ${{
        workflowId: params.workflowId,
        workflowVersionId: params.version.id,
        versionIdentity: params.version.identity,
        sourceHash: params.version.sourceHash,
        manifestHash: params.version.manifestHash,
        catalogHash: params.version.catalogHash,
        targetCount: params.targetCount,
        actionCounts: params.actionCounts,
        kind: params.kind,
        channel: params.channel,
      }}::jsonb
    )
  `;
  await audit.record(
    {
      action: "mail.workflow.run.request",
      outcome: "allowed",
      actor: auditActorFromRequest(params.context),
      target: { type: "workflow_run", id: params.runId },
      requestId: params.context.requestId,
      metadata: {
        mailboxId: params.mailboxId,
        workflowId: params.workflowId,
        workflowVersionId: params.version.id,
        versionIdentity: params.version.identity,
        sourceHash: params.version.sourceHash,
        manifestHash: params.version.manifestHash,
        catalogHash: params.version.catalogHash,
        targetCount: params.targetCount,
        actionCounts: params.actionCounts,
        kind: params.kind,
        mode: params.mode,
        channel: params.channel,
        idempotencyKey: params.idempotencyKey,
      },
    },
    params.db,
  );
};

const loadRunByIdempotency = async (params: {
  mailboxId: string;
  mode: WorkflowRunMode;
  idempotencyKey: string;
  db?: SqlClient;
  lock?: boolean;
}): Promise<(DbWorkflowRun & { request_hash: string }) | null> => {
  const db = params.db ?? sql;
  const [run] = await db<(DbWorkflowRun & { request_hash: string })[]>`
    SELECT ${workflowRunColumns}, run.request_hash
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid
      AND run.mode = ${params.mode}
      AND run.idempotency_key = ${params.idempotencyKey}
    ${params.lock ? sql`FOR UPDATE` : sql``}
  `;
  return run ?? null;
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

const insertTargets = async (
  db: SqlClient,
  parentRunId: string,
  targets: PreparedWorkflowTarget[],
  ordinalStart: number,
): Promise<void> => {
  for (let offset = 0; offset < targets.length; offset += 500) {
    const rows = targets.slice(offset, offset + 500).map((target, index) => {
      const id = crypto.randomUUID();
      return {
        id,
        ordinal: ordinalStart + offset + index,
        target_key: target.targetKey,
        frozen_inputs: target.inputs,
        frozen_source: target.source,
        frozen_preconditions: target.preconditions,
      };
    });
    await db`
      INSERT INTO mail.workflow_run_targets (
        id, parent_run_id, ordinal, target_key, state, execution_generation, execution_clock_at,
        frozen_inputs, frozen_source, frozen_preconditions
      )
      SELECT
        row.id, ${parentRunId}::uuid, row.ordinal, row.target_key, 'queued', 0, NULL,
        row.frozen_inputs, row.frozen_source, row.frozen_preconditions
      FROM jsonb_to_recordset(${rows}::jsonb) AS row(
        id uuid,
        ordinal bigint,
        target_key text,
        frozen_inputs jsonb,
        frozen_source jsonb,
        frozen_preconditions jsonb
      )
    `;
  }
};

type AutomaticActivationRow = {
  activation_id: string;
  mailbox_id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_key: string;
  trigger_kind: string;
  trigger_config: Record<string, WorkflowJsonValue> | string;
  authorization_snapshot: MailWorkflowAuthorizationSnapshot | string;
  version_identity: string;
  source_hash: string;
  bound_plan: WorkflowBoundPlan | string;
  effect_budget: WorkflowEffectBudget | string;
  manifest_hash: string;
  catalog_hash: string;
};

export type AutomaticWorkflowTarget = {
  key: string;
  source: WorkflowJsonValue;
  preconditions: WorkflowJsonValue;
};

export type AutomaticWorkflowMaterialization = { state: "created" | "existing"; runId: string } | { state: "skipped"; reason: string };

const automaticActivationColumns = sql`
  activation.id AS activation_id,
  activation.mailbox_id,
  activation.workflow_id,
  activation.workflow_version_id,
  activation.trigger_key,
  activation.trigger_kind,
  activation.trigger_config,
  activation.authorization_snapshot,
  version.version_identity,
  version.source_hash,
  version.bound_plan,
  version.effect_budget,
  version.manifest_hash,
  version.catalog_hash
`;

const loadAutomaticActivation = async (
  activationId: string,
  triggerKind: string,
  db: SqlClient = sql,
  lock = false,
): Promise<AutomaticActivationRow | null> => {
  const [activation] = await db<AutomaticActivationRow[]>`
    SELECT ${automaticActivationColumns}
    FROM mail.workflow_activations activation
    JOIN mail.workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.mailbox_id = activation.mailbox_id
     AND workflow.active_version_id = activation.workflow_version_id
    JOIN mail.workflow_versions version
      ON version.id = activation.workflow_version_id
     AND version.workflow_id = activation.workflow_id
     AND version.mailbox_id = activation.mailbox_id
    WHERE activation.id = ${activationId}::uuid
      AND activation.trigger_kind = ${triggerKind}
      AND activation.enabled
    ${lock ? sql`FOR SHARE OF activation, workflow, version` : sql``}
  `;
  return activation ?? null;
};

const addCounts = (left: Record<string, number>, right: Record<string, number>): Record<string, number> => {
  const result = { ...left };
  for (const [action, count] of Object.entries(right)) result[action] = (result[action] ?? 0) + count;
  return result;
};

const maxCounts = (counts: Record<string, number>[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const item of counts) {
    for (const [action, count] of Object.entries(item)) result[action] = Math.max(result[action] ?? 0, count);
  }
  return result;
};

const possibleActionCounts = (steps: WorkflowIrStep[]): Record<string, number> => {
  let result: Record<string, number> = {};
  for (const step of steps) {
    if (step.kind === "action") result[step.action] = (result[step.action] ?? 0) + 1;
    else if (step.kind === "if") {
      result = addCounts(result, maxCounts([possibleActionCounts(step.then), possibleActionCounts(step.else)]));
    } else if (step.kind === "switch") {
      result = addCounts(
        result,
        maxCounts([...step.cases.map((item) => possibleActionCounts(item.steps)), possibleActionCounts(step.default)]),
      );
    } else {
      throw new Error("Mail automatic workflows do not support forEach");
    }
  }
  return result;
};

const recordAutomaticSkip = async (activation: AutomaticActivationRow, deliveryKey: string, reason: string): Promise<void> => {
  await sql`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${activation.mailbox_id}::uuid,
      'workflow',
      ${activation.workflow_version_id}::uuid,
      'workflow.trigger',
      'failed',
      'workflow',
      ${activation.workflow_id}::uuid,
      ${{
        activationId: activation.activation_id,
        triggerKind: activation.trigger_kind,
        deliveryKey,
        reason,
      }}::jsonb
    )
  `;
};

export const materializeAutomaticWorkflowRun = async (params: {
  activationId: string;
  triggerKind: string;
  deliveryKey: string;
  occurredAt: string;
  channel: "event" | "schedule";
  triggerValues: Record<string, WorkflowJsonValue>;
  target: AutomaticWorkflowTarget;
}): Promise<AutomaticWorkflowMaterialization> => {
  const candidate = await loadAutomaticActivation(params.activationId, params.triggerKind);
  if (!candidate) return { state: "skipped", reason: "Activation is no longer active" };
  const authorization = parseJson(candidate.authorization_snapshot);
  if (authorization.authority !== "mailbox" || authorization.mailboxId !== candidate.mailbox_id) {
    const reason = "Activated workflow authority is invalid";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }

  const config = parseJson(candidate.trigger_config);
  const bindings = config.with;
  if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) {
    const reason = "Activated workflow trigger bindings are invalid";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }
  const plan = parseJson(candidate.bound_plan);
  const effectBudget = parseJson(candidate.effect_budget);
  const actionCounts = possibleActionCounts(plan.steps);
  if (workflowEffectBudgetExceeded(actionCounts, 1, effectBudget)) {
    const reason = "Automatic workflow exceeds its configured effect budget";
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }
  let inputs: Record<string, WorkflowJsonValue>;
  try {
    inputs = evaluateWorkflowTriggerInputs(params.triggerValues, bindings as Record<string, WorkflowJsonValue>, params.occurredAt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordAutomaticSkip(candidate, params.deliveryKey, reason);
    return { state: "skipped", reason };
  }

  const idempotencyKey = sha256Json({
    activationId: params.activationId,
    triggerKind: params.triggerKind,
    deliveryKey: params.deliveryKey,
  });
  const selection: WorkflowRunTargetSelection = {
    type: "trigger",
    kind: params.triggerKind,
    deliveryKey: params.deliveryKey,
  };
  const requestHash = sha256Json({
    activationId: params.activationId,
    workflowVersionId: candidate.workflow_version_id,
    authorization,
    inputs,
    selection,
    target: params.target,
  });
  const preflightHash = sha256Json({
    workflowVersionId: candidate.workflow_version_id,
    versionIdentity: candidate.version_identity,
    sourceHash: candidate.source_hash,
    inputs,
    selection,
    target: params.target,
    effectBudget,
    actionCounts,
  });
  const actor = actorColumns(authorization, candidate.workflow_version_id);

  const materialized = await sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
    const activation = await loadAutomaticActivation(params.activationId, params.triggerKind, tx, true);
    if (!activation) return { state: "skipped", reason: "Activation is no longer active" } as const;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${activation.mailbox_id}:workflow-trigger:${idempotencyKey}`}, 0))`;
    const existing = await loadRunByIdempotency({
      mailboxId: activation.mailbox_id,
      mode: "execute",
      idempotencyKey,
      db: tx,
      lock: true,
    });
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error("Automatic workflow idempotency key conflicts with a different request");
      return { state: "existing", runId: existing.id } as const;
    }

    const runId = crypto.randomUUID();
    const [run] = await tx<DbWorkflowRun[]>`
      INSERT INTO mail.workflow_runs AS run (
        id, mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
        kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
        inputs, target_query, preflight_hash, idempotency_key, request_hash, occurred_at,
        target_count, queued_targets
      ) VALUES (
        ${runId}::uuid, ${activation.mailbox_id}::uuid, ${activation.workflow_id}::uuid,
        ${activation.workflow_version_id}::uuid, ${activation.version_identity}, ${activation.source_hash},
        'trigger', 'execute', ${params.channel}, 'queued', ${actor.kind}, ${actor.id}::uuid,
        ${authorization}::jsonb, ${inputs}::jsonb, ${selection}::jsonb, ${preflightHash},
        ${idempotencyKey}, ${requestHash}, ${params.occurredAt}::timestamptz, 1, 1
      )
      RETURNING ${workflowRunColumns}
    `;
    if (!run) throw new Error("Automatic workflow run insert returned no row");
    await tx`
      INSERT INTO mail.workflow_run_targets (
        id, parent_run_id, ordinal, target_key, state, execution_generation,
        frozen_inputs, frozen_source, frozen_preconditions
      ) VALUES (
        ${crypto.randomUUID()}::uuid, ${runId}::uuid, 0, ${params.target.key}, 'queued', 0,
        ${inputs}::jsonb, ${params.target.source}::jsonb, ${params.target.preconditions}::jsonb
      )
    `;
    await tx`
      INSERT INTO mail.activity_events (
        mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
      ) VALUES (
        ${activation.mailbox_id}::uuid, ${actor.kind}, ${actor.id}::uuid,
        'workflow.run', 'requested', 'workflow_run', ${runId}::uuid,
        ${{
          workflowId: activation.workflow_id,
          workflowVersionId: activation.workflow_version_id,
          activationId: activation.activation_id,
          triggerKind: params.triggerKind,
          deliveryKey: params.deliveryKey,
          actionCounts,
        }}::jsonb
      )
    `;
    await audit.record(
      {
        action: "mail.workflow.run.request",
        outcome: "allowed",
        actor: null,
        target: { type: "workflow_run", id: runId },
        requestId: `mail-workflow-trigger:${runId}`,
        metadata: {
          mailboxId: activation.mailbox_id,
          workflowId: activation.workflow_id,
          workflowVersionId: activation.workflow_version_id,
          activationId: activation.activation_id,
          triggerKind: params.triggerKind,
          deliveryKey: params.deliveryKey,
          mode: "execute",
          channel: params.channel,
        },
      },
      tx,
    );
    return { state: "created", runId } as const;
  });

  if (materialized.state === "skipped") {
    await recordAutomaticSkip(candidate, params.deliveryKey, materialized.reason);
    return materialized;
  }
  if (materialized.state === "created") await dispatchMailWorkflowRun(materialized.runId).catch(() => undefined);
  return materialized;
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
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${run.mailbox_id}:execute:execute:${params.idempotencyKey}`}, 0))`;
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
              internalDate: toIso(current.materialization_cursor_internal_date),
              remoteMessageRefId: current.materialization_cursor_target_key,
            }
          : null;
      const batch = await prepareWorkflowTargetBatch({
        mailboxId: current.mailbox_id,
        workflowId: current.workflow_id,
        versionIdentity: current.version_identity,
        plan: version.boundPlan,
        inputs: parseJson(current.inputs),
        query: parseJson(current.target_query) as BackfillWorkflowInput["query"],
        occurredAt: toIso(current.occurred_at),
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
      await insertTargets(tx, current.id, batch.data.targets, current.queued_targets);
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
          actionCounts: parseJson(current.materialization_action_counts),
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
    await dispatchMailWorkflowRun(run.id).catch(() => undefined);
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
  const actor = actorColumns(params.authorizationSnapshot, params.input.expectedVersionId);
  const existing = await loadRunByIdempotency({
    mailboxId: params.mailboxId,
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
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:execute:execute:${params.input.idempotencyKey}`}, 0))`;
      const concurrent = await loadRunByIdempotency({
        mailboxId: params.mailboxId,
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
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${run.mailbox_id}:execute:execute:${run.idempotency_key}`}, 0))`;
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

export type MailWorkflowMaterializationRecovery = {
  scanned: number;
  recovered: number;
  canceled: number;
  failed: number;
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
      const run = await loadBackfillMaterializationRun(candidate.id, sql);
      if (!run || run.state !== "materializing") continue;
      const authorization = parseJson(run.authorization_snapshot);
      const context = await restoreMailWorkflowContext(authorization, run.id);
      if (!context) {
        if (
          await cancelRejectedMaterialization(run, {
            code: "WORKFLOW_AUTHORIZATION_REVOKED",
            message: "Workflow actor or credential is no longer active",
            reason: "authorization_revoked_during_materialization",
          })
        )
          result.canceled += 1;
        continue;
      }
      const resumed = await resumeBackfillWorkflowRun({
        run,
        context,
        actor: actorColumns(authorization, run.workflow_version_id),
        requestHash: run.request_hash,
        idempotencyKey: run.idempotency_key,
        enqueue: options.enqueue ?? true,
      });
      if (resumed.ok) {
        result.recovered += 1;
      } else if (resumed.error.status === 401 || resumed.error.status === 403) {
        if (
          await cancelRejectedMaterialization(run, {
            code: "WORKFLOW_PERMISSION_REVOKED",
            message: "Workflow actor no longer has mailbox write access",
            reason: "permission_revoked_during_materialization",
          })
        )
          result.canceled += 1;
      } else {
        materializationLog.error("Mail workflow materialization could not be resumed", {
          runId: run.id,
          code: resumed.error.code,
          message: resumed.error.message,
        });
        result.failed += 1;
      }
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
let materializationRuntimeStarted = false;

const runMaterializationRecovery = async (): Promise<MailWorkflowMaterializationRecovery> => {
  const result = await reconcileMailWorkflowMaterializations();
  if (result.failed > 0) materializationLog.error("Mail workflow materialization recovery failed", result);
  return result;
};

export const workflowMaterializationRuntime = {
  start: async (): Promise<void> => {
    if (materializationRuntimeStarted) return;
    await materializationScheduler.create({
      id: "mail:workflow-materialization:reconcile",
      cron: "* * * * *",
      meta: { appId: "mail", family: "mail:workflows", label: "Mail workflow materialization recovery" },
      process: runMaterializationRecovery,
    });
    materializationScheduler.start();
    materializationRuntimeStarted = true;
    await runMaterializationRecovery();
  },
  stop: async (): Promise<void> => {
    if (materializationRuntimeStarted) await materializationScheduler.stop();
    materializationRuntimeStarted = false;
  },
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
  const actor = actorColumns(authorizationSnapshot, params.input.expectedVersionId);
  const occurredAt = "occurredAt" in params.input ? params.input.occurredAt : (params.occurredAt ?? new Date().toISOString());
  if (!Number.isFinite(Date.parse(occurredAt))) return fail(err.badInput("Workflow occurrence time is invalid"));
  const requestHash = sha256Json({
    workflowId: params.workflowId,
    workflowVersionId: params.input.expectedVersionId,
    kind: params.kind,
    mode: params.mode,
    authorization: authorizationIdentity(authorizationSnapshot),
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
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.mailboxId}:execute:${params.mode}:${params.input.idempotencyKey}`}, 0))`;
      const existing = await loadRunByIdempotency({
        mailboxId: params.mailboxId,
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
        onBatch: (targets, ordinal) => insertTargets(tx, runId, targets, ordinal),
      });
      if (!streamed.ok) throw streamed.error;
      if (streamed.data.targetCount !== targetCount || streamed.data.targetDigest !== prepared.data.targetDigest) {
        throw new Error("Workflow target set changed inside a repeatable-read materialization");
      }
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid, ${actor.kind}, ${actor.id}::uuid,
          'workflow.run', 'requested', 'workflow_run', ${runId}::uuid,
          ${{
            workflowId: params.workflowId,
            workflowVersionId: version.id,
            versionIdentity: version.identity,
            sourceHash: version.sourceHash,
            manifestHash: version.manifestHash,
            catalogHash: version.catalogHash,
            targetCount,
            actionCounts: prepared.data.actionCounts,
            kind: params.kind,
            channel: params.channel,
          }}::jsonb
        )
      `;
      await audit.record(
        {
          action: "mail.workflow.run.request",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: runId },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            workflowId: params.workflowId,
            workflowVersionId: version.id,
            versionIdentity: version.identity,
            sourceHash: version.sourceHash,
            manifestHash: version.manifestHash,
            catalogHash: version.catalogHash,
            targetCount,
            actionCounts: prepared.data.actionCounts,
            kind: params.kind,
            mode: params.mode,
            channel: params.channel,
            idempotencyKey: params.input.idempotencyKey,
          },
        },
        tx,
      );
      return ok({ run: mapWorkflowRun(run), created: true });
    });
    if (!materialized.ok) return materialized;
    if (params.enqueue !== false && materialized.data.created) {
      await dispatchMailWorkflowRun(materialized.data.run.id).catch(() => undefined);
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

export const listWorkflowRuns = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId?: string;
  limit?: number;
}): Promise<Result<MailWorkflowRun[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.workflowId ?? null}::uuid IS NULL OR run.workflow_id = ${params.workflowId ?? null}::uuid)
    ORDER BY run.created_at DESC, run.id DESC
    LIMIT ${Math.min(Math.max(params.limit ?? 50, 1), 200)}
  `;
  return ok(rows.map(mapWorkflowRun));
};

export const getWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [run] = await sql<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
  `;
  return run ? ok(mapWorkflowRun(run)) : fail(err.notFound("Workflow run"));
};

export const listWorkflowRunTargets = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
  afterOrdinal?: number;
  limit?: number;
}): Promise<Result<MailWorkflowRunTarget[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [run] = await sql<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_runs
    WHERE id = ${params.runId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
  `;
  if (!run) return fail(err.notFound("Workflow run"));
  const rows = await sql<DbWorkflowRunTarget[]>`
    SELECT
      target.id,
      target.parent_run_id,
      target.ordinal,
      target.target_key,
      target.state,
      target.execution_generation,
      target.frozen_inputs,
      target.frozen_source,
      target.frozen_preconditions,
      target.result,
      target.last_error,
      target.cancel_requested_at,
      target.created_at,
      target.started_at,
      target.finished_at,
      target.updated_at
    FROM mail.workflow_run_targets target
    WHERE target.parent_run_id = ${params.runId}::uuid
      AND target.ordinal > ${params.afterOrdinal ?? -1}
    ORDER BY target.ordinal ASC
    LIMIT ${Math.min(Math.max(params.limit ?? 100, 1), 200)}
  `;
  return ok(rows.map(mapWorkflowRunTarget));
};

export const cancelWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
  reason?: string;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(params.context, params.mailboxId, "write", tx);
      if (!currentPermission.ok) return currentPermission;
      const [existing] = await tx<DbWorkflowRun[]>`
        SELECT ${workflowRunColumns}
        FROM mail.workflow_runs run
        WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!existing) return fail(err.notFound("Workflow run"));
      if (["succeeded", "failed", "canceled", "needs_attention"].includes(existing.state)) return ok(mapWorkflowRun(existing));
      if (existing.state === "materializing") {
        await tx`DELETE FROM mail.workflow_run_targets WHERE parent_run_id = ${params.runId}::uuid`;
        const [canceled] = await tx<DbWorkflowRun[]>`
          UPDATE mail.workflow_runs AS run
          SET
            state = 'canceled',
            target_count = 0,
            queued_targets = 0,
            materialization_cursor_internal_date = NULL,
            materialization_cursor_target_key = NULL,
            materialization_digest = NULL,
            materialization_expected_digest = NULL,
            materialization_action_counts = NULL,
            finished_at = now()
          WHERE run.id = ${params.runId}::uuid AND run.state = 'materializing'
          RETURNING ${workflowRunColumns}
        `;
        if (!canceled) throw new Error("Canceled workflow materialization could not be reloaded");
        await audit.record(
          {
            action: "mail.workflow.run.cancel",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "workflow_run", id: params.runId },
            requestId: params.context.requestId,
            metadata: { mailboxId: params.mailboxId, reason: params.reason ?? null },
          },
          tx,
        );
        return ok(mapWorkflowRun(canceled));
      }
      await tx`
        UPDATE mail.workflow_run_targets
        SET
          state = CASE WHEN state IN ('queued', 'waiting') THEN 'canceled' ELSE state END,
          cancel_requested_at = now(),
          cancel_reason = ${params.reason ?? "Canceled by actor"},
          finished_at = CASE WHEN state IN ('queued', 'waiting') THEN now() ELSE finished_at END
        WHERE parent_run_id = ${params.runId}::uuid
          AND state IN ('queued', 'running', 'waiting')
      `;
      const [run] = await tx<DbWorkflowRun[]>`
        WITH progress AS (
          SELECT
            COUNT(*) FILTER (WHERE state = 'queued')::int AS queued,
            COUNT(*) FILTER (WHERE state = 'running')::int AS running,
            COUNT(*) FILTER (WHERE state = 'waiting')::int AS waiting,
            COUNT(*) FILTER (WHERE state = 'succeeded')::int AS succeeded,
            COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE state = 'canceled')::int AS canceled,
            COUNT(*) FILTER (WHERE state = 'needs_attention')::int AS needs_attention
          FROM mail.workflow_run_targets
          WHERE parent_run_id = ${params.runId}::uuid
        )
        UPDATE mail.workflow_runs AS run
        SET
          queued_targets = progress.queued,
          running_targets = progress.running,
          waiting_targets = progress.waiting,
          succeeded_targets = progress.succeeded,
          failed_targets = progress.failed,
          canceled_targets = progress.canceled,
          needs_attention_targets = progress.needs_attention,
          state = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN 'canceled' ELSE run.state END,
          finished_at = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN now() ELSE run.finished_at END
        FROM progress
        WHERE run.id = ${params.runId}::uuid
        RETURNING ${workflowRunColumns}
      `;
      if (!run) throw new Error("Canceled workflow run could not be reloaded");
      await audit.record(
        {
          action: "mail.workflow.run.cancel",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: params.runId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, reason: params.reason ?? null },
        },
        tx,
      );
      return ok(mapWorkflowRun(run));
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to cancel workflow run"));
  }
};
