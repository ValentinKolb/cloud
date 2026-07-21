import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encryptSecret } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { cancelPendingAutomaticRepliesInTransaction, prepareAutomaticReplyInTransaction } from "./automatic-reply";
import { createActorCommand } from "./commands";
import type { ConnectorEnvelope } from "./connectors";
import { mergeConversations } from "./conversations";
import { acquireDraftLease } from "./draft-leases";
import { createDraftAttachmentUpload } from "./draft-uploads";
import { getDraft } from "./drafts";
import { createMailbox } from "./mailboxes";
import { claimFence, commitSyncBatch } from "./sync-runtime";
import { processMailWorkflowTarget, workflowRuntime } from "./workflow-runtime";
import { processMailWorkflowTriggerEvent } from "./workflow-trigger-runtime";
import { activateWorkflow, cancelWorkflowRun, createWorkflow, createWorkflowVersion, deactivateWorkflow } from "./workflows";

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
  maxCopies: 0,
  maxSends: 0,
  maxDrafts: 0,
  maxFlagChanges: 0,
  maxNotifications: 0,
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
  let senderIdentityId = "";
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
    protocolFacts: {
      returnPath: "<customer@example.com>",
      autoSubmitted: "no",
      precedence: null,
      listId: null,
      autoResponseSuppress: null,
      contentType: "text/plain",
      deliveryStatus: false,
    },
    subject,
    sentAt: null,
    internalDate: new Date(`2026-07-15T10:${String(uid).padStart(2, "0")}:00.000Z`),
    sizeBytes: 128,
    flags: [],
    labels: [],
    addresses: {
      from: [{ name: "Customer", address: "customer@example.com" }],
      replyTo: [{ name: "Untrusted Reply-To", address: "attacker@example.com" }],
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
    await workflowRuntime.stop();
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
    const encryptedSecret = await encryptSecret({ kind: "password", password: "workflow-trigger-fixture-secret" });
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret,
        authenticated_principal, capabilities, server_identity, last_verified_at
      ) VALUES (
        ${mailboxId}::uuid, 'Trigger fixture', 'support@example.com', 'support@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 587, 'starttls',
        'password', ${encryptedSecret}, 'support@example.com', '{}'::jsonb, '{}'::jsonb, now()
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
    const [senderIdentity] = await sql<{ id: string }[]>`
      INSERT INTO mail.sender_identities (
        mailbox_id, display_name, from_address, automation_policy, is_default, status
      ) VALUES (
        ${mailboxId}::uuid, 'Support', 'support@example.com', 'mailbox', true, 'verified'
      )
      RETURNING id
    `;
    if (!senderIdentity) throw new Error("Failed to create workflow trigger sender identity fixture");
    senderIdentityId = senderIdentity.id;
    await sql`
      INSERT INTO mail.sender_identity_bindings (
        sender_identity_id, binding_id, provider_principal, verified_at, verified_secret_revision, saves_sent_automatically
      ) VALUES (
        ${senderIdentityId}::uuid, ${bindingId}::uuid, 'support@example.com', now(), 1, true
      )
    `;
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
    const [deactivationPinnedRun] = await sql<{ id: string; workflow_version_id: string; inputs: Record<string, unknown> | string }[]>`
      SELECT id, workflow_version_id, inputs
      FROM mail.workflow_runs
      WHERE mailbox_id = ${mailboxId}::uuid
        AND target_query->>'deliveryKey' = ${deactivationPendingEvent!.delivery_key}
    `;
    expect(deactivationPinnedRun?.workflow_version_id).toBe(replacementVersionId);
    expect(parseJson(deactivationPinnedRun!.inputs)).toMatchObject({ message: { subject: "Receipt before deactivation" } });
    const [deactivationPinnedTarget] = await sql<{ id: string }[]>`
      SELECT id
      FROM mail.workflow_run_targets
      WHERE parent_run_id = ${deactivationPinnedRun!.id}::uuid
    `;
    expect(
      await processMailWorkflowTarget({
        targetId: deactivationPinnedTarget!.id,
        workerId: "trigger-worker-execute-after-deactivation",
      }),
    ).toMatchObject({
      state: "canceled",
      result: { state: "canceled", message: "Workflow execution authority is no longer active" },
    });

    const deactivated = await commitEnvelope(envelope(7, "Deactivated workflow message"), "incremental");
    expect(deactivated.workflowTriggerEventIds).toEqual([]);
    const [finalRunCount] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.workflow_runs WHERE mailbox_id = ${mailboxId}::uuid
    `;
    expect(finalRunCount?.count).toBe(5);
  }, 30_000);

  test("prepares automatic replies idempotently and suppresses loops", async () => {
    const [target] = await sql<
      {
        id: string;
        workflow_version_id: string;
        frozen_source:
          | {
              message: { id: string; protocolFacts: NonNullable<ConnectorEnvelope["protocolFacts"]> };
              conversation: { id: string };
            }
          | string;
      }[]
    >`
      SELECT target.id, run.workflow_version_id, target.frozen_source
      FROM mail.workflow_run_targets target
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE run.mailbox_id = ${mailboxId}::uuid
      ORDER BY target.created_at, target.id
      LIMIT 1
    `;
    if (!target) throw new Error("Automatic reply workflow target fixture is unavailable");
    const source = parseJson(target.frozen_source);
    const base = {
      mailboxId,
      workflowVersionId: target.workflow_version_id,
      workflowTargetId: target.id,
      messageId: source.message.id,
      conversationId: source.conversation.id,
      senderIdentityId,
      subject: "Re: Automatic reply fixture",
      body: "We received your message.",
      format: "plain" as const,
      protocolFacts: { ...source.message.protocolFacts, returnPath: "<race@example.com>" },
      occurredAt: new Date().toISOString(),
      minimumIntervalHours: 24,
      schedule: null,
    };
    const first = await sql.begin((tx) => prepareAutomaticReplyInTransaction({ ...base, db: tx, stepKey: "automatic-reply:first" }));
    expect(first.ok && first.data.state).toBe("queued");
    const replay = await sql.begin((tx) => prepareAutomaticReplyInTransaction({ ...base, db: tx, stepKey: "automatic-reply:first" }));
    expect(replay).toEqual(first);
    const duplicate = await sql.begin((tx) =>
      prepareAutomaticReplyInTransaction({ ...base, db: tx, stepKey: "automatic-reply:duplicate" }),
    );
    if (!duplicate.ok) throw new Error(duplicate.error.message);
    expect(duplicate.data).toMatchObject({
      state: "suppressed",
      reasons: ["already_replied", "recipient_rate_limited"],
    });
    const loop = await sql.begin((tx) =>
      prepareAutomaticReplyInTransaction({
        ...base,
        db: tx,
        stepKey: "automatic-reply:loop",
        protocolFacts: { ...base.protocolFacts, returnPath: "<>" },
        minimumIntervalHours: 0,
      }),
    );
    if (!loop.ok) throw new Error(loop.error.message);
    expect(loop.data).toMatchObject({
      state: "suppressed",
      reasons: ["missing_sender", "null_return_path", "already_replied"],
    });
    const draftId = first.ok && first.data.state === "queued" ? first.data.draftId : null;
    const [draft] = await sql<{ origin: string; author_kind: string; state: string }[]>`
      SELECT origin, author_kind, state FROM mail.drafts WHERE id = ${draftId}::uuid
    `;
    expect(draft).toEqual({ origin: "workflow", author_kind: "workflow", state: "draft" });
    expect((await getDraft(ownerContext, mailboxId, draftId!)).ok).toBe(false);
    expect((await acquireDraftLease({ context: ownerContext, mailboxId, draftId: draftId! })).ok).toBe(false);
    expect(
      (
        await createDraftAttachmentUpload({
          context: ownerContext,
          mailboxId,
          draftId: draftId!,
          input: { filename: "not-allowed.txt", contentType: "text/plain", byteLength: 0 },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createActorCommand({
          context: ownerContext,
          mailboxId,
          enqueue: false,
          input: {
            kind: "send",
            draftId: draftId!,
            expectedDraftRevision: first.ok && first.data.state === "queued" ? first.data.draftRevision : 1,
            senderIdentityId,
            undoSeconds: 0,
            idempotencyKey: `workflow-draft-user-send-${suffix}`,
          },
        })
      ).ok,
    ).toBe(false);
    const cleanup = await sql.begin((tx) =>
      cancelPendingAutomaticRepliesInTransaction({
        db: tx,
        mailboxId,
        code: "TEST_CLEANUP",
        message: "Clean up an unlinked automatic reply fixture",
      }),
    );
    expect(cleanup.cancelled).toBeGreaterThanOrEqual(1);
    const [cleaned] = await sql<{ effect_state: string; draft_state: string }[]>`
      SELECT effect.state AS effect_state, draft.state AS draft_state
      FROM mail.automatic_reply_effects effect
      JOIN mail.drafts draft ON draft.id = effect.draft_id
      WHERE effect.id = ${first.ok ? first.data.effectId : null}::uuid
    `;
    expect(cleaned).toEqual({ effect_state: "cancelled", draft_state: "discarded" });
  });

  test("serializes concurrent automatic reply guards", async () => {
    const targets = await sql<
      {
        id: string;
        workflow_version_id: string;
        frozen_source:
          | {
              message: { id: string; protocolFacts: NonNullable<ConnectorEnvelope["protocolFacts"]> };
              conversation: { id: string };
            }
          | string;
      }[]
    >`
      SELECT target.id, run.workflow_version_id, target.frozen_source
      FROM mail.workflow_run_targets target
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE run.mailbox_id = ${mailboxId}::uuid
      ORDER BY target.created_at, target.id
      OFFSET 1
      LIMIT 2
    `;
    if (targets.length !== 2) throw new Error("Automatic reply concurrency fixtures are unavailable");
    const source = parseJson(targets[0]!.frozen_source);
    const base = {
      mailboxId,
      workflowVersionId: targets[0]!.workflow_version_id,
      workflowTargetId: targets[0]!.id,
      messageId: source.message.id,
      conversationId: source.conversation.id,
      senderIdentityId,
      subject: "Re: Concurrent automatic reply",
      body: "We received your message.",
      format: "plain" as const,
      protocolFacts: source.message.protocolFacts,
      occurredAt: new Date().toISOString(),
      minimumIntervalHours: 24,
      schedule: null,
    };
    const concurrent = await Promise.all([
      sql.begin((tx) => prepareAutomaticReplyInTransaction({ ...base, db: tx, stepKey: "automatic-reply:race-a" })),
      sql.begin((tx) => prepareAutomaticReplyInTransaction({ ...base, db: tx, stepKey: "automatic-reply:race-b" })),
    ]);
    expect(concurrent.every((result) => result.ok)).toBe(true);
    const states = concurrent.flatMap((result) => (result.ok ? [result.data.state] : [])).sort();
    expect(states).toEqual(["queued", "suppressed"]);
    const suppressed = concurrent.find((result) => result.ok && result.data.state === "suppressed");
    expect(suppressed?.ok && suppressed.data.state === "suppressed" ? suppressed.data.reasons : []).toEqual([
      "already_replied",
      "recipient_rate_limited",
    ]);
    const cleanup = await sql.begin((tx) =>
      cancelPendingAutomaticRepliesInTransaction({
        db: tx,
        mailboxId,
        code: "TEST_CLEANUP",
        message: "Clean up concurrent automatic reply fixtures",
      }),
    );
    expect(cleanup.cancelled).toBeGreaterThanOrEqual(1);
  });

  test("materializes an automatic reply through the durable outbox", async () => {
    const source = `inputs:
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
  - automaticReply:
      message: inputs.message
      conversation: inputs.conversation
      sender: Support <support@example.com>
      subject: "Re: \${{ inputs.message.subject }}"
      body: We received your message.
      minimumIntervalHours: 0
`;
    const workflow = unwrap(
      await createWorkflow({
        context: ownerContext,
        mailboxId,
        input: {
          name: `Automatic reply ${suffix}`,
          description: "Automatic reply outbox integration fixture",
          priority: 50,
          source,
          effectBudget: { ...effectBudget, maxSends: 1 },
        },
      }),
    );
    unwrap(
      await activateWorkflow({
        context: ownerContext,
        mailboxId,
        workflowId: workflow.id,
        input: { expectedVersionId: workflow.currentVersionId },
      }),
    );
    const committed = await commitEnvelope(envelope(8, "Automatic reply request"), "incremental");
    expect(committed.workflowTriggerEventIds).toHaveLength(1);
    await processMailWorkflowTriggerEvent(committed.workflowTriggerEventIds[0]!, "automatic-reply-trigger-worker");
    const [target] = await sql<{ id: string; parent_run_id: string }[]>`
      SELECT target.id, target.parent_run_id
      FROM mail.workflow_run_targets target
      JOIN mail.workflow_runs run ON run.id = target.parent_run_id
      WHERE run.workflow_version_id = ${workflow.currentVersionId}::uuid
      ORDER BY target.created_at DESC, target.id DESC
      LIMIT 1
    `;
    if (!target) throw new Error("Automatic reply runtime target was not materialized");
    const execution = await processMailWorkflowTarget({ targetId: target.id, workerId: "automatic-reply-target-worker" });
    expect(execution).toMatchObject({ state: "waiting", result: { state: "waiting" } });

    const [effect] = await sql<
      {
        state: string;
        command_id: string | null;
        draft_id: string | null;
        draft_state: string;
        command_state: string;
        outbox_state: string;
        draft_snapshot: Record<string, unknown> | string;
      }[]
    >`
      SELECT
        effect.state,
        effect.command_id,
        effect.draft_id,
        draft.state AS draft_state,
        command.state AS command_state,
        outbox.state AS outbox_state,
        outbox.draft_snapshot
      FROM mail.automatic_reply_effects effect
      JOIN mail.drafts draft ON draft.id = effect.draft_id
      JOIN mail.commands command ON command.id = effect.command_id
      JOIN mail.outbox_submissions outbox ON outbox.command_id = command.id
      WHERE effect.workflow_version_id = ${workflow.currentVersionId}::uuid
    `;
    expect(effect).toMatchObject({
      state: "queued",
      draft_state: "scheduled",
      command_state: "queued",
      outbox_state: "scheduled",
    });
    expect(parseJson(effect!.draft_snapshot)).toMatchObject({
      useNullEnvelopeSender: true,
      automaticReply: true,
      bcc: [],
      to: [{ name: null, address: "customer@example.com" }],
      subject: "Re: Automatic reply request",
    });
    if (!effect?.command_id) throw new Error("Automatic reply command was not linked");
    const [sourceConversation] = await sql<{ id: string; revision: string | number }[]>`
      SELECT conversation.id, conversation.revision
      FROM mail.automatic_reply_effects effect
      JOIN mail.conversations conversation ON conversation.id = effect.conversation_id
      WHERE effect.command_id = ${effect!.command_id}::uuid
    `;
    const [mergeTarget] = await sql<{ id: string; revision: string | number }[]>`
      INSERT INTO mail.conversations (mailbox_id, subject, participant_summary, latest_message_at)
      VALUES (${mailboxId}::uuid, 'Automatic reply merge target', 'Customer', now())
      RETURNING id, revision
    `;
    if (!sourceConversation || !mergeTarget) throw new Error("Automatic reply merge fixture is unavailable");
    const merged = await mergeConversations({
      context: ownerContext,
      mailboxId,
      targetConversationId: mergeTarget.id,
      input: {
        sourceConversationId: sourceConversation.id,
        expectedTargetRevision: Number(mergeTarget.revision),
        expectedSourceRevision: Number(sourceConversation.revision),
        confirm: true,
      },
    });
    expect(merged.ok).toBe(true);
    const [mergedEffect] = await sql<{ conversation_id: string }[]>`
      SELECT conversation_id FROM mail.automatic_reply_effects WHERE command_id = ${effect!.command_id}::uuid
    `;
    expect(mergedEffect?.conversation_id).toBe(mergeTarget.id);
    const cancelledRun = await cancelWorkflowRun({
      context: ownerContext,
      mailboxId,
      runId: target.parent_run_id,
      reason: "Cancel automatic reply fixture",
    });
    if (!cancelledRun.ok) throw new Error(`${cancelledRun.error.code}: ${cancelledRun.error.message}`);
    const [cancelled] = await sql<{ state: string; draft_state: string; command_state: string; outbox_state: string }[]>`
      SELECT effect.state, draft.state AS draft_state, command.state AS command_state, outbox.state AS outbox_state
      FROM mail.automatic_reply_effects effect
      JOIN mail.drafts draft ON draft.id = effect.draft_id
      JOIN mail.commands command ON command.id = effect.command_id
      JOIN mail.outbox_submissions outbox ON outbox.command_id = command.id
      WHERE effect.command_id = ${effect.command_id}::uuid
    `;
    expect(cancelled).toEqual({ state: "cancelled", draft_state: "discarded", command_state: "cancelled", outbox_state: "cancelled" });
  });
});
