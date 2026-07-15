import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowInvocation, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { executeWorkflowPlan, type WorkflowRuntimeRepositoryPort } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import type { MailWorkflowDetail, MailWorkflowPreflight, MailWorkflowRun, WorkflowTargetQuery } from "../contracts";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { createMailbox } from "./mailboxes";
import { prepareWorkflowPreflight } from "./workflow-preflight-service";
import { processMailWorkflowTarget } from "./workflow-runtime";
import { createMailWorkflowActionPorts } from "./workflow-runtime-actions";
import {
  type ClaimedMailWorkflowTarget,
  claimMailWorkflowTarget,
  MailWorkflowRuntimeRepository,
  recoverCanceledMailWorkflowTargets,
  resumeMailWorkflowDependency,
} from "./workflow-runtime-repository";
import { createMailWorkflowValueResolver } from "./workflow-runtime-values";
import {
  backfillWorkflow,
  cancelWorkflowRun,
  createWorkflow,
  createWorkflowVersion,
  dryRunWorkflow,
  getWorkflowRun,
  listWorkflowRunTargets,
  listWorkflowVersions,
  oneShotWorkflow,
} from "./workflows";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

type ResultLike<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type TestUser = { id: string; uid: string; displayName: string };

const unwrap = <T>(result: ResultLike<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  expect(result.ok).toBe(true);
  return result.data;
};

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
  requestId: `mail-workflow-${user.uid}`,
});

const budget = {
  maxTargets: 100,
  maxMoves: 100,
  maxKeywordChanges: 100,
  maxCollaborationChanges: 200,
};

const collaborationSource = (params: { userId: string | null; status: "open" | "waiting" | "done" }) => `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - assignConversation:
      conversation: "\${{ inputs.conversation }}"
      user: ${params.userId === null ? "null" : JSON.stringify(params.userId)}
  - setConversationStatus:
      conversation: "\${{ inputs.conversation }}"
      status: ${params.status}
`;

const keywordSource = (keyword: string) => `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - addKeyword:
      message: "\${{ inputs.message }}"
      keyword: ${JSON.stringify(keyword)}
`;

const nestedKeywordSource = (keyword: string) => `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - if:
      equals: [true, true]
    then:
      - addKeyword:
          message: "\${{ inputs.message }}"
          keyword: ${JSON.stringify(keyword)}
`;

const nestedCollaborationSource = (userId: string) => `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - if:
      equals: [true, true]
    then:
      - assignConversation:
          conversation: "\${{ inputs.conversation }}"
          user: ${JSON.stringify(userId)}
  - setConversationStatus:
      conversation: "\${{ inputs.conversation }}"
      status: waiting
`;

const hydratedKeywordSource = () => `inputs:
  message:
    type: mailMessage
    required: true
steps:
  - if:
      contains:
        - "\${{ inputs.message.bodyText }}"
        - terminal-hydration-probe
    then:
      - addKeyword:
          message: "\${{ inputs.message }}"
          keyword: TerminalHydrationProbe
`;

const terminalFailureSource = () => `inputs:
  message:
    type: mailMessage
    required: true
steps:
  - fail:
      message: "target failed"
`;

suite("mail canonical workflow runtime", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let conversationId = "";
  let writerAccessId = "";
  let owner: TestUser;
  let writer: TestUser;
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;

  const createUser = async (role: string): Promise<TestUser> => {
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

  const createWorkflowFixture = async (source: string, name = `Workflow ${crypto.randomUUID().slice(0, 8)}`) =>
    unwrap(
      await createWorkflow({
        context: ownerContext,
        mailboxId,
        input: {
          name,
          description: "Canonical workflow runtime integration fixture",
          priority: 100,
          source,
          effectBudget: budget,
        },
      }),
    );

  const preflight = async (
    workflow: MailWorkflowDetail,
    context = writerContext,
    query: WorkflowTargetQuery = { type: "all" },
  ): Promise<MailWorkflowPreflight> =>
    unwrap(
      await sql.begin(async (tx) => {
        const prepared = await prepareWorkflowPreflight({
          context,
          mailboxId,
          workflowId: workflow.id,
          input: { expectedVersionId: workflow.currentVersionId, inputs: {}, query },
          occurredAt: new Date().toISOString(),
          db: tx,
        });
        return prepared.ok ? { ok: true as const, data: prepared.data.preflight } : prepared;
      }),
    );

  const backfill = async (workflow: MailWorkflowDetail, key: string, context = writerContext): Promise<MailWorkflowRun> => {
    const prepared = await preflight(workflow, context);
    return unwrap(
      await backfillWorkflow({
        context,
        mailboxId,
        workflowId: workflow.id,
        channel: "bulk",
        input: {
          expectedVersionId: workflow.currentVersionId,
          inputs: {},
          query: { type: "all" },
          preflightHash: prepared.preflightHash,
          occurredAt: prepared.occurredAt,
          idempotencyKey: key,
        },
        enqueue: false,
      }),
    );
  };

  const oneShot = async (workflow: MailWorkflowDetail, key: string, context = writerContext): Promise<MailWorkflowRun> => {
    const prepared = await preflight(workflow, context);
    return unwrap(
      await oneShotWorkflow({
        context,
        mailboxId,
        workflowId: workflow.id,
        channel: "ui",
        input: {
          expectedVersionId: workflow.currentVersionId,
          inputs: {},
          query: { type: "all" },
          preflightHash: prepared.preflightHash,
          occurredAt: prepared.occurredAt,
          idempotencyKey: key,
        },
        enqueue: false,
      }),
    );
  };

  const targetRows = (runId: string) =>
    sql<{ id: string; ordinal: number; state: string }[]>`
      SELECT id, ordinal::int, state
      FROM mail.workflow_run_targets
      WHERE parent_run_id = ${runId}::uuid
      ORDER BY ordinal
    `;

  const processTarget = (targetId: string, worker: string) =>
    processMailWorkflowTarget({ targetId, workerId: `${worker}-${crypto.randomUUID().slice(0, 8)}` });

  const resetConversation = async (): Promise<number> => {
    const [conversation] = await sql<{ revision: number }[]>`
      UPDATE mail.conversations
      SET
        assignee_user_id = NULL,
        work_status = 'open',
        response_needed = true,
        snoozed_until = NULL,
        revision = revision + 1
      WHERE id = ${conversationId}::uuid
      RETURNING revision::int
    `;
    if (!conversation) throw new Error("Workflow collaboration fixture is unavailable");
    return conversation.revision;
  };

  const executeClaim = (claim: ClaimedMailWorkflowTarget, repository: WorkflowRuntimeRepositoryPort) => {
    if (claim.mode !== "execute") throw new Error("Expected an executable workflow claim");
    const sourceContext =
      claim.source !== null && typeof claim.source === "object" && !Array.isArray(claim.source)
        ? (claim.source as Record<string, WorkflowJsonValue>)
        : {};
    const actorSnapshot = claim.authorization.authority === "actor" ? claim.authorization.actor : null;
    const actor = {
      userId: actorSnapshot?.kind === "user" ? actorSnapshot.userId : null,
      groupIds: [],
      serviceAccountId: actorSnapshot?.kind === "service_account" ? actorSnapshot.serviceAccountId : null,
    };
    const invocation: WorkflowInvocation & { mode: "execute" } = {
      workflowId: claim.workflowId,
      expectedRevision: claim.versionIdentity,
      mode: "execute",
      channel: claim.channel,
      actor,
      inputs: claim.inputs,
      idempotencyKey: `${claim.idempotencyKey}:${claim.runId}`,
      occurredAt: claim.occurredAt,
      context: {
        ...sourceContext,
        mailboxId: claim.mailboxId,
        actor,
        occurredAt: claim.occurredAt,
        workflow: { id: claim.workflowId, versionId: claim.workflowVersionId },
      },
    };
    return executeWorkflowPlan({
      runId: claim.runId,
      executionGeneration: claim.executionGeneration,
      plan: claim.plan,
      invocation,
      repository,
      clock: { now: () => claim.executionClockAt },
      values: createMailWorkflowValueResolver({ targetId: claim.runId, inputs: claim.inputs }),
      actions: createMailWorkflowActionPorts({
        authority: { kind: "actor", context: writerContext },
        mailboxId: claim.mailboxId,
        workflowVersionId: claim.workflowVersionId,
        targetId: claim.runId,
        preconditions: claim.preconditions,
      }).execute,
    });
  };

  beforeAll(async () => {
    await migrate();
    await migrate();

    owner = await createUser("owner");
    writer = await createUser("writer");
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);

    const mailbox = unwrap(
      await createMailbox(ownerContext, {
        name: `Workflow ${suffix}`,
        description: "Disposable workflow fixture",
        connectionPolicy: "shared_connection",
      }),
    );
    mailboxId = mailbox.id;

    const writerAccess = unwrap(
      await grantMailboxAccess({
        context: ownerContext,
        mailboxId,
        principal: { type: "user", userId: writer.id },
        permission: "write",
      }),
    );
    writerAccessId = writerAccess.id;
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
        verification_evidence, verified_scope_fingerprint, verified_secret_revision, last_verified_at
      ) VALUES (
        ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)}, 1, now()
      )
      RETURNING id
    `;
    const providerBindingId = binding!.id;
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
        ARRAY['read', 'write_flags', 'move', 'insert']::text[], now()
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

  test("creates immutable canonical YAML versions", async () => {
    const first = await createWorkflowFixture(collaborationSource({ userId: writer.id, status: "waiting" }), "Immutable versions");
    const second = unwrap(
      await createWorkflowVersion({
        context: ownerContext,
        mailboxId,
        workflowId: first.id,
        input: {
          source: collaborationSource({ userId: writer.id, status: "done" }),
          effectBudget: budget,
        },
      }),
    );
    expect(second.currentVersionId).not.toBe(first.currentVersionId);
    expect(second.currentVersion.source).toContain("setConversationStatus");
    expect(second.currentVersion.boundPlan.languageId).toBe("mail");
    expect(second.currentVersion.identity).not.toBe(first.currentVersion.identity);

    const versions = unwrap(await listWorkflowVersions({ context: ownerContext, mailboxId, workflowId: first.id }));
    expect(versions.map((version) => version.id)).toEqual([second.currentVersionId, first.currentVersionId]);

    let immutableUpdateCode: string | null = null;
    try {
      await sql`
        UPDATE mail.workflow_versions
        SET source_hash = ${"f".repeat(64)}
        WHERE id = ${first.currentVersionId}::uuid
      `;
    } catch (error) {
      immutableUpdateCode = (error as { code?: string; errno?: string }).errno ?? (error as { code?: string }).code ?? null;
    }
    expect(immutableUpdateCode).toBe("55000");
  });

  test("materializes runs idempotently from preflight snapshots", async () => {
    const workflow = await createWorkflowFixture(collaborationSource({ userId: writer.id, status: "waiting" }), "Idempotent run");
    const prepared = await preflight(workflow);
    expect(prepared).toMatchObject({ workflowVersionId: workflow.currentVersionId, targetCount: 2 });

    const input = {
      expectedVersionId: workflow.currentVersionId,
      inputs: {},
      query: { type: "all" as const },
      preflightHash: prepared.preflightHash,
      occurredAt: prepared.occurredAt,
      idempotencyKey: `idempotent-${suffix}`,
    };
    const first = unwrap(
      await backfillWorkflow({ context: writerContext, mailboxId, workflowId: workflow.id, channel: "api", input, enqueue: false }),
    );
    const second = unwrap(
      await backfillWorkflow({ context: writerContext, mailboxId, workflowId: workflow.id, channel: "api", input, enqueue: false }),
    );
    expect(second.id).toBe(first.id);
    expect(first.channel).toBe("api");
    expect(second.channel).toBe("api");
    expect(first.targetProgress).toMatchObject({ total: 2, queued: 2 });

    const [materialized] = await sql<{ targets: number; steps: number; distinct_targets: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM mail.workflow_run_targets WHERE parent_run_id = ${first.id}::uuid) AS targets,
        (SELECT COUNT(*)::int FROM mail.workflow_step_runs step
          JOIN mail.workflow_run_targets target ON target.id = step.target_id
          WHERE target.parent_run_id = ${first.id}::uuid) AS steps,
        (SELECT COUNT(DISTINCT target_key)::int FROM mail.workflow_run_targets WHERE parent_run_id = ${first.id}::uuid) AS distinct_targets
    `;
    expect(materialized).toEqual({ targets: 2, steps: 0, distinct_targets: 2 });
  });

  test("scopes idempotency keys to a workflow", async () => {
    const firstWorkflow = await createWorkflowFixture(keywordSource("First"), "First idempotency scope");
    const secondWorkflow = await createWorkflowFixture(keywordSource("Second"), "Second idempotency scope");
    const key = `shared-workflow-key-${suffix}`;
    const first = await backfill(firstWorkflow, key);
    const second = await backfill(secondWorkflow, key);

    expect(second.id).not.toBe(first.id);
    expect(first.workflowId).toBe(firstWorkflow.id);
    expect(second.workflowId).toBe(secondWorkflow.id);
  });

  test("restores an atomically ledgered collaboration action after crash and lease takeover", async () => {
    const baselineRevision = await resetConversation();
    const workflow = await createWorkflowFixture(
      collaborationSource({ userId: writer.id, status: "waiting" }),
      "Collaboration crash recovery",
    );
    const run = await oneShot(workflow, `collaboration-crash-${suffix}`);
    const target = (await targetRows(run.id))[0]!;
    const claim = await claimMailWorkflowTarget({ targetId: target.id, workerId: `crash-${suffix}` });
    expect(claim).not.toBeNull();
    if (!claim) return;

    const repository = new MailWorkflowRuntimeRepository(claim);
    let simulatedCrash = false;
    const crashRepository: WorkflowRuntimeRepositoryPort = {
      heartbeat: (identity) => repository.heartbeat(identity),
      restoreStepOutcome: (step) => repository.restoreStepOutcome(step),
      startStep: (step) => repository.startStep(step),
      finishStep: async (step, result) => {
        if (!simulatedCrash && step.action === "assignConversation" && result.mode === "execute" && result.outcome.state === "completed") {
          simulatedCrash = true;
          throw new Error("Simulated crash after collaboration commit");
        }
        await repository.finishStep(step, result);
      },
      parkStep: (step, dependency) => repository.parkStep(step, dependency),
    };
    await expect(executeClaim(claim, crashRepository)).rejects.toThrow("Simulated crash after collaboration commit");

    const [afterCrash] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(afterCrash).toEqual({ assignee_user_id: writer.id, work_status: "open", revision: baselineRevision + 1 });
    const [ledger] = await sql<{ state: string; outcome: Record<string, unknown> | string }[]>`
      SELECT state, outcome
      FROM mail.workflow_step_runs
      WHERE target_id = ${target.id}::uuid
    `;
    expect(ledger?.state).toBe("succeeded");

    await sql`
      UPDATE mail.workflow_run_targets
      SET lease_expires_at = now() - interval '1 second'
      WHERE id = ${target.id}::uuid
    `;
    expect(await processTarget(target.id, "crash-takeover")).toMatchObject({ state: "succeeded" });

    const [recovered] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(recovered).toEqual({ assignee_user_id: writer.id, work_status: "waiting", revision: baselineRevision + 2 });
    const [activity] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.activity_events
      WHERE metadata ->> 'workflowTargetId' = ${target.id}
    `;
    expect(activity?.count).toBe(2);
  }, 20_000);

  test("rolls back a collaboration mutation when lease takeover wins after step start", async () => {
    const baselineRevision = await resetConversation();
    const workflow = await createWorkflowFixture(
      collaborationSource({ userId: writer.id, status: "waiting" }),
      "Collaboration lease fence",
    );
    const run = await oneShot(workflow, `collaboration-lease-${suffix}`);
    const target = (await targetRows(run.id))[0]!;
    const staleClaim = await claimMailWorkflowTarget({ targetId: target.id, workerId: `stale-${suffix}` });
    expect(staleClaim).not.toBeNull();
    if (!staleClaim) return;

    const staleRepository = new MailWorkflowRuntimeRepository(staleClaim);
    let takeoverClaim: ClaimedMailWorkflowTarget | null = null;
    const takeoverRepository: WorkflowRuntimeRepositoryPort = {
      heartbeat: async () => ({ state: "active" }),
      restoreStepOutcome: async () => null,
      startStep: async (step) => {
        await staleRepository.startStep(step);
        await sql`
          UPDATE mail.workflow_run_targets
          SET lease_expires_at = now() - interval '1 second'
          WHERE id = ${target.id}::uuid
        `;
        takeoverClaim = await claimMailWorkflowTarget({ targetId: target.id, workerId: `takeover-${suffix}` });
        if (!takeoverClaim) throw new Error("Lease takeover did not claim the workflow target");
      },
      finishStep: async () => undefined,
      parkStep: async () => undefined,
    };
    const result = await executeClaim(staleClaim, takeoverRepository);
    expect(takeoverClaim).not.toBeNull();
    expect(result).toMatchObject({
      state: "failed",
      error: { code: "MAIL_WORKFLOW_LEASE_LOST" },
    });

    const [conversation] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(conversation).toEqual({ assignee_user_id: null, work_status: "open", revision: baselineRevision });
    const [activity] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.activity_events
      WHERE metadata ->> 'workflowTargetId' = ${target.id}
    `;
    expect(activity?.count).toBe(0);
  }, 20_000);

  test("restores completed collaboration descendants after a control-step crash", async () => {
    const baselineRevision = await resetConversation();
    const workflow = await createWorkflowFixture(nestedCollaborationSource(writer.id), "Nested collaboration recovery");
    const run = await oneShot(workflow, `nested-collaboration-${suffix}`);
    const target = (await targetRows(run.id))[0]!;
    const claim = await claimMailWorkflowTarget({ targetId: target.id, workerId: `nested-crash-${suffix}` });
    expect(claim).not.toBeNull();
    if (!claim) return;

    const repository = new MailWorkflowRuntimeRepository(claim);
    let simulatedCrash = false;
    const crashRepository: WorkflowRuntimeRepositoryPort = {
      heartbeat: (identity) => repository.heartbeat(identity),
      restoreStepOutcome: (step) => repository.restoreStepOutcome(step),
      startStep: (step) => repository.startStep(step),
      finishStep: async (step, result) => {
        await repository.finishStep(step, result);
        if (!simulatedCrash && step.kind === "if" && result.mode === "execute" && result.outcome.state === "completed") {
          simulatedCrash = true;
          throw new Error("Simulated crash after control-step commit");
        }
      },
      parkStep: (step, dependency) => repository.parkStep(step, dependency),
    };
    await expect(executeClaim(claim, crashRepository)).rejects.toThrow("Simulated crash after control-step commit");

    const [afterCrash] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(afterCrash).toEqual({ assignee_user_id: writer.id, work_status: "open", revision: baselineRevision + 1 });

    await sql`
      UPDATE mail.workflow_run_targets
      SET lease_expires_at = now() - interval '1 second'
      WHERE id = ${target.id}::uuid
    `;
    expect(await processTarget(target.id, "nested-takeover")).toMatchObject({ state: "succeeded" });

    const [recovered] = await sql<{ assignee_user_id: string | null; work_status: string; revision: number }[]>`
      SELECT assignee_user_id, work_status, revision::int
      FROM mail.conversations
      WHERE id = ${conversationId}::uuid
    `;
    expect(recovered).toEqual({ assignee_user_id: writer.id, work_status: "waiting", revision: baselineRevision + 2 });
  }, 20_000);

  test("claims one target once and resumes provider commands through the shared executor", async () => {
    const workflow = await createWorkflowFixture(nestedKeywordSource("Priority"), "Provider command flow");
    const run = await oneShot(workflow, `provider-${suffix}`);
    const targets = await targetRows(run.id);
    expect(targets).toHaveLength(2);

    const [first, second] = await Promise.all([processTarget(targets[0]!.id, "claim-a"), processTarget(targets[0]!.id, "claim-b")]);
    expect([first.state, second.state].sort()).toEqual(["idle", "waiting"]);

    const [parked] = await sql<
      {
        command_id: string;
        dependency: Record<string, unknown> | string;
        actor_kind: string;
        actor_id: string;
        initiator_actor_kind: string | null;
        initiator_actor_id: string | null;
        target: Record<string, unknown> | string;
      }[]
    >`
      SELECT step.command_id, step.dependency, command.actor_kind, command.actor_id,
        command.initiator_actor_kind, command.initiator_actor_id, command.target
      FROM mail.workflow_step_runs step
      JOIN mail.commands command ON command.id = step.command_id
      WHERE step.target_id = ${targets[0]!.id}::uuid
    `;
    expect(parked).toMatchObject({
      actor_kind: "workflow",
      actor_id: workflow.currentVersionId,
      initiator_actor_kind: "user",
      initiator_actor_id: writer.id,
    });
    const dependency = typeof parked!.dependency === "string" ? JSON.parse(parked!.dependency) : parked!.dependency;
    const commandTarget = typeof parked!.target === "string" ? JSON.parse(parked!.target) : parked!.target;
    expect(dependency).toEqual({ kind: "mail.command", key: parked!.command_id });
    expect(commandTarget.expectedRemoteState).toEqual({ modseq: "1", flags: [], keywords: [] });
    const parkedSteps = await sql<{ step_key: string; state: string }[]>`
      SELECT step_key, state
      FROM mail.workflow_step_runs
      WHERE target_id = ${targets[0]!.id}::uuid
      ORDER BY step_key
    `;
    expect(parkedSteps).toEqual([
      { step_key: "steps.0", state: "running" },
      { step_key: "steps.0.then.0", state: "waiting" },
    ]);

    await sql`
      UPDATE mail.commands
      SET state = 'confirmed', finished_at = now()
      WHERE id = ${parked!.command_id}::uuid
    `;
    expect(await resumeMailWorkflowDependency({ kind: "mail.command", key: parked!.command_id })).toEqual([targets[0]!.id]);
    expect(await processTarget(targets[0]!.id, "resume-a")).toMatchObject({ state: "succeeded" });

    expect(await processTarget(targets[1]!.id, "resume-b")).toMatchObject({ state: "waiting" });
    const [failedCommand] = await sql<{ command_id: string }[]>`
      SELECT command_id
      FROM mail.workflow_step_runs
      WHERE target_id = ${targets[1]!.id}::uuid AND command_id IS NOT NULL
    `;
    await sql`
      UPDATE mail.commands
      SET state = 'failed', last_error_code = 'TEST_FAILURE', last_error_message = 'Second target failed', finished_at = now()
      WHERE id = ${failedCommand!.command_id}::uuid
    `;
    expect(await resumeMailWorkflowDependency({ kind: "mail.command", key: failedCommand!.command_id })).toEqual([targets[1]!.id]);
    expect(await processTarget(targets[1]!.id, "resume-c")).toMatchObject({ state: "failed" });

    const stored = unwrap(await getWorkflowRun({ context: writerContext, mailboxId, runId: run.id }));
    expect(stored).toMatchObject({
      state: "failed",
      targetProgress: { total: 2, queued: 0, running: 0, waiting: 0, succeeded: 1, failed: 1 },
    });
  }, 20_000);

  test("plans dry runs without creating provider commands or changing mail", async () => {
    const workflow = await createWorkflowFixture(keywordSource("DryRunOnly"), "Dry run");
    const [before] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.commands WHERE mailbox_id = ${mailboxId}::uuid
    `;
    const run = unwrap(
      await dryRunWorkflow({
        context: writerContext,
        mailboxId,
        workflowId: workflow.id,
        channel: "api",
        input: {
          expectedVersionId: workflow.currentVersionId,
          inputs: {},
          query: { type: "all" },
          idempotencyKey: `dry-run-${suffix}`,
        },
        enqueue: false,
      }),
    );
    expect(run).toMatchObject({ mode: "dryRun", state: "queued", targetProgress: { total: 2, queued: 2 } });

    for (const target of await targetRows(run.id)) {
      expect(await processTarget(target.id, `dry-run-${target.ordinal}`)).toMatchObject({
        state: "planned",
        result: { state: "planned", effects: expect.any(Array) },
      });
    }

    const [after] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.commands WHERE mailbox_id = ${mailboxId}::uuid
    `;
    expect(after?.count).toBe(before?.count);
    const stored = unwrap(await getWorkflowRun({ context: writerContext, mailboxId, runId: run.id }));
    expect(stored).toMatchObject({ mode: "dryRun", state: "succeeded", targetProgress: { succeeded: 2 } });
    const targets = unwrap(await listWorkflowRunTargets({ context: writerContext, mailboxId, runId: run.id, afterOrdinal: 0, limit: 1 }));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ ordinal: 1, state: "succeeded", targetKey: expect.any(String), result: expect.anything() });
  }, 20_000);

  test("cancels queued materialized targets before execution", async () => {
    const workflow = await createWorkflowFixture(collaborationSource({ userId: writer.id, status: "waiting" }), "Cancellation");
    const run = await backfill(workflow, `cancel-${suffix}`);
    const canceled = unwrap(
      await cancelWorkflowRun({ context: writerContext, mailboxId, runId: run.id, reason: "integration cancellation" }),
    );
    expect(canceled).toMatchObject({
      state: "canceled",
      targetProgress: { total: 2, queued: 0, running: 0, waiting: 0, canceled: 2 },
    });
    expect((await targetRows(run.id)).map(({ state }) => state)).toEqual(["canceled", "canceled"]);
    expect(await processTarget((await targetRows(run.id))[0]!.id, "cancel")).toMatchObject({ state: "idle" });
  });

  test("terminalizes a canceled running target after worker loss", async () => {
    const workflow = await createWorkflowFixture(keywordSource("CanceledWorker"), "Canceled worker recovery");
    const run = await backfill(workflow, `cancel-worker-${suffix}`);
    const targets = await targetRows(run.id);
    const claim = await claimMailWorkflowTarget({ targetId: targets[0]!.id, workerId: `lost-${suffix}` });
    expect(claim).not.toBeNull();

    unwrap(await cancelWorkflowRun({ context: writerContext, mailboxId, runId: run.id, reason: "worker lost" }));
    await sql`
      UPDATE mail.workflow_run_targets
      SET lease_expires_at = now() - interval '1 second'
      WHERE id = ${targets[0]!.id}::uuid
    `;

    expect(await recoverCanceledMailWorkflowTargets()).toBe(1);
    expect(await recoverCanceledMailWorkflowTargets()).toBe(0);
    const stored = unwrap(await getWorkflowRun({ context: writerContext, mailboxId, runId: run.id }));
    expect(stored).toMatchObject({
      state: "canceled",
      targetProgress: { total: 2, queued: 0, running: 0, waiting: 0, canceled: 2 },
    });
  });

  test("atomically cancels waiting targets and blocks dependency resume", async () => {
    const workflow = await createWorkflowFixture(keywordSource("CanceledWaiting"), "Waiting cancellation");
    const run = await oneShot(workflow, `cancel-waiting-${suffix}`);
    const targets = await targetRows(run.id);
    expect(await processTarget(targets[0]!.id, "cancel-waiting")).toMatchObject({ state: "waiting" });
    const [step] = await sql<{ command_id: string }[]>`
      SELECT command_id
      FROM mail.workflow_step_runs
      WHERE target_id = ${targets[0]!.id}::uuid
    `;
    if (!step) throw new Error("Waiting workflow step was not persisted");

    const [canceled] = await Promise.all([
      cancelWorkflowRun({ context: writerContext, mailboxId, runId: run.id, reason: "cancel waiting target" }),
      resumeMailWorkflowDependency({ kind: "mail.command", key: step.command_id }),
    ]);
    expect(unwrap(canceled)).toMatchObject({
      state: "canceled",
      targetProgress: { total: 2, queued: 0, running: 0, waiting: 0, canceled: 2 },
    });
    expect((await targetRows(run.id)).map(({ state }) => state)).toEqual(["canceled", "canceled"]);
    expect(await resumeMailWorkflowDependency({ kind: "mail.command", key: step.command_id })).toEqual([]);
  });

  test("fails a waiting target when message hydration exhausts its attempts", async () => {
    const workflow = await createWorkflowFixture(hydratedKeywordSource(), "Terminal hydration");
    const query = {
      type: "search" as const,
      expression: { field: "message_id" as const, query: `<workflow-${suffix}@example.com>`, match: "exact" as const },
    };
    const prepared = await preflight(workflow, writerContext, query);
    const run = unwrap(
      await oneShotWorkflow({
        context: writerContext,
        mailboxId,
        workflowId: workflow.id,
        channel: "api",
        input: {
          expectedVersionId: workflow.currentVersionId,
          inputs: {},
          query,
          preflightHash: prepared.preflightHash,
          occurredAt: prepared.occurredAt,
          idempotencyKey: `terminal-hydration-${suffix}`,
        },
        enqueue: false,
      }),
    );
    const [target] = await sql<{ id: string; message_id: string }[]>`
      SELECT id, frozen_inputs #>> '{message,messageId}' AS message_id
      FROM mail.workflow_run_targets
      WHERE parent_run_id = ${run.id}::uuid
    `;
    if (!target) throw new Error("Hydration workflow target was not materialized");

    await sql`
      UPDATE mail.message_contents
      SET hydration_status = 'failed', hydration_attempt = 4
      WHERE id = ${target.message_id}::uuid
    `;
    expect(await processTarget(target.id, "hydration-waiting")).toMatchObject({ state: "waiting" });

    await sql`
      UPDATE mail.message_contents
      SET hydration_status = 'failed', hydration_attempt = 5
      WHERE id = ${target.message_id}::uuid
    `;
    expect(await resumeMailWorkflowDependency({ kind: "mail.hydration", key: target.message_id })).toEqual([target.id]);
    expect(await processTarget(target.id, "hydration-terminal")).toMatchObject({
      state: "failed",
      result: { state: "failed", error: { code: "WORKFLOW_VALUE_UNAVAILABLE", retryable: false } },
    });
    const [stored] = await sql<{ state: string; error_code: string }[]>`
      SELECT state, last_error ->> 'code' AS error_code
      FROM mail.workflow_run_targets
      WHERE id = ${target.id}::uuid
    `;
    expect(stored).toEqual({ state: "failed", error_code: "WORKFLOW_VALUE_UNAVAILABLE" });

    await sql`
      UPDATE mail.message_contents
      SET hydration_status = 'complete', hydration_attempt = 0
      WHERE id = ${target.message_id}::uuid
    `;
  });

  test("does not execute materialized work after authorization is revoked", async () => {
    const workflow = await createWorkflowFixture(collaborationSource({ userId: writer.id, status: "done" }), "Revocation");
    const run = await backfill(workflow, `revoked-${suffix}`);
    expect(run).toMatchObject({ state: "queued", targetProgress: { total: 2, queued: 2 } });

    unwrap(await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: writerAccessId }));
    const target = (await targetRows(run.id))[0]!;
    const result = await processTarget(target.id, "revoked");
    expect(result).toMatchObject({ state: "canceled" });

    const stored = unwrap(await getWorkflowRun({ context: ownerContext, mailboxId, runId: run.id }));
    expect(stored.state).toBe("canceled");
    expect(stored.lastError?.message).toContain("revoked");
  }, 20_000);

  test("aggregates parent state after terminal target outcomes", async () => {
    const workflow = await createWorkflowFixture(terminalFailureSource(), "Terminal aggregation");
    const run = await oneShot(workflow, `terminal-${suffix}`, ownerContext);
    const targets = await targetRows(run.id);
    for (const target of targets) {
      expect(await processTarget(target.id, `terminal-${target.ordinal}`)).toMatchObject({ state: "failed" });
    }
    const stored = unwrap(await getWorkflowRun({ context: ownerContext, mailboxId, runId: run.id }));
    expect(stored).toMatchObject({
      state: "failed",
      targetProgress: { total: 2, queued: 0, running: 0, waiting: 0, succeeded: 0, failed: 2 },
    });
  });
});
