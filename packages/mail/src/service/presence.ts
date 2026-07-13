import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { ephemeral, type Lock, mutex } from "@valentinkolb/sync";
import { sql } from "bun";
import type { ConversationPresenceHeartbeat, ConversationPresenceMode } from "../contracts";
import { type MailRequestContext, userBackedActor } from "./auth";
import { requireMailboxCollaborationPermission } from "./collaboration";
import { currentMailboxUserIds, hasCurrentMailboxUserPermission } from "./collaborators";

const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;

type PresenceEntry = {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  peerId: string;
  mode: ConversationPresenceMode;
  joinedAt: number;
};

type ReplyLeaseEntry = {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  token: string;
  lock: Lock;
  acquiredAt: number;
};

export type ConversationPresenceParticipant = {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  mode: ConversationPresenceMode;
  peerCount: number;
  joinedAt: string;
};

export type ConversationReplyLease = {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  acquiredAt: string;
  expiresAt: string;
};

export type ConversationPresenceSnapshot = {
  participants: ConversationPresenceParticipant[];
  replyLease: ConversationReplyLease | null;
};

export type AcquiredReplyLease = ConversationReplyLease & { token: string };

const presenceStore = ephemeral<PresenceEntry>({
  id: "mail.conversation-presence",
  ttlMs: PRESENCE_TTL_MS,
  limits: { maxEntries: 250, maxPayloadBytes: 4_000 },
});

const replyLeaseStore = ephemeral<ReplyLeaseEntry>({
  id: "mail.conversation-reply-leases",
  ttlMs: PRESENCE_TTL_MS,
  limits: { maxEntries: 1, maxPayloadBytes: 4_000 },
});

const replyLeaseMutex = mutex({
  id: "mail:conversation-reply-leases",
  defaultTtl: PRESENCE_TTL_MS,
  retryCount: 0,
});

const replyLeaseStateMutex = mutex({
  id: "mail:conversation-reply-lease-state",
  defaultTtl: 5_000,
  retryCount: 3,
  retryDelay: 25,
});

const withReplyLeaseState = async <T>(conversationId: string, operation: () => Promise<Result<T>>): Promise<Result<T>> => {
  const result = await replyLeaseStateMutex.withLock(conversationId, operation, 5_000);
  return result ?? fail(err.conflict("Reply lease state is being updated; retry the request"));
};

const authorizeConversation = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  permission: "read" | "write";
}) => {
  const user = userBackedActor(params.context);
  if (!user) return fail(err.forbidden("Conversation presence requires a user-backed actor"));
  const allowed = await requireMailboxCollaborationPermission(params.context, params.mailboxId, params.permission);
  if (!allowed.ok) return allowed;
  const [conversation] = await sql<{ id: string }[]>`
    SELECT id FROM mail.conversations
    WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
  `;
  return conversation ? ok(user) : fail(err.notFound("Conversation"));
};

const summarizeParticipants = (entries: Array<{ value: PresenceEntry }>): ConversationPresenceParticipant[] => {
  const participants = new Map<string, ConversationPresenceParticipant>();
  for (const { value } of entries) {
    const current = participants.get(value.userId);
    if (current) {
      current.peerCount += 1;
      if (value.mode === "composing") current.mode = "composing";
      if (value.joinedAt < Date.parse(current.joinedAt)) current.joinedAt = new Date(value.joinedAt).toISOString();
      continue;
    }
    participants.set(value.userId, {
      userId: value.userId,
      displayName: value.displayName,
      avatarHash: value.avatarHash,
      mode: value.mode,
      peerCount: 1,
      joinedAt: new Date(value.joinedAt).toISOString(),
    });
  }
  return [...participants.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
};

const snapshotState = async (mailboxId: string, conversationId: string): Promise<ConversationPresenceSnapshot> => {
  const [presence, lease] = await Promise.all([
    presenceStore.snapshot({ tenantId: conversationId }),
    replyLeaseStore.snapshot({ tenantId: conversationId }),
  ]);
  const currentLease = lease.entries[0];
  const [readableUserIds, writableLeaseUserIds] = await Promise.all([
    currentMailboxUserIds({
      mailboxId,
      userIds: presence.entries.map((entry) => entry.value.userId),
      minimumPermission: "read",
    }),
    currentLease
      ? currentMailboxUserIds({ mailboxId, userIds: [currentLease.value.userId], minimumPermission: "write" })
      : Promise.resolve(new Set<string>()),
  ]);
  return {
    participants: summarizeParticipants(presence.entries.filter((entry) => readableUserIds.has(entry.value.userId))),
    replyLease:
      currentLease && writableLeaseUserIds.has(currentLease.value.userId)
        ? {
            userId: currentLease.value.userId,
            displayName: currentLease.value.displayName,
            avatarHash: currentLease.value.avatarHash,
            acquiredAt: new Date(currentLease.value.acquiredAt).toISOString(),
            expiresAt: new Date(currentLease.expiresAt).toISOString(),
          }
        : null,
  };
};

export const getConversationPresence = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
}): Promise<Result<ConversationPresenceSnapshot>> => {
  const allowed = await authorizeConversation({ ...params, permission: "read" });
  if (!allowed.ok) return allowed;
  return ok(await snapshotState(params.mailboxId, params.conversationId));
};

export const heartbeatConversationPresence = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: ConversationPresenceHeartbeat;
}): Promise<Result<ConversationPresenceSnapshot>> => {
  const user = await authorizeConversation({
    ...params,
    permission: params.input.mode === "composing" ? "write" : "read",
  });
  if (!user.ok) return user;
  const key = `${user.data.id}:${params.input.peerId}`;
  const state = await presenceStore.snapshot({ tenantId: params.conversationId, prefix: key });
  const joinedAt = state.entries.find((entry) => entry.key === key)?.value.joinedAt ?? Date.now();
  await presenceStore.upsert({
    tenantId: params.conversationId,
    key,
    value: {
      userId: user.data.id,
      displayName: user.data.displayName,
      avatarHash: user.data.avatarHash,
      peerId: params.input.peerId,
      mode: params.input.mode,
      joinedAt,
    },
  });
  return ok(await snapshotState(params.mailboxId, params.conversationId));
};

export const leaveConversationPresence = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  peerId: string;
}): Promise<Result<ConversationPresenceSnapshot>> => {
  const user = await authorizeConversation({ ...params, permission: "read" });
  if (!user.ok) return user;
  await presenceStore.remove({
    tenantId: params.conversationId,
    key: `${user.data.id}:${params.peerId}`,
    reason: "client-left",
  });
  return ok(await snapshotState(params.mailboxId, params.conversationId));
};

export const acquireConversationReplyLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
}): Promise<Result<AcquiredReplyLease>> => {
  const user = await authorizeConversation({ ...params, permission: "write" });
  if (!user.ok) return user;
  return withReplyLeaseState(params.conversationId, async () => {
    const current = (await replyLeaseStore.snapshot({ tenantId: params.conversationId })).entries[0]?.value;
    if (
      current &&
      !(await hasCurrentMailboxUserPermission({
        mailboxId: params.mailboxId,
        userId: current.userId,
        minimumPermission: "write",
      }))
    ) {
      await replyLeaseStore.remove({ tenantId: params.conversationId, key: "lease", reason: "access-revoked" });
      await replyLeaseMutex.release(current.lock).catch(() => undefined);
    }
    const lock = await replyLeaseMutex.acquire(params.conversationId, PRESENCE_TTL_MS);
    if (!lock) return fail(err.conflict("Another collaborator is already replying to this conversation"));
    const token = crypto.randomUUID();
    const acquiredAt = Date.now();
    try {
      const entry = await replyLeaseStore.upsert({
        tenantId: params.conversationId,
        key: "lease",
        value: {
          userId: user.data.id,
          displayName: user.data.displayName,
          avatarHash: user.data.avatarHash,
          token,
          lock,
          acquiredAt,
        },
      });
      return ok({
        token,
        userId: user.data.id,
        displayName: user.data.displayName,
        avatarHash: user.data.avatarHash,
        acquiredAt: new Date(acquiredAt).toISOString(),
        expiresAt: new Date(entry.expiresAt).toISOString(),
      });
    } catch (error) {
      await replyLeaseMutex.release(lock).catch(() => undefined);
      throw error;
    }
  });
};

const loadOwnedLease = async (conversationId: string, userId: string, token: string): Promise<ReplyLeaseEntry | null> => {
  const snapshot = await replyLeaseStore.snapshot({ tenantId: conversationId, prefix: "lease" });
  const lease = snapshot.entries.find((entry) => entry.key === "lease")?.value;
  return lease?.userId === userId && lease.token === token ? lease : null;
};

export const heartbeatConversationReplyLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  token: string;
}): Promise<Result<AcquiredReplyLease>> => {
  const user = await authorizeConversation({ ...params, permission: "write" });
  if (!user.ok) return user;
  return withReplyLeaseState(params.conversationId, async () => {
    const lease = await loadOwnedLease(params.conversationId, user.data.id, params.token);
    if (!lease) return fail(err.conflict("Reply lease is no longer owned by this client"));
    if (!(await replyLeaseMutex.extend(lease.lock, PRESENCE_TTL_MS))) {
      await replyLeaseStore.remove({ tenantId: params.conversationId, key: "lease", reason: "mutex-expired" });
      return fail(err.conflict("Reply lease expired"));
    }
    const entry = await replyLeaseStore.upsert({ tenantId: params.conversationId, key: "lease", value: lease });
    return ok({
      token: lease.token,
      userId: lease.userId,
      displayName: lease.displayName,
      avatarHash: lease.avatarHash,
      acquiredAt: new Date(lease.acquiredAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
    });
  });
};

export const releaseConversationReplyLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  token: string;
}): Promise<Result<ConversationPresenceSnapshot>> => {
  const user = await authorizeConversation({ ...params, permission: "write" });
  if (!user.ok) return user;
  return withReplyLeaseState(params.conversationId, async () => {
    const lease = await loadOwnedLease(params.conversationId, user.data.id, params.token);
    if (!lease) return fail(err.conflict("Reply lease is no longer owned by this client"));
    await replyLeaseStore.remove({ tenantId: params.conversationId, key: "lease", reason: "released" });
    await replyLeaseMutex.release(lease.lock);
    return ok(await snapshotState(params.mailboxId, params.conversationId));
  });
};
