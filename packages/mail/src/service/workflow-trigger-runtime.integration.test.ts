import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import type { ConnectorEnvelope } from "./connectors";
import { createMailbox } from "./mailboxes";
import { claimFence, commitSyncBatch } from "./sync-runtime";
import { workflowRuntime } from "./workflow-runtime";
import { processMailWorkflowTriggerEvent } from "./workflow-trigger-runtime";
import { activateWorkflow, createWorkflow, createWorkflowVersion, deactivateWorkflow } from "./workflows";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

type ResultLike<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type TestUser = { id: string; uid: string; displayName: string };

const unwrap = <T>(result: ResultLike<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
};

const parseJson = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);

const contextFor = (user: TestUser): MailRequestContext => ({
  actor: {
    kind: "user",
    user: {
      id: user.id,
      uid: user.uid,
      provider: "local",
      profile: "user",
      displayName: user.displayName,
      givenName: user.displayName,
      sn: "Test",
      mail: `${user.uid}@example.com`,
      roles: ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-workflow-trigger-${user.uid}`,
});

const triggerSource = `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
triggers:
  messageReceived:
    with:
      message: "\${{ trigger.message }}"
      conversation: "\${{ trigger.conversation }}"
steps:
  - succeed:
      message: "Received \${{ inputs.message.subject }}"
`;

const effectBudget = {
  maxTargets: 10,
  maxMoves: 0,
  maxKeywordChanges: 0,
  maxCollaborationChanges: 0,
};

const cursor = {
  version: 1 as const,
  uidValidity: "1",
  highestSeenUid: 10,
  backfillNextHigh: null,
  backfillComplete: true,
  incrementalTargetHigh: null,
  incrementalNextHigh: null,
  highestModseq: "1",
  flagTargetModseq: null,
  flagNextLow: null,
  flagMaxUid: null,
  reconcileNextLow: null,
  lastFullReconcileAt: null,
};

suite("mail workflow trigger event runtime", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  let mailboxId = "";
  let actorAccessId = "";
  let resourceId = "";
  let bindingId = "";
  let folderId = "";
  let workflowId = "";
  let workflowVersionId = "";
  let ownerContext: MailRequestContext;
  let actorContext: MailRequestContext;

  const createUser = async (role: string): Promise<TestUser> => {
    const uid = `mail-trigger-${role}-${suffix}`;
    const displayName = `${role} trigger test`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${uid}, 'local', 'user', ${displayName}, false)
      RETURNING id
    `;
    if (!row) throw new Error(`Failed to create ${role} workflow trigger user`);
    userIds.push(row.id);
    return { id: row.id, uid, displayName };
  };

  const envelope = (uid: number, subject: string): ConnectorEnvelope => ({
    remoteRef: { folderStableKey: "trigger-inbox", uidValidity: "1", uid: String(uid), modseq: String(uid) },
    providerMessageId: `provider-${suffix}-${uid}`,
    providerThreadId: null,
    messageId: `<trigger-${suffix}-${uid}@example.com>`,
    inReplyTo: null,
    references: [],
    subject,
    sentAt: null,
    internalDate: new Date(`2026-07-15T10:${String(uid).padStart(2, "0")}:00.000Z`),
    sizeBytes: 128,
    flags: [],
    labels: [],
    addresses: {
      from: [{ name: "Customer", address: "customer@example.com" }],
      replyTo: [],
      to: [{ name: "Support", address: "support@example.com" }],
      cc: [],
      bcc: [],
    },
    mimeStructure: {},
  });

  const commitEnvelope = async (message: ConnectorEnvelope, kind: "incremental" | "backfill") => {
    const fence = await claimFence(resourceId, bindingId, kind);
    return commitSyncBatch({
      folder: {
        folder_id: folderId,
        mailbox_id: mailboxId,
        remote_resource_id: resourceId,
        sync_generation: fence.generation,
        envelope_cursor: cursor,
        role: "inbox",
      },
      folderId,
      bindingId,
      secretRevision: 1,
      fence,
      status: { uidValidity: "1", uidNext: 11, highestModseq: "10", messages: 10 },
      beforeCursor: cursor,
      cursor,
      uidValidityChanged: false,
      envelopeBatch: { messages: [message], nextHighUid: null },
      envelopeKind: kind,
      flagChanges: [],
      reconcileWindow: null,
    });
  };

  beforeAll(async () => {
    await migrate();
    await migrate();

    const owner = await createUser("owner");
    const actor = await createUser("actor");
    ownerContext = contextFor(owner);
    actorContext = contextFor(actor);

    const mailbox = unwrap(
      await createMailbox(ownerContext, {
        name: `Trigger runtime ${suffix}`,
        description: "Disposable workflow trigger runtime fixture",
        connectionPolicy: "shared_connection",
      }),
    );
    mailboxId = mailbox.id;

    const actorAccess = unwrap(
      await grantMailboxAccess({
        context: ownerContext,
        mailboxId,
        principal: { type: "user", userId: actor.id },
        permission: "admin",
      }),
    );
    actorAccessId = actorAccess.id;

    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint, status)
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)}, 'active')
      RETURNING id
    `;
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret,
        authenticated_principal, capabilities, server_identity, last_verified_at
      ) VALUES (
        ${mailboxId}::uuid, 'Trigger fixture', 'support@example.com', 'support@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 587, 'starttls',
        'password', 'fixture-ciphertext', 'support@example.com', '{}'::jsonb, '{}'::jsonb, now()
      )
      RETURNING id
    `;
    if (!resource || !connection) throw new Error("Failed to create workflow trigger provider fixture");
    resourceId = resource.id;

    const [binding] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, remote_locator, capabilities, rights,
        verification_evidence, verified_scope_fingerprint, verified_secret_revision, last_verified_at
      ) VALUES (
        ${resourceId}::uuid, ${connection.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)}, 1, now()
      )
      RETURNING id
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resourceId}::uuid, 'trigger-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    if (!binding || !folder) throw new Error("Failed to create workflow trigger binding fixture");
    bindingId = binding.id;
    folderId = folder.id;
    await sql`
      INSERT INTO mail.binding_folder_refs (
        binding_id, folder_id, remote_path, uid_validity, uid_next, effective_rights, last_verified_at
      ) VALUES (
        ${bindingId}::uuid, ${folderId}::uuid, 'INBOX', 1, 11,
        ARRAY['read', 'write_flags', 'move', 'insert']::text[], now()
      )
    `;

    const workflow = unwrap(
      await createWorkflow({
        context: actorContext,
        mailboxId,
        input: {
          name: `Message received ${suffix}`,
          description: "Workflow trigger runtime integration fixture",
          priority: 100,
          source: triggerSource,
          effectBudget,
        },
      }),
    );
    workflowId = workflow.id;
    workflowVersionId = workflow.currentVersionId;
    unwrap(
      await activateWorkflow({
        context: actorContext,
        mailboxId,
        workflowId: workflow.id,
        input: { expectedVersionId: workflow.currentVersionId },
      }),
    );
  });

  afterAll(async () => {
    await workflowRuntime.stop();
    if (mailboxId) {
      const accessRows = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
      `;
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
      if (accessRows.length > 0) {
        await sql`
          DELETE FROM auth.access
          WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${accessRows.map((row) => row.access_id)}::jsonb))
        `;
      }
    }
    if (userIds.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))`;
    }
  });

  test("pins receipt-time deliveries across replacement, mutation, and deactivation", async () => {
    const historical = envelope(1, "Historical message");
    expect((await commitEnvelope(historical, "backfill")).workflowTriggerEventIds).toEqual([]);
    expect((await commitEnvelope(historical, "incremental")).workflowTriggerEventIds).toEqual([]);
    const [historicalEvents] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM mail.workflow_trigger_events WHERE mailbox_id = ${mailboxId}::uuid
      `;
    expect(historicalEvents?.count).toBe(0);
    const [deliveryConstraint] = await sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'mail.workflow_trigger_events'::regclass
          AND conname = 'workflow_trigger_events_activation_delivery_unique'
          AND pg_get_constraintdef(oid) = 'UNIQUE (activation_id, trigger_kind, delivery_key)'
      ) AS present
    `;
    expect(deliveryConstraint?.present).toBe(true);

    const first = await commitEnvelope(envelope(2, "First live message"), "incremental");
    expect(first.workflowTriggerEventIds).toHaveLength(1);
    const firstEventId = first.workflowTriggerEventIds[0]!;
    await Promise.all([
      processMailWorkflowTriggerEvent(firstEventId, "trigger-worker-first"),
      processMailWorkflowTriggerEvent(firstEventId, "trigger-worker-concurrent-duplicate"),
    ]);

    const [firstEvent] = await sql<
      { state: string; execution_generation: number; result: Record<string, number> | string; lease_owner: string | null }[]
    >`
        SELECT state, execution_generation::int, result, lease_owner
        FROM mail.workflow_trigger_events
        WHERE id = ${firstEventId}::uuid
      `;
    expect(firstEvent).toMatchObject({ state: "succeeded", execution_generation: 1, lease_owner: null });
    expect(parseJson(firstEvent!.result)).toEqual({ activations: 1, created: 1, existing: 0, skipped: 0 });

    const runsAfterFirst = await sql<
      {
        id: string;
        kind: string;
        mode: string;
        channel: string;
        actor_id: string;
        inputs: Record<string, unknown> | string;
        target_query: Record<string, unknown> | string;
        target_count: number;
      }[]
    >`
        SELECT id, kind, mode, channel, actor_id, inputs, target_query, target_count::int
        FROM mail.workflow_runs
        WHERE mailbox_id = ${mailboxId}::uuid
        ORDER BY created_at, id
      `;
    expect(runsAfterFirst).toHaveLength(1);
    expect(runsAfterFirst[0]).toMatchObject({ kind: "trigger", mode: "execute", channel: "event", target_count: 1 });
    expect(runsAfterFirst[0]?.actor_id).toBe(workflowVersionId);
    expect(parseJson(runsAfterFirst[0]!.inputs)).toMatchObject({
      message: { subject: "First live message" },
      conversation: { subject: "First live message" },
    });
    expect(parseJson(runsAfterFirst[0]!.target_query)).toMatchObject({
      type: "trigger",
      kind: "messageReceived",
      deliveryKey: expect.stringContaining("message:"),
    });

    const [target] = await sql<{ target_key: string; frozen_source: Record<string, unknown> | string }[]>`
        SELECT target_key, frozen_source
        FROM mail.workflow_run_targets
        WHERE parent_run_id = ${runsAfterFirst[0]!.id}::uuid
      `;
    expect(target?.target_key).toBeTruthy();
    expect(parseJson(target!.frozen_source)).toMatchObject({ message: { subject: "First live message" } });

    await processMailWorkflowTriggerEvent(firstEventId, "trigger-worker-duplicate");
    const [afterDuplicate] = await sql<{ runs: number; generation: number }[]>`
        SELECT
          (SELECT COUNT(*)::int FROM mail.workflow_runs WHERE mailbox_id = ${mailboxId}::uuid) AS runs,
          execution_generation::int AS generation
        FROM mail.workflow_trigger_events
        WHERE id = ${firstEventId}::uuid
      `;
    expect(afterDuplicate).toEqual({ runs: 1, generation: 1 });

    const recoverable = await commitEnvelope(envelope(3, "Recoverable live message"), "incremental");
    const recoverableEventId = recoverable.workflowTriggerEventIds[0]!;
    expect(recoverableEventId).toBeTruthy();
    await sql`
        UPDATE mail.workflow_trigger_events
        SET
          state = 'running',
          execution_generation = 4,
          lease_owner = 'dead-worker',
          lease_token = ${crypto.randomUUID()}::uuid,
          lease_expires_at = now() - interval '1 minute',
          started_at = now() - interval '2 minutes'
        WHERE id = ${recoverableEventId}::uuid
      `;
    await processMailWorkflowTriggerEvent(recoverableEventId, "trigger-worker-recovery");
    const [recovered] = await sql<{ state: string; generation: number; result: Record<string, number> | string }[]>`
        SELECT state, execution_generation::int AS generation, result
        FROM mail.workflow_trigger_events
        WHERE id = ${recoverableEventId}::uuid
      `;
    expect(recovered).toMatchObject({ state: "succeeded", generation: 5 });
    expect(parseJson(recovered!.result)).toEqual({ activations: 1, created: 1, existing: 0, skipped: 0 });

    const actorRevoked = await commitEnvelope(envelope(4, "Revoked actor message"), "incremental");
    const actorRevokedEventId = actorRevoked.workflowTriggerEventIds[0]!;
    expect(actorRevokedEventId).toBeTruthy();
    unwrap(await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: actorAccessId }));
    await processMailWorkflowTriggerEvent(actorRevokedEventId, "trigger-worker-actor-revoked");

    const [actorRevokedEvent] = await sql<{ state: string; result: Record<string, number> | string }[]>`
        SELECT state, result
        FROM mail.workflow_trigger_events
        WHERE id = ${actorRevokedEventId}::uuid
      `;
    expect(actorRevokedEvent?.state).toBe("succeeded");
    expect(parseJson(actorRevokedEvent!.result)).toEqual({ activations: 1, created: 1, existing: 0, skipped: 0 });
    const [runCount] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM mail.workflow_runs WHERE mailbox_id = ${mailboxId}::uuid
      `;
    expect(runCount?.count).toBe(3);

    const replacementPending = await commitEnvelope(envelope(5, "Receipt-time subject"), "incremental");
    const replacementPendingEventId = replacementPending.workflowTriggerEventIds[0]!;
    expect(replacementPendingEventId).toBeTruthy();
    const [replacementPendingEvent] = await sql<
      {
        activation_id: string;
        workflow_version_id: string;
        authorization_snapshot: Record<string, unknown> | string;
        delivery_key: string;
        trigger_values: Record<string, unknown> | string;
        target_key: string;
        frozen_source: { message: { id: string }; conversation: { id: string } | null } | string;
        frozen_preconditions: Record<string, unknown> | string;
      }[]
    >`
      SELECT
        activation_id,
        workflow_version_id,
        authorization_snapshot,
        delivery_key,
        trigger_values,
        target_key,
        frozen_source,
        frozen_preconditions
      FROM mail.workflow_trigger_events
      WHERE id = ${replacementPendingEventId}::uuid
    `;
    expect(replacementPendingEvent?.workflow_version_id).toBe(workflowVersionId);
    expect(parseJson(replacementPendingEvent!.trigger_values)).toMatchObject({
      message: { subject: "Receipt-time subject" },
      conversation: { subject: "Receipt-time subject" },
    });

    const replacement = unwrap(
      await createWorkflowVersion({
        context: ownerContext,
        mailboxId,
        workflowId,
        input: { source: triggerSource.replace("Received ", "Replacement "), effectBudget },
      }),
    );
    const replacementVersionId = replacement.currentVersionId;
    unwrap(
      await activateWorkflow({
        context: ownerContext,
        mailboxId,
        workflowId,
        input: { expectedVersionId: replacementVersionId },
      }),
    );
    const [replacementActivation] = await sql<{ id: string }[]>`
      SELECT id
      FROM mail.workflow_activations
      WHERE workflow_id = ${workflowId}::uuid AND trigger_kind = 'messageReceived' AND enabled
    `;
    expect(replacementActivation?.id).not.toBe(replacementPendingEvent?.activation_id);

    const replacementSource = parseJson(replacementPendingEvent!.frozen_source);
    await sql`UPDATE mail.message_contents SET subject = 'Mutated after receipt' WHERE id = ${replacementSource.message.id}::uuid`;
    if (replacementSource.conversation) {
      await sql`
        UPDATE mail.conversations
        SET subject = 'Mutated conversation after receipt', revision = revision + 1
        WHERE id = ${replacementSource.conversation.id}::uuid
      `;
    }
    await processMailWorkflowTriggerEvent(replacementPendingEventId, "trigger-worker-after-replacement");

    const [replacementPinnedRun] = await sql<
      {
        id: string;
        workflow_version_id: string;
        authorization_snapshot: Record<string, unknown> | string;
        inputs: Record<string, unknown> | string;
      }[]
    >`
      SELECT id, workflow_version_id, authorization_snapshot, inputs
      FROM mail.workflow_runs
      WHERE mailbox_id = ${mailboxId}::uuid
        AND target_query->>'deliveryKey' = ${replacementPendingEvent!.delivery_key}
    `;
    expect(replacementPinnedRun?.workflow_version_id).toBe(workflowVersionId);
    expect(parseJson(replacementPinnedRun!.authorization_snapshot)).toEqual(parseJson(replacementPendingEvent!.authorization_snapshot));
    expect(parseJson(replacementPinnedRun!.inputs)).toMatchObject({
      message: { subject: "Receipt-time subject" },
      conversation: { subject: "Receipt-time subject" },
    });
    const [replacementPinnedTarget] = await sql<
      { target_key: string; frozen_source: Record<string, unknown> | string; frozen_preconditions: Record<string, unknown> | string }[]
    >`
      SELECT target_key, frozen_source, frozen_preconditions
      FROM mail.workflow_run_targets
      WHERE parent_run_id = ${replacementPinnedRun!.id}::uuid
    `;
    expect(replacementPinnedTarget?.target_key).toBe(replacementPendingEvent?.target_key);
    expect(parseJson(replacementPinnedTarget!.frozen_source)).toEqual(parseJson(replacementPendingEvent!.frozen_source));
    expect(parseJson(replacementPinnedTarget!.frozen_preconditions)).toEqual(parseJson(replacementPendingEvent!.frozen_preconditions));

    const deactivationPending = await commitEnvelope(envelope(6, "Receipt before deactivation"), "incremental");
    const deactivationPendingEventId = deactivationPending.workflowTriggerEventIds[0]!;
    expect(deactivationPendingEventId).toBeTruthy();
    const [deactivationPendingEvent] = await sql<{ activation_id: string; workflow_version_id: string; delivery_key: string }[]>`
      SELECT activation_id, workflow_version_id, delivery_key
      FROM mail.workflow_trigger_events
      WHERE id = ${deactivationPendingEventId}::uuid
    `;
    expect(deactivationPendingEvent).toMatchObject({
      activation_id: replacementActivation?.id,
      workflow_version_id: replacementVersionId,
    });

    unwrap(
      await deactivateWorkflow({
        context: ownerContext,
        mailboxId,
        workflowId,
        input: { expectedVersionId: replacementVersionId },
      }),
    );
    await processMailWorkflowTriggerEvent(deactivationPendingEventId, "trigger-worker-after-deactivation");
    const [deactivationPinnedRun] = await sql<{ workflow_version_id: string; inputs: Record<string, unknown> | string }[]>`
      SELECT workflow_version_id, inputs
      FROM mail.workflow_runs
      WHERE mailbox_id = ${mailboxId}::uuid
        AND target_query->>'deliveryKey' = ${deactivationPendingEvent!.delivery_key}
    `;
    expect(deactivationPinnedRun?.workflow_version_id).toBe(replacementVersionId);
    expect(parseJson(deactivationPinnedRun!.inputs)).toMatchObject({ message: { subject: "Receipt before deactivation" } });

    const deactivated = await commitEnvelope(envelope(7, "Deactivated workflow message"), "incremental");
    expect(deactivated.workflowTriggerEventIds).toEqual([]);
    const [finalRunCount] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.workflow_runs WHERE mailbox_id = ${mailboxId}::uuid
    `;
    expect(finalRunCount?.count).toBe(5);
  }, 30_000);
});
