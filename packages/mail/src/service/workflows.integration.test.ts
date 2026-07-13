import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import type { WorkflowDefinition } from "../contracts";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { createMailbox } from "./mailboxes";
import { executeWorkflowRunSlice } from "./workflow-runtime";
import {
  createOneShotRun,
  createSavedRun,
  createWorkflow,
  createWorkflowVersion,
  getWorkflowRun,
  listWorkflowVersions,
  previewWorkflow,
} from "./workflows";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

const contextFor = (user: { id: string; uid: string; displayName: string }): MailRequestContext => ({
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
  requestId: `mail-workflow-${user.uid}`,
});

const definition = (params: { writerId: string; description: string; reset?: boolean }): WorkflowDefinition => ({
  version: 1,
  name: "Route support mail",
  description: params.description,
  priority: 100,
  trigger: { type: "backfill" },
  effectBudget: {
    maxTargets: 100,
    maxMoves: 0,
    maxKeywordChanges: 0,
    maxCollaborationChanges: 200,
  },
  steps: params.reset
    ? [
        { action: "assign", userId: null },
        { action: "status.set", status: "open" },
      ]
    : [
        { action: "assign", userId: params.writerId },
        { action: "status.set", status: "waiting" },
      ],
});

suite("mail deterministic workflow foundation", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let writerAccessId = "";
  let providerBindingId = "";
  let conversationId = "";
  let owner: { id: string; uid: string; displayName: string };
  let writer: { id: string; uid: string; displayName: string };
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    await migrate();
    const createUser = async (role: string) => {
      const uid = `mail-workflow-${role}-${suffix}`;
      const displayName = `${role} workflow test`;
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO auth.users (uid, provider, profile, display_name, admin)
        VALUES (${uid}, 'local', 'user', ${displayName}, false)
        RETURNING id
      `;
      if (!row) throw new Error(`Failed to create ${role} workflow user`);
      userIds.push(row.id);
      return { id: row.id, uid, displayName };
    };
    owner = await createUser("owner");
    writer = await createUser("writer");
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);

    const mailbox = await createMailbox(ownerContext, {
      name: `Workflow ${suffix}`,
      description: "Disposable workflow fixture",
      connectionPolicy: "shared_connection",
    });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    const writerAccess = await grantMailboxAccess({
      context: ownerContext,
      mailboxId,
      principal: { type: "user", userId: writer.id },
      permission: "write",
    });
    if (!writerAccess.ok) throw new Error(writerAccess.error.message);
    writerAccessId = writerAccess.data.id;
    accessIds.push(writerAccessId);

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
        ${mailboxId}::uuid, 'Workflow fixture', 'support@example.com', 'support@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 587, 'starttls',
        'password', 'fixture-ciphertext', 'support@example.com', '{}'::jsonb, '{}'::jsonb, now()
      )
      RETURNING id
    `;
    const [binding] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, remote_locator, capabilities, rights,
        verification_evidence, verified_scope_fingerprint, last_verified_at
      ) VALUES (
        ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)}, now()
      )
      RETURNING id
    `;
    providerBindingId = binding!.id;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, 'workflow-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.binding_folder_refs (
        binding_id, folder_id, remote_path, uid_validity, uid_next, effective_rights, last_verified_at
      ) VALUES (
        ${providerBindingId}::uuid, ${folder!.id}::uuid, 'INBOX', 1, 3,
        ARRAY['read', 'write_flags', 'move']::text[], now()
      )
    `;
    const internalDate = new Date("2026-07-13T08:00:00.000Z");
    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, normalized_subject, internal_date, size_bytes,
        content_hash, hydration_status, plain_text
      ) VALUES (
        ${mailboxId}::uuid, ${`<workflow-${suffix}@example.com>`}, 'Support request', 'support request',
        ${internalDate}, 128, ${"b".repeat(64)}, 'complete', 'Please help with this request.'
      )
      RETURNING id
    `;
    const [reply] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, normalized_subject, internal_date, size_bytes,
        content_hash, hydration_status, plain_text
      ) VALUES (
        ${mailboxId}::uuid, ${`<workflow-reply-${suffix}@example.com>`}, 'Re: Support request', 'support request',
        ${new Date(internalDate.getTime() + 60_000)}, 96, ${"c".repeat(64)}, 'complete', 'Following up on this request.'
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_addresses (message_id, role, position, display_name, email, normalized_email)
      VALUES
        (${message!.id}::uuid, 'from', 0, 'Customer', 'customer@example.com', 'customer@example.com'),
        (${message!.id}::uuid, 'to', 0, 'Support', 'support@example.com', 'support@example.com'),
        (${reply!.id}::uuid, 'from', 0, 'Customer', 'customer@example.com', 'customer@example.com'),
        (${reply!.id}::uuid, 'to', 0, 'Support', 'support@example.com', 'support@example.com')
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid, modseq)
      VALUES (${folder!.id}::uuid, ${message!.id}::uuid, 1, 1, 1)
      RETURNING id
    `;
    const [replyRemoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid, modseq)
      VALUES (${folder!.id}::uuid, ${reply!.id}::uuid, 1, 2, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES
        (${remoteRef!.id}::uuid, ${folder!.id}::uuid, ${message!.id}::uuid, ARRAY[]::text[], ARRAY[]::text[]),
        (${replyRemoteRef!.id}::uuid, ${folder!.id}::uuid, ${reply!.id}::uuid, ARRAY[]::text[], ARRAY[]::text[])
    `;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO mail.conversations (
        mailbox_id, subject, participant_summary, latest_inbound_at, latest_message_at, response_needed
      ) VALUES (${mailboxId}::uuid, 'Support request', 'customer@example.com', ${internalDate}, ${internalDate}, true)
      RETURNING id
    `;
    conversationId = conversation!.id;
    await sql`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
      VALUES
        (${conversationId}::uuid, ${message!.id}::uuid, 1, 'headers'),
        (${conversationId}::uuid, ${reply!.id}::uuid, 2, 'headers')
    `;
  });

  afterAll(async () => {
    if (mailboxId) {
      const rows = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
      `;
      accessIds.push(...rows.map((row) => row.access_id));
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
    }
    const uniqueAccessIds = [...new Set(accessIds)];
    if (uniqueAccessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${uniqueAccessIds}::jsonb))`;
    }
    if (userIds.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))`;
    }
  });

  test("blocks executable body-search previews while mailbox bodies are incomplete", async () => {
    const [message] = await sql<{ id: string; hydration_status: string }[]>`
      SELECT id, hydration_status
      FROM mail.message_contents
      WHERE mailbox_id = ${mailboxId}::uuid
      ORDER BY internal_date
      LIMIT 1
    `;
    if (!message) throw new Error("Workflow fixture message is missing");
    await sql`UPDATE mail.message_contents SET hydration_status = 'envelope' WHERE id = ${message.id}::uuid`;
    try {
      const preview = await previewWorkflow({
        context: ownerContext,
        mailboxId,
        input: {
          definition: definition({ writerId: writer.id, description: "Body query hydration gate" }),
          query: {
            type: "search",
            expression: { field: "body", query: "request", match: "contains" },
          },
        },
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.data.waitingDataCount).toBeGreaterThanOrEqual(1);
      expect(preview.data.previewHash).toBeNull();
    } finally {
      await sql`
        UPDATE mail.message_contents
        SET hydration_status = ${message.hydration_status}
        WHERE id = ${message.id}::uuid
      `;
    }
  });

  test("continues later targets after one provider command fails", async () => {
    const providerDefinition: WorkflowDefinition = {
      ...definition({ writerId: writer.id, description: "Continue after target failure" }),
      name: "Continue after target failure",
      effectBudget: {
        maxTargets: 100,
        maxMoves: 0,
        maxKeywordChanges: 100,
        maxCollaborationChanges: 0,
      },
      steps: [{ action: "remote.keyword.add", keyword: "ContinueTest" }],
    };
    const preview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: providerDefinition, query: { type: "all" } },
    });
    expect(preview.ok && preview.data.previewHash).not.toBeNull();
    if (!preview.ok || !preview.data.previewHash) return;
    const run = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: providerDefinition,
        query: { type: "all" },
        previewHash: preview.data.previewHash,
        idempotencyKey: `continue-after-failure-${suffix}`,
      },
      enqueue: false,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    expect(await executeWorkflowRunSlice(run.data.id, async () => undefined)).toBe("waiting_command");
    const [first] = await sql<{ command_id: string }[]>`
      SELECT command_id
      FROM mail.workflow_step_runs
      WHERE run_id = ${run.data.id}::uuid AND target_ordinal = 0
    `;
    await sql`
      UPDATE mail.commands
      SET state = 'failed', last_error_code = 'TEST_FAILURE', last_error_message = 'First target failed', finished_at = now()
      WHERE id = ${first!.command_id}::uuid
    `;

    expect(await executeWorkflowRunSlice(run.data.id, async () => undefined)).toBe("waiting_command");
    const targets = await sql<{ ordinal: number; state: string }[]>`
      SELECT ordinal::int, state
      FROM mail.workflow_run_targets
      WHERE run_id = ${run.data.id}::uuid
      ORDER BY ordinal
    `;
    expect(targets).toEqual([
      { ordinal: 0, state: "failed" },
      { ordinal: 1, state: "waiting_command" },
    ]);
    const [second] = await sql<{ command_id: string }[]>`
      SELECT command_id
      FROM mail.workflow_step_runs
      WHERE run_id = ${run.data.id}::uuid AND target_ordinal = 1
    `;
    await sql`UPDATE mail.commands SET state = 'confirmed', finished_at = now() WHERE id = ${second!.command_id}::uuid`;
    expect(await executeWorkflowRunSlice(run.data.id, async () => undefined)).toBe("failed");
    const stored = await getWorkflowRun({ context: writerContext, mailboxId, runId: run.data.id });
    expect(stored.ok && stored.data).toMatchObject({ state: "failed", completedTargets: 1, failedTargets: 1 });
  }, 15_000);

  test("versions, previews, executes, replays, and cancels on revoked access", async () => {
    const versionOne = await createWorkflow({
      context: ownerContext,
      mailboxId,
      definition: definition({ writerId: writer.id, description: "Version one" }),
    });
    expect(versionOne.ok).toBe(true);
    if (!versionOne.ok) return;
    const versionTwo = await createWorkflowVersion({
      context: ownerContext,
      mailboxId,
      workflowId: versionOne.data.id,
      definition: definition({ writerId: writer.id, description: "Version two" }),
    });
    expect(versionTwo.ok && versionTwo.data.currentVersion).toBe(2);
    const versions = await listWorkflowVersions({ context: ownerContext, mailboxId, workflowId: versionOne.data.id });
    expect(versions.ok && versions.data.map((version) => version.version)).toEqual([2, 1]);
    let immutableUpdateCode: string | null = null;
    try {
      await sql`
        UPDATE mail.workflow_versions
        SET definition_hash = ${"f".repeat(64)}
        WHERE id = ${versionOne.data.version.id}::uuid
      `;
    } catch (error) {
      const postgresError = error as { code?: string; errno?: string };
      immutableUpdateCode = postgresError.errno ?? postgresError.code ?? null;
    }
    expect(immutableUpdateCode).toBe("55000");
    const constraints = await sql<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'mail.workflow_runs'::regclass
        AND conname IN (
          'workflow_runs_mailbox_id_idempotency_key_key',
          'workflow_runs_actor_idempotency_key'
        )
      ORDER BY conname
    `;
    expect(constraints.map((constraint) => constraint.conname)).toEqual([
      "workflow_runs_mailbox_id_idempotency_key_key",
    ]);

    const versionOnePreview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: versionOne.data.version.definition, query: { type: "all" } },
    });
    expect(versionOnePreview.ok && versionOnePreview.data.previewHash).not.toBeNull();
    if (!versionOnePreview.ok || !versionOnePreview.data.previewHash) return;
    const versionOneRun = await createSavedRun({
      context: writerContext,
      mailboxId,
      workflowId: versionOne.data.id,
      input: {
        version: 1,
        query: { type: "all" },
        previewHash: versionOnePreview.data.previewHash,
        idempotencyKey: `saved-version-one-${suffix}`,
      },
      enqueue: false,
    });
    expect(versionOneRun.ok && versionOneRun.data.workflowVersion).toBe(1);

    const currentDefinition = versionTwo.ok ? versionTwo.data.version.definition : versionOne.data.version.definition;
    const providerDefinition: WorkflowDefinition = {
      ...currentDefinition,
      name: "Tag support mail",
      effectBudget: { ...currentDefinition.effectBudget, maxKeywordChanges: 100 },
      steps: [{ action: "remote.keyword.add", keyword: "Priority" }],
    };
    const providerPreview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: providerDefinition, query: { type: "all" } },
    });
    expect(providerPreview.ok && providerPreview.data).toMatchObject({ targetCount: 2, actionTargetCount: 2 });
    if (!providerPreview.ok || !providerPreview.data.previewHash) return;
    const providerRun = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: providerDefinition,
        query: { type: "all" },
        previewHash: providerPreview.data.previewHash,
        idempotencyKey: `provider-${suffix}`,
      },
      enqueue: false,
    });
    expect(providerRun.ok).toBe(true);
    if (!providerRun.ok) return;
    for (let ordinal = 0; ordinal < 2; ordinal += 1) {
      expect(await executeWorkflowRunSlice(providerRun.data.id, async () => undefined)).toBe("waiting_command");
      const [journaled] = await sql<
        {
          step_id: string;
          command_id: string;
          provider_lease_token: string | null;
          actor_kind: string;
          actor_id: string;
          initiator_actor_kind: string | null;
          initiator_actor_id: string | null;
          expected_remote_state: Record<string, unknown> | string | null;
          target: Record<string, unknown> | string;
        }[]
      >`
        SELECT
          step.id AS step_id,
          step.command_id,
          step.provider_lease_token,
          command.actor_kind,
          command.actor_id,
          command.initiator_actor_kind,
          command.initiator_actor_id,
          step.expected_remote_state,
          command.target
        FROM mail.workflow_step_runs step
        JOIN mail.commands command ON command.id = step.command_id
        WHERE step.run_id = ${providerRun.data.id}::uuid AND step.target_ordinal = ${ordinal}
      `;
      expect(journaled).toMatchObject({
        provider_lease_token: null,
        actor_kind: "workflow",
        actor_id: providerRun.data.workflowVersionId,
        initiator_actor_kind: "user",
        initiator_actor_id: writer.id,
      });
      const expectedRemoteState =
        typeof journaled!.expected_remote_state === "string"
          ? JSON.parse(journaled!.expected_remote_state)
          : journaled!.expected_remote_state;
      const commandTarget = typeof journaled!.target === "string" ? JSON.parse(journaled!.target) : journaled!.target;
      expect(expectedRemoteState).toEqual({ modseq: "1", keywords: [] });
      expect(commandTarget.expectedRemoteState).toEqual(expectedRemoteState);
      await sql`
        UPDATE mail.commands
        SET state = 'confirmed', finished_at = now()
        WHERE id = ${journaled!.command_id}::uuid
      `;
    }
    expect(await executeWorkflowRunSlice(providerRun.data.id, async () => undefined)).toBe("succeeded");

    const preview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: currentDefinition, query: { type: "all" } },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok || !preview.data.previewHash) return;
    expect(preview.data).toMatchObject({ targetCount: 2, actionTargetCount: 1, waitingDataCount: 0, budgetExceeded: false });
    expect(preview.data.actionCounts).toEqual({ assign: 1, "status.set": 1 });

    const savedRunInput = {
      version: 2,
      query: { type: "all" } as const,
      previewHash: preview.data.previewHash,
      idempotencyKey: `saved-${suffix}`,
    };
    const queued = await createSavedRun({
      context: writerContext,
      mailboxId,
      workflowId: versionOne.data.id,
      input: savedRunInput,
      enqueue: false,
    });
    expect(queued.ok && queued.data.state).toBe("queued");
    if (!queued.ok) return;
    const foreignActor = await createSavedRun({
      context: ownerContext,
      mailboxId,
      workflowId: versionOne.data.id,
      input: savedRunInput,
      enqueue: false,
    });
    expect(foreignActor.ok).toBe(false);
    if (!foreignActor.ok) expect(foreignActor.error.code).toBe("CONFLICT");
    const [materialized] = await sql<{ targets: number; steps: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM mail.workflow_run_targets WHERE run_id = ${queued.data.id}::uuid) AS targets,
        (SELECT COUNT(*)::int FROM mail.workflow_step_runs WHERE run_id = ${queued.data.id}::uuid) AS steps
    `;
    expect(materialized).toEqual({ targets: 2, steps: 2 });
    const concurrentKey = `concurrent-${suffix}`;
    const concurrentRuns = await Promise.all(
      [1, 2].map(() =>
        createSavedRun({
          context: writerContext,
          mailboxId,
          workflowId: versionOne.data.id,
          input: { ...savedRunInput, idempotencyKey: concurrentKey },
          enqueue: false,
        }),
      ),
    );
    expect(concurrentRuns.every((run) => run.ok)).toBe(true);
    if (!concurrentRuns[0]?.ok || !concurrentRuns[1]?.ok) throw new Error("Concurrent idempotent run creation failed");
    expect(concurrentRuns[0].data.id).toBe(concurrentRuns[1].data.id);
    expect(await executeWorkflowRunSlice(queued.data.id, async () => undefined)).toBe("succeeded");
    const completed = await getWorkflowRun({ context: writerContext, mailboxId, runId: queued.data.id });
    expect(completed.ok && completed.data).toMatchObject({ state: "succeeded", completedTargets: 2, failedTargets: 0 });
    const [collaboration] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(collaboration).toEqual({ assignee_user_id: writer.id, work_status: "waiting", revision: 3 });
    const [workflowActivity] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.activity_events
      WHERE mailbox_id = ${mailboxId}::uuid AND actor_kind = 'workflow' AND actor_id = ${queued.data.workflowVersionId}::uuid
    `;
    expect(workflowActivity!.count).toBeGreaterThanOrEqual(3);
    const replay = await createSavedRun({
      context: writerContext,
      mailboxId,
      workflowId: versionOne.data.id,
      input: savedRunInput,
      enqueue: false,
    });
    expect(replay.ok && replay.data.id).toBe(queued.data.id);
    const crossWorkflowReuse = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: currentDefinition,
        query: { type: "all" },
        previewHash: preview.data.previewHash,
        idempotencyKey: savedRunInput.idempotencyKey,
      },
      enqueue: false,
    });
    expect(crossWorkflowReuse.ok ? null : crossWorkflowReuse.error.code).toBe("CONFLICT");

    const doneDefinition: WorkflowDefinition = {
      ...definition({ writerId: writer.id, description: "Complete conversation" }),
      name: "Complete support mail",
      steps: [{ action: "status.set", status: "done" }],
    };
    const donePreview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: doneDefinition, query: { type: "all" } },
    });
    expect(donePreview.ok && donePreview.data).toMatchObject({ targetCount: 2, actionTargetCount: 1 });
    if (!donePreview.ok || !donePreview.data.previewHash) return;
    const doneRun = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: doneDefinition,
        query: { type: "all" },
        previewHash: donePreview.data.previewHash,
        idempotencyKey: `done-${suffix}`,
      },
      enqueue: false,
    });
    expect(doneRun.ok).toBe(true);
    if (!doneRun.ok) return;
    expect(await executeWorkflowRunSlice(doneRun.data.id, async () => undefined)).toBe("succeeded");
    const [doneCollaboration] = await sql<{ work_status: string; response_needed: boolean; revision: number }[]>`
      SELECT work_status, response_needed, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(doneCollaboration).toEqual({ work_status: "done", response_needed: false, revision: 4 });

    const resetDefinition = definition({ writerId: writer.id, description: "Reset", reset: true });
    const resetPreview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: resetDefinition, query: { type: "all" } },
    });
    expect(resetPreview.ok && resetPreview.data.previewHash).not.toBeNull();
    if (!resetPreview.ok || !resetPreview.data.previewHash) return;
    await sql`UPDATE mail.provider_bindings SET state = 'revoked' WHERE id = ${providerBindingId}::uuid`;
    const rejectedWithoutBinding = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: resetDefinition,
        query: { type: "all" },
        previewHash: resetPreview.data.previewHash,
        idempotencyKey: `binding-revoked-${suffix}`,
      },
      enqueue: false,
    });
    expect(rejectedWithoutBinding.ok ? null : rejectedWithoutBinding.error.code).toBe("FORBIDDEN");
    await sql`UPDATE mail.provider_bindings SET state = 'active' WHERE id = ${providerBindingId}::uuid`;
    const pending = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: resetDefinition,
        query: { type: "all" },
        previewHash: resetPreview.data.previewHash,
        idempotencyKey: `revoked-${suffix}`,
      },
      enqueue: false,
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const revokeProviderPreview = await previewWorkflow({
      context: writerContext,
      mailboxId,
      input: { definition: providerDefinition, query: { type: "all" } },
    });
    expect(revokeProviderPreview.ok && revokeProviderPreview.data.previewHash).not.toBeNull();
    if (!revokeProviderPreview.ok || !revokeProviderPreview.data.previewHash) return;
    const revokeProviderRun = await createOneShotRun({
      context: writerContext,
      mailboxId,
      input: {
        definition: providerDefinition,
        query: { type: "all" },
        previewHash: revokeProviderPreview.data.previewHash,
        idempotencyKey: `confirmed-before-revoke-${suffix}`,
      },
      enqueue: false,
    });
    expect(revokeProviderRun.ok).toBe(true);
    if (!revokeProviderRun.ok) return;
    expect(await executeWorkflowRunSlice(revokeProviderRun.data.id, async () => undefined)).toBe("waiting_command");
    const [confirmedBeforeRevoke] = await sql<{ command_id: string }[]>`
      SELECT command_id
      FROM mail.workflow_step_runs
      WHERE run_id = ${revokeProviderRun.data.id}::uuid AND target_ordinal = 0
    `;
    await sql`
      UPDATE mail.commands SET state = 'confirmed', finished_at = now()
      WHERE id = ${confirmedBeforeRevoke!.command_id}::uuid
    `;
    const revoked = await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: writerAccessId });
    expect(revoked.ok).toBe(true);
    expect(await executeWorkflowRunSlice(revokeProviderRun.data.id, async () => undefined)).toBe("canceled");
    const revokedTargets = await sql<{ ordinal: number; state: string }[]>`
      SELECT ordinal::int, state
      FROM mail.workflow_run_targets
      WHERE run_id = ${revokeProviderRun.data.id}::uuid
      ORDER BY ordinal
    `;
    expect(revokedTargets).toEqual([
      { ordinal: 0, state: "succeeded" },
      { ordinal: 1, state: "failed" },
    ]);
    expect(await executeWorkflowRunSlice(pending.data.id, async () => undefined)).toBe("canceled");
    const canceled = await getWorkflowRun({ context: ownerContext, mailboxId, runId: pending.data.id });
    expect(canceled.ok && canceled.data).toMatchObject({
      state: "canceled",
      lastError: "Mailbox or provider write access was revoked before workflow execution",
    });
  }, 30_000);
});
