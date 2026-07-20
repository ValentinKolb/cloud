import { sql } from "bun";
import { cancelPendingAutomaticRepliesInTransaction } from "./automatic-reply";

type SqlClient = typeof sql;

type MailboxExecutionPauseSummary = {
  resources: number;
  syncRuns: number;
  commandsCancelled: number;
  commandsNeedAttention: number;
  outboxCancelled: number;
  outboxNeedAttention: number;
  workflowActivations: number;
  workflowTriggers: number;
  workflowRuns: number;
  workflowTargets: number;
};

const affectedRows = (result: { count: number }): number => Number(result.count);

export const pauseMailboxTransport = async (params: {
  mailboxId: string;
  code: "MAILBOX_DELETED" | "MAILBOX_RESTORED_PAUSED";
  message: string;
  db?: SqlClient;
}): Promise<number> => {
  const db = params.db ?? sql;
  const resources = await db`
    UPDATE mail.remote_resources
    SET
      status = 'paused',
      sync_generation = sync_generation + 1,
      current_fence_token = current_fence_token + 1,
      last_error_code = ${params.code},
      last_error_message = ${params.message},
      updated_at = now()
    WHERE mailbox_id = ${params.mailboxId}::uuid
  `;
  return affectedRows(resources);
};

export const pauseDeletedMailboxExecution = async (mailboxId: string, db: SqlClient = sql): Promise<MailboxExecutionPauseSummary> => {
  const code = "MAILBOX_DELETED";
  const message = "Mailbox was deleted; execution remains paused after restore until an administrator resumes it";
  const resources = await pauseMailboxTransport({ mailboxId, code, message, db });
  const syncRuns = await db`
    UPDATE mail.sync_runs run
    SET state = 'cancelled', error_code = ${code}, error_message = ${message}, finished_at = now()
    FROM mail.remote_resources resource
    WHERE run.remote_resource_id = resource.id
      AND resource.mailbox_id = ${mailboxId}::uuid
      AND run.state = 'running'
  `;
  const [outbox] = await db<{ cancelled: number; needs_attention: number }[]>`
    WITH changed AS (
      UPDATE mail.outbox_submissions submission
      SET
        state = CASE
          WHEN submission.state IN ('scheduled', 'undo_window') THEN 'cancelled'
          ELSE 'needs_attention'
        END,
        last_error_code = ${code},
        last_error_message = ${message},
        updated_at = now()
      WHERE submission.mailbox_id = ${mailboxId}::uuid
        AND submission.state IN ('scheduled', 'undo_window', 'sending', 'accepted', 'sent_sync_pending', 'unknown')
      RETURNING submission.draft_id, submission.state
    ), reset_drafts AS (
      UPDATE mail.drafts draft
      SET state = 'draft', updated_at = now()
      WHERE draft.id IN (SELECT draft_id FROM changed WHERE state = 'cancelled')
        AND draft.state IN ('scheduled', 'sending')
    )
    SELECT
      COUNT(*) FILTER (WHERE state = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE state = 'needs_attention')::int AS needs_attention
    FROM changed
  `;
  const [commands] = await db<{ cancelled: number; needs_attention: number }[]>`
    WITH changed AS (
      UPDATE mail.commands command
      SET
        state = CASE
          WHEN command.state = 'ambiguous'
            OR command.provider_effect_started_at IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM mail.outbox_submissions submission
              WHERE submission.command_id = command.id AND submission.state = 'needs_attention'
            )
          THEN 'needs_attention'
          ELSE 'cancelled'
        END,
        finished_at = now(),
        worker_heartbeat_at = NULL,
        last_error_code = ${code},
        last_error_message = ${message},
        updated_at = now()
      WHERE command.mailbox_id = ${mailboxId}::uuid
        AND command.state IN ('queued', 'executing', 'ambiguous')
      RETURNING command.state
    )
    SELECT
      COUNT(*) FILTER (WHERE state = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE state = 'needs_attention')::int AS needs_attention
    FROM changed
  `;
  const workflowActivations = await db`
    UPDATE mail.workflow_activations
    SET enabled = false, updated_at = now()
    WHERE mailbox_id = ${mailboxId}::uuid AND enabled
  `;
  const workflowTriggers = await db`
    UPDATE mail.workflow_trigger_events
    SET
      state = 'failed',
      execution_generation = execution_generation + 1,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = ${{ code, message, retryable: false }}::jsonb,
      finished_at = now(),
      updated_at = now()
    WHERE mailbox_id = ${mailboxId}::uuid AND state IN ('queued', 'running')
  `;
  const materializingRuns = await db<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_runs
    WHERE mailbox_id = ${mailboxId}::uuid AND state = 'materializing'
    FOR UPDATE
  `;
  if (materializingRuns.length > 0) {
    const ids = materializingRuns.map((run) => run.id);
    await db`
      DELETE FROM mail.workflow_run_targets
      WHERE parent_run_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
    `;
    await db`
      UPDATE mail.workflow_runs
      SET
        state = 'canceled',
        target_count = 0,
        queued_targets = 0,
        materialization_cursor_internal_date = NULL,
        materialization_cursor_target_key = NULL,
        materialization_digest = NULL,
        materialization_expected_digest = NULL,
        materialization_action_counts = NULL,
        last_error = ${{ code, message, retryable: false }}::jsonb,
        finished_at = now(),
        updated_at = now()
      WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))
        AND state = 'materializing'
    `;
  }
  const workflowTargets = await db`
    UPDATE mail.workflow_run_targets target
    SET
      state = CASE WHEN target.state IN ('queued', 'waiting') THEN 'canceled' ELSE target.state END,
      cancel_requested_at = COALESCE(target.cancel_requested_at, now()),
      cancel_reason = ${message},
      finished_at = CASE WHEN target.state IN ('queued', 'waiting') THEN now() ELSE target.finished_at END,
      updated_at = now()
    FROM mail.workflow_runs run
    WHERE target.parent_run_id = run.id
      AND run.mailbox_id = ${mailboxId}::uuid
      AND run.state IN ('queued', 'running', 'waiting')
      AND target.state IN ('queued', 'running', 'waiting')
  `;
  const workflowRuns = await db`
    WITH progress AS (
      SELECT
        run.id AS parent_run_id,
        COUNT(*) FILTER (WHERE target.state = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE target.state = 'running')::int AS running,
        COUNT(*) FILTER (WHERE target.state = 'waiting')::int AS waiting,
        COUNT(*) FILTER (WHERE target.state = 'succeeded')::int AS succeeded,
        COUNT(*) FILTER (WHERE target.state = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE target.state = 'canceled')::int AS canceled,
        COUNT(*) FILTER (WHERE target.state = 'needs_attention')::int AS needs_attention
      FROM mail.workflow_runs run
      LEFT JOIN mail.workflow_run_targets target ON target.parent_run_id = run.id
      WHERE run.mailbox_id = ${mailboxId}::uuid
        AND run.state IN ('queued', 'running', 'waiting')
      GROUP BY run.id
    )
    UPDATE mail.workflow_runs run
    SET
      queued_targets = progress.queued,
      running_targets = progress.running,
      waiting_targets = progress.waiting,
      succeeded_targets = progress.succeeded,
      failed_targets = progress.failed,
      canceled_targets = progress.canceled,
      needs_attention_targets = progress.needs_attention,
      state = 'canceled',
      last_error = ${{ code, message, retryable: false }}::jsonb,
      finished_at = now(),
      updated_at = now()
    FROM progress
    WHERE run.id = progress.parent_run_id
  `;
  await cancelPendingAutomaticRepliesInTransaction({ db, mailboxId, code, message });

  return {
    resources,
    syncRuns: affectedRows(syncRuns),
    commandsCancelled: commands?.cancelled ?? 0,
    commandsNeedAttention: commands?.needs_attention ?? 0,
    outboxCancelled: outbox?.cancelled ?? 0,
    outboxNeedAttention: outbox?.needs_attention ?? 0,
    workflowActivations: affectedRows(workflowActivations),
    workflowTriggers: affectedRows(workflowTriggers),
    workflowRuns: materializingRuns.length + affectedRows(workflowRuns),
    workflowTargets: affectedRows(workflowTargets),
  };
};
