import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import {
  createConversationComment,
  deleteConversationComment,
  getConversationCollaboration,
  listActivity,
  listAssignableUsers,
  listConversationComments,
  listMentionableUsers,
  setConversationWatcher,
  updateConversationCollaboration,
  updateConversationComment,
} from "./collaboration";
import type { ConnectorEnvelope } from "./connectors";
import { createMailbox } from "./mailboxes";
import { getConversationViewCounts, listConversations } from "./messages";
import { latestMailCollaborationEventCursor, liveMailCollaborationEvents } from "./events";
import { ingestEnvelope } from "./sync-runtime";

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
  requestId: `mail-collaboration-${user.uid}`,
});

suite("mail collaboration backend", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let conversationId = "";
  let messageId = "";
  let remoteResourceId = "";
  let folderId = "";
  let readerAccessId = "";
  let owner: { id: string; uid: string; displayName: string };
  let writer: { id: string; uid: string; displayName: string };
  let reader: { id: string; uid: string; displayName: string };
  let outsider: { id: string; uid: string; displayName: string };
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;
  let readerContext: MailRequestContext;
  let outsiderContext: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const createUser = async (role: string) => {
      const uid = `mail-collab-${role}-${suffix}`;
      const displayName = `${role[0]!.toUpperCase()}${role.slice(1)} Collaboration Test`;
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO auth.users (uid, provider, profile, display_name, admin)
        VALUES (${uid}, 'local', 'user', ${displayName}, false)
        RETURNING id
      `;
      if (!row) throw new Error(`Failed to create ${role} user`);
      userIds.push(row.id);
      return { id: row.id, uid, displayName };
    };
    owner = await createUser("owner");
    writer = await createUser("writer");
    reader = await createUser("reader");
    outsider = await createUser("outsider");
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);
    readerContext = contextFor(reader);
    outsiderContext = contextFor(outsider);

    const mailbox = await createMailbox(ownerContext, {
      name: `Collaboration ${suffix}`,
      description: "Disposable collaboration fixture",
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
    accessIds.push(writerAccess.data.id);
    const readerAccess = await grantMailboxAccess({
      context: ownerContext,
      mailboxId,
      principal: { type: "user", userId: reader.id },
      permission: "read",
    });
    if (!readerAccess.ok) throw new Error(readerAccess.error.message);
    readerAccessId = readerAccess.data.id;
    accessIds.push(readerAccessId);

    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint, status)
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${"a".repeat(64)}, 'active')
      RETURNING id
    `;
    remoteResourceId = resource!.id;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${remoteResourceId}::uuid, 'collaboration-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    folderId = folder!.id;
    const initialDate = new Date(Date.now() - 60 * 60_000);
    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, normalized_subject, internal_date, size_bytes, content_hash, hydration_status, plain_text
      ) VALUES (
        ${mailboxId}::uuid, ${`<collaboration-${suffix}@example.com>`}, 'Collaboration fixture', 'collaboration fixture',
        ${initialDate}, 128, ${"b".repeat(64)}, 'complete', 'Initial collaboration message'
      )
      RETURNING id
    `;
    messageId = message!.id;
    await sql`
      INSERT INTO mail.message_addresses (message_id, role, position, display_name, email, normalized_email)
      VALUES
        (${messageId}::uuid, 'from', 0, 'Customer', 'customer@example.com', 'customer@example.com'),
        (${messageId}::uuid, 'to', 0, 'Support', 'support@example.com', 'support@example.com')
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${folderId}::uuid, ${messageId}::uuid, 1, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES (${remoteRef!.id}::uuid, ${folderId}::uuid, ${messageId}::uuid, ARRAY[]::text[], ARRAY[]::text[])
    `;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO mail.conversations (
        mailbox_id, subject, participant_summary, latest_inbound_at, latest_message_at, response_needed
      ) VALUES (${mailboxId}::uuid, 'Collaboration fixture', 'customer@example.com', ${initialDate}, ${initialDate}, true)
      RETURNING id
    `;
    conversationId = conversation!.id;
    await sql`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
      VALUES (${conversationId}::uuid, ${messageId}::uuid, ${initialDate.getTime()}, 'headers')
    `;
  });

  afterAll(async () => {
    if (mailboxId) {
      const mailboxAccess = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
      `;
      accessIds.push(...mailboxAccess.map((row) => row.access_id));
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

  test("enforces permissions, revisions, comment history, views, and access revocation", async () => {
    const users = await listAssignableUsers({ context: readerContext, mailboxId, limit: 20 });
    expect(users.ok).toBe(true);
    if (!users.ok) return;
    expect(users.data.map((user) => user.id)).toContain(owner.id);
    expect(users.data.map((user) => user.id)).toContain(writer.id);
    expect(users.data.map((user) => user.id)).not.toContain(reader.id);
    expect(users.data.map((user) => user.id)).not.toContain(outsider.id);
    const mentionable = await listMentionableUsers({ context: readerContext, mailboxId, limit: 20 });
    expect(mentionable.ok && mentionable.data.map((user) => user.id)).toContain(reader.id);
    expect(mentionable.ok && mentionable.data.map((user) => user.id)).not.toContain(outsider.id);

    const deniedState = await updateConversationCollaboration({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 1, workStatus: "waiting" },
    });
    expect(deniedState.ok).toBe(false);
    if (!deniedState.ok) expect(deniedState.error.status).toBe(403);

    const invalidAssignee = await updateConversationCollaboration({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 1, assigneeUserId: reader.id },
    });
    expect(invalidAssignee.ok).toBe(false);
    const eventAbort = new AbortController();
    const eventCursor = (await latestMailCollaborationEventCursor(mailboxId)) ?? "0-0";
    const eventIterator = liveMailCollaborationEvents({ mailboxId, after: eventCursor, signal: eventAbort.signal })[Symbol.asyncIterator]();
    const nextEvent = eventIterator.next();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const waiting = await updateConversationCollaboration({
      context: writerContext,
      mailboxId,
      conversationId,
      input: {
        expectedRevision: 1,
        assigneeUserId: writer.id,
        workStatus: "waiting",
        responseNeeded: true,
        snoozedUntil: future,
      },
    });
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    expect(waiting.data).toMatchObject({ workStatus: "waiting", responseNeeded: true, revision: 2 });
    expect(waiting.data.assignee?.id).toBe(writer.id);
    const liveEvent = await Promise.race([
      nextEvent,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for Mail collaboration event")), 5_000)),
    ]);
    eventAbort.abort();
    expect(liveEvent.done).toBe(false);
    expect(liveEvent.value?.data).toMatchObject({
      mailboxId,
      conversationId,
      reason: "collaboration",
      activityId: expect.any(String),
    });

    const stale = await updateConversationCollaboration({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 1, workStatus: "open" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.status).toBe(409);
    const snoozedCounts = await getConversationViewCounts({ context: writerContext, mailboxId });
    expect(snoozedCounts.ok && snoozedCounts.data.snoozed).toBe(1);
    expect(snoozedCounts.ok && snoozedCounts.data.waiting).toBe(0);

    const unsnoozed = await updateConversationCollaboration({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 2, snoozedUntil: null },
    });
    expect(unsnoozed.ok).toBe(true);
    if (!unsnoozed.ok) return;
    const waitingCounts = await getConversationViewCounts({ context: writerContext, mailboxId });
    expect(waitingCounts.ok && waitingCounts.data.mine).toBe(1);
    expect(waitingCounts.ok && waitingCounts.data.waiting).toBe(1);

    const watched = await setConversationWatcher({
      context: writerContext,
      mailboxId,
      conversationId,
      userId: reader.id,
      watching: true,
    });
    expect(watched.ok && watched.data.watchers.map((watcher) => watcher.id)).toContain(reader.id);
    const deniedWatcher = await setConversationWatcher({
      context: readerContext,
      mailboxId,
      conversationId,
      userId: owner.id,
      watching: true,
    });
    expect(deniedWatcher.ok).toBe(false);

    const secretBody = `Internal secret ${suffix}`;
    const comment = await createConversationComment({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { body: secretBody, mentionUserIds: [writer.id], referencedMessageId: messageId },
    });
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    const invalidMention = await createConversationComment({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { body: "Cannot mention outsider", mentionUserIds: [outsider.id] },
    });
    expect(invalidMention.ok).toBe(false);
    const forbiddenEdit = await updateConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      commentId: comment.data.id,
      input: { expectedRevision: 1, body: "Writer overwrite", mentionUserIds: [] },
    });
    expect(forbiddenEdit.ok).toBe(false);
    if (!forbiddenEdit.ok) expect(forbiddenEdit.error.status).toBe(403);
    const edited = await updateConversationComment({
      context: readerContext,
      mailboxId,
      conversationId,
      commentId: comment.data.id,
      input: { expectedRevision: 1, body: "Edited internal context", mentionUserIds: [owner.id] },
    });
    expect(edited.ok && edited.data.revision).toBe(2);
    const reply = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Flat reply", parentCommentId: comment.data.id, mentionUserIds: [] },
    });
    expect(reply.ok && reply.data.parentCommentId).toBe(comment.data.id);
    const deleted = await deleteConversationComment({
      context: ownerContext,
      mailboxId,
      conversationId,
      commentId: comment.data.id,
      input: { expectedRevision: 2 },
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data).toMatchObject({ body: null, revision: 3 });
    const comments = await listConversationComments({ context: readerContext, mailboxId, conversationId, limit: 10 });
    expect(comments.ok && comments.data.items).toHaveLength(2);
    if (comments.ok) expect(comments.data.items[0]).toMatchObject({ id: comment.data.id, body: null, revision: 3 });
    const versions = await sql<{ revision: number; deleted: boolean }[]>`
      SELECT revision::int, deleted
      FROM mail.conversation_comment_versions
      WHERE comment_id = ${comment.data.id}::uuid
      ORDER BY revision
    `;
    expect(versions).toEqual([
      { revision: 1, deleted: false },
      { revision: 2, deleted: false },
      { revision: 3, deleted: true },
    ]);
    const activityMetadata = await sql<{ metadata: string }[]>`
      SELECT metadata::text
      FROM mail.activity_events
      WHERE conversation_id = ${conversationId}::uuid AND target_type = 'comment'
    `;
    expect(activityMetadata.map((row) => row.metadata).join(" ")).not.toContain(secretBody);
    expect(activityMetadata.map((row) => row.metadata).join(" ")).not.toContain("Edited internal context");
    const firstActivityPage = await listActivity({ context: readerContext, mailboxId, conversationId, limit: 2 });
    expect(firstActivityPage.ok && firstActivityPage.data.items).toHaveLength(2);
    expect(firstActivityPage.ok && firstActivityPage.data.nextCursor).not.toBeNull();
    if (!firstActivityPage.ok || !firstActivityPage.data.nextCursor) return;
    const secondActivityPage = await listActivity({
      context: readerContext,
      mailboxId,
      conversationId,
      limit: 2,
      cursor: firstActivityPage.data.nextCursor,
    });
    expect(secondActivityPage.ok).toBe(true);
    if (secondActivityPage.ok) {
      expect(secondActivityPage.data.items[0]?.id).not.toBe(firstActivityPage.data.items[0]?.id);
    }

    const completed = await updateConversationCollaboration({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 3, workStatus: "done" },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.data).toMatchObject({ workStatus: "done", responseNeeded: false, snoozedUntil: null, revision: 4 });

    const inbound: ConnectorEnvelope = {
      remoteRef: { folderStableKey: folderId, uidValidity: "1", uid: "2", modseq: null },
      providerMessageId: null,
      providerThreadId: null,
      messageId: `<collaboration-reply-${suffix}@example.com>`,
      inReplyTo: `<collaboration-${suffix}@example.com>`,
      references: [`<collaboration-${suffix}@example.com>`],
      subject: "Re: Collaboration fixture",
      sentAt: new Date(),
      internalDate: new Date(),
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
    };
    await ingestEnvelope({ db: sql, mailboxId, remoteResourceId, folderId, message: inbound });
    const reopened = await getConversationCollaboration({ context: writerContext, mailboxId, conversationId });
    expect(reopened.ok && reopened.data).toMatchObject({ workStatus: "open", responseNeeded: true, snoozedUntil: null, revision: 5 });
    const reopenActivity = await listActivity({ context: writerContext, mailboxId, conversationId, limit: 20 });
    expect(reopenActivity.ok && reopenActivity.data.items.some((event) => event.action === "conversation.reopened")).toBe(true);
    const mine = await listConversations({ context: writerContext, mailboxId, view: "mine" });
    expect(mine.ok && mine.data.items.map((item) => item.id)).toContain(conversationId);
    const inbox = await listConversations({ context: writerContext, mailboxId, view: "inbox" });
    expect(inbox.ok && inbox.data.items.map((item) => item.id)).toContain(conversationId);

    const revoked = await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: readerAccessId });
    expect(revoked.ok).toBe(true);
    const revokedRead = await listConversationComments({ context: readerContext, mailboxId, conversationId });
    expect(revokedRead.ok).toBe(false);
    const revokedMention = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "No stale mention", mentionUserIds: [reader.id] },
    });
    expect(revokedMention.ok).toBe(false);
    const filteredWatchers = await getConversationCollaboration({ context: writerContext, mailboxId, conversationId });
    expect(filteredWatchers.ok && filteredWatchers.data.watchers.map((watcher) => watcher.id)).not.toContain(reader.id);
    const removedStaleWatcher = await setConversationWatcher({
      context: writerContext,
      mailboxId,
      conversationId,
      userId: reader.id,
      watching: false,
    });
    expect(removedStaleWatcher.ok).toBe(true);
    const outsiderRead = await listActivity({ context: outsiderContext, mailboxId });
    expect(outsiderRead.ok).toBe(false);
  }, 30_000);
});
