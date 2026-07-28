import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encryptSecret, toPgTextArray } from "@valentinkolb/cloud/services";
import { deleteWorkflowScope } from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { createMailbox, updateMailbox } from "./mailboxes";
import { createSenderIdentity } from "./sender-identities";
import {
  cancelSenderRuleBackfill,
  createSenderRule,
  deleteSenderRule,
  getSenderRuleBackfill,
  listSenderRules,
  markSenderMessagesRead,
  previewSenderRuleMatches,
  setSenderRuleEnabled,
  startSenderRuleBackfill,
  stopSenderRuleBackfillRuntime,
  updateSenderRule,
} from "./sender-rules";
import { listWorkflows } from "./workflow-definition-service";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

type TestUser = { id: string; uid: string; displayName: string };

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
      mail: `${user.uid}@example.test`,
      roles: ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-sender-rules-${user.uid}`,
});

suite("mail sender rules", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let folderId = "";
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;
  let readerContext: MailRequestContext;

  const waitForBackfill = async (ruleId: string, operationId: string) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await getSenderRuleBackfill({ context: ownerContext, mailboxId, ruleId, operationId });
      if (!result.ok) throw new Error(result.error.message);
      if (!["queued", "running", "waiting"].includes(result.data.state)) return result.data;
      await Bun.sleep(25);
    }
    throw new Error(`Backfill ${operationId} did not finish`);
  };

  const seedMessage = async (params: {
    sender: string;
    normalizedSender?: string;
    uid: number;
    flags?: string[];
    sizeBytes?: number;
  }): Promise<{ messageId: string; remoteMessageRefId: string; conversationId: string }> => {
    const internalDate = new Date(Date.now() + params.uid * 1_000);
    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, normalized_subject, internal_date, sent_at,
        size_bytes, content_hash, hydration_status, plain_text
      ) VALUES (
        ${mailboxId}::uuid,
        ${`<sender-rule-${suffix}-${params.uid}@example.test>`},
        ${`Sender rule ${params.uid}`},
        ${`sender rule ${params.uid}`},
        ${internalDate},
        ${internalDate},
        ${params.sizeBytes ?? 256},
        ${params.uid.toString(16).padStart(64, "0")},
        'complete',
        ${`Sender rule body ${params.uid}`}
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_addresses (message_id, role, position, display_name, email, normalized_email)
      VALUES (
        ${message!.id}::uuid,
        'from',
        0,
        'Sender rule fixture',
        ${params.sender},
        ${params.normalizedSender ?? params.sender.toLowerCase()}
      )
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${folderId}::uuid, ${message!.id}::uuid, 1, ${params.uid})
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES (
        ${remoteRef!.id}::uuid,
        ${folderId}::uuid,
        ${message!.id}::uuid,
        ${toPgTextArray(params.flags ?? [])}::text[],
        ARRAY['keep-me']::text[]
      )
    `;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO mail.conversations (mailbox_id, subject, participant_summary, latest_inbound_at, latest_message_at)
      VALUES (
        ${mailboxId}::uuid,
        ${`Sender rule ${params.uid}`},
        'Sender rule fixture',
        ${internalDate},
        ${internalDate}
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
      VALUES (${conversation!.id}::uuid, ${message!.id}::uuid, 0, 'headers')
    `;
    return { messageId: message!.id, remoteMessageRefId: remoteRef!.id, conversationId: conversation!.id };
  };

  beforeAll(async () => {
    await migrate();
    const createUser = async (role: string): Promise<TestUser> => {
      const uid = `mail-sender-rules-${role}-${suffix}`;
      const displayName = `${role} sender rule test`;
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO auth.users (uid, provider, profile, display_name, admin)
        VALUES (${uid}, 'local', 'user', ${displayName}, false)
        RETURNING id
      `;
      if (!row) throw new Error(`Failed to create ${role} user`);
      userIds.push(row.id);
      return { id: row.id, uid, displayName };
    };

    const owner = await createUser("owner");
    const writer = await createUser("writer");
    const reader = await createUser("reader");
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);
    readerContext = contextFor(reader);

    const mailbox = await createMailbox(ownerContext, { name: `Sender rules ${suffix}` });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    for (const [userId, permission] of [
      [writer.id, "write"],
      [reader.id, "read"],
    ] as const) {
      const access = await grantMailboxAccess({
        context: ownerContext,
        mailboxId,
        principal: { type: "user", userId },
        permission,
      });
      if (!access.ok) throw new Error(access.error.message);
      accessIds.push(access.data.id);
    }

    await sql`
      UPDATE mail.mailboxes
      SET compose_safety = ${{
        internalDomains: ["internal.example"],
        largeRecipientThreshold: 20,
      }}::jsonb
      WHERE id = ${mailboxId}::uuid
    `;
    await sql`
      INSERT INTO mail.sender_identities (
        mailbox_id, label, display_name, from_address, automation_policy, is_default, status
      ) VALUES (
        ${mailboxId}::uuid, 'Support', 'Support', 'support@example.test', 'disabled', true, 'verified'
      )
    `;
    const scopeFingerprint = "c".repeat(64);
    const encryptedSecret = await encryptSecret({ kind: "password", password: `sender-rules-${suffix}` });
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret,
        authenticated_principal, capabilities, server_identity, last_verified_at
      ) VALUES (
        ${mailboxId}::uuid, 'Sender rules fixture', 'support@example.test', 'support@example.test',
        'imap.example.test', 993, 'implicit', 'smtp.example.test', 587, 'starttls',
        'password', ${encryptedSecret}, 'support@example.test', '{}'::jsonb, '{}'::jsonb, now()
      )
      RETURNING id
    `;
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint, status)
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${scopeFingerprint}, 'active')
      RETURNING id
    `;
    const [binding] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, remote_locator, capabilities, rights,
        verification_evidence, verified_scope_fingerprint, last_verified_at
      ) VALUES (
        ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${scopeFingerprint}, now()
      )
      RETURNING id
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, 'sender-rules-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    folderId = folder!.id;
    await sql`
      INSERT INTO mail.binding_folder_refs (
        binding_id, folder_id, remote_path, uid_validity, uid_next, effective_rights, last_verified_at
      ) VALUES (
        ${binding!.id}::uuid,
        ${folderId}::uuid,
        'INBOX',
        1,
        10000,
        ARRAY['read', 'write_flags', 'insert', 'move', 'delete_messages']::text[],
        now()
      )
    `;
    const roleFolders = await sql<{ id: string; role: "junk" | "trash" }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES
        (${resource!.id}::uuid, 'sender-rules-junk', 'Junk', 'junk', 'current'),
        (${resource!.id}::uuid, 'sender-rules-trash', 'Trash', 'trash', 'current')
      RETURNING id, role
    `;
    for (const roleFolder of roleFolders) {
      await sql`
        INSERT INTO mail.binding_folder_refs (
          binding_id, folder_id, remote_path, uid_validity, uid_next, effective_rights, last_verified_at
        ) VALUES (
          ${binding!.id}::uuid,
          ${roleFolder.id}::uuid,
          ${roleFolder.role === "junk" ? "Junk" : "Trash"},
          1,
          10000,
          ARRAY['read', 'write_flags', 'insert', 'move', 'delete_messages']::text[],
          now()
        )
      `;
    }
  });

  afterAll(async () => {
    await stopSenderRuleBackfillRuntime();
    if (mailboxId) {
      await sql`
        DELETE FROM logging.trace_spans
        WHERE source = 'mail:sender-rule-backfill'
          AND attributes->>'mail.mailbox.id' = ${mailboxId}
      `;
      const rows = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
      `;
      accessIds.push(...rows.map((row) => row.access_id));
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
      await deleteWorkflowScope({ appId: "mail", scopeId: mailboxId });
    }
    if (accessIds.length > 0) {
      await sql`
        DELETE FROM auth.access
        WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${[...new Set(accessIds)]}::jsonb))
      `;
    }
    if (userIds.length > 0) {
      await sql`
        DELETE FROM auth.users
        WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))
      `;
    }
  });

  test("enforces mailbox permissions and maintains immutable workflow versions", async () => {
    const denied = await createSenderRule({
      context: writerContext,
      mailboxId,
      input: {
        name: "Writer rule",
        enabled: true,
        matchKind: "sender",
        matchValue: "external@example.test",
        actions: [{ kind: "mark_read" }],
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    const created = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "  Read trusted sender  ",
        enabled: true,
        matchKind: "sender",
        matchValue: " External@Example.TEST ",
        actions: [{ kind: "mark_read" }, { kind: "set_status", status: "needs_action" }],
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({
      name: "Read trusted sender",
      enabled: true,
      matchKind: "sender",
      matchValue: "external@example.test",
      actions: [{ kind: "mark_read" }, { kind: "set_status", status: "needs_action" }],
      revision: 1,
    });

    const readerList = await listSenderRules(readerContext, mailboxId);
    expect(readerList.ok).toBe(true);
    if (!readerList.ok) throw new Error(readerList.error.message);
    expect(readerList.data.map((rule) => rule.id)).toContain(created.data.id);

    const duplicate = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "read   trusted SENDER",
        enabled: true,
        matchKind: "sender",
        matchValue: "other@example.test",
        actions: [{ kind: "mark_read" }],
      },
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe("CONFLICT");

    const updated = await updateSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: {
        expectedRevision: created.data.revision,
        name: created.data.name,
        enabled: true,
        matchKind: "domain",
        matchValue: "MÜNICH.Example",
        actions: [{ kind: "mark_read" }, { kind: "set_status", status: "waiting" }],
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.data.matchValue).toBe("xn--mnich-kva.example");
    expect(updated.data.revision).toBe(2);

    const [versionCount] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM workflows.version
      WHERE workflow_id = ${created.data.workflowId}::uuid
    `;
    expect(Number(versionCount?.count)).toBe(2);

    const disabled = await setSenderRuleEnabled({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { expectedRevision: updated.data.revision, enabled: false },
    });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) throw new Error(disabled.error.message);
    expect(disabled.data).toMatchObject({ enabled: false, revision: 3 });

    const staleDelete = await deleteSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { expectedRevision: updated.data.revision },
    });
    expect(staleDelete.ok).toBe(false);
    if (!staleDelete.ok) expect(staleDelete.error.code).toBe("CONFLICT");

    const deleted = await deleteSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { expectedRevision: disabled.data.revision },
    });
    expect(deleted.ok).toBe(true);
    const afterDelete = await listSenderRules(ownerContext, mailboxId);
    expect(afterDelete.ok).toBe(true);
    if (afterDelete.ok) expect(afterDelete.data.some((rule) => rule.id === created.data.id)).toBe(false);
    const visibleWorkflows = await listWorkflows(ownerContext, mailboxId);
    expect(visibleWorkflows.ok).toBe(true);
    if (visibleWorkflows.ok) expect(visibleWorkflows.data.some((workflow) => workflow.id === created.data.workflowId)).toBe(false);

    const [workflow] = await sql<{ enabled: boolean; active_activations: number }[]>`
      SELECT
        profile.enabled,
        (SELECT COUNT(*)::int FROM workflows.activation activation
         WHERE activation.workflow_id = profile.id AND activation.enabled) AS active_activations
      FROM mail.workflow_profile profile
      WHERE profile.id = ${created.data.workflowId}::uuid
    `;
    expect(workflow).toEqual({ enabled: false, active_activations: 0 });
  });

  test("rejects destructive rules for mailbox identities and internal domains", async () => {
    for (const input of [
      {
        name: "Own identity",
        matchKind: "sender" as const,
        matchValue: "SUPPORT@EXAMPLE.TEST",
      },
      {
        name: "Internal sender",
        matchKind: "sender" as const,
        matchValue: "person@internal.example",
      },
      {
        name: "Internal domain",
        matchKind: "domain" as const,
        matchValue: "INTERNAL.EXAMPLE",
      },
      {
        name: "Internal subdomain sender",
        matchKind: "sender" as const,
        matchValue: "person@team.internal.example",
      },
      {
        name: "Internal subdomain",
        matchKind: "domain" as const,
        matchValue: "team.internal.example",
      },
      {
        name: "Broad parent domain",
        matchKind: "domain" as const,
        matchValue: "example.test",
      },
    ]) {
      const result = await createSenderRule({
        context: ownerContext,
        mailboxId,
        input: {
          ...input,
          enabled: true,
          actions: [{ kind: "junk" }],
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        if (result.error.code !== "BAD_INPUT") throw new Error(`${result.error.code}: ${result.error.message}`);
        expect(result.error.code).toBe("BAD_INPUT");
      }
    }
  });

  test("prevents conflicting destructive rules and later safety changes", async () => {
    const created = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "Risky domain",
        enabled: true,
        matchKind: "domain",
        matchValue: "risky.example",
        actions: [{ kind: "junk" }],
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const overlap = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "Conflicting sender",
        enabled: true,
        matchKind: "sender",
        matchValue: "person@risky.example",
        actions: [{ kind: "trash" }],
      },
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.error.code).toBe("CONFLICT");

    const safety = await updateMailbox({
      context: ownerContext,
      mailboxId,
      composeSafety: { internalDomains: ["internal.example", "risky.example"], largeRecipientThreshold: 20 },
    });
    expect(safety.ok).toBe(false);
    if (!safety.ok) expect(safety.error.code).toBe("CONFLICT");

    const identity = await createSenderIdentity({
      context: ownerContext,
      mailboxId,
      input: {
        label: "Risky identity",
        displayName: "Risky",
        fromAddress: "identity@risky.example",
      },
    });
    expect(identity.ok).toBe(false);
    if (!identity.ok) expect(identity.error.code).toBe("CONFLICT");

    const deleted = await deleteSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { expectedRevision: created.data.revision },
    });
    expect(deleted.ok).toBe(true);
  });

  test("uses read access for previews and write access for bounded sender actions", async () => {
    const preview = await previewSenderRuleMatches({
      context: readerContext,
      mailboxId,
      input: { matchKind: "sender", matchValue: "nobody@external.example" },
    });
    expect(preview).toEqual({
      ok: true,
      data: { messageCount: 0, conversationCount: 0, applicationLimit: 100, capped: false },
    });

    const denied = await markSenderMessagesRead({
      context: readerContext,
      mailboxId,
      input: { matchKind: "sender", matchValue: "nobody@external.example", idempotencyKey: "reader-denied" },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    const allowed = await markSenderMessagesRead({
      context: writerContext,
      mailboxId,
      input: { matchKind: "sender", matchValue: "nobody@external.example", idempotencyKey: "writer-allowed" },
    });
    expect(allowed).toEqual({
      ok: true,
      data: { commandIds: [], messageCount: 0, applicationLimit: 100, capped: false },
    });
  });

  test("requires an enabled current revision before applying a rule to existing messages", async () => {
    const created = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "Disabled retroactive rule",
        enabled: false,
        matchKind: "sender",
        matchValue: "retroactive@external.example",
        actions: [{ kind: "mark_read" }],
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const result = await startSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { operationId: crypto.randomUUID(), expectedRevision: created.data.revision },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_INPUT");
  });

  test("matches inbound IDN senders, preserves flags, and returns one stable read batch", async () => {
    const sender = `person@xn--mnich-kva.example`;
    await seedMessage({ sender: "person@münich.example", normalizedSender: sender, uid: 1001, flags: ["$Important"] });
    await seedMessage({ sender: "person@münich.example", normalizedSender: sender, uid: 1002 });
    await seedMessage({ sender: "support@example.test", uid: 1003 });

    const preview = await previewSenderRuleMatches({
      context: ownerContext,
      mailboxId,
      input: { matchKind: "domain", matchValue: "münich.example" },
    });
    expect(preview).toEqual({
      ok: true,
      data: { messageCount: 2, conversationCount: 2, applicationLimit: 100, capped: false },
    });
    const outbound = await previewSenderRuleMatches({
      context: ownerContext,
      mailboxId,
      input: { matchKind: "sender", matchValue: "support@example.test" },
    });
    expect(outbound.ok && outbound.data.messageCount).toBe(0);

    const input = { matchKind: "domain" as const, matchValue: "münich.example", idempotencyKey: `stable-${suffix}` };
    const [first, concurrent] = await Promise.all([
      markSenderMessagesRead({ context: writerContext, mailboxId, input }),
      markSenderMessagesRead({ context: writerContext, mailboxId, input }),
    ]);
    if (!first.ok || !concurrent.ok) throw new Error("Stable sender read batch failed");
    expect([...concurrent.data.commandIds].sort()).toEqual([...first.data.commandIds].sort());
    expect(first.data.messageCount).toBe(2);

    const retry = await markSenderMessagesRead({ context: writerContext, mailboxId, input });
    if (!retry.ok) throw new Error(retry.error.message);
    expect(retry.data).toEqual(first.data);
    const placements = await sql<{ flags: string[]; keywords: string[] }[]>`
      SELECT placement.flags, placement.keywords
      FROM mail.message_placements placement
      JOIN mail.remote_message_refs remote_ref ON remote_ref.id = placement.remote_message_ref_id
      JOIN mail.message_addresses sender_address ON sender_address.message_id = remote_ref.message_id
      WHERE sender_address.normalized_email = ${sender}
      ORDER BY remote_ref.id
    `;
    expect(placements.every((placement) => placement.flags.includes("\\Seen"))).toBe(true);
    expect(placements.some((placement) => placement.flags.includes("$Important"))).toBe(true);
    expect(placements.every((placement) => placement.keywords.includes("keep-me"))).toBe(true);

    const conflictingKey = `conflicting-${suffix}`;
    const conflicting = await Promise.all([
      markSenderMessagesRead({
        context: writerContext,
        mailboxId,
        input: { matchKind: "domain", matchValue: "münich.example", idempotencyKey: conflictingKey },
      }),
      markSenderMessagesRead({
        context: writerContext,
        mailboxId,
        input: { matchKind: "sender", matchValue: "person@münich.example", idempotencyKey: conflictingKey },
      }),
    ]);
    expect(conflicting.filter((result) => result.ok)).toHaveLength(1);
    const rejected = conflicting.find((result) => !result.ok);
    expect(rejected?.ok).toBe(false);
    if (rejected && !rejected.ok) expect(rejected.error.code).toBe("CONFLICT");
  });

  test("backfills every historical match and skips an unchanged workflow version on rerun", async () => {
    const sender = `retro-${suffix}@external.example`;
    await seedMessage({ sender, uid: 1101 });
    await seedMessage({ sender, uid: 1102 });
    const created = await createSenderRule({
      context: ownerContext,
      mailboxId,
      input: {
        name: "Retroactive stable version",
        enabled: true,
        matchKind: "sender",
        matchValue: sender,
        actions: [{ kind: "mark_read" }],
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const firstOperationId = crypto.randomUUID();
    const first = await startSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { operationId: firstOperationId, expectedRevision: created.data.revision },
    });
    if (!first.ok) throw new Error(first.error.message);
    expect(first.data).toMatchObject({ operationId: firstOperationId, matchedCount: 2 });
    const afterStart = await listSenderRules(ownerContext, mailboxId);
    if (!afterStart.ok) throw new Error(afterStart.error.message);
    expect(afterStart.data.find((rule) => rule.id === created.data.id)?.latestBackfillOperationId).toBe(firstOperationId);
    const firstComplete = await waitForBackfill(created.data.id, firstOperationId);
    expect(firstComplete).toMatchObject({
      state: "completed",
      matchedCount: 2,
      alreadyAcceptedCount: 0,
      newlyAcceptedCount: 2,
      remainingCount: 0,
      failureCount: 0,
    });

    const renamed = await updateSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: {
        expectedRevision: created.data.revision,
        name: "Renamed stable version",
        enabled: true,
        matchKind: created.data.matchKind,
        matchValue: created.data.matchValue,
        actions: created.data.actions,
      },
    });
    if (!renamed.ok) throw new Error(renamed.error.message);
    expect(renamed.data.workflowVersionId).toBe(created.data.workflowVersionId);

    const secondOperationId = crypto.randomUUID();
    const second = await startSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: renamed.data.id,
      input: { operationId: secondOperationId, expectedRevision: renamed.data.revision },
    });
    if (!second.ok) throw new Error(second.error.message);
    const secondComplete = await waitForBackfill(renamed.data.id, secondOperationId);
    expect(secondComplete).toMatchObject({
      state: "completed",
      matchedCount: 2,
      alreadyAcceptedCount: 2,
      newlyAcceptedCount: 0,
      remainingCount: 0,
    });

    const changed = await updateSenderRule({
      context: ownerContext,
      mailboxId,
      ruleId: renamed.data.id,
      input: {
        expectedRevision: renamed.data.revision,
        name: renamed.data.name,
        enabled: true,
        matchKind: renamed.data.matchKind,
        matchValue: renamed.data.matchValue,
        actions: [{ kind: "add_keyword", keyword: "backfilled" }],
      },
    });
    if (!changed.ok) throw new Error(changed.error.message);
    expect(changed.data.workflowVersionId).not.toBe(renamed.data.workflowVersionId);
    expect(changed.data.latestBackfillOperationId).toBeNull();
    const changedOperationId = crypto.randomUUID();
    const changedStarted = await startSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: changed.data.id,
      input: { operationId: changedOperationId, expectedRevision: changed.data.revision },
    });
    if (!changedStarted.ok) throw new Error(changedStarted.error.message);
    const changedComplete = await waitForBackfill(changed.data.id, changedOperationId);
    expect(changedComplete).toMatchObject({
      state: "completed",
      matchedCount: 2,
      alreadyAcceptedCount: 0,
      newlyAcceptedCount: 2,
      remainingCount: 0,
    });

    const canceledOperationId = crypto.randomUUID();
    const startedForCancel = await startSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: changed.data.id,
      input: { operationId: canceledOperationId, expectedRevision: changed.data.revision },
    });
    if (!startedForCancel.ok) throw new Error(startedForCancel.error.message);
    const canceled = await cancelSenderRuleBackfill({
      context: ownerContext,
      mailboxId,
      ruleId: changed.data.id,
      operationId: canceledOperationId,
    });
    if (!canceled.ok) throw new Error(canceled.error.message);
    expect(["completed", "canceled"]).toContain(canceled.data.state);
  });
});
