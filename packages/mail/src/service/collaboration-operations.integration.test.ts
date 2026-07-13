import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { app } from "../config";
import { migrate } from "../migrate";
import { createMailNotificationService, type MailNotificationSendInput } from "../notifications";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import {
  createConversationComment,
  getConversationCollaboration,
  listActivity,
  listConversationComments,
  updateConversationComment,
} from "./collaboration";
import { createMailbox } from "./mailboxes";
import {
  acquireConversationReplyLease,
  getConversationPresence,
  heartbeatConversationPresence,
  heartbeatConversationReplyLease,
  leaveConversationPresence,
  releaseConversationReplyLease,
} from "./presence";
import { cancelConversationReminder, getConversationReminder, setConversationReminder } from "./reminders";
import {
  createSavedConversationView,
  deleteSavedConversationView,
  listSavedConversationViews,
  listSavedViewConversations,
  updateSavedConversationView,
} from "./saved-views";

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
      mail: `${user.uid}@example.com`,
      roles: ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-collaboration-operations-${user.uid}`,
});

suite("mail collaboration operations", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let remoteResourceId = "";
  let conversationId = "";
  let writerAccessId = "";
  let readerAccessId = "";
  let owner: TestUser;
  let writer: TestUser;
  let reader: TestUser;
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;
  let readerContext: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const createUser = async (role: string): Promise<TestUser> => {
      const uid = `mail-ops-${role}-${suffix}`;
      const displayName = `${role[0]!.toUpperCase()}${role.slice(1)} Mail Operations`;
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
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);
    readerContext = contextFor(reader);

    const mailbox = await createMailbox(ownerContext, {
      name: `Collaboration operations ${suffix}`,
      description: "Disposable collaboration operations fixture",
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
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${"d".repeat(64)}, 'active')
      RETURNING id
    `;
    remoteResourceId = resource!.id;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, 'operations-inbox', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    const messageDate = new Date(Date.now() - 60_000);
    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, normalized_subject, internal_date, size_bytes, content_hash, hydration_status, plain_text
      ) VALUES (
        ${mailboxId}::uuid,
        ${`<mail-ops-${suffix}@example.com>`},
        'Collaboration operations',
        'collaboration operations',
        ${messageDate},
        128,
        ${"e".repeat(64)},
        'complete',
        'Collaboration operations body'
      )
      RETURNING id
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${folder!.id}::uuid, ${message!.id}::uuid, 1, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES (${remoteRef!.id}::uuid, ${folder!.id}::uuid, ${message!.id}::uuid, ARRAY[]::text[], ARRAY[]::text[])
    `;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO mail.conversations (
        mailbox_id, subject, participant_summary, latest_message_at, assignee_user_id, work_status, response_needed
      ) VALUES (
        ${mailboxId}::uuid,
        'Collaboration operations',
        'customer@example.com',
        ${messageDate},
        ${writer.id}::uuid,
        'open',
        true
      )
      RETURNING id
    `;
    conversationId = conversation!.id;
    await sql`
      INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
      VALUES (${conversationId}::uuid, ${message!.id}::uuid, ${messageDate.getTime()}, 'headers')
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

  test("recovers notifications and enforces reminder, view, presence, and lease invariants", async () => {
    const sent: MailNotificationSendInput[] = [];
    const notificationService = createMailNotificationService(app.notifications, {
      sender: async (input) => {
        sent.push(input);
      },
    });

    const comment = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Reader mention", mentionUserIds: [reader.id] },
    });
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    expect(comment.data.mentionUserIds).toEqual([reader.id]);
    const edited = await updateConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      commentId: comment.data.id,
      input: { expectedRevision: 1, body: "Reader and owner mention", mentionUserIds: [reader.id, owner.id] },
    });
    expect(edited.ok && edited.data.revision).toBe(2);
    expect(edited.ok && edited.data.mentionUserIds).toEqual([owner.id, reader.id].sort());
    const mentionDeliveries = await sql<{ recipient_user_id: string }[]>`
      SELECT recipient_user_id
      FROM mail.collaboration_notification_deliveries
      WHERE kind = 'mention' AND source_id = ${comment.data.id}::uuid AND state = 'pending'
      ORDER BY recipient_user_id
    `;
    expect(mentionDeliveries.map((row) => row.recipient_user_id).sort()).toEqual([owner.id, reader.id].sort());
    const mentionRecovery = await notificationService.recover();
    expect(mentionRecovery).toMatchObject({ scanned: 2, sent: 2, skipped: 0, failed: 0 });
    expect(
      sent
        .filter((item) => item.kind === "mention")
        .map((item) => item.recipientUserId)
        .sort(),
    ).toEqual([owner.id, reader.id].sort());
    expect([...new Set(sent.filter((item) => item.kind === "mention").map((item) => item.commentId))]).toEqual([comment.data.id]);

    const retryComment = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Recover a transient notification failure", mentionUserIds: [owner.id] },
    });
    expect(retryComment.ok).toBe(true);
    let failedOnce = false;
    const failingService = createMailNotificationService(app.notifications, {
      sender: async () => {
        failedOnce = true;
        throw new Error("Transient notification failure");
      },
    });
    const failedRecovery = await failingService.recover();
    expect(failedRecovery).toMatchObject({ scanned: 1, sent: 0, skipped: 0, failed: 1 });
    expect(failedOnce).toBe(true);
    if (retryComment.ok) {
      await sql`
        UPDATE mail.collaboration_notification_deliveries
        SET available_at = now()
        WHERE kind = 'mention' AND source_id = ${retryComment.data.id}::uuid AND state = 'pending'
      `;
    }
    const retriedRecovery = await notificationService.recover();
    expect(retriedRecovery).toMatchObject({ scanned: 1, sent: 1, skipped: 0, failed: 0 });

    const queuedComment = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Claim only inside the delivery worker", mentionUserIds: [owner.id] },
    });
    expect(queuedComment.ok).toBe(true);
    let markWorkerStarted: () => void = () => undefined;
    let releaseWorker: () => void = () => undefined;
    const workerStarted = new Promise<void>((resolve) => {
      markWorkerStarted = resolve;
    });
    const workerReleased = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    const dispatchService = createMailNotificationService(app.notifications, {
      jobId: `mail:test-collaboration-notification-delivery:${suffix}`,
      sender: async () => {
        markWorkerStarted();
        await workerReleased;
      },
    });
    expect(await dispatchService.dispatch({ limit: 1 })).toEqual({ reserved: 1, enqueued: 1 });
    await workerStarted;
    if (queuedComment.ok) {
      const [claimedInWorker] = await sql<{ state: string; claimed: boolean }[]>`
        SELECT state, claim_id IS NOT NULL AND claimed_at IS NOT NULL AS claimed
        FROM mail.collaboration_notification_deliveries
        WHERE kind = 'mention' AND source_id = ${queuedComment.data.id}::uuid
      `;
      expect(claimedInWorker).toEqual({ state: "sending", claimed: true });
    }
    expect(await dispatchService.dispatch({ limit: 1 })).toEqual({ reserved: 0, enqueued: 0 });
    releaseWorker();
    if (queuedComment.ok) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [delivery] = await sql<{ state: string }[]>`
          SELECT state
          FROM mail.collaboration_notification_deliveries
          WHERE kind = 'mention' AND source_id = ${queuedComment.data.id}::uuid
        `;
        if (delivery?.state === "sent") break;
        await Bun.sleep(10);
      }
      const [completedInWorker] = await sql<{ state: string }[]>`
        SELECT state
        FROM mail.collaboration_notification_deliveries
        WHERE kind = 'mention' AND source_id = ${queuedComment.data.id}::uuid
      `;
      expect(completedInWorker?.state).toBe("sent");
    }
    await dispatchService.stop();

    const removedMention = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Mention removed before delivery", mentionUserIds: [owner.id] },
    });
    expect(removedMention.ok).toBe(true);
    let staleMentionDispatchStarted: () => void = () => undefined;
    let releaseStaleMentionDispatch: () => void = () => undefined;
    const staleMentionStarted = new Promise<void>((resolve) => {
      staleMentionDispatchStarted = resolve;
    });
    const staleMentionReleased = new Promise<void>((resolve) => {
      releaseStaleMentionDispatch = resolve;
    });
    const staleMentionInputs: MailNotificationSendInput[] = [];
    const staleMentionService = createMailNotificationService(app.notifications, {
      sender: async (input) => {
        staleMentionInputs.push(input);
        staleMentionDispatchStarted();
        await staleMentionReleased;
        throw new Error("Stale mention delivery failed after comment edit");
      },
    });
    const staleMentionRecovery = staleMentionService.recover();
    await staleMentionStarted;
    if (removedMention.ok) {
      const removeDuringDispatch = await updateConversationComment({
        context: writerContext,
        mailboxId,
        conversationId,
        commentId: removedMention.data.id,
        input: { expectedRevision: 1, body: "Mention removed before delivery", mentionUserIds: [] },
      });
      expect(removeDuringDispatch.ok).toBe(false);
      if (!removeDuringDispatch.ok) expect(removeDuringDispatch.error.status).toBe(409);
    }
    releaseStaleMentionDispatch();
    expect(await staleMentionRecovery).toMatchObject({ scanned: 1, sent: 0, skipped: 0, failed: 1 });
    if (removedMention.ok) {
      const removed = await updateConversationComment({
        context: writerContext,
        mailboxId,
        conversationId,
        commentId: removedMention.data.id,
        input: { expectedRevision: 1, body: "Mention removed before delivery", mentionUserIds: [] },
      });
      expect(removed.ok).toBe(true);
      const readded = await updateConversationComment({
        context: writerContext,
        mailboxId,
        conversationId,
        commentId: removedMention.data.id,
        input: { expectedRevision: 2, body: "Mention added again", mentionUserIds: [owner.id] },
      });
      expect(readded.ok).toBe(true);
    }
    const readdedMentionRecovery = await notificationService.recover();
    expect(readdedMentionRecovery).toMatchObject({ scanned: 1, sent: 1, skipped: 0, failed: 0 });
    const deliveredReaddedMentions = sent.filter((item) => item.commentId === (removedMention.ok ? removedMention.data.id : ""));
    expect(deliveredReaddedMentions).toHaveLength(1);
    expect(deliveredReaddedMentions[0]?.idempotencyKey).toBe(staleMentionInputs[0]?.idempotencyKey);
    const staleMentionRetry = await notificationService.recover();
    expect(staleMentionRetry).toMatchObject({ scanned: 0, sent: 0, skipped: 0, failed: 0 });

    const dueAt = new Date(Date.now() - 1_000).toISOString();
    const reminder = await setConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { dueAt, expectedRevision: null },
    });
    expect(reminder.ok && reminder.data.revision).toBe(1);
    const duplicateCreate = await setConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { dueAt, expectedRevision: null },
    });
    expect(duplicateCreate.ok).toBe(false);
    if (!duplicateCreate.ok) expect(duplicateCreate.error.status).toBe(409);
    const rescheduled = await setConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { dueAt, expectedRevision: 1 },
    });
    expect(rescheduled.ok && rescheduled.data.revision).toBe(2);
    const reminderRecovery = await notificationService.recover();
    expect(reminderRecovery).toMatchObject({ scanned: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sent.filter((item) => item.kind === "reminder")).toHaveLength(1);
    const deliveredReminder = await getConversationReminder({ context: writerContext, mailboxId, conversationId });
    expect(deliveredReminder.ok && deliveredReminder.data).toMatchObject({ state: "sent", revision: 2 });
    const resetReminder = await setConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { dueAt: new Date(Date.now() + 60_000).toISOString(), expectedRevision: 2 },
    });
    expect(resetReminder.ok && resetReminder.data.revision).toBe(3);
    const canceledReminder = await cancelConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 3 },
    });
    expect(canceledReminder.ok && canceledReminder.data).toMatchObject({ state: "canceled", revision: 4 });
    const dispatchReminder = await setConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { dueAt, expectedRevision: 4 },
    });
    expect(dispatchReminder.ok && dispatchReminder.data.revision).toBe(5);
    let markDispatchStarted: () => void = () => undefined;
    let releaseDispatch: () => void = () => undefined;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const dispatchReleased = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const blockingNotificationService = createMailNotificationService(app.notifications, {
      sender: async () => {
        markDispatchStarted();
        await dispatchReleased;
      },
    });
    const dispatchRecovery = blockingNotificationService.recover();
    await dispatchStarted;
    const cancelDuringDispatch = await cancelConversationReminder({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { expectedRevision: 5 },
    });
    expect(cancelDuringDispatch.ok).toBe(false);
    if (!cancelDuringDispatch.ok) expect(cancelDuringDispatch.error.status).toBe(409);
    releaseDispatch();
    expect(await dispatchRecovery).toMatchObject({ scanned: 1, sent: 1, skipped: 0, failed: 0 });
    if (reminder.ok) {
      const [activity] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM mail.activity_events
        WHERE target_type = 'reminder' AND target_id = ${reminder.data.id}::uuid
      `;
      expect(activity?.count).toBe(0);
    }

    const privateView = await createSavedConversationView({
      context: readerContext,
      mailboxId,
      input: { scope: "private", name: "My open mail", filter: { workStatuses: ["open"] } },
    });
    expect(privateView.ok).toBe(true);
    if (!privateView.ok) return;
    const [privateViewActivity] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.activity_events
      WHERE target_type = 'saved_conversation_view' AND target_id = ${privateView.data.id}::uuid
    `;
    expect(privateViewActivity?.count).toBe(0);
    const deniedMailboxView = await createSavedConversationView({
      context: readerContext,
      mailboxId,
      input: { scope: "mailbox", name: "Reader team view", filter: {} },
    });
    expect(deniedMailboxView.ok).toBe(false);
    const invalidAssigneeView = await createSavedConversationView({
      context: writerContext,
      mailboxId,
      input: { scope: "mailbox", name: "Invalid assignee", filter: { assignee: { kind: "user", userId: reader.id } } },
    });
    expect(invalidAssigneeView.ok).toBe(false);
    const mailboxView = await createSavedConversationView({
      context: writerContext,
      mailboxId,
      input: { scope: "mailbox", name: "Assigned to me", filter: { assignee: { kind: "me" }, workStatuses: ["open"] } },
    });
    expect(mailboxView.ok).toBe(true);
    if (!mailboxView.ok) return;
    const [mailboxViewActivity] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.activity_events
      WHERE target_type = 'saved_conversation_view' AND target_id = ${mailboxView.data.id}::uuid
    `;
    expect(mailboxViewActivity?.count).toBe(1);
    const writerViews = await listSavedConversationViews({ context: writerContext, mailboxId });
    expect(writerViews.ok && writerViews.data.map((view) => view.id)).toContain(mailboxView.data.id);
    expect(writerViews.ok && writerViews.data.map((view) => view.id)).not.toContain(privateView.data.id);
    const readerViews = await listSavedConversationViews({ context: readerContext, mailboxId });
    expect(readerViews.ok && readerViews.data.map((view) => view.id).sort()).toEqual([privateView.data.id, mailboxView.data.id].sort());
    const writerQueue = await listSavedViewConversations({
      context: writerContext,
      mailboxId,
      viewId: mailboxView.data.id,
    });
    expect(writerQueue.ok && writerQueue.data.items.map((item) => item.id)).toContain(conversationId);
    const ownerQueue = await listSavedViewConversations({ context: ownerContext, mailboxId, viewId: mailboxView.data.id });
    expect(ownerQueue.ok && ownerQueue.data.items.map((item) => item.id)).not.toContain(conversationId);
    const staleViewUpdate = await updateSavedConversationView({
      context: writerContext,
      mailboxId,
      viewId: mailboxView.data.id,
      input: { expectedRevision: 2, name: "Stale" },
    });
    expect(staleViewUpdate.ok).toBe(false);
    if (!staleViewUpdate.ok) expect(staleViewUpdate.error.status).toBe(409);
    const updatedView = await updateSavedConversationView({
      context: writerContext,
      mailboxId,
      viewId: mailboxView.data.id,
      input: { expectedRevision: 1, name: "My active assignments" },
    });
    expect(updatedView.ok && updatedView.data.revision).toBe(2);
    const deletedPrivateView = await deleteSavedConversationView({
      context: readerContext,
      mailboxId,
      viewId: privateView.data.id,
      expectedRevision: 1,
    });
    expect(deletedPrivateView.ok).toBe(true);

    const readerPeerId = crypto.randomUUID();
    const writerPeerId = crypto.randomUUID();
    const readerPresence = await heartbeatConversationPresence({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { peerId: readerPeerId, mode: "viewing" },
    });
    expect(readerPresence.ok).toBe(true);
    const deniedComposing = await heartbeatConversationPresence({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { peerId: readerPeerId, mode: "composing" },
    });
    expect(deniedComposing.ok).toBe(false);
    const writerPresence = await heartbeatConversationPresence({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { peerId: writerPeerId, mode: "composing" },
    });
    expect(writerPresence.ok && writerPresence.data.participants).toHaveLength(2);
    const snapshot = await getConversationPresence({ context: ownerContext, mailboxId, conversationId });
    expect(snapshot.ok && snapshot.data.participants.find((participant) => participant.userId === writer.id)?.mode).toBe("composing");

    const writerLease = await acquireConversationReplyLease({ context: writerContext, mailboxId, conversationId });
    expect(writerLease.ok).toBe(true);
    if (!writerLease.ok) return;
    const competingLease = await acquireConversationReplyLease({ context: ownerContext, mailboxId, conversationId });
    expect(competingLease.ok).toBe(false);
    const wrongHeartbeat = await heartbeatConversationReplyLease({
      context: writerContext,
      mailboxId,
      conversationId,
      token: crypto.randomUUID(),
    });
    expect(wrongHeartbeat.ok).toBe(false);
    const leaseHeartbeat = await heartbeatConversationReplyLease({
      context: writerContext,
      mailboxId,
      conversationId,
      token: writerLease.data.token,
    });
    expect(leaseHeartbeat.ok).toBe(true);
    const released = await releaseConversationReplyLease({
      context: writerContext,
      mailboxId,
      conversationId,
      token: writerLease.data.token,
    });
    expect(released.ok && released.data.replyLease).toBeNull();
    const ownerLease = await acquireConversationReplyLease({ context: ownerContext, mailboxId, conversationId });
    expect(ownerLease.ok).toBe(true);
    if (ownerLease.ok) {
      await releaseConversationReplyLease({
        context: ownerContext,
        mailboxId,
        conversationId,
        token: ownerLease.data.token,
      });
    }
    await leaveConversationPresence({ context: writerContext, mailboxId, conversationId, peerId: writerPeerId });
    await leaveConversationPresence({ context: readerContext, mailboxId, conversationId, peerId: readerPeerId });

    const revokedComment = await createConversationComment({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { body: "Mention before access revocation", mentionUserIds: [reader.id] },
    });
    expect(revokedComment.ok).toBe(true);
    const staleReaderPresence = await heartbeatConversationPresence({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { peerId: readerPeerId, mode: "viewing" },
    });
    expect(staleReaderPresence.ok).toBe(true);
    const revoked = await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: readerAccessId });
    expect(revoked.ok).toBe(true);
    const revokedRecovery = await notificationService.recover();
    expect(revokedRecovery).toMatchObject({ scanned: 1, sent: 0, skipped: 1, failed: 0 });
    const snapshotAfterReaderRevocation = await getConversationPresence({ context: ownerContext, mailboxId, conversationId });
    expect(
      snapshotAfterReaderRevocation.ok &&
        snapshotAfterReaderRevocation.data.participants.some((participant) => participant.userId === reader.id),
    ).toBe(false);
    const deniedAfterRevocation = await heartbeatConversationPresence({
      context: readerContext,
      mailboxId,
      conversationId,
      input: { peerId: readerPeerId, mode: "viewing" },
    });
    expect(deniedAfterRevocation.ok).toBe(false);

    const staleWriterPresence = await heartbeatConversationPresence({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { peerId: writerPeerId, mode: "composing" },
    });
    expect(staleWriterPresence.ok).toBe(true);
    const staleWriterLease = await acquireConversationReplyLease({ context: writerContext, mailboxId, conversationId });
    expect(staleWriterLease.ok).toBe(true);
    const revokedWriter = await revokeMailboxAccess({ context: ownerContext, mailboxId, accessId: writerAccessId });
    expect(revokedWriter.ok).toBe(true);
    const snapshotAfterWriterRevocation = await getConversationPresence({ context: ownerContext, mailboxId, conversationId });
    expect(
      snapshotAfterWriterRevocation.ok &&
        snapshotAfterWriterRevocation.data.participants.some((participant) => participant.userId === writer.id),
    ).toBe(false);
    expect(snapshotAfterWriterRevocation.ok && snapshotAfterWriterRevocation.data.replyLease).toBeNull();
    const recoveredOwnerLease = await acquireConversationReplyLease({ context: ownerContext, mailboxId, conversationId });
    expect(recoveredOwnerLease.ok).toBe(true);
    if (recoveredOwnerLease.ok) {
      await releaseConversationReplyLease({
        context: ownerContext,
        mailboxId,
        conversationId,
        token: recoveredOwnerLease.data.token,
      });
    }

    const restoredWriterAccess = await grantMailboxAccess({
      context: ownerContext,
      mailboxId,
      principal: { type: "user", userId: writer.id },
      permission: "write",
    });
    expect(restoredWriterAccess.ok).toBe(true);
    if (!restoredWriterAccess.ok) return;
    accessIds.push(restoredWriterAccess.data.id);
    await sql`UPDATE mail.mailboxes SET connection_policy = 'personal_provider_account' WHERE id = ${mailboxId}::uuid`;

    const addPersonalBinding = async (user: TestUser): Promise<string> => {
      const [connection] = await sql<{ id: string }[]>`
        INSERT INTO mail.provider_connections (
          owner_user_id, name, email, username,
          imap_host, imap_port, imap_tls_mode,
          smtp_host, smtp_port, smtp_tls_mode,
          secret_kind, encrypted_secret, status
        ) VALUES (
          ${user.id}::uuid,
          ${`Personal provider ${user.uid}`},
          ${`${user.uid}@example.com`},
          ${user.uid},
          'imap.example.com', 993, 'implicit',
          'smtp.example.com', 465, 'implicit',
          'password', 'encrypted-test-secret', 'active'
        )
        RETURNING id
      `;
      const [binding] = await sql<{ id: string }[]>`
        INSERT INTO mail.provider_bindings (
          remote_resource_id, connection_id, state, remote_locator,
          verified_scope_fingerprint, verified_secret_revision
        ) VALUES (
          ${remoteResourceId}::uuid,
          ${connection!.id}::uuid,
          'active',
          '{}'::jsonb,
          ${"d".repeat(64)},
          1
        )
        RETURNING id
      `;
      return binding!.id;
    };

    await addPersonalBinding(owner);
    const writerBindingId = await addPersonalBinding(writer);
    const personalPeerId = crypto.randomUUID();
    const personalPresence = await heartbeatConversationPresence({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { peerId: personalPeerId, mode: "composing" },
    });
    expect(personalPresence.ok).toBe(true);
    const personalLease = await acquireConversationReplyLease({ context: writerContext, mailboxId, conversationId });
    expect(personalLease.ok).toBe(true);
    const bindingMention = await createConversationComment({
      context: ownerContext,
      mailboxId,
      conversationId,
      input: { body: "Mention before personal binding revocation", mentionUserIds: [writer.id] },
    });
    expect(bindingMention.ok).toBe(true);

    await sql`
      UPDATE mail.provider_bindings
      SET state = 'revoked'
      WHERE id = ${writerBindingId}::uuid
    `;
    const revokedBindingRecovery = await notificationService.recover();
    expect(revokedBindingRecovery).toMatchObject({ scanned: 1, sent: 0, skipped: 1, failed: 0 });
    const snapshotAfterBindingRevocation = await getConversationPresence({ context: ownerContext, mailboxId, conversationId });
    expect(
      snapshotAfterBindingRevocation.ok &&
        snapshotAfterBindingRevocation.data.participants.some((participant) => participant.userId === writer.id),
    ).toBe(false);
    expect(snapshotAfterBindingRevocation.ok && snapshotAfterBindingRevocation.data.replyLease).toBeNull();
    const deniedAfterBindingRevocation = await heartbeatConversationPresence({
      context: writerContext,
      mailboxId,
      conversationId,
      input: { peerId: personalPeerId, mode: "viewing" },
    });
    expect(deniedAfterBindingRevocation.ok).toBe(false);
    expect((await getConversationCollaboration({ context: writerContext, mailboxId, conversationId })).ok).toBe(false);
    expect((await listConversationComments({ context: writerContext, mailboxId, conversationId })).ok).toBe(false);
    expect((await listActivity({ context: writerContext, mailboxId, conversationId })).ok).toBe(false);
    const ownerLeaseAfterBindingRevocation = await acquireConversationReplyLease({
      context: ownerContext,
      mailboxId,
      conversationId,
    });
    expect(ownerLeaseAfterBindingRevocation.ok).toBe(true);
    if (ownerLeaseAfterBindingRevocation.ok) {
      await releaseConversationReplyLease({
        context: ownerContext,
        mailboxId,
        conversationId,
        token: ownerLeaseAfterBindingRevocation.data.token,
      });
    }
  }, 30_000);
});
