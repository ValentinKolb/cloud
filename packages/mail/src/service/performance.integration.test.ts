import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { MailRequestContext } from "./auth";
import { createMailbox } from "./mailboxes";
import { getConversationViewCounts, listConversations } from "./messages";
import { searchMessages } from "./search";
import { reconcileMailWorkflowMaterializations } from "./workflow-materialization-service";
import { backfillWorkflow, createWorkflow, preflightWorkflow } from "./workflows";

const enabled = process.env.MAIL_PERFORMANCE_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const requestedMessageCount = Number.parseInt(process.env.MAIL_PERFORMANCE_MESSAGE_COUNT ?? "20000", 10);
const MESSAGE_COUNT = Number.isFinite(requestedMessageCount) ? Math.min(Math.max(requestedMessageCount, 20_000), 100_000) : 20_000;
const workflowPerformanceTest = MESSAGE_COUNT <= 50_000 ? test : test.skip;

suite("mail large-mailbox performance", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids: { userId?: string; mailboxId?: string; accessIds: string[] } = { accessIds: [] };
  let context: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-perf-${suffix}`}, 'local', 'user', 'Mail Performance Test', true)
      RETURNING id
    `;
    if (!user) throw new Error("Failed to create performance user");
    ids.userId = user.id;
    context = {
      actor: {
        kind: "user",
        user: {
          id: user.id,
          uid: `mail-perf-${suffix}`,
          provider: "local",
          profile: "user",
          displayName: "Mail Performance Test",
          givenName: "Mail",
          sn: "Performance",
          mail: `mail-perf-${suffix}@example.com`,
          roles: ["admin", "user"],
          memberofGroupIds: [],
          memberofGroups: [],
        } as never,
      },
      accessSubject: { type: "user", userId: user.id },
      requestId: `mail-performance-${suffix}`,
    };

    const mailbox = await createMailbox(context, {
      name: `Performance ${suffix}`,
      description: `Disposable ${MESSAGE_COUNT} message performance fixture`,
      connectionPolicy: "shared_connection",
    });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    ids.mailboxId = mailbox.data.id;
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (
        mailbox_id, remote_locator, server_identity, scope_fingerprint, status
      ) VALUES (
        ${mailbox.data.id}::uuid, '{}'::jsonb, '{}'::jsonb, ${"f".repeat(64)}, 'active'
      ) RETURNING id
    `;
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret,
        authenticated_principal, capabilities, server_identity, last_verified_at
      ) VALUES (
        ${mailbox.data.id}::uuid, 'Performance fixture', 'performance@example.com', 'performance@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 587, 'starttls',
        'password', 'fixture-ciphertext', 'performance@example.com', '{}'::jsonb, '{}'::jsonb, now()
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, remote_locator, capabilities, rights,
        verification_evidence, verified_scope_fingerprint, verified_secret_revision, last_verified_at
      ) VALUES (
        ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${"f".repeat(64)}, 1, now()
      )
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, 'performance-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;

    await sql`
      INSERT INTO mail.message_contents (
        mailbox_id,
        message_id,
        subject,
        internal_date,
        size_bytes,
        content_hash,
        hydration_status,
        plain_text,
        normalized_subject
      )
      SELECT
        ${mailbox.data.id}::uuid,
        '<bulk-' || item || '@example.com>',
        CASE WHEN item = 15000 THEN 'Quarterly cobalt invoice' ELSE 'Routine message ' || item END,
        now() - (item::text || ' seconds')::interval,
        512,
        lpad(to_hex(item::bigint), 64, '0'),
        'complete',
        CASE WHEN item = 15000 THEN 'The quarterly cobalt invoice is ready for review' ELSE 'Routine body ' || item END,
        CASE WHEN item = 15000 THEN 'quarterly cobalt invoice' ELSE 'routine message ' || item END
      FROM generate_series(1, ${MESSAGE_COUNT}) AS item
    `;
    await sql`
      INSERT INTO mail.message_addresses (
        message_id, role, position, display_name, email, normalized_email
      )
      SELECT
        mc.id,
        'from',
        0,
        CASE WHEN mc.message_id = '<bulk-15000@example.com>' THEN 'Needle Sender' ELSE 'Bulk Sender' END,
        CASE WHEN mc.message_id = '<bulk-15000@example.com>' THEN 'needle@example.com' ELSE 'bulk@example.com' END,
        CASE WHEN mc.message_id = '<bulk-15000@example.com>' THEN 'needle@example.com' ELSE 'bulk@example.com' END
      FROM mail.message_contents mc
      WHERE mc.mailbox_id = ${mailbox.data.id}::uuid
    `;
    await sql`
      INSERT INTO mail.message_search_chunks (message_id, position, search_document)
      SELECT mc.id, 0, to_tsvector('simple'::regconfig, mc.plain_text)
      FROM mail.message_contents mc
      WHERE mc.mailbox_id = ${mailbox.data.id}::uuid AND mc.plain_text IS NOT NULL
    `;
    await sql`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      SELECT
        ${folder!.id}::uuid,
        mc.id,
        1,
        row_number() OVER (ORDER BY mc.internal_date, mc.id)
      FROM mail.message_contents mc
      WHERE mc.mailbox_id = ${mailbox.data.id}::uuid
    `;
    await sql`
      INSERT INTO mail.message_placements (
        remote_message_ref_id, folder_id, message_id, flags, keywords
      )
      SELECT rmr.id, rmr.folder_id, rmr.message_id, ARRAY[]::text[], ARRAY[]::text[]
      FROM mail.remote_message_refs rmr
      WHERE rmr.folder_id = ${folder!.id}::uuid
    `;
    await sql`
      INSERT INTO mail.conversations (
        id,
        mailbox_id,
        subject,
        participant_summary,
        latest_inbound_at,
        latest_message_at,
        response_needed
      )
      SELECT
        mc.id,
        mc.mailbox_id,
        mc.subject,
        'Bulk Sender',
        mc.internal_date,
        mc.internal_date,
        true
      FROM mail.message_contents mc
      WHERE mc.mailbox_id = ${mailbox.data.id}::uuid
    `;
    await sql`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
      SELECT
        mc.id,
        mc.id,
        (extract(epoch FROM mc.internal_date) * 1000)::bigint,
        'heuristic'
      FROM mail.message_contents mc
      WHERE mc.mailbox_id = ${mailbox.data.id}::uuid
    `;
    await sql`ANALYZE mail.message_contents`;
    await sql`ANALYZE mail.message_addresses`;
    await sql`ANALYZE mail.message_placements`;
    await sql`ANALYZE mail.conversations`;
    await sql`ANALYZE mail.conversation_messages`;
  }, 120_000);

  afterAll(async () => {
    if (ids.mailboxId) {
      const access = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${ids.mailboxId}::uuid
      `;
      ids.accessIds.push(...access.map((row) => row.access_id));
      await sql`
        DELETE FROM mail.conversation_messages conversation_message
        USING mail.conversations conversation
        WHERE conversation_message.conversation_id = conversation.id
          AND conversation.mailbox_id = ${ids.mailboxId}::uuid
      `;
      await sql`DELETE FROM mail.conversations WHERE mailbox_id = ${ids.mailboxId}::uuid`;
      await sql`
        DELETE FROM mail.message_search_chunks chunk
        USING mail.message_contents message
        WHERE chunk.message_id = message.id AND message.mailbox_id = ${ids.mailboxId}::uuid
      `;
      await sql`
        DELETE FROM mail.message_placements placement
        USING mail.message_contents message
        WHERE placement.message_id = message.id AND message.mailbox_id = ${ids.mailboxId}::uuid
      `;
      await sql`
        DELETE FROM mail.remote_message_refs remote_ref
        USING mail.message_contents message
        WHERE remote_ref.message_id = message.id AND message.mailbox_id = ${ids.mailboxId}::uuid
      `;
      await sql`
        DELETE FROM mail.message_addresses address
        USING mail.message_contents message
        WHERE address.message_id = message.id AND message.mailbox_id = ${ids.mailboxId}::uuid
      `;
      await sql`DELETE FROM mail.message_contents WHERE mailbox_id = ${ids.mailboxId}::uuid`;
      await sql`DELETE FROM mail.mailboxes WHERE id = ${ids.mailboxId}::uuid`;
    }
    if (ids.accessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids.accessIds}::jsonb))`;
    }
    if (ids.userId) await sql`DELETE FROM auth.users WHERE id = ${ids.userId}::uuid`;
  }, 120_000);

  test(`keeps structured indexed search bounded at ${MESSAGE_COUNT.toLocaleString("en-US")} messages`, async () => {
    if (!ids.mailboxId) throw new Error("Performance mailbox is unavailable");
    const durations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      const result = await searchMessages({
        context,
        mailboxId: ids.mailboxId,
        request: {
          expression: {
            and: [
              { field: "from", query: "needle@example.com", match: "exact" },
              { field: "body", query: "quarterly cobalt", match: "phrase" },
            ],
          },
          sort: "relevance",
          limit: 20,
        },
      });
      durations.push(performance.now() - startedAt);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0]?.messageId).toBe("<bulk-15000@example.com>");
      }
    }
    const warmDurations = durations.slice(1);
    const worstWarmMs = Math.max(...warmDurations);
    console.info(`Mail ${MESSAGE_COUNT} structured search: ${warmDurations.map((value) => value.toFixed(1)).join(", ")} ms`);
    expect(worstWarmMs).toBeLessThan(500);
  }, 30_000);

  test(`keeps the warm inbox list bounded at ${MESSAGE_COUNT.toLocaleString("en-US")} conversations`, async () => {
    if (!ids.mailboxId) throw new Error("Performance mailbox is unavailable");
    const durations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      const result = await listConversations({
        context,
        mailboxId: ids.mailboxId,
        limit: 50,
      });
      durations.push(performance.now() - startedAt);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toHaveLength(50);
        expect(result.data.items.every((item) => item.messageCount === 1)).toBe(true);
      }
    }
    const warmDurations = durations.slice(1);
    const worstWarmMs = Math.max(...warmDurations);
    console.info(`Mail ${MESSAGE_COUNT} conversation list: ${warmDurations.map((value) => value.toFixed(1)).join(", ")} ms`);
    expect(worstWarmMs).toBeLessThan(500);
  }, 30_000);

  test(`keeps collaboration views bounded at ${MESSAGE_COUNT.toLocaleString("en-US")} conversations`, async () => {
    if (!ids.mailboxId) throw new Error("Performance mailbox is unavailable");
    const durations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      const [view, counts] = await Promise.all([
        listConversations({ context, mailboxId: ids.mailboxId, view: "inbox", limit: 50 }),
        getConversationViewCounts({ context, mailboxId: ids.mailboxId }),
      ]);
      durations.push(performance.now() - startedAt);
      expect(view.ok && view.data.items).toHaveLength(50);
      expect(counts.ok && counts.data.inbox).toBe(MESSAGE_COUNT);
      expect(counts.ok && counts.data.recently_active).toBe(MESSAGE_COUNT);
    }
    const warmDurations = durations.slice(1);
    const worstWarmMs = Math.max(...warmDurations);
    console.info(`Mail ${MESSAGE_COUNT} collaboration views: ${warmDurations.map((value) => value.toFixed(1)).join(", ")} ms`);
    expect(worstWarmMs).toBeLessThan(500);
  }, 30_000);

  workflowPerformanceTest(
    `previews a deterministic workflow across ${MESSAGE_COUNT.toLocaleString("en-US")} messages`,
    async () => {
      if (!ids.mailboxId) throw new Error("Performance mailbox is unavailable");
      const source = `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - setConversationStatus:
      conversation: "\${{ inputs.conversation }}"
      status: open
`;
      const workflow = await createWorkflow({
        context,
        mailboxId: ids.mailboxId,
        input: {
          name: `Performance preview ${suffix}`,
          priority: 100,
          source,
          effectBudget: {
            maxTargets: MESSAGE_COUNT,
            maxMoves: 0,
            maxKeywordChanges: 0,
            maxCollaborationChanges: 0,
          },
        },
      });
      expect(workflow.ok).toBe(true);
      if (!workflow.ok) return;

      const startedAt = performance.now();
      const result = await preflightWorkflow({
        context,
        mailboxId: ids.mailboxId,
        workflowId: workflow.data.id,
        input: {
          expectedVersionId: workflow.data.currentVersionId,
          inputs: {},
          query: { type: "all" },
        },
      });
      const duration = performance.now() - startedAt;
      console.info(`Mail ${MESSAGE_COUNT} workflow preflight: ${duration.toFixed(1)} ms`);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toMatchObject({
          workflowVersionId: workflow.data.currentVersionId,
          targetCount: MESSAGE_COUNT,
          effectBudget: {
            maxTargets: MESSAGE_COUNT,
            maxMoves: 0,
            maxKeywordChanges: 0,
            maxCollaborationChanges: 0,
          },
        });
        expect(result.data.preflightHash).toMatch(/^[a-f0-9]{64}$/);

        const input = {
          expectedVersionId: workflow.data.currentVersionId,
          inputs: {},
          query: { type: "all" as const },
          preflightHash: result.data.preflightHash,
          occurredAt: result.data.occurredAt,
          idempotencyKey: `performance-backfill-${suffix}`,
        };
        await sql`
          CREATE OR REPLACE FUNCTION mail.fail_large_workflow_materialization_test()
          RETURNS trigger AS $$
          BEGIN
            IF NEW.ordinal >= 1000 THEN
              RAISE EXCEPTION 'simulated workflow materialization crash';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `;
        await sql`
          CREATE TRIGGER fail_large_workflow_materialization_test
          BEFORE INSERT ON mail.workflow_run_targets
          FOR EACH ROW EXECUTE FUNCTION mail.fail_large_workflow_materialization_test()
        `;
        let interrupted: Awaited<ReturnType<typeof backfillWorkflow>> | undefined;
        try {
          interrupted = await backfillWorkflow({
            context,
            mailboxId: ids.mailboxId,
            workflowId: workflow.data.id,
            channel: "bulk",
            input,
            enqueue: false,
          });
        } finally {
          await sql`DROP TRIGGER IF EXISTS fail_large_workflow_materialization_test ON mail.workflow_run_targets`;
          await sql`DROP FUNCTION IF EXISTS mail.fail_large_workflow_materialization_test()`;
        }
        expect(interrupted?.ok).toBe(false);
        const [checkpoint] = await sql<
          {
            id: string;
            state: string;
            target_count: number;
            queued_targets: number;
            materialization_cursor_target_key: string | null;
            targets: number;
          }[]
        >`
          SELECT
            run.id,
            run.state,
            run.target_count,
            run.queued_targets,
            run.materialization_cursor_target_key,
            (SELECT COUNT(*)::int FROM mail.workflow_run_targets target WHERE target.parent_run_id = run.id) AS targets
          FROM mail.workflow_runs run
          WHERE run.mailbox_id = ${ids.mailboxId}::uuid
            AND run.mode = 'execute'
            AND run.idempotency_key = ${input.idempotencyKey}
        `;
        expect(checkpoint).toMatchObject({
          state: "materializing",
          target_count: MESSAGE_COUNT,
          queued_targets: 1_000,
          targets: 1_000,
        });
        if (!checkpoint) throw new Error("Interrupted workflow materialization checkpoint is unavailable");
        expect(checkpoint?.materialization_cursor_target_key).not.toBeNull();

        const materializationStartedAt = performance.now();
        const recovery = await reconcileMailWorkflowMaterializations({ enqueue: false, limit: 1, staleAfterMs: 0 });
        const materializationDuration = performance.now() - materializationStartedAt;
        console.info(`Mail ${MESSAGE_COUNT} workflow materialization resume: ${materializationDuration.toFixed(1)} ms`);
        expect(recovery).toMatchObject({ scanned: 1, recovered: 1, canceled: 0, failed: 0 });
        const resumed = await backfillWorkflow({
          context,
          mailboxId: ids.mailboxId,
          workflowId: workflow.data.id,
          channel: "bulk",
          input,
          enqueue: false,
        });
        expect(resumed.ok).toBe(true);
        if (resumed.ok) {
          expect(resumed.data.id).toBe(checkpoint.id);
          expect(resumed.data.state).toBe("queued");
          expect(resumed.data.targetProgress).toMatchObject({ total: MESSAGE_COUNT, queued: MESSAGE_COUNT });
          const [persisted] = await sql<
            {
              targets: number;
              insert_transactions: number;
              materialization_digest: string | null;
              materialization_expected_digest: string | null;
            }[]
          >`
            SELECT
              COUNT(target.id)::int AS targets,
              COUNT(DISTINCT target.xmin::text)::int AS insert_transactions,
              run.materialization_digest,
              run.materialization_expected_digest
            FROM mail.workflow_runs run
            JOIN mail.workflow_run_targets target ON target.parent_run_id = run.id
            WHERE run.id = ${resumed.data.id}::uuid
            GROUP BY run.id
          `;
          expect(persisted).toMatchObject({
            targets: MESSAGE_COUNT,
            materialization_digest: null,
            materialization_expected_digest: null,
          });
          expect(persisted!.insert_transactions).toBeGreaterThan(1);
        }
        expect(materializationDuration).toBeLessThan(60_000);
      }
      expect(duration).toBeLessThan(5_000);
    },
    120_000,
  );
});
