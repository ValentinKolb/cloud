import { audit } from "@valentinkolb/cloud/services";
import {
  err,
  fail,
  isServiceError,
  ok,
  type Result,
} from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import type {
  MailWorkflowRun,
  MailWorkflowRunPage,
  MailWorkflowRunTarget,
  RetryWorkflowRunInput,
  WorkflowRunState,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import {
  actorRefFromRequest,
  auditActorFromRequest,
  type MailRequestContext,
} from "./auth";
import { cancelPendingAutomaticRepliesInTransaction } from "./automatic-reply";
import { sha256Json } from "./canonical";
import {
  type DbWorkflowRun,
  type DbWorkflowRunTarget,
  mapWorkflowRun,
  mapWorkflowRunTarget,
  workflowRunColumns,
} from "./workflow-run-model";
import { lockWorkflowRunControl } from "./workflow-run-lock";
import { snapshotMailWorkflowAuthorization } from "./workflow-runtime-context";

type WorkflowRunWake = (runId: string) => Promise<void>;
const workflowRunCursorSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();
type WorkflowRunCursor = z.infer<typeof workflowRunCursorSchema>;

const encodeWorkflowRunCursor = (row: DbWorkflowRun): string =>
  Buffer.from(
    JSON.stringify({
      version: 1,
      createdAt: (row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at)
      ).toISOString(),
      id: row.id,
    } satisfies WorkflowRunCursor)
  ).toString("base64url");

const decodeWorkflowRunCursor = (
  value?: string
): Result<WorkflowRunCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = workflowRunCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    );
    return parsed.success
      ? ok(parsed.data)
      : fail(err.badInput("Invalid workflow run cursor"));
  } catch {
    return fail(err.badInput("Invalid workflow run cursor"));
  }
};

const actorColumns = (
  context: MailRequestContext
): { kind: string; id: string | null } => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account")
    return { kind: actor.kind, id: actor.serviceAccountId };
  if (actor.kind === "workflow")
    return { kind: actor.kind, id: actor.workflowVersionId };
  return { kind: actor.kind, id: null };
};

export const listWorkflowRuns = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId?: string;
  cursor?: string;
  limit?: number;
}): Promise<Result<MailWorkflowRunPage>> => {
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "read"
  );
  if (!allowed.ok) return allowed;
  const cursor = decodeWorkflowRunCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = await sql<DbWorkflowRun[]>`
    SELECT ${workflowRunColumns}
    FROM mail.workflow_runs run
    WHERE run.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.workflowId ?? null}::uuid IS NULL OR run.workflow_id = ${
    params.workflowId ?? null
  }::uuid)
      AND (${cursor.data?.createdAt ?? null}::timestamptz IS NULL
        OR (run.created_at, run.id) < (${
          cursor.data?.createdAt ?? null
        }::timestamptz, ${cursor.data?.id ?? null}::uuid))
    ORDER BY run.created_at DESC, run.id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return ok({
    items: page.map(mapWorkflowRun),
    nextCursor:
      hasMore && page.at(-1) ? encodeWorkflowRunCursor(page.at(-1)!) : null,
  });
};

export const getWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "read"
  );
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
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "read"
  );
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
      target.retry_of_target_id,
      EXISTS (
        SELECT 1 FROM mail.workflow_run_targets retry_target
        WHERE retry_target.retry_of_target_id = target.id
      ) AS has_retry,
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
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "write"
  );
  if (!allowed.ok) return allowed;
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(
        params.context,
        params.mailboxId,
        "write",
        tx
      );
      if (!currentPermission.ok) return currentPermission;
      await lockWorkflowRunControl(tx, params.runId);
      // Workers lock targets before their parent run. Keep control operations
      // in the same order to avoid deadlocks with concurrent transitions.
      await tx`
        SELECT target.id
        FROM mail.workflow_run_targets target
        JOIN mail.workflow_runs run ON run.id = target.parent_run_id
        WHERE target.parent_run_id = ${params.runId}::uuid
          AND run.mailbox_id = ${params.mailboxId}::uuid
          AND target.state IN ('queued', 'running', 'waiting')
        ORDER BY target.id
        FOR UPDATE OF target
      `;
      const [existing] = await tx<
        (DbWorkflowRun & { paused_from_state: WorkflowRunState | null })[]
      >`
        SELECT ${workflowRunColumns}, run.paused_from_state
        FROM mail.workflow_runs run
        WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!existing) return fail(err.notFound("Workflow run"));
      if (
        ["succeeded", "failed", "canceled", "needs_attention"].includes(
          existing.state
        )
      ) {
        if (existing.state === "canceled") {
          await cancelPendingAutomaticRepliesInTransaction({
            db: tx,
            mailboxId: params.mailboxId,
            workflowRunId: params.runId,
            code: "WORKFLOW_CANCELED",
            message: params.reason ?? "Canceled by actor",
          });
        }
        return ok(mapWorkflowRun(existing));
      }
      if (
        existing.state === "materializing" ||
        (existing.state === "paused" &&
          existing.paused_from_state === "materializing")
      ) {
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
            paused_at = NULL,
            pause_reason = NULL,
            paused_from_state = NULL,
            finished_at = now()
          WHERE run.id = ${params.runId}::uuid
            AND (run.state = 'materializing' OR (run.state = 'paused' AND run.paused_from_state = 'materializing'))
          RETURNING ${workflowRunColumns}
        `;
        if (!canceled)
          throw new Error(
            "Canceled workflow materialization could not be reloaded"
          );
        await recordCancellation(params, tx);
        return ok(mapWorkflowRun(canceled));
      }
      const [providerEffect] = await tx<{ active: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM mail.workflow_run_targets target
          JOIN mail.workflow_step_runs step ON step.target_id = target.id
          JOIN mail.commands command ON command.id = step.command_id
          WHERE target.parent_run_id = ${params.runId}::uuid
            AND target.state IN ('running', 'waiting')
            AND step.state IN ('running', 'waiting')
            AND command.provider_effect_started_at IS NOT NULL
        ) AS active
      `;
      if (providerEffect?.active === true) {
        return fail(
          err.conflict(
            "Workflow cancellation cannot overtake an in-flight provider effect"
          )
        );
      }
      await tx`
        UPDATE mail.workflow_run_targets
        SET
          state = CASE
            WHEN ${
              existing.state === "paused"
            } AND state IN ('queued', 'running', 'waiting') THEN 'canceled'
            WHEN state IN ('queued', 'waiting') THEN 'canceled'
            ELSE state
          END,
          cancel_requested_at = now(),
          cancel_reason = ${params.reason ?? "Canceled by actor"},
          lease_owner = CASE WHEN ${
            existing.state === "paused"
          } THEN NULL ELSE lease_owner END,
          lease_expires_at = CASE WHEN ${
            existing.state === "paused"
          } THEN NULL ELSE lease_expires_at END,
          finished_at = CASE
            WHEN ${
              existing.state === "paused"
            } OR state IN ('queued', 'waiting') THEN now()
            ELSE finished_at
          END
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
          paused_at = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN NULL ELSE run.paused_at END,
          pause_reason = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN NULL ELSE run.pause_reason END,
          paused_from_state = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN NULL ELSE run.paused_from_state END,
          finished_at = CASE WHEN progress.queued + progress.running + progress.waiting = 0 THEN now() ELSE run.finished_at END
        FROM progress
        WHERE run.id = ${params.runId}::uuid
        RETURNING ${workflowRunColumns}
      `;
      if (!run) throw new Error("Canceled workflow run could not be reloaded");
      await cancelPendingAutomaticRepliesInTransaction({
        db: tx,
        mailboxId: params.mailboxId,
        workflowRunId: params.runId,
        code: "WORKFLOW_CANCELED",
        message: params.reason ?? "Canceled by actor",
      });
      await recordCancellation(params, tx);
      return ok(mapWorkflowRun(run));
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to cancel workflow run"));
  }
};

const activeRunStates: WorkflowRunState[] = [
  "materializing",
  "queued",
  "running",
  "waiting",
];

export const pauseWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
  reason?: string;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "write"
  );
  if (!allowed.ok) return allowed;
  try {
    return await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(
        params.context,
        params.mailboxId,
        "write",
        tx
      );
      if (!currentPermission.ok) return currentPermission;
      await lockWorkflowRunControl(tx, params.runId);
      await tx`
        SELECT target.id
        FROM mail.workflow_run_targets target
        JOIN mail.workflow_runs run ON run.id = target.parent_run_id
        WHERE target.parent_run_id = ${params.runId}::uuid
          AND run.mailbox_id = ${params.mailboxId}::uuid
          AND target.state IN ('queued', 'running', 'waiting')
        ORDER BY target.id
        FOR UPDATE OF target
      `;
      const [existing] = await tx<
        (DbWorkflowRun & { paused_from_state: WorkflowRunState | null })[]
      >`
        SELECT ${workflowRunColumns}, run.paused_from_state
        FROM mail.workflow_runs run
        WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!existing) return fail(err.notFound("Workflow run"));
      if (existing.state === "paused") return ok(mapWorkflowRun(existing));
      if (!activeRunStates.includes(existing.state))
        return fail(err.conflict("Only an active workflow run can be paused"));
      const [pendingProviderEffect] = await tx<{ active: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM mail.workflow_run_targets target
          JOIN mail.workflow_step_runs step ON step.target_id = target.id
          JOIN mail.commands command ON command.id = step.command_id
          WHERE target.parent_run_id = ${params.runId}::uuid
            AND command.state IN ('queued', 'executing', 'ambiguous')
        ) AS active
      `;
      if (pendingProviderEffect?.active) {
        return fail(
          err.conflict(
            "Workflow pause cannot overtake a queued or in-flight provider effect"
          )
        );
      }
      const [paused] = await tx<DbWorkflowRun[]>`
        UPDATE mail.workflow_runs AS run
        SET
          state = 'paused',
          paused_at = now(),
          pause_reason = ${params.reason ?? null},
          paused_from_state = ${existing.state}
        WHERE run.id = ${params.runId}::uuid
        RETURNING ${workflowRunColumns}
      `;
      if (!paused) throw new Error("Paused workflow run could not be reloaded");
      await audit.record(
        {
          action: "mail.workflow.run.pause",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: params.runId },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            reason: params.reason ?? null,
          },
        },
        tx
      );
      return ok(mapWorkflowRun(paused));
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to pause workflow run"));
  }
};

export const resumeWorkflowRun = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
  reason?: string;
  wake?: WorkflowRunWake;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "write"
  );
  if (!allowed.ok) return allowed;
  try {
    const result = await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(
        params.context,
        params.mailboxId,
        "write",
        tx
      );
      if (!currentPermission.ok) return currentPermission;
      await lockWorkflowRunControl(tx, params.runId);
      await tx`
        SELECT target.id
        FROM mail.workflow_run_targets target
        JOIN mail.workflow_runs run ON run.id = target.parent_run_id
        WHERE target.parent_run_id = ${params.runId}::uuid
          AND run.mailbox_id = ${params.mailboxId}::uuid
          AND target.state IN ('queued', 'running', 'waiting')
        ORDER BY target.id
        FOR UPDATE OF target
      `;
      const [existing] = await tx<
        (DbWorkflowRun & { paused_from_state: WorkflowRunState | null })[]
      >`
        SELECT ${workflowRunColumns}, run.paused_from_state
        FROM mail.workflow_runs run
        WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!existing) return fail(err.notFound("Workflow run"));
      if (existing.state !== "paused" || !existing.paused_from_state)
        return fail(err.conflict("Workflow run is not paused"));
      if (existing.paused_from_state !== "materializing") {
        await tx`
          UPDATE mail.workflow_run_targets
          SET
            state = 'queued',
            execution_generation = execution_generation + 1,
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            finished_at = NULL
          WHERE parent_run_id = ${params.runId}::uuid AND state IN ('running', 'waiting')
        `;
      }
      const [resumed] = await tx<DbWorkflowRun[]>`
        WITH progress AS (
          SELECT
            COUNT(*)::int AS total,
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
          state = CASE
            WHEN run.paused_from_state = 'materializing' THEN 'materializing'
            WHEN progress.running > 0 THEN 'running'
            WHEN progress.queued > 0 THEN 'queued'
            WHEN progress.waiting > 0 THEN 'waiting'
            WHEN progress.needs_attention > 0 THEN 'needs_attention'
            WHEN progress.failed > 0 THEN 'failed'
            WHEN progress.canceled > 0 THEN 'canceled'
            ELSE 'succeeded'
          END,
          queued_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.queued_targets ELSE progress.queued END,
          running_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.running_targets ELSE progress.running END,
          waiting_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.waiting_targets ELSE progress.waiting END,
          succeeded_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.succeeded_targets ELSE progress.succeeded END,
          failed_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.failed_targets ELSE progress.failed END,
          canceled_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.canceled_targets ELSE progress.canceled END,
          needs_attention_targets = CASE WHEN run.paused_from_state = 'materializing' THEN run.needs_attention_targets ELSE progress.needs_attention END,
          paused_at = NULL,
          pause_reason = NULL,
          paused_from_state = NULL,
          finished_at = CASE WHEN run.paused_from_state <> 'materializing' AND progress.queued + progress.running + progress.waiting = 0 THEN now() ELSE NULL END
        FROM progress
        WHERE run.id = ${params.runId}::uuid
        RETURNING ${workflowRunColumns}
      `;
      if (!resumed)
        throw new Error("Resumed workflow run could not be reloaded");
      await audit.record(
        {
          action: "mail.workflow.run.resume",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: params.runId },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            reason: params.reason ?? null,
          },
        },
        tx
      );
      return ok(mapWorkflowRun(resumed));
    });
    if (
      result.ok &&
      ["queued", "running", "waiting"].includes(result.data.state)
    ) {
      await params.wake?.(result.data.id).catch(() => undefined);
    }
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to resume workflow run"));
  }
};

export const retryWorkflowRunTargets = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  runId: string;
  input: RetryWorkflowRunInput;
  channel: "ui" | "api" | "agent";
  wake?: WorkflowRunWake;
}): Promise<Result<MailWorkflowRun>> => {
  const allowed = await requireMailboxPermission(
    params.context,
    params.mailboxId,
    "write"
  );
  if (!allowed.ok) return allowed;
  const authorization = snapshotMailWorkflowAuthorization(params.context);
  if (!authorization)
    return fail(
      err.forbidden("Durable Mail work requires a current service credential")
    );
  const actor = actorColumns(params.context);
  const requestHash = sha256Json({
    sourceRunId: params.runId,
    targetIds: params.input.targetIds,
    reason: params.input.reason ?? null,
  });
  try {
    const result = await sql.begin(async (tx) => {
      const currentPermission = await requireMailboxPermission(
        params.context,
        params.mailboxId,
        "write",
        tx
      );
      if (!currentPermission.ok) return currentPermission;
      const [sourceIdentity] = await tx<{ workflow_id: string }[]>`
        SELECT workflow_id
        FROM mail.workflow_runs
        WHERE id = ${params.runId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
      `;
      if (!sourceIdentity) return fail(err.notFound("Workflow run"));
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${params.mailboxId}:${sourceIdentity.workflow_id}:execute:${params.input.idempotencyKey}`}, 0)
        )
      `;
      const [existingRetry] = await tx<DbWorkflowRun[]>`
        SELECT ${workflowRunColumns}
        FROM mail.workflow_runs run
        WHERE run.mailbox_id = ${params.mailboxId}::uuid
          AND run.workflow_id = ${sourceIdentity.workflow_id}::uuid
          AND run.mode = 'execute'
          AND run.idempotency_key = ${params.input.idempotencyKey}
        FOR UPDATE OF run
      `;
      if (existingRetry)
        return existingRetry.request_hash === requestHash
          ? ok(mapWorkflowRun(existingRetry))
          : fail(err.conflict("Retry idempotency key is already in use"));
      const selected = await tx<
        Array<{
          id: string;
          target_key: string;
          state: string;
          execution_clock_at: Date | string;
          frozen_inputs: unknown;
          frozen_source: unknown;
          frozen_preconditions: unknown;
          frozen_hydration: unknown;
        }>
      >`
        SELECT
          target.id, target.target_key, target.state, target.execution_clock_at,
          target.frozen_inputs, target.frozen_source, target.frozen_preconditions, target.frozen_hydration
        FROM mail.workflow_run_targets target
        JOIN mail.workflow_runs run ON run.id = target.parent_run_id
        WHERE target.parent_run_id = ${params.runId}::uuid
          AND run.mailbox_id = ${params.mailboxId}::uuid
          AND target.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${params.input.targetIds}::jsonb))
        ORDER BY target.id
        FOR UPDATE OF target
      `;
      if (selected.length !== params.input.targetIds.length)
        return fail(
          err.badInput("Every retry target must belong to the source run")
        );
      const [source] = await tx<
        Array<
          DbWorkflowRun & {
            authorization_snapshot: unknown;
            idempotency_key: string;
            occurred_at: Date | string;
          }
        >
      >`
        SELECT ${workflowRunColumns}, run.authorization_snapshot, run.idempotency_key, run.occurred_at
        FROM mail.workflow_runs run
        WHERE run.id = ${params.runId}::uuid AND run.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!source) return fail(err.notFound("Workflow run"));
      if (
        source.mode !== "execute" ||
        !["failed", "needs_attention"].includes(source.state)
      ) {
        return fail(
          err.conflict("Only failed execute-run targets can be retried")
        );
      }
      if (
        selected.some(
          (target) =>
            target.state !== "failed" && target.state !== "needs_attention"
        )
      ) {
        return fail(
          err.conflict("Every retry target must be failed or need attention")
        );
      }
      const [alreadyRetried] = await tx<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM mail.workflow_run_targets retry_target
          WHERE retry_target.retry_of_target_id IN (
            SELECT value::uuid FROM jsonb_array_elements_text(${params.input.targetIds}::jsonb)
          )
        ) AS exists
      `;
      if (alreadyRetried?.exists)
        return fail(
          err.conflict(
            "Every workflow target can be retried only once; retry its child target instead"
          )
        );
      const [unsafe] = await tx<{ active: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM mail.workflow_step_runs step
          JOIN mail.commands command ON command.id = step.command_id
          WHERE step.target_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${params.input.targetIds}::jsonb))
            AND (
              command.provider_effect_started_at IS NOT NULL
              OR command.state NOT IN ('failed', 'cancelled')
            )
          UNION ALL
          SELECT 1
          FROM mail.workflow_step_runs step
          WHERE step.target_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${params.input.targetIds}::jsonb))
            AND step.state = 'succeeded'
            AND step.outcome #>> '{outcome,output,applied}' = 'true'
        ) AS active
      `;
      if (unsafe?.active) {
        return fail(
          err.conflict(
            "Retry is forbidden after an effect was applied or a provider outcome became ambiguous"
          )
        );
      }
      const runId = crypto.randomUUID();
      const query = {
        type: "retry",
        sourceRunId: params.runId,
        targetIds: params.input.targetIds,
      } as const;
      const [created] = await tx<DbWorkflowRun[]>`
        INSERT INTO mail.workflow_runs AS run (
          id, mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
          kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
          inputs, target_query, preflight_hash, idempotency_key, request_hash, occurred_at,
          target_count, queued_targets, retry_of_run_id
        ) VALUES (
          ${runId}::uuid, ${params.mailboxId}::uuid, ${source.workflow_id}::uuid, ${source.workflow_version_id}::uuid,
          ${source.version_identity}, ${source.source_hash}, 'retry', 'execute', ${params.channel}, 'queued',
          ${actor.kind}, ${actor.id}::uuid, ${authorization}::jsonb,
          ${source.inputs}::jsonb, ${query}::jsonb, ${source.preflight_hash}, ${params.input.idempotencyKey}, ${requestHash}, now(),
          ${selected.length}, ${selected.length}, ${params.runId}::uuid
        )
        RETURNING ${workflowRunColumns}
      `;
      if (!created)
        throw new Error("Retry workflow run insert returned no row");
      await tx`
        INSERT INTO mail.workflow_run_targets (
          id, parent_run_id, ordinal, target_key, state, execution_clock_at,
          frozen_inputs, frozen_source, frozen_preconditions, frozen_hydration, retry_of_target_id
        )
        SELECT
          gen_random_uuid(), ${runId}::uuid, row_number() OVER (ORDER BY source_target.ordinal) - 1,
          source_target.target_key, 'queued', source_target.execution_clock_at,
          source_target.frozen_inputs, source_target.frozen_source, source_target.frozen_preconditions,
          source_target.frozen_hydration, source_target.id
        FROM mail.workflow_run_targets source_target
        WHERE source_target.parent_run_id = ${params.runId}::uuid
          AND source_target.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${params.input.targetIds}::jsonb))
        ORDER BY source_target.ordinal
      `;
      await audit.record(
        {
          action: "mail.workflow.run.retry",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "workflow_run", id: runId },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            sourceRunId: params.runId,
            targetIds: params.input.targetIds,
            reason: params.input.reason ?? null,
          },
        },
        tx
      );
      return ok(mapWorkflowRun(created));
    });
    if (result.ok) await params.wake?.(result.data.id).catch(() => undefined);
    return result;
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to retry workflow run targets"));
  }
};

const recordCancellation = async (
  params: {
    context: MailRequestContext;
    mailboxId: string;
    runId: string;
    reason?: string;
  },
  db: Parameters<typeof audit.record>[1]
): Promise<void> => {
  await audit.record(
    {
      action: "mail.workflow.run.cancel",
      outcome: "allowed",
      actor: auditActorFromRequest(params.context),
      target: { type: "workflow_run", id: params.runId },
      requestId: params.context.requestId,
      metadata: { mailboxId: params.mailboxId, reason: params.reason ?? null },
    },
    db
  );
};
