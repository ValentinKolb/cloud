import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "./migrate";
import { commitManagedOAuthRefresh } from "./service/provider-oauth-tokens";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("mail migrations", () => {
  test("installs privacy-safe remote image metadata and personal rules once", async () => {
    await migrate();
    await migrate();
    const [shape] = await sql<
      {
        applied_count: string | number;
        image_table_present: boolean;
        rules_table_present: boolean;
        image_index_present: boolean;
        principal_index_present: boolean;
      }[]
    >`
      SELECT
        (
          SELECT count(*)
          FROM mail.schema_migrations
          WHERE version = 87 AND name = 'privacy_safe_remote_content'
        ) AS applied_count,
        to_regclass('mail.message_remote_images') IS NOT NULL AS image_table_present,
        to_regclass('mail.remote_content_rules') IS NOT NULL AS rules_table_present,
        to_regclass('mail.message_remote_images_message_idx') IS NOT NULL AS image_index_present,
        to_regclass('mail.remote_content_rules_principal_idx') IS NOT NULL AS principal_index_present
    `;
    expect({ ...shape, applied_count: Number(shape?.applied_count) }).toEqual({
      applied_count: 1,
      image_table_present: true,
      rules_table_present: true,
      image_index_present: true,
      principal_index_present: true,
    });
  });

  test("hard-migrates the alpha conversation state model without retaining the removed column", async () => {
    await migrate();
    const mailboxId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO mail.mailboxes (id, name) VALUES (${mailboxId}::uuid, 'Work-state migration test')`;
      await tx`
        INSERT INTO mail.conversations (id, mailbox_id, subject, participant_summary, latest_message_at)
        VALUES (${conversationId}::uuid, ${mailboxId}::uuid, 'Migration fixture', 'Customer', now())
      `;
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, conversation_id, actor_kind, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${mailboxId}::uuid,
          ${conversationId}::uuid,
          'system',
          'conversation.collaboration_updated',
          'confirmed',
          'conversation',
          ${conversationId}::uuid,
          ${{
            before: { workStatus: "open", responseNeeded: false },
            after: { workStatus: "open", responseNeeded: true },
          }}::jsonb
        )
      `;
      await tx`ALTER TABLE mail.conversations DROP CONSTRAINT conversations_work_status_check`;
      await tx`ALTER TABLE mail.conversations ADD COLUMN response_needed BOOLEAN NOT NULL DEFAULT false`;
      await tx`UPDATE mail.conversations SET work_status = 'open', response_needed = true WHERE id = ${conversationId}::uuid`;
      await tx`DELETE FROM mail.schema_migrations WHERE version = 79`;
    });

    try {
      await migrate();
      const [shape] = await sql<
        {
          applied: boolean;
          status: string;
          removed_column_absent: boolean;
          due_index_present: boolean;
          metadata: Record<string, unknown> | string;
        }[]
      >`
        SELECT
          EXISTS (
            SELECT 1 FROM mail.schema_migrations
            WHERE version = 79 AND name = 'unified_conversation_work_states'
          ) AS applied,
          conversation.work_status AS status,
          NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'mail' AND table_name = 'conversations' AND column_name = 'response_needed'
          ) AS removed_column_absent,
          to_regclass('mail.conversations_due_snooze_idx') IS NOT NULL AS due_index_present,
          activity.metadata
        FROM mail.conversations conversation
        JOIN mail.activity_events activity ON activity.conversation_id = conversation.id
        WHERE conversation.id = ${conversationId}::uuid
      `;
      expect(shape).toMatchObject({
        applied: true,
        status: "needs_action",
        removed_column_absent: true,
        due_index_present: true,
        metadata: {
          before: { workStatus: "needs_action" },
          after: { workStatus: "needs_action" },
        },
      });
    } finally {
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
    }
  }, 30_000);

  test("removes conversation followers and comment mentions without retaining legacy tables", async () => {
    await migrate();
    await sql`DELETE FROM mail.schema_migrations WHERE version = 78`;
    await migrate();
    const [shape] = await sql<
      {
        applied: boolean;
        follower_table_absent: boolean;
        mention_table_absent: boolean;
        delivery_constraint: string;
        mention_definition_inactive: boolean;
        legacy_activity_absent: boolean;
      }[]
    >`
      SELECT
        EXISTS (
          SELECT 1
          FROM mail.schema_migrations
          WHERE version = 78 AND name = 'remove_conversation_followers_and_mentions'
        ) AS applied,
        to_regclass('mail.conversation_watchers') IS NULL AS follower_table_absent,
        to_regclass('mail.conversation_comment_mentions') IS NULL AS mention_table_absent,
        (
          SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
          WHERE conrelid = 'mail.collaboration_notification_deliveries'::regclass
            AND conname = 'collaboration_notification_deliveries_kind_check'
        ) AS delivery_constraint,
        NOT EXISTS (
          SELECT 1
          FROM notifications.definitions
          WHERE id = 'mail.commentMention' AND active
        ) AS mention_definition_inactive,
        NOT EXISTS (
          SELECT 1
          FROM mail.activity_events
          WHERE action IN ('conversation.watcher_added', 'conversation.watcher_removed')
            OR metadata ? 'mentionUserIds'
        ) AS legacy_activity_absent
    `;

    expect(shape).toMatchObject({
      applied: true,
      follower_table_absent: true,
      mention_table_absent: true,
      mention_definition_inactive: true,
      legacy_activity_absent: true,
    });
    expect(shape?.delivery_constraint).toContain("kind = 'reminder'");
    expect(shape?.delivery_constraint).not.toContain("mention");
  });

  test("installs the complete public-link storage schema once with detachable blobs", async () => {
    await migrate();
    await migrate();
    const [shape] = await sql<
      {
        applied_count: string | number;
        all_tables_present: boolean;
        blob_nullable: boolean;
        blob_on_delete_set_null: boolean;
        grant_claim_present: boolean;
      }[]
    >`
      SELECT
        (
          SELECT count(*)
          FROM mail.schema_migrations
          WHERE version = 64 AND name = 'public_attachment_links_storage_snapshots'
        ) AS applied_count,
        to_regclass('mail.attachment_links') IS NOT NULL
          AND to_regclass('mail.attachment_link_grants') IS NOT NULL
          AND to_regclass('mail.storage_usage_snapshots') IS NOT NULL
          AND to_regclass('mail.storage_system_snapshot') IS NOT NULL AS all_tables_present,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'attachment_links'
            AND column_name = 'blob_id'
            AND is_nullable = 'YES'
        ) AS blob_nullable,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.attachment_links'::regclass
            AND conname = 'attachment_links_blob_id_fkey'
            AND confdeltype = 'n'
        ) AS blob_on_delete_set_null,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'attachment_link_grants'
            AND column_name = 'download_claimed_at'
        ) AS grant_claim_present
    `;

    expect(Number(shape?.applied_count)).toBe(1);
    expect(shape).toMatchObject({
      all_tables_present: true,
      blob_nullable: true,
      blob_on_delete_set_null: true,
      grant_claim_present: true,
    });
  });

  test("appends the operator command contract after existing Mail migrations", async () => {
    await migrate();
    const [shape] = await sql<{ applied: boolean; attention_index_present: boolean; constraint: string }[]>`
      SELECT
        EXISTS (SELECT 1 FROM mail.schema_migrations WHERE version = 67 AND name = 'operator_maintenance_commands') AS applied,
        to_regclass('mail.commands_mailbox_attention_idx') IS NOT NULL AS attention_index_present,
        pg_get_constraintdef(oid) AS constraint
      FROM pg_constraint
      WHERE conrelid = 'mail.commands'::regclass AND conname = 'commands_kind_check'
    `;

    expect(shape?.applied).toBe(true);
    expect(shape?.attention_index_present).toBe(true);
    expect(shape?.constraint).toContain("rebuild_search");
    expect(shape?.constraint).toContain("reconcile_effect");
    expect(shape?.constraint).toContain("cancel_command");
  });

  test("installs compose templates, signature defaults, and mailbox styles", async () => {
    await migrate();
    const [shape] = await sql<
      {
        templates_present: boolean;
        defaults_present: boolean;
        styles_present: boolean;
        template_indexes_present: boolean;
        default_indexes_present: boolean;
        mailbox_reference_constraints_present: boolean;
        scheduled_send_ordering_present: boolean;
        scheduled_send_guard_present: boolean;
        automatic_reply_invariants_present: boolean;
        sender_automation_default: boolean;
        inline_response_timing_present: boolean;
        imap_push_health_present: boolean;
        canonical_saved_view_search_present: boolean;
        canonical_saved_view_search_strict: boolean;
        draft_remote_observations_supported: boolean;
        draft_recovery_attachments_present: boolean;
      }[]
    >`
      SELECT
        to_regclass('mail.compose_templates') IS NOT NULL AS templates_present,
        to_regclass('mail.compose_signature_defaults') IS NOT NULL AS defaults_present,
        to_regclass('mail.compose_styles') IS NOT NULL AS styles_present,
        to_regclass('mail.compose_templates_mailbox_shortcut_idx') IS NOT NULL
          AND to_regclass('mail.compose_templates_private_shortcut_idx') IS NOT NULL AS template_indexes_present,
        to_regclass('mail.compose_signature_defaults_mailbox_idx') IS NOT NULL
          AND to_regclass('mail.compose_signature_defaults_user_idx') IS NOT NULL AS default_indexes_present,
        (
          SELECT count(*) = 2
          FROM pg_constraint
          WHERE conrelid = 'mail.compose_signature_defaults'::regclass
            AND conname IN ('compose_signature_defaults_sender_fk', 'compose_signature_defaults_template_fk')
        ) AS mailbox_reference_constraints_present,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'outbox_submissions'
            AND column_name = 'requested_at'
            AND is_nullable = 'NO'
        ) AND to_regclass('mail.outbox_scheduled_view_idx') IS NOT NULL AS scheduled_send_ordering_present,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = 'mail.outbox_submissions'::regclass
            AND tgname = 'outbox_requested_at_guard'
            AND NOT tgisinternal
        ) AS scheduled_send_guard_present,
        to_regclass('mail.automatic_reply_configurations_one_active_idx') IS NOT NULL
          AND to_regclass('mail.automatic_reply_rate_idx') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'mail'
              AND table_name = 'automatic_reply_effects'
              AND column_name = 'confirmed_at'
          )
          AND EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'mail.automatic_reply_effects'::regclass
              AND conname = 'automatic_reply_effects_confirmed_at_check'
              AND convalidated
          ) AS automatic_reply_invariants_present,
        (
          SELECT column_default = '''mailbox''::text'
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'sender_identities'
            AND column_name = 'automation_policy'
        ) AS sender_automation_default,
        to_regclass('mail.response_schedules') IS NULL
          AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'mail'
              AND table_name = 'automatic_reply_configurations'
              AND column_name = 'schedule_definition'
              AND is_nullable = 'NO'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'mail'
              AND (
                (table_name = 'automatic_reply_configurations' AND column_name = 'response_schedule_id')
                OR (table_name = 'automatic_reply_effects' AND column_name IN ('response_schedule_id', 'response_schedule_revision'))
              )
          ) AS inline_response_timing_present,
        to_regclass('mail.imap_push_listener_health') IS NOT NULL
          AND to_regclass('mail.imap_push_listener_health_state_idx') IS NOT NULL AS imap_push_health_present,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.saved_conversation_views'::regclass
            AND conname = 'saved_conversation_views_canonical_search_check'
            AND convalidated
        )
        AND (
          SELECT column_default IS NULL
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'saved_conversation_views'
            AND column_name = 'filter'
        ) AS canonical_saved_view_search_present,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.saved_conversation_views'::regclass
            AND conname = 'saved_conversation_views_canonical_search_check'
            AND pg_get_constraintdef(oid) LIKE '%filter ? ''expression''%'
            AND pg_get_constraintdef(oid) LIKE '%filter ? ''sort''%'
            AND pg_get_constraintdef(oid) LIKE '%IS TRUE%'
        ) AS canonical_saved_view_search_strict,
        EXISTS (
          SELECT 1
          FROM pg_index
          WHERE indexrelid = 'mail.draft_provider_snapshots_remote_identity_idx'::regclass
            AND indisunique = false
        ) AS draft_remote_observations_supported,
        to_regclass('mail.draft_recovery_attachments') IS NOT NULL
          AND to_regclass('mail.draft_recovery_attachments_blob_idx') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'mail'
              AND table_name = 'draft_recovery_copies'
              AND column_name = 'has_attachment_snapshot'
              AND is_nullable = 'NO'
          ) AS draft_recovery_attachments_present
    `;
    expect(shape).toEqual({
      templates_present: true,
      defaults_present: true,
      styles_present: true,
      template_indexes_present: true,
      default_indexes_present: true,
      mailbox_reference_constraints_present: true,
      scheduled_send_ordering_present: true,
      scheduled_send_guard_present: true,
      automatic_reply_invariants_present: true,
      sender_automation_default: true,
      inline_response_timing_present: true,
      imap_push_health_present: true,
      canonical_saved_view_search_present: true,
      canonical_saved_view_search_strict: true,
      draft_remote_observations_supported: true,
      draft_recovery_attachments_present: true,
    });
  });

  test("installs provider limits and deterministic outbound preflight evidence", async () => {
    await migrate();
    await migrate();
    const [shape] = await sql<
      {
        limit_snapshot_present: boolean;
        mime_date_required: boolean;
        preflight_columns_present: boolean;
        migrations_applied: boolean;
      }[]
    >`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'provider_connections'
            AND column_name = 'limit_snapshot'
            AND is_nullable = 'NO'
        ) AS limit_snapshot_present,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'outbox_submissions'
            AND column_name = 'mime_date'
            AND is_nullable = 'NO'
        ) AS mime_date_required,
        (
          SELECT count(*) = 3
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'outbox_submissions'
            AND column_name IN (
              'preflight_byte_length',
              'preflight_smtp_limit_bytes',
              'preflight_checked_at'
            )
        ) AS preflight_columns_present,
        (
          SELECT count(*) = 2
          FROM mail.schema_migrations
          WHERE (version, name) IN (
            (85, 'provider_limit_snapshots'),
            (86, 'outbound_message_preflight')
          )
        ) AS migrations_applied
    `;
    expect(shape).toEqual({
      limit_snapshot_present: true,
      mime_date_required: true,
      preflight_columns_present: true,
      migrations_applied: true,
    });
  });

  test("repairs an accidentally unique remote draft observation index in place", async () => {
    await migrate();
    await sql`DELETE FROM mail.schema_migrations WHERE version = 61`;
    await sql`DROP INDEX mail.draft_provider_snapshots_remote_identity_idx`;
    await sql`
      CREATE UNIQUE INDEX draft_provider_snapshots_remote_identity_idx
      ON mail.draft_provider_snapshots (id)
    `;

    await migrate();

    const [index] = await sql<{ unique: boolean; definition: string }[]>`
      SELECT index_state.indisunique AS unique, pg_get_indexdef(index_state.indexrelid) AS definition
      FROM pg_index index_state
      WHERE index_state.indexrelid = 'mail.draft_provider_snapshots_remote_identity_idx'::regclass
    `;
    expect(index?.unique).toBe(false);
    expect(index?.definition).toContain("(folder_id, uid_validity, uid, created_at DESC)");
    expect(index?.definition).toContain("WHERE ((folder_id IS NOT NULL)");
  });

  test("adds mailbox-consistent local tags and a safe reference-search bridge", async () => {
    await migrate();
    const [shape] = await sql<
      {
        tags_present: boolean;
        assignments_present: boolean;
        reference_request_ledger_present: boolean;
        reference_configuration_present: boolean;
        legacy_reference_schemes_absent: boolean;
        reference_without_table: boolean;
      }[]
    >`
      SELECT
        to_regclass('mail.local_tags') IS NOT NULL AS tags_present,
        to_regclass('mail.conversation_local_tags') IS NOT NULL AS assignments_present,
        to_regclass('mail.conversation_reference_requests') IS NOT NULL AS reference_request_ledger_present,
        to_regclass('mail.reference_number_configurations') IS NOT NULL AS reference_configuration_present,
        to_regclass('mail.reference_schemes') IS NULL AS legacy_reference_schemes_absent,
        mail.search_reference_matches(gen_random_uuid(), 'SUP-42', 'exact') = false AS reference_without_table
    `;
    expect(shape).toEqual({
      tags_present: true,
      assignments_present: true,
      reference_request_ledger_present: true,
      reference_configuration_present: true,
      legacy_reference_schemes_absent: true,
      reference_without_table: true,
    });
  });

  test("enforces mailbox-owned current provider connections and bindings", async () => {
    await migrate();
    const [shape] = await sql<
      {
        legacy_columns_absent: boolean;
        current_indexes_present: boolean;
        mailbox_guard_present: boolean;
        account_evidence_guard_present: boolean;
      }[]
    >`
      SELECT
        NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND (
              (table_name = 'mailboxes' AND column_name = 'connection_policy')
              OR (table_name = 'provider_connections' AND column_name IN ('owner_user_id', 'owner_service_account_id'))
              OR (table_name = 'sender_identities' AND column_name = 'interactive_policy')
            )
        ) AS legacy_columns_absent,
        to_regclass('mail.provider_connections_mailbox_active_idx') IS NOT NULL
          AND to_regclass('mail.provider_bindings_resource_current_idx') IS NOT NULL
          AND to_regclass('mail.provider_bindings_connection_current_idx') IS NOT NULL AS current_indexes_present,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = 'mail.provider_bindings'::regclass
            AND tgname = 'provider_bindings_mailbox_guard'
            AND NOT tgisinternal
        ) AS mailbox_guard_present,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgrelid = 'mail.provider_bindings'::regclass
            AND tgname = 'provider_bindings_account_evidence_guard'
            AND NOT tgisinternal
        )
        AND EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.provider_bindings'::regclass
            AND conname = 'provider_bindings_account_evidence_matches'
            AND convalidated
        )
        AND NOT EXISTS (
          SELECT 1
          FROM mail.provider_bindings
          WHERE NULLIF(remote_locator ->> 'accountId', '') IS NOT NULL
            AND verification_evidence ->> 'accountId' IS DISTINCT FROM remote_locator ->> 'accountId'
        ) AS account_evidence_guard_present
    `;
    expect(shape).toEqual({
      legacy_columns_absent: true,
      current_indexes_present: true,
      mailbox_guard_present: true,
      account_evidence_guard_present: true,
    });

    const mailboxId = crypto.randomUUID();
    const otherMailboxId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO mail.mailboxes (id, name)
        VALUES (${mailboxId}, 'Provider invariant test'), (${otherMailboxId}, 'Other provider invariant test')
      `;
      const [resource] = await sql<{ id: string }[]>`
        INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint)
        VALUES (${mailboxId}, '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)})
        RETURNING id
      `;
      const [revokedConnection] = await sql<{ id: string }[]>`
        INSERT INTO mail.provider_connections (
          owner_mailbox_id, name, email, username,
          imap_host, imap_port, imap_tls_mode, smtp_host, smtp_port, smtp_tls_mode,
          secret_kind, encrypted_secret, status
        ) VALUES (
          ${mailboxId}, 'Historical', 'history@example.com', 'history@example.com',
          'imap.example.com', 993, 'implicit', 'smtp.example.com', 465, 'implicit',
          'password', NULL, 'revoked'
        )
        RETURNING id
      `;
      await sql`
        INSERT INTO mail.provider_bindings (remote_resource_id, connection_id, state, remote_locator)
        VALUES (${resource!.id}, ${revokedConnection!.id}, 'revoked', '{}'::jsonb)
      `;
      const accountId = "b".repeat(64);
      const [normalizedEvidence] = await sql<{ account_id: string | null }[]>`
        UPDATE mail.provider_bindings
        SET remote_locator = ${{ accountId }}::jsonb, verification_evidence = '{}'::jsonb
        WHERE connection_id = ${revokedConnection!.id}::uuid
        RETURNING verification_evidence ->> 'accountId' AS account_id
      `;
      expect(normalizedEvidence?.account_id).toBe(accountId);
      let mismatchedEvidenceError: unknown;
      try {
        await sql`
          UPDATE mail.provider_bindings
          SET verification_evidence = ${{ accountId: "c".repeat(64) }}::jsonb
          WHERE connection_id = ${revokedConnection!.id}::uuid
        `;
      } catch (error) {
        mismatchedEvidenceError = error;
      }
      expect(mismatchedEvidenceError).toMatchObject({ errno: "23514" });
      const [currentConnection] = await sql<{ id: string }[]>`
        INSERT INTO mail.provider_connections (
          owner_mailbox_id, name, email, username,
          imap_host, imap_port, imap_tls_mode, smtp_host, smtp_port, smtp_tls_mode,
          secret_kind, encrypted_secret, status
        ) VALUES (
          ${mailboxId}, 'Current', 'current@example.com', 'current@example.com',
          'imap.example.com', 993, 'implicit', 'smtp.example.com', 465, 'implicit',
          'password', 'encrypted-fixture', 'active'
        )
        RETURNING id
      `;
      await sql`
        INSERT INTO mail.provider_bindings (remote_resource_id, connection_id, state, remote_locator)
        VALUES (${resource!.id}, ${currentConnection!.id}, 'active', '{}'::jsonb)
      `;

      let duplicateCurrentError: unknown;
      try {
        await sql`
          INSERT INTO mail.provider_bindings (remote_resource_id, connection_id, state, remote_locator)
          VALUES (${resource!.id}, ${currentConnection!.id}, 'pending', '{}'::jsonb)
        `;
      } catch (error) {
        duplicateCurrentError = error;
      }
      expect(duplicateCurrentError).toMatchObject({ errno: "23505" });

      const [otherConnection] = await sql<{ id: string }[]>`
        INSERT INTO mail.provider_connections (
          owner_mailbox_id, name, email, username,
          imap_host, imap_port, imap_tls_mode, smtp_host, smtp_port, smtp_tls_mode,
          secret_kind, encrypted_secret, status
        ) VALUES (
          ${otherMailboxId}, 'Other', 'other@example.com', 'other@example.com',
          'imap.example.com', 993, 'implicit', 'smtp.example.com', 465, 'implicit',
          'password', 'encrypted-fixture', 'active'
        )
        RETURNING id
      `;
      let crossMailboxError: unknown;
      try {
        await sql`
          INSERT INTO mail.provider_bindings (remote_resource_id, connection_id, state, remote_locator)
          VALUES (${resource!.id}, ${otherConnection!.id}, 'active', '{}'::jsonb)
        `;
      } catch (error) {
        crossMailboxError = error;
      }
      expect(crossMailboxError).toMatchObject({ errno: "23514" });
    } finally {
      await sql`DELETE FROM mail.mailboxes WHERE id IN (${mailboxId}, ${otherMailboxId})`;
    }
  });

  test("installs durable single-use provider OAuth state and token revision fencing", async () => {
    await migrate();
    const [shape] = await sql<
      {
        flow_table_present: boolean;
        connection_columns_present: boolean;
        cleanup_index_present: boolean;
      }[]
    >`
      SELECT
        to_regclass('mail.provider_oauth_flows') IS NOT NULL AS flow_table_present,
        (
          SELECT count(*) = 3
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'provider_connections'
            AND column_name IN ('oauth_provider_id', 'oauth_token_revision', 'oauth_expires_at')
        ) AS connection_columns_present,
        to_regclass('mail.provider_oauth_flows_cleanup_idx') IS NOT NULL AS cleanup_index_present
    `;
    expect(shape).toEqual({ flow_table_present: true, connection_columns_present: true, cleanup_index_present: true });

    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const flowId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO auth.users (id, uid, provider, profile)
          VALUES (${userId}::uuid, ${`oauth-migration-${userId}`}, 'local', 'user')
        `;
        await tx`INSERT INTO mail.mailboxes (id, name) VALUES (${mailboxId}::uuid, 'OAuth migration test')`;
        await tx`
          INSERT INTO mail.provider_oauth_flows (
            id, state_hash, browser_nonce_hash, mailbox_id, user_id, provider_id, operation,
            connection_input, encrypted_code_verifier, expires_at
          ) VALUES (
            ${flowId}::uuid, ${"a".repeat(64)}, ${"b".repeat(64)}, ${mailboxId}::uuid, ${userId}::uuid,
            'google', 'create', '{}'::jsonb, 'encrypted-verifier', now() + interval '10 minutes'
          )
        `;
      });
      const claim = () => sql<{ id: string }[]>`
        UPDATE mail.provider_oauth_flows
        SET status = 'exchanging', consumed_at = now()
        WHERE id = ${flowId}::uuid AND status = 'pending' AND consumed_at IS NULL AND expires_at > now()
        RETURNING id
      `;
      const claims = await Promise.all([claim(), claim()]);
      expect(claims.map((rows) => rows.length).sort()).toEqual([0, 1]);

      await sql`
        INSERT INTO mail.provider_connections (
          id, owner_mailbox_id, name, email, username,
          imap_host, imap_port, imap_tls_mode, smtp_host, smtp_port, smtp_tls_mode,
          secret_kind, encrypted_secret, status, oauth_provider_id, oauth_expires_at
        ) VALUES (
          ${connectionId}::uuid, ${mailboxId}::uuid, 'Managed OAuth', 'oauth@example.com', 'oauth@example.com',
          'imap.example.com', 993, 'implicit', 'smtp.example.com', 465, 'implicit',
          'oauth2', 'encrypted-original', 'active', 'google', now() - interval '1 minute'
        )
      `;
      const commit = (encryptedSecret: string) =>
        commitManagedOAuthRefresh({
          connectionId,
          expectedSecretRevision: 1,
          expectedOAuthTokenRevision: 0,
          encryptedSecret,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
      const refreshes = await Promise.all([commit("encrypted-refresh-a"), commit("encrypted-refresh-b")]);
      expect(refreshes.sort()).toEqual([false, true]);
      const [refreshed] = await sql<{ encrypted_secret: string; secret_revision: number; oauth_token_revision: string | number }[]>`
        SELECT encrypted_secret, secret_revision, oauth_token_revision
        FROM mail.provider_connections
        WHERE id = ${connectionId}::uuid
      `;
      expect(refreshed?.encrypted_secret).toMatch(/^encrypted-refresh-[ab]$/);
      expect(refreshed?.secret_revision).toBe(1);
      expect(Number(refreshed?.oauth_token_revision)).toBe(1);

      await sql`
        UPDATE mail.provider_connections
        SET status = 'revoked', encrypted_secret = NULL, oauth_provider_id = NULL, oauth_expires_at = NULL
        WHERE id = ${connectionId}::uuid
      `;
      expect(
        await commitManagedOAuthRefresh({
          connectionId,
          expectedSecretRevision: 1,
          expectedOAuthTokenRevision: 1,
          encryptedSecret: "encrypted-after-revoke",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      ).toBe(false);
    } finally {
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("hard-cuts workflow storage while preserving the rest of the Mail schema", async () => {
    await migrate();

    const [before] = await sql<{ commands_oid: number; mailboxes_oid: number }[]>`
      SELECT
        'mail.commands'::regclass::oid AS commands_oid,
        'mail.mailboxes'::regclass::oid AS mailboxes_oid
    `;
    if (!before) throw new Error("Mail schema OIDs were not returned");

    // Later Mail tables reference the canonical workflow schema. Replaying the
    // hard-cut marker must therefore verify and preserve that schema in place.
    await sql`DELETE FROM mail.schema_migrations WHERE version = 26`;

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
        draft_upload_blob_nullable: boolean;
        draft_upload_blob_set_null: boolean;
        draft_upload_constraints_present: boolean;
        draft_continuity_indexes_present: boolean;
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
            ('workflow_run_targets', 'frozen_hydration'),
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
            AND pg_get_constraintdef(oid) = 'UNIQUE (mailbox_id, workflow_id, mode, idempotency_key)'
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
        ) AS step_primary_key,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'draft_attachment_uploads'
            AND column_name = 'blob_id'
            AND is_nullable = 'YES'
        ) AS draft_upload_blob_nullable,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'mail.draft_attachment_uploads'::regclass
            AND conname = 'draft_attachment_uploads_blob_id_fkey'
            AND confdeltype = 'n'
        ) AS draft_upload_blob_set_null,
        NOT EXISTS (
          SELECT 1
          FROM (VALUES
            ('draft_attachment_uploads_blob_state_check'),
            ('draft_attachment_uploads_received_state_check')
          ) expected(constraint_name)
          WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'mail.draft_attachment_uploads'::regclass
              AND conname = expected.constraint_name
          )
        ) AS draft_upload_constraints_present,
        NOT EXISTS (
          SELECT 1
          FROM (VALUES
            ('mail.drafts_source_message_idx'),
            ('mail.draft_recovery_copies_unresolved_idx'),
            ('mail.draft_attachment_uploads_draft_idx')
          ) expected(index_name)
          WHERE to_regclass(expected.index_name) IS NULL
        ) AS draft_continuity_indexes_present
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
      draft_upload_blob_nullable: true,
      draft_upload_blob_set_null: true,
      draft_upload_constraints_present: true,
      draft_continuity_indexes_present: true,
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

  test("installs tenant-scoped search and hot-path recovery indexes", async () => {
    await migrate();
    const indexes = await sql<{ name: string }[]>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'mail'
        AND indexname IN (
          'message_placements_folder_unread_idx',
          'message_search_chunks_mailbox_document_idx',
          'workflow_runs_materializing_recovery_idx',
          'sync_runs_terminal_retention_idx',
          'workflow_trigger_events_terminal_retention_idx'
        )
      ORDER BY indexname
    `;
    expect(indexes.map((row) => row.name)).toEqual([
      "message_placements_folder_unread_idx",
      "message_search_chunks_mailbox_document_idx",
      "sync_runs_terminal_retention_idx",
      "workflow_runs_materializing_recovery_idx",
      "workflow_trigger_events_terminal_retention_idx",
    ]);

    const [mailboxColumn] = await sql<{ nullable: string }[]>`
      SELECT is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'mail'
        AND table_name = 'message_search_chunks'
        AND column_name = 'mailbox_id'
    `;
    expect(mailboxColumn).toEqual({ nullable: "NO" });

    const [savedViewShape] = await sql<
      {
        migration_applied: boolean;
        quarantine_columns: boolean;
        private_index: string;
        mailbox_index: string;
      }[]
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 75 AND name = 'saved_view_quarantine'
        ) AS migration_applied,
        (
          SELECT COUNT(*) = 3
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'saved_conversation_views'
            AND column_name IN ('invalid_filter', 'disabled_at', 'migration_error')
        ) AS quarantine_columns,
        pg_get_indexdef('mail.saved_conversation_views_private_name_idx'::regclass) AS private_index,
        pg_get_indexdef('mail.saved_conversation_views_mailbox_name_idx'::regclass) AS mailbox_index
    `;
    expect(savedViewShape?.migration_applied).toBe(true);
    expect(savedViewShape?.quarantine_columns).toBe(true);
    expect(savedViewShape?.private_index).toContain("disabled_at IS NULL");
    expect(savedViewShape?.mailbox_index).toContain("disabled_at IS NULL");
  });

  test("installs exact message source and canonical protocol facts once", async () => {
    await migrate();
    await migrate();
    const [shape] = await sql<
      {
        applied_count: number;
        columns_present: boolean;
        source_blob_restricted: boolean;
        source_index_present: boolean;
        invalid_protocol_facts: number;
        legacy_machine_headers: number;
      }[]
    >`
      SELECT
        (
          SELECT count(*)::int
          FROM mail.schema_migrations
          WHERE version = 83 AND name = 'message_protocol_foundations'
        ) AS applied_count,
        (
          SELECT count(*) = 2
          FROM information_schema.columns
          WHERE table_schema = 'mail'
            AND table_name = 'message_contents'
            AND column_name IN ('source_blob_id', 'protocol_facts')
        ) AS columns_present,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.message_contents'::regclass
            AND conname = 'message_contents_source_blob_id_fkey'
            AND confdeltype = 'r'
        ) AS source_blob_restricted,
        to_regclass('mail.message_contents_source_blob_idx') IS NOT NULL AS source_index_present,
        (
          SELECT count(*)::int
          FROM mail.message_contents
          WHERE jsonb_typeof(protocol_facts) <> 'object'
            OR protocol_facts ->> 'version' <> '1'
            OR jsonb_typeof(protocol_facts -> 'list') <> 'object'
            OR jsonb_typeof(protocol_facts -> 'priority') <> 'object'
            OR jsonb_typeof(protocol_facts -> 'receipts') <> 'object'
            OR jsonb_typeof(protocol_facts -> 'spam') <> 'object'
        ) AS invalid_protocol_facts,
        (
          SELECT count(*)::int
          FROM mail.message_contents
          WHERE selected_headers ?| ARRAY[
            'returnPath',
            'autoSubmitted',
            'listId',
            'autoResponseSuppress',
            'contentType',
            'deliveryStatus'
          ]::text[]
        ) AS legacy_machine_headers
    `;

    expect(shape).toEqual({
      applied_count: 1,
      columns_present: true,
      source_blob_restricted: true,
      source_index_present: true,
      invalid_protocol_facts: 0,
      legacy_machine_headers: 0,
    });
  });
});
