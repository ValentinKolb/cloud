import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "./migrate";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("mail migrations", () => {
  test("hard-cuts workflow storage while preserving the rest of the Mail schema", async () => {
    await migrate();

    const [before] = await sql<{ commands_oid: number; mailboxes_oid: number }[]>`
      SELECT
        'mail.commands'::regclass::oid AS commands_oid,
        'mail.mailboxes'::regclass::oid AS mailboxes_oid
    `;
    if (!before) throw new Error("Mail schema OIDs were not returned");

    await sql`DELETE FROM mail.schema_migrations WHERE version IN (26, 27)`;

    await migrate();

    const [state] = await sql<
      {
        migration_applied: boolean;
        durable_materialization_migration_applied: boolean;
        commands_preserved: boolean;
        mailboxes_preserved: boolean;
        workflow_tables_present: boolean;
        canonical_columns_present: boolean;
        legacy_columns_absent: boolean;
        indexes_present: boolean;
        touch_triggers: number;
        immutable_trigger: boolean;
        target_primary_key: boolean;
        target_ordinal_unique: boolean;
        run_idempotency_unique: boolean;
        materialization_constraint: boolean;
        step_primary_key: boolean;
      }[]
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 26 AND name = 'canonical_workflow_foundation'
        ) AS migration_applied,
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 27 AND name = 'durable_workflow_materialization'
        ) AS durable_materialization_migration_applied,
        'mail.commands'::regclass::oid = ${before.commands_oid}::oid AS commands_preserved,
        'mail.mailboxes'::regclass::oid = ${before.mailboxes_oid}::oid AS mailboxes_preserved,
        NOT EXISTS (
          SELECT 1
          FROM (VALUES
            ('workflows'),
            ('workflow_versions'),
            ('workflow_activations'),
            ('workflow_trigger_events'),
            ('workflow_runs'),
            ('workflow_run_targets'),
            ('workflow_step_runs')
          ) expected(table_name)
          WHERE to_regclass('mail.' || expected.table_name) IS NULL
        ) AS workflow_tables_present,
        NOT EXISTS (
          SELECT 1
          FROM (VALUES
            ('workflows', 'current_version_id'),
            ('workflows', 'active_version_id'),
            ('workflow_versions', 'version_identity'),
            ('workflow_versions', 'source'),
            ('workflow_versions', 'source_hash'),
            ('workflow_versions', 'ir'),
            ('workflow_versions', 'bound_plan'),
            ('workflow_versions', 'manifest_hash'),
            ('workflow_versions', 'catalog_hash'),
            ('workflow_versions', 'compiler_version'),
            ('workflow_activations', 'authorization_snapshot'),
            ('workflow_trigger_events', 'delivery_key'),
            ('workflow_trigger_events', 'execution_generation'),
            ('workflow_trigger_events', 'lease_token'),
            ('workflow_trigger_events', 'payload'),
            ('workflow_trigger_events', 'result'),
            ('workflow_runs', 'mode'),
            ('workflow_runs', 'channel'),
            ('workflow_runs', 'occurred_at'),
            ('workflow_runs', 'target_count'),
            ('workflow_runs', 'materialization_cursor_internal_date'),
            ('workflow_runs', 'materialization_cursor_target_key'),
            ('workflow_runs', 'materialization_digest'),
            ('workflow_runs', 'materialization_expected_digest'),
            ('workflow_runs', 'materialization_action_counts'),
            ('workflow_run_targets', 'id'),
            ('workflow_run_targets', 'parent_run_id'),
            ('workflow_run_targets', 'execution_generation'),
            ('workflow_run_targets', 'execution_clock_at'),
            ('workflow_run_targets', 'lease_token'),
            ('workflow_run_targets', 'cancel_requested_at'),
            ('workflow_run_targets', 'frozen_inputs'),
            ('workflow_run_targets', 'frozen_source'),
            ('workflow_run_targets', 'frozen_preconditions'),
            ('workflow_step_runs', 'target_id'),
            ('workflow_step_runs', 'step_key'),
            ('workflow_step_runs', 'source_path'),
            ('workflow_step_runs', 'iteration_path'),
            ('workflow_step_runs', 'path'),
            ('workflow_step_runs', 'mode'),
            ('workflow_step_runs', 'outcome'),
            ('workflow_step_runs', 'dependency'),
            ('workflow_step_runs', 'command_id'),
            ('workflow_step_runs', 'execution_generation')
          ) expected(table_name, column_name)
          WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns column_info
            WHERE column_info.table_schema = 'mail'
              AND column_info.table_name = expected.table_name
              AND column_info.column_name = expected.column_name
          )
        ) AS canonical_columns_present,
        NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND (
              (table_name = 'workflow_versions' AND column_name IN ('definition', 'definition_hash', 'version'))
              OR (table_name = 'workflow_runs' AND column_name IN ('workflow_version', 'trigger_type', 'preview_hash'))
              OR (table_name = 'workflow_run_targets' AND column_name = 'run_id')
              OR (table_name = 'workflow_step_runs' AND column_name IN ('run_id', 'target_ordinal', 'action'))
            )
        ) AS legacy_columns_absent,
        NOT EXISTS (
          SELECT 1
          FROM (VALUES
            ('mail.workflows_active_idx'),
            ('mail.workflow_versions_source_hash_idx'),
            ('mail.workflow_activations_dispatch_idx'),
            ('mail.workflow_trigger_events_dispatch_idx'),
            ('mail.workflow_runs_dispatch_idx'),
            ('mail.workflow_runs_mailbox_history_idx'),
            ('mail.workflow_run_targets_dispatch_idx'),
            ('mail.workflow_step_runs_dispatch_idx'),
            ('mail.workflow_step_runs_command_idx')
          ) expected(index_name)
          WHERE to_regclass(expected.index_name) IS NULL
        ) AS indexes_present,
        (
          SELECT count(*)::int
          FROM pg_trigger
          WHERE tgname IN (
            'workflows_touch_updated_at',
            'workflow_activations_touch_updated_at',
            'workflow_trigger_events_touch_updated_at',
            'workflow_runs_touch_updated_at',
            'workflow_run_targets_touch_updated_at',
            'workflow_step_runs_touch_updated_at'
          )
            AND NOT tgisinternal
        ) AS touch_triggers,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = 'mail.workflow_versions'::regclass
            AND tgname = 'workflow_versions_reject_update'
            AND NOT tgisinternal
        ) AS immutable_trigger,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.workflow_run_targets'::regclass
            AND contype = 'p'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
        ) AS target_primary_key,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.workflow_run_targets'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (parent_run_id, ordinal)'
        ) AS target_ordinal_unique,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.workflow_runs'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (mailbox_id, mode, idempotency_key)'
        ) AS run_idempotency_unique,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.workflow_runs'::regclass
            AND conname = 'workflow_runs_materialization_check'
        ) AS materialization_constraint,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.workflow_step_runs'::regclass
            AND contype = 'p'
            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (target_id, step_key)'
        ) AS step_primary_key
    `;
    expect(state).toEqual({
      migration_applied: true,
      durable_materialization_migration_applied: true,
      commands_preserved: true,
      mailboxes_preserved: true,
      workflow_tables_present: true,
      canonical_columns_present: true,
      legacy_columns_absent: true,
      indexes_present: true,
      touch_triggers: 6,
      immutable_trigger: true,
      target_primary_key: true,
      target_ordinal_unique: true,
      run_idempotency_unique: true,
      materialization_constraint: true,
      step_primary_key: true,
    });

    const mailboxId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO mail.mailboxes (id, name) VALUES (${mailboxId}, 'Workflow migration test')`;
      await tx`
        INSERT INTO mail.workflows (
          id, mailbox_id, name, current_version_id, created_by_kind, created_by_id
        ) VALUES (
          ${workflowId}, ${mailboxId}, 'Immutable workflow', ${versionId}, 'user', ${crypto.randomUUID()}
        )
      `;
      await tx`
        INSERT INTO mail.workflow_versions (
          id, version_identity, workflow_id, mailbox_id, source, source_hash,
          ir, bound_plan, effect_budget, language_id, language_version,
          manifest_hash, catalog_hash, compiler_name, compiler_version,
          created_by_kind, created_by_id
        ) VALUES (
          ${versionId}, 'immutable-test-v1', ${workflowId}, ${mailboxId}, 'steps: []\n', ${"a".repeat(64)},
          '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'mail', 1,
          ${"b".repeat(64)}, ${"c".repeat(64)}, 'cloud-workflows', '1',
          'user', ${crypto.randomUUID()}
        )
      `;
    });
    let invalidMaterializationError: unknown;
    try {
      await sql`
        INSERT INTO mail.workflow_runs (
          mailbox_id, workflow_id, workflow_version_id, version_identity, source_hash,
          kind, mode, channel, state, actor_kind, actor_id, authorization_snapshot,
          target_query, preflight_hash, idempotency_key, request_hash, occurred_at, target_count
        ) VALUES (
          ${mailboxId}, ${workflowId}, ${versionId}, 'immutable-test-v1', ${"a".repeat(64)},
          'backfill', 'execute', 'bulk', 'materializing', 'user', ${crypto.randomUUID()}, '{}'::jsonb,
          '{"type":"all"}'::jsonb, ${"d".repeat(64)}, 'invalid-materialization', ${"e".repeat(64)}, now(), 1
        )
      `;
    } catch (error) {
      invalidMaterializationError = error;
    }
    expect(invalidMaterializationError).toMatchObject({ errno: "23514" });
    let immutableError: unknown;
    try {
      await sql`UPDATE mail.workflow_versions SET source = 'steps: [changed]' WHERE id = ${versionId}`;
    } catch (error) {
      immutableError = error;
    } finally {
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}`;
    }
    expect(immutableError).toMatchObject({ errno: "55000" });
  }, 30_000);
});
