import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { MailRequestContext } from "./auth";
import { releaseDueSnoozes } from "./collaboration";
import type { ConnectorEnvelope, ConnectorProtocolFacts } from "./connectors";
import { createMailbox } from "./mailboxes";
import { hydrateMessageFromSource } from "./message-hydration";
import { ingestEnvelope } from "./sync-runtime";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

const protocolFacts = (autoSubmitted: string | null): ConnectorProtocolFacts => ({
  returnPath: "<support@example.test>",
  autoSubmitted,
  precedence: null,
  listId: null,
  autoResponseSuppress: null,
  contentType: "text/plain; charset=utf-8",
  deliveryStatus: false,
});

suite("mail conversation work-state projection", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const mailboxIds: string[] = [];
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let remoteResourceId = "";
  let folderId = "";
  let senderIdentityId = "";
  let context: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const uid = `mail-work-state-${suffix}`;
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${uid}, 'local', 'user', 'Mail work-state test', false)
      RETURNING id
    `;
    if (!user) throw new Error("Failed to create Mail work-state test user");
    userIds.push(user.id);
    context = {
      actor: {
        kind: "user",
        user: {
          id: user.id,
          uid,
          provider: "local",
          profile: "user",
          displayName: "Mail work-state test",
          givenName: "Mail",
          sn: "Test",
          mail: `${uid}@example.test`,
          roles: ["user"],
          memberofGroupIds: [],
          memberofGroups: [],
        } as never,
      },
      accessSubject: { type: "user", userId: user.id },
      requestId: `mail-work-state-${suffix}`,
    };

    const mailbox = await createMailbox(context, { name: `Work state ${suffix}` });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    mailboxIds.push(mailboxId);
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint, status)
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${"c".repeat(64)}, 'active')
      RETURNING id
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, ${`work-state-${suffix}`}, 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    remoteResourceId = resource!.id;
    folderId = folder!.id;
    const [identity] = await sql<{ id: string }[]>`
      INSERT INTO mail.sender_identities (mailbox_id, display_name, from_address, is_default, status)
      VALUES (${mailboxId}::uuid, 'Support', 'support@example.test', true, 'verified')
      RETURNING id
    `;
    senderIdentityId = identity!.id;
  });

  afterAll(async () => {
    for (const id of mailboxIds) {
      const rows = await sql<{ access_id: string }[]>`SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${id}::uuid`;
      accessIds.push(...rows.map((row) => row.access_id));
      await sql`DELETE FROM mail.mailboxes WHERE id = ${id}::uuid`;
    }
    if (accessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${accessIds}::jsonb))`;
    }
    if (userIds.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))`;
    }
  });

  const envelope = (params: {
    uid: number;
    messageId: string;
    inReplyTo: string | null;
    from: string;
    to: string;
    date: Date;
    autoSubmitted?: string | null;
  }): ConnectorEnvelope => ({
    remoteRef: { folderStableKey: `work-state-${suffix}`, uidValidity: "1", uid: String(params.uid), modseq: null },
    providerMessageId: null,
    providerThreadId: null,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.inReplyTo ? [params.inReplyTo] : [],
    protocolFacts: protocolFacts(params.autoSubmitted ?? null),
    subject: params.inReplyTo ? "Re: Work-state projection" : "Work-state projection",
    sentAt: params.date,
    internalDate: params.date,
    sizeBytes: 256,
    flags: [],
    labels: [],
    addresses: {
      from: [{ name: null, address: params.from }],
      replyTo: [],
      to: [{ name: null, address: params.to }],
      cc: [],
      bcc: [],
    },
    mimeStructure: {},
  });

  const hydrate = async (messageId: string, source: readonly string[]) => {
    const body = Buffer.from([...source, "Content-Type: text/plain; charset=utf-8", "", "Work-state test body"].join("\r\n"));
    return hydrateMessageFromSource({ messageId, source: Readable.from([body]), expectedSize: body.byteLength });
  };

  test("projects verified inbound, automatic, and human replies deterministically", async () => {
    const initialMessageId = `<work-state-inbound-${suffix}@example.test>`;
    const initial = envelope({
      uid: 1,
      messageId: initialMessageId,
      inReplyTo: null,
      from: "customer@example.test",
      to: "support@example.test",
      date: new Date("2026-07-22T08:00:00.000Z"),
    });
    const initialId = await ingestEnvelope({ db: sql, mailboxId, remoteResourceId, folderId, message: initial });
    await hydrate(initialId, [
      `Message-ID: ${initialMessageId}`,
      "From: Customer <customer@example.test>",
      "To: Support <support@example.test>",
      `Subject: ${initial.subject}`,
    ]);
    const [link] = await sql<{ conversation_id: string }[]>`
      SELECT conversation_id FROM mail.conversation_messages WHERE message_id = ${initialId}::uuid
    `;
    if (!link) throw new Error("Initial message was not linked to a conversation");
    const futureSnooze = new Date(Date.now() + 60 * 60_000).toISOString();
    await sql`
      UPDATE mail.conversations
      SET work_status = 'done', snoozed_until = ${futureSnooze}::timestamptz, revision = revision + 1
      WHERE id = ${link.conversation_id}::uuid
    `;

    const automaticMessageId = `<work-state-automatic-${suffix}@example.test>`;
    const automatic = envelope({
      uid: 2,
      messageId: automaticMessageId,
      inReplyTo: initialMessageId,
      from: "support@example.test",
      to: "customer@example.test",
      date: new Date("2026-07-22T08:01:00.000Z"),
      autoSubmitted: "auto-replied",
    });
    const automaticId = await ingestEnvelope({ db: sql, mailboxId, remoteResourceId, folderId, message: automatic });
    await hydrate(automaticId, [
      `Message-ID: ${automaticMessageId}`,
      `In-Reply-To: ${initialMessageId}`,
      "Auto-Submitted: auto-replied",
      "From: Support <support@example.test>",
      "To: Customer <customer@example.test>",
      `Subject: ${automatic.subject}`,
    ]);
    const [afterAutomatic] = await sql<{ work_status: string; snoozed_until: Date | string | null }[]>`
      SELECT work_status, snoozed_until FROM mail.conversations WHERE id = ${link.conversation_id}::uuid
    `;
    expect(afterAutomatic?.work_status).toBe("done");
    expect(new Date(afterAutomatic!.snoozed_until!).toISOString()).toBe(futureSnooze);

    await sql`UPDATE mail.sender_identities SET status = 'disabled', is_default = false WHERE id = ${senderIdentityId}::uuid`;

    const replyMessageId = `<work-state-reply-${suffix}@example.test>`;
    const reply = envelope({
      uid: 3,
      messageId: replyMessageId,
      inReplyTo: automaticMessageId,
      from: "support@example.test",
      to: "customer@example.test",
      date: new Date("2026-07-22T08:02:00.000Z"),
      autoSubmitted: "no",
    });
    const replyId = await ingestEnvelope({ db: sql, mailboxId, remoteResourceId, folderId, message: reply });
    await hydrate(replyId, [
      `Message-ID: ${replyMessageId}`,
      `In-Reply-To: ${automaticMessageId}`,
      "Auto-Submitted: no",
      "From: Support <support@example.test>",
      "To: Customer <customer@example.test>",
      `Subject: ${reply.subject}`,
    ]);
    const [afterReply] = await sql<{ work_status: string; snoozed_until: Date | string | null }[]>`
      SELECT work_status, snoozed_until FROM mail.conversations WHERE id = ${link.conversation_id}::uuid
    `;
    expect(afterReply?.work_status).toBe("waiting");
    expect(new Date(afterReply!.snoozed_until!).toISOString()).toBe(futureSnooze);

    const inboundMessageId = `<work-state-return-${suffix}@example.test>`;
    const inbound = envelope({
      uid: 4,
      messageId: inboundMessageId,
      inReplyTo: replyMessageId,
      from: "customer@example.test",
      to: "support@example.test",
      date: new Date("2026-07-22T08:03:00.000Z"),
    });
    const inboundId = await ingestEnvelope({ db: sql, mailboxId, remoteResourceId, folderId, message: inbound });
    await hydrate(inboundId, [
      `Message-ID: ${inboundMessageId}`,
      `In-Reply-To: ${replyMessageId}`,
      "From: Customer <customer@example.test>",
      "To: Support <support@example.test>",
      `Subject: ${inbound.subject}`,
    ]);
    const [afterInbound] = await sql<{ work_status: string; snoozed_until: Date | string | null }[]>`
      SELECT work_status, snoozed_until FROM mail.conversations WHERE id = ${link.conversation_id}::uuid
    `;
    expect(afterInbound).toEqual({ work_status: "needs_action", snoozed_until: null });
  }, 30_000);

  test("releases due snoozes once without changing their work state", async () => {
    const [conversation] = await sql<{ id: string; revision: number }[]>`
      INSERT INTO mail.conversations (
        mailbox_id, subject, participant_summary, latest_message_at, work_status, snoozed_until
      ) VALUES (
        ${mailboxId}::uuid,
        'Expired snooze',
        'customer@example.test',
        now(),
        'waiting',
        now() - interval '1 minute'
      )
      RETURNING id, revision::int AS revision
    `;
    const released = await releaseDueSnoozes(10);
    expect(released).toBeGreaterThanOrEqual(1);
    const [state] = await sql<{ work_status: string; snoozed_until: null; revision: number; activities: number }[]>`
      SELECT
        conversation.work_status,
        conversation.snoozed_until,
        conversation.revision::int AS revision,
        (
          SELECT COUNT(*)::int
          FROM mail.activity_events activity
          WHERE activity.conversation_id = conversation.id
            AND activity.action = 'conversation.snooze_expired'
        ) AS activities
      FROM mail.conversations conversation
      WHERE conversation.id = ${conversation!.id}::uuid
    `;
    expect(state).toEqual({
      work_status: "waiting",
      snoozed_until: null,
      revision: conversation!.revision + 1,
      activities: 1,
    });
    expect(await releaseDueSnoozes(10)).toBe(0);
    expect(releaseDueSnoozes(0)).rejects.toThrow("positive safe integer");
  }, 30_000);
});
