import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { MailWorkflowRun, MailWorkflowRunTarget } from "../contracts";
import { requireMailboxPermission } from "./access";
import { auditActorFromRequest, type MailRequestContext } from "./auth";
import {
  type DbWorkflowRun,
  type DbWorkflowRunTarget,
  mapWorkflowRun,
  mapWorkflowRunTarget,
  workflowRunColumns,
} from "./workflow-run-model";

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
        await recordCancellation(params, tx);
        return ok(mapWorkflowRun(canceled));
      }
      await tx`
        SELECT id
        FROM mail.workflow_run_targets
        WHERE parent_run_id = ${params.runId}::uuid
          AND state IN ('queued', 'running', 'waiting')
        FOR UPDATE
      `;
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
        return fail(err.conflict("Workflow cancellation cannot overtake an in-flight provider effect"));
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
      await recordCancellation(params, tx);
      return ok(mapWorkflowRun(run));
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to cancel workflow run"));
  }
};

const recordCancellation = async (
  params: { context: MailRequestContext; mailboxId: string; runId: string; reason?: string },
  db: Parameters<typeof audit.record>[1],
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
    db,
  );
};
