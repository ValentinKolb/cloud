import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteWorkflowScope } from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { createMailbox } from "./mailboxes";
import {
  applySenderRuleToExisting,
  createSenderRule,
  deleteSenderRule,
  listSenderRules,
  markSenderMessagesRead,
  previewSenderRuleMatches,
  setSenderRuleEnabled,
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
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;
  let readerContext: MailRequestContext;

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
  });

  afterAll(async () => {
    if (mailboxId) {
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
        action: { kind: "mark_read" },
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
        action: { kind: "mark_read" },
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({
      name: "Read trusted sender",
      enabled: true,
      matchKind: "sender",
      matchValue: "external@example.test",
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
        action: { kind: "mark_read" },
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
        action: { kind: "mark_read" },
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
          action: { kind: "junk" },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        if (result.error.code !== "BAD_INPUT") throw new Error(`${result.error.code}: ${result.error.message}`);
        expect(result.error.code).toBe("BAD_INPUT");
      }
    }
  });

  test("uses read access for previews and write access for bounded sender actions", async () => {
    const preview = await previewSenderRuleMatches({
      context: readerContext,
      mailboxId,
      input: { matchKind: "sender", matchValue: "nobody@external.example" },
    });
    expect(preview).toEqual({
      ok: true,
      data: { messageCount: 0, conversationCount: 0, applicationLimit: 500, capped: false },
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
      data: { commandIds: [], messageCount: 0, applicationLimit: 500, capped: false },
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
        action: { kind: "mark_read" },
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const result = await applySenderRuleToExisting({
      context: ownerContext,
      mailboxId,
      ruleId: created.data.id,
      input: { expectedRevision: created.data.revision },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_INPUT");
  });
});
