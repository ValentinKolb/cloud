import { type AccessUser, listUsersWithAccess, type PermissionLevel } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  ActorRef,
  CreateConversationComment,
  DeleteConversationComment,
  UpdateConversationCollaboration,
  UpdateConversationComment,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, type MailRequestContext } from "./auth";
import { publishMailCollaborationEvent, type MailCollaborationEvent } from "./events";

type SqlClient = typeof sql;
type CommentActorKind = "user" | "service_account";

export type MailCollaborator = {
  id: string;
  uid: string;
  displayName: string;
  avatarHash: string | null;
};

export type MailAssignableUser = MailCollaborator & {
  permission: Exclude<PermissionLevel, "none">;
  description: string;
};

export type ConversationCollaboration = {
  conversationId: string;
  assignee: MailCollaborator | null;
  workStatus: "open" | "waiting" | "done";
  responseNeeded: boolean;
  snoozedUntil: string | null;
  revision: number;
  watchers: MailCollaborator[];
};

export type ConversationComment = {
  id: string;
  conversationId: string;
  body: string | null;
  author: {
    kind: CommentActorKind;
    id: string;
    displayName: string;
    avatarHash: string | null;
  };
  parentCommentId: string | null;
  referencedMessageId: string | null;
  mentionUserIds: string[];
  revision: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailActivityEvent = {
  id: string;
  conversationId: string | null;
  actor: {
    kind: "user" | "service_account" | "workflow" | "system";
    id: string | null;
    displayName: string;
    avatarHash: string | null;
  };
  action: string;
  outcome: "requested" | "confirmed" | "failed" | "reconciled";
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type CollaborationRow = {
  id: string;
  assignee_user_id: string | null;
  assignee_uid: string | null;
  assignee_display_name: string | null;
  assignee_avatar_hash: string | null;
  work_status: ConversationCollaboration["workStatus"];
  response_needed: boolean;
  snoozed_until: Date | string | null;
  revision: string | number;
};

type CommentRow = {
  id: string;
  conversation_id: string;
  body_markdown: string;
  author_kind: CommentActorKind;
  author_id: string;
  author_display_name: string;
  author_avatar_hash: string | null;
  parent_comment_id: string | null;
  referenced_message_id: string | null;
  mention_user_ids: string[];
  revision: string | number;
  edited_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ActivityRow = {
  id: string | number;
  conversation_id: string | null;
  actor_kind: MailActivityEvent["actor"]["kind"];
  actor_id: string | null;
  actor_display_name: string;
  actor_avatar_hash: string | null;
  action: string;
  outcome: MailActivityEvent["outcome"];
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | string;
  created_at: Date | string;
};

type MutableCommentRow = {
  revision: string | number;
  body_markdown: string;
  author_kind: CommentActorKind;
  author_id: string;
  deleted_at: Date | string | null;
};

export type CollaborationMutation<T> = {
  value: T;
  event: Omit<MailCollaborationEvent, "type" | "at"> | null;
};

type DateCursor = { version: 1; date: string; id: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const toNullableIso = (value: Date | string | null): string | null => (value ? toIso(value) : null);
const encodeDateCursor = (cursor: DateCursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url");

const decodeDateCursor = (value: string | undefined): Result<DateCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DateCursor>;
    if (
      parsed.version !== 1 ||
      typeof parsed.date !== "string" ||
      !Number.isFinite(Date.parse(parsed.date)) ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      return fail(err.badInput("Invalid pagination cursor"));
    }
    return ok(parsed as DateCursor);
  } catch {
    return fail(err.badInput("Invalid pagination cursor"));
  }
};

const encodeActivityCursor = (id: string): string => Buffer.from(JSON.stringify({ version: 1, id })).toString("base64url");

const decodeActivityCursor = (value: string | undefined): Result<string | null> => {
  if (!value) return ok(null);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { version?: unknown; id?: unknown };
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== "string" ||
      !/^[1-9]\d*$/.test(parsed.id) ||
      BigInt(parsed.id) > 9_223_372_036_854_775_807n
    ) {
      return fail(err.badInput("Invalid pagination cursor"));
    }
    return ok(parsed.id);
  } catch {
    return fail(err.badInput("Invalid pagination cursor"));
  }
};

const parseMetadata = (value: Record<string, unknown> | string): Record<string, unknown> =>
  typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;

const actorIdentity = (context: MailRequestContext): { kind: CommentActorKind; id: string } => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  if (actor.kind === "service_account") return { kind: "service_account", id: actor.serviceAccountId };
  throw new Error("Request actor cannot author Mail collaboration changes");
};

const activityActorIdentity = (
  context: MailRequestContext,
  actorOverride?: ActorRef,
): { kind: ActorRef["kind"]; id: string | null } => {
  const actor = actorOverride ?? actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  if (actor.kind === "workflow") return { kind: actor.kind, id: actor.workflowVersionId };
  return { kind: actor.kind, id: null };
};

const listMailboxAccessIds = async (mailboxId: string, db: SqlClient = sql): Promise<string[]> => {
  const rows = await db<{ access_id: string }[]>`
    SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
  `;
  return rows.map((row) => row.access_id);
};

const collaboratorFromAccessUser = (user: AccessUser): MailCollaborator => ({
  id: user.id,
  uid: user.uid,
  displayName: user.displayName,
  avatarHash: user.avatarHash,
});

const accessUserDescription = (user: AccessUser): string =>
  user.source.type === "direct" ? `${user.uid} · direct access` : `${user.uid} · via ${user.source.groupName}`;

const listCurrentUsers = async (params: {
  mailboxId: string;
  db?: SqlClient;
  userIds?: string[];
  minimumPermission?: "read" | "write" | "admin";
  search?: string;
  limit?: number;
}): Promise<AccessUser[]> => {
  const accessIds = await listMailboxAccessIds(params.mailboxId, params.db);
  return listUsersWithAccess({
    accessIds,
    userIds: params.userIds,
    minimumPermission: params.minimumPermission,
    search: params.search,
    limit: params.limit,
    db: params.db,
  });
};

const validateCurrentUsers = async (params: {
  mailboxId: string;
  db: SqlClient;
  userIds: string[];
  minimumPermission: "read" | "write";
  label: "Assignee" | "Watcher" | "Mentioned user";
}): Promise<Result<void>> => {
  const userIds = [...new Set(params.userIds)];
  if (userIds.length === 0) return ok();
  const users = await listCurrentUsers({
    mailboxId: params.mailboxId,
    db: params.db,
    userIds,
    minimumPermission: params.minimumPermission,
    limit: userIds.length,
  });
  const found = new Set(users.map((user) => user.id));
  return userIds.every((id) => found.has(id))
    ? ok()
    : fail(err.badInput(`${params.label} must have current ${params.minimumPermission} access to this mailbox`));
};

const lockMailboxForCollaboration = async (
  context: MailRequestContext,
  mailboxId: string,
  permission: "read" | "write",
  db: SqlClient,
): Promise<Result<PermissionLevel>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR SHARE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  return requireMailboxPermission(context, mailboxId, permission, db);
};

const loadCollaboration = async (
  mailboxId: string,
  conversationId: string,
  db: SqlClient = sql,
): Promise<ConversationCollaboration | null> => {
  const [row] = await db<CollaborationRow[]>`
    SELECT
      c.id,
      c.assignee_user_id,
      assignee.uid AS assignee_uid,
      COALESCE(NULLIF(assignee.display_name, ''), assignee.uid) AS assignee_display_name,
      assignee.avatar_hash AS assignee_avatar_hash,
      c.work_status,
      c.response_needed,
      c.snoozed_until,
      c.revision
    FROM mail.conversations c
    LEFT JOIN auth.users assignee ON assignee.id = c.assignee_user_id
    WHERE c.id = ${conversationId}::uuid AND c.mailbox_id = ${mailboxId}::uuid
  `;
  if (!row) return null;
  const watcherRows = await db<{ user_id: string }[]>`
    SELECT user_id
    FROM mail.conversation_watchers
    WHERE conversation_id = ${conversationId}::uuid
  `;
  const watcherUsers =
    watcherRows.length === 0
      ? []
      : await listCurrentUsers({
          mailboxId,
          db,
          userIds: watcherRows.map((watcher) => watcher.user_id),
          minimumPermission: "read",
          limit: watcherRows.length,
        });
  return {
    conversationId: row.id,
    assignee:
      row.assignee_user_id && row.assignee_uid && row.assignee_display_name
        ? {
            id: row.assignee_user_id,
            uid: row.assignee_uid,
            displayName: row.assignee_display_name,
            avatarHash: row.assignee_avatar_hash,
          }
        : null,
    workStatus: row.work_status,
    responseNeeded: row.response_needed,
    snoozedUntil: toNullableIso(row.snoozed_until),
    revision: Number(row.revision),
    watchers: watcherUsers.map(collaboratorFromAccessUser),
  };
};

const insertActivity = async (params: {
  db: SqlClient;
  mailboxId: string;
  conversationId: string;
  context: MailRequestContext;
  actorOverride?: ActorRef;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<string> => {
  const actor = activityActorIdentity(params.context, params.actorOverride);
  const [event] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, conversation_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${params.conversationId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      ${params.targetType},
      ${params.targetId}::uuid,
      ${params.metadata ?? {}}::jsonb
    )
    RETURNING id
  `;
  if (!event) throw new Error("Mail activity insert returned no row");
  return String(event.id);
};

const finishMutation = async <T>(result: Result<CollaborationMutation<T>>): Promise<Result<T>> => {
  if (!result.ok) return result;
  if (result.data.event) await publishMailCollaborationEvent(result.data.event);
  return ok(result.data.value);
};

const listEligibleUsers = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  search?: string;
  limit?: number;
  minimumPermission: "read" | "write";
}): Promise<Result<MailAssignableUser[]>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const users = await listCurrentUsers({
    mailboxId: params.mailboxId,
    minimumPermission: params.minimumPermission,
    search: params.search,
    limit: Math.min(Math.max(params.limit ?? 50, 1), 200),
  });
  return ok(
    users.map((user) => ({
      ...collaboratorFromAccessUser(user),
      permission: user.permission,
      description: accessUserDescription(user),
    })),
  );
};

export const listAssignableUsers = (params: {
  context: MailRequestContext;
  mailboxId: string;
  search?: string;
  limit?: number;
}): Promise<Result<MailAssignableUser[]>> => listEligibleUsers({ ...params, minimumPermission: "write" });

export const listMentionableUsers = (params: {
  context: MailRequestContext;
  mailboxId: string;
  search?: string;
  limit?: number;
}): Promise<Result<MailAssignableUser[]>> => listEligibleUsers({ ...params, minimumPermission: "read" });

export const getConversationCollaboration = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
}): Promise<Result<ConversationCollaboration>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const state = await loadCollaboration(params.mailboxId, params.conversationId);
  return state ? ok(state) : fail(err.notFound("Conversation"));
};

export const updateConversationCollaborationInTransaction = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: UpdateConversationCollaboration;
  db: SqlClient;
  actorOverride?: ActorRef;
}): Promise<Result<CollaborationMutation<ConversationCollaboration>>> => {
  const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", params.db);
  if (!allowed.ok) return allowed;
  const [current] = await params.db<CollaborationRow[]>`
    SELECT
      c.id,
      c.assignee_user_id,
      NULL::text AS assignee_uid,
      NULL::text AS assignee_display_name,
      NULL::text AS assignee_avatar_hash,
      c.work_status,
      c.response_needed,
      c.snoozed_until,
      c.revision
    FROM mail.conversations c
    WHERE c.id = ${params.conversationId}::uuid AND c.mailbox_id = ${params.mailboxId}::uuid
    FOR UPDATE
  `;
  if (!current) return fail(err.notFound("Conversation"));
  if (Number(current.revision) !== params.input.expectedRevision) {
    return fail(err.conflict("Conversation was changed by another collaborator"));
  }
  if (params.input.assigneeUserId) {
    const validAssignee = await validateCurrentUsers({
      mailboxId: params.mailboxId,
      db: params.db,
      userIds: [params.input.assigneeUserId],
      minimumPermission: "write",
      label: "Assignee",
    });
    if (!validAssignee.ok) return validAssignee;
  }

  const nextStatus = params.input.workStatus ?? current.work_status;
  if (nextStatus === "done" && params.input.responseNeeded === true) {
    return fail(err.badInput("A completed conversation cannot require a response"));
  }
  const requestedSnooze =
    params.input.snoozedUntil === undefined
      ? undefined
      : params.input.snoozedUntil === null
        ? null
        : new Date(params.input.snoozedUntil).toISOString();
  if (requestedSnooze) {
    if (Date.parse(requestedSnooze) <= Date.now()) return fail(err.badInput("Snooze time must be in the future"));
    if (nextStatus === "done") return fail(err.badInput("A completed conversation cannot be snoozed"));
  }

  const nextAssignee = params.input.assigneeUserId === undefined ? current.assignee_user_id : params.input.assigneeUserId;
  const nextResponseNeeded = nextStatus === "done" ? false : (params.input.responseNeeded ?? current.response_needed);
  const nextSnoozedUntil =
    nextStatus === "done" ? null : requestedSnooze === undefined ? toNullableIso(current.snoozed_until) : requestedSnooze;
  const unchanged =
    nextAssignee === current.assignee_user_id &&
    nextStatus === current.work_status &&
    nextResponseNeeded === current.response_needed &&
    nextSnoozedUntil === toNullableIso(current.snoozed_until);
  if (unchanged) {
    const state = await loadCollaboration(params.mailboxId, params.conversationId, params.db);
    return state ? ok({ value: state, event: null }) : fail(err.notFound("Conversation"));
  }

  await params.db`
    UPDATE mail.conversations
    SET
      assignee_user_id = ${nextAssignee}::uuid,
      work_status = ${nextStatus},
      response_needed = ${nextResponseNeeded},
      snoozed_until = ${nextSnoozedUntil}::timestamptz,
      revision = revision + 1
    WHERE id = ${params.conversationId}::uuid
  `;
  const state = await loadCollaboration(params.mailboxId, params.conversationId, params.db);
  if (!state) return fail(err.internal("Updated conversation could not be loaded"));
  const activityId = await insertActivity({
    db: params.db,
    mailboxId: params.mailboxId,
    conversationId: params.conversationId,
    context: params.context,
    actorOverride: params.actorOverride,
    action: "conversation.collaboration_updated",
    targetType: "conversation",
    targetId: params.conversationId,
    metadata: {
      before: {
        assigneeUserId: current.assignee_user_id,
        workStatus: current.work_status,
        responseNeeded: current.response_needed,
        snoozedUntil: toNullableIso(current.snoozed_until),
        revision: Number(current.revision),
      },
      after: {
        assigneeUserId: state.assignee?.id ?? null,
        workStatus: state.workStatus,
        responseNeeded: state.responseNeeded,
        snoozedUntil: state.snoozedUntil,
        revision: state.revision,
      },
    },
  });
  return ok({
    value: state,
    event: {
      mailboxId: params.mailboxId,
      conversationId: params.conversationId,
      reason: "collaboration",
      targetId: params.conversationId,
      activityId,
    },
  });
};

export const updateConversationCollaboration = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: UpdateConversationCollaboration;
}): Promise<Result<ConversationCollaboration>> => {
  try {
    const result = await sql.begin((tx) => updateConversationCollaborationInTransaction({ ...params, db: tx }));
    return finishMutation(result);
  } catch {
    return fail(err.internal("Failed to update conversation collaboration"));
  }
};

export const setConversationWatcher = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  userId: string;
  watching: boolean;
}): Promise<Result<ConversationCollaboration>> => {
  try {
    const result = await sql.begin(async (tx): Promise<Result<CollaborationMutation<ConversationCollaboration>>> => {
      const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", tx);
      if (!allowed.ok) return allowed;
      const [conversation] = await tx<{ id: string }[]>`
        SELECT id FROM mail.conversations
        WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!conversation) return fail(err.notFound("Conversation"));
      if (params.watching) {
        const validWatcher = await validateCurrentUsers({
          mailboxId: params.mailboxId,
          db: tx,
          userIds: [params.userId],
          minimumPermission: "read",
          label: "Watcher",
        });
        if (!validWatcher.ok) return validWatcher;
      }

      let changed = false;
      if (params.watching) {
        const [inserted] = await tx<{ user_id: string }[]>`
          INSERT INTO mail.conversation_watchers (conversation_id, user_id)
          VALUES (${params.conversationId}::uuid, ${params.userId}::uuid)
          ON CONFLICT DO NOTHING
          RETURNING user_id
        `;
        changed = Boolean(inserted);
      } else {
        const [deleted] = await tx<{ user_id: string }[]>`
          DELETE FROM mail.conversation_watchers
          WHERE conversation_id = ${params.conversationId}::uuid AND user_id = ${params.userId}::uuid
          RETURNING user_id
        `;
        changed = Boolean(deleted);
      }
      const state = await loadCollaboration(params.mailboxId, params.conversationId, tx);
      if (!state) return fail(err.internal("Updated conversation could not be loaded"));
      if (!changed) return ok({ value: state, event: null });
      await tx`UPDATE mail.conversations SET updated_at = now() WHERE id = ${params.conversationId}::uuid`;
      const activityId = await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        context: params.context,
        action: params.watching ? "conversation.watcher_added" : "conversation.watcher_removed",
        targetType: "user",
        targetId: params.userId,
        metadata: { userId: params.userId },
      });
      return ok({
        value: state,
        event: {
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          reason: "watcher",
          targetId: params.userId,
          activityId,
        },
      });
    });
    return finishMutation(result);
  } catch {
    return fail(err.internal("Failed to update conversation watcher"));
  }
};

const commentColumns = sql`
  comment.id,
  comment.conversation_id,
  comment.body_markdown,
  comment.author_kind,
  comment.author_id,
  COALESCE(
    NULLIF(author_user.display_name, ''),
    author_user.uid,
    author_service.name,
    CASE comment.author_kind WHEN 'user' THEN 'Former user' ELSE 'Former service account' END
  ) AS author_display_name,
  author_user.avatar_hash AS author_avatar_hash,
  comment.parent_comment_id,
  comment.referenced_message_id,
  ARRAY(
    SELECT mention.user_id
    FROM mail.conversation_comment_mentions mention
    WHERE mention.comment_id = comment.id AND mention.revision = comment.revision
    ORDER BY mention.user_id
  ) AS mention_user_ids,
  comment.revision,
  comment.edited_at,
  comment.deleted_at,
  comment.created_at,
  comment.updated_at
`;

const mapComment = (row: CommentRow): ConversationComment => ({
  id: row.id,
  conversationId: row.conversation_id,
  body: row.deleted_at ? null : row.body_markdown,
  author: {
    kind: row.author_kind,
    id: row.author_id,
    displayName: row.author_display_name,
    avatarHash: row.author_avatar_hash,
  },
  parentCommentId: row.parent_comment_id,
  referencedMessageId: row.referenced_message_id,
  mentionUserIds: row.deleted_at ? [] : row.mention_user_ids,
  revision: Number(row.revision),
  editedAt: toNullableIso(row.edited_at),
  deletedAt: toNullableIso(row.deleted_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const loadComment = async (params: {
  db: SqlClient;
  mailboxId: string;
  conversationId: string;
  commentId: string;
}): Promise<ConversationComment | null> => {
  const [row] = await params.db<CommentRow[]>`
    SELECT ${commentColumns}
    FROM mail.conversation_comments comment
    JOIN mail.conversations conversation ON conversation.id = comment.conversation_id
    LEFT JOIN auth.users author_user ON comment.author_kind = 'user' AND author_user.id = comment.author_id
    LEFT JOIN auth.service_accounts author_service
      ON comment.author_kind = 'service_account' AND author_service.id = comment.author_id
    WHERE comment.id = ${params.commentId}::uuid
      AND comment.conversation_id = ${params.conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
  `;
  return row ? mapComment(row) : null;
};

const validateCommentReferences = async (params: {
  db: SqlClient;
  conversationId: string;
  parentCommentId?: string | null;
  referencedMessageId?: string | null;
}): Promise<Result<void>> => {
  if (params.parentCommentId) {
    const [parent] = await params.db<{ id: string }[]>`
      SELECT id FROM mail.conversation_comments
      WHERE id = ${params.parentCommentId}::uuid
        AND conversation_id = ${params.conversationId}::uuid
        AND deleted_at IS NULL
    `;
    if (!parent) return fail(err.badInput("Reply target must be an active comment in this conversation"));
  }
  if (params.referencedMessageId) {
    const [message] = await params.db<{ message_id: string }[]>`
      SELECT message_id FROM mail.conversation_messages
      WHERE conversation_id = ${params.conversationId}::uuid
        AND message_id = ${params.referencedMessageId}::uuid
    `;
    if (!message) return fail(err.badInput("Referenced message must belong to this conversation"));
  }
  return ok();
};

const replaceMentions = async (params: { db: SqlClient; commentId: string; revision: number; userIds: string[] }): Promise<void> => {
  for (const userId of params.userIds) {
    await params.db`
      INSERT INTO mail.conversation_comment_mentions (comment_id, revision, user_id)
      VALUES (${params.commentId}::uuid, ${params.revision}, ${userId}::uuid)
    `;
  }
};

const lockCommentForMutation = async (params: {
  db: SqlClient;
  mailboxId: string;
  conversationId: string;
  commentId: string;
  expectedRevision: number;
  actor: { kind: CommentActorKind; id: string };
  permission: PermissionLevel;
  action: "edit" | "delete";
}): Promise<Result<MutableCommentRow>> => {
  const [comment] = await params.db<MutableCommentRow[]>`
    SELECT comment.revision, comment.body_markdown, comment.author_kind, comment.author_id, comment.deleted_at
    FROM mail.conversation_comments comment
    JOIN mail.conversations conversation ON conversation.id = comment.conversation_id
    WHERE comment.id = ${params.commentId}::uuid
      AND comment.conversation_id = ${params.conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
    FOR UPDATE OF comment
  `;
  if (!comment) return fail(err.notFound("Comment"));
  if (comment.deleted_at) return fail(err.badInput(params.action === "edit" ? "Deleted comments cannot be edited" : "Comment is already deleted"));
  if (Number(comment.revision) !== params.expectedRevision) return fail(err.conflict("Comment was changed by another collaborator"));
  const owner = comment.author_kind === params.actor.kind && comment.author_id === params.actor.id;
  if (!owner && params.permission !== "admin") {
    return fail(err.forbidden(`Only the comment author or a mailbox admin can ${params.action} this comment`));
  }
  return ok(comment);
};

export const listConversationComments = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  cursor?: string;
  limit?: number;
}): Promise<Result<{ items: ConversationComment[]; nextCursor: string | null }>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const cursor = decodeDateCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const rows = await sql<CommentRow[]>`
    SELECT ${commentColumns}
    FROM mail.conversation_comments comment
    JOIN mail.conversations conversation ON conversation.id = comment.conversation_id
    LEFT JOIN auth.users author_user ON comment.author_kind = 'user' AND author_user.id = comment.author_id
    LEFT JOIN auth.service_accounts author_service
      ON comment.author_kind = 'service_account' AND author_service.id = comment.author_id
    WHERE comment.conversation_id = ${params.conversationId}::uuid
      AND conversation.mailbox_id = ${params.mailboxId}::uuid
      AND (
        ${cursor.data?.id ?? null}::uuid IS NULL
        OR (comment.created_at, comment.id) > (${cursor.data?.date ?? null}::timestamptz, ${cursor.data?.id ?? null}::uuid)
      )
    ORDER BY comment.created_at, comment.id
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(mapComment);
  const last = items.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last ? encodeDateCursor({ version: 1, date: last.createdAt, id: last.id }) : null,
  });
};

export const createConversationComment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: CreateConversationComment;
}): Promise<Result<ConversationComment>> => {
  try {
    const result = await sql.begin(async (tx): Promise<Result<CollaborationMutation<ConversationComment>>> => {
      const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", tx);
      if (!allowed.ok) return allowed;
      const [conversation] = await tx<{ id: string }[]>`
        SELECT id FROM mail.conversations
        WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!conversation) return fail(err.notFound("Conversation"));
      const references = await validateCommentReferences({
        db: tx,
        conversationId: params.conversationId,
        parentCommentId: params.input.parentCommentId,
        referencedMessageId: params.input.referencedMessageId,
      });
      if (!references.ok) return references;
      const mentions = await validateCurrentUsers({
        mailboxId: params.mailboxId,
        db: tx,
        userIds: params.input.mentionUserIds,
        minimumPermission: "read",
        label: "Mentioned user",
      });
      if (!mentions.ok) return mentions;
      const actor = actorIdentity(params.context);
      const [comment] = await tx<{ id: string }[]>`
        INSERT INTO mail.conversation_comments (
          conversation_id, author_kind, author_id, body_markdown, parent_comment_id, referenced_message_id
        ) VALUES (
          ${params.conversationId}::uuid,
          ${actor.kind},
          ${actor.id}::uuid,
          ${params.input.body},
          ${params.input.parentCommentId ?? null}::uuid,
          ${params.input.referencedMessageId ?? null}::uuid
        )
        RETURNING id
      `;
      if (!comment) return fail(err.internal("Comment insert returned no row"));
      await tx`
        INSERT INTO mail.conversation_comment_versions (
          comment_id, revision, body_markdown, editor_kind, editor_id, deleted
        ) VALUES (${comment.id}::uuid, 1, ${params.input.body}, ${actor.kind}, ${actor.id}::uuid, false)
      `;
      await replaceMentions({
        db: tx,
        commentId: comment.id,
        revision: 1,
        userIds: params.input.mentionUserIds,
      });
      await tx`UPDATE mail.conversations SET updated_at = now() WHERE id = ${params.conversationId}::uuid`;
      const value = await loadComment({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        commentId: comment.id,
      });
      if (!value) return fail(err.internal("Created comment could not be loaded"));
      const activityId = await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        context: params.context,
        action: "conversation.comment_created",
        targetType: "comment",
        targetId: comment.id,
        metadata: {
          revision: 1,
          parentCommentId: value.parentCommentId,
          referencedMessageId: value.referencedMessageId,
          mentionUserIds: value.mentionUserIds,
        },
      });
      return ok({
        value,
        event: {
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          reason: "comment",
          targetId: comment.id,
          activityId,
        },
      });
    });
    return finishMutation(result);
  } catch {
    return fail(err.internal("Failed to create internal comment"));
  }
};

export const updateConversationComment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  commentId: string;
  input: UpdateConversationComment;
}): Promise<Result<ConversationComment>> => {
  try {
    const result = await sql.begin(async (tx): Promise<Result<CollaborationMutation<ConversationComment>>> => {
      const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", tx);
      if (!allowed.ok) return allowed;
      const actor = actorIdentity(params.context);
      const current = await lockCommentForMutation({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        commentId: params.commentId,
        expectedRevision: params.input.expectedRevision,
        actor,
        permission: allowed.data,
        action: "edit",
      });
      if (!current.ok) return current;
      const mentions = await validateCurrentUsers({
        mailboxId: params.mailboxId,
        db: tx,
        userIds: params.input.mentionUserIds,
        minimumPermission: "read",
        label: "Mentioned user",
      });
      if (!mentions.ok) return mentions;
      const currentMentionRows = await tx<{ user_id: string }[]>`
        SELECT user_id FROM mail.conversation_comment_mentions
        WHERE comment_id = ${params.commentId}::uuid AND revision = ${params.input.expectedRevision}
        ORDER BY user_id
      `;
      const currentMentionIds = currentMentionRows.map((row) => row.user_id);
      const nextMentionIds = [...params.input.mentionUserIds].sort();
      if (current.data.body_markdown === params.input.body && currentMentionIds.join(",") === nextMentionIds.join(",")) {
        const value = await loadComment({
          db: tx,
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          commentId: params.commentId,
        });
        if (!value) return fail(err.notFound("Comment"));
        return ok({ value, event: null });
      }
      const revision = params.input.expectedRevision + 1;
      await tx`
        UPDATE mail.conversation_comments
        SET body_markdown = ${params.input.body}, revision = ${revision}, edited_at = now()
        WHERE id = ${params.commentId}::uuid
      `;
      await tx`
        INSERT INTO mail.conversation_comment_versions (
          comment_id, revision, body_markdown, editor_kind, editor_id, deleted
        ) VALUES (${params.commentId}::uuid, ${revision}, ${params.input.body}, ${actor.kind}, ${actor.id}::uuid, false)
      `;
      await replaceMentions({
        db: tx,
        commentId: params.commentId,
        revision,
        userIds: nextMentionIds,
      });
      await tx`UPDATE mail.conversations SET updated_at = now() WHERE id = ${params.conversationId}::uuid`;
      const value = await loadComment({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        commentId: params.commentId,
      });
      if (!value) return fail(err.internal("Updated comment could not be loaded"));
      const activityId = await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        context: params.context,
        action: "conversation.comment_updated",
        targetType: "comment",
        targetId: params.commentId,
        metadata: { revision, mentionUserIds: value.mentionUserIds },
      });
      return ok({
        value,
        event: {
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          reason: "comment",
          targetId: params.commentId,
          activityId,
        },
      });
    });
    return finishMutation(result);
  } catch {
    return fail(err.internal("Failed to update internal comment"));
  }
};

export const deleteConversationComment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  commentId: string;
  input: DeleteConversationComment;
}): Promise<Result<ConversationComment>> => {
  try {
    const result = await sql.begin(async (tx): Promise<Result<CollaborationMutation<ConversationComment>>> => {
      const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", tx);
      if (!allowed.ok) return allowed;
      const actor = actorIdentity(params.context);
      const current = await lockCommentForMutation({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        commentId: params.commentId,
        expectedRevision: params.input.expectedRevision,
        actor,
        permission: allowed.data,
        action: "delete",
      });
      if (!current.ok) return current;
      const revision = params.input.expectedRevision + 1;
      await tx`
        UPDATE mail.conversation_comments
        SET revision = ${revision}, edited_at = now(), deleted_at = now()
        WHERE id = ${params.commentId}::uuid
      `;
      await tx`
        INSERT INTO mail.conversation_comment_versions (
          comment_id, revision, body_markdown, editor_kind, editor_id, deleted
        ) VALUES (${params.commentId}::uuid, ${revision}, ${current.data.body_markdown}, ${actor.kind}, ${actor.id}::uuid, true)
      `;
      await tx`UPDATE mail.conversations SET updated_at = now() WHERE id = ${params.conversationId}::uuid`;
      const value = await loadComment({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        commentId: params.commentId,
      });
      if (!value) return fail(err.internal("Deleted comment could not be loaded"));
      const activityId = await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        context: params.context,
        action: "conversation.comment_deleted",
        targetType: "comment",
        targetId: params.commentId,
        metadata: { revision },
      });
      return ok({
        value,
        event: {
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          reason: "comment",
          targetId: params.commentId,
          activityId,
        },
      });
    });
    return finishMutation(result);
  } catch {
    return fail(err.internal("Failed to delete internal comment"));
  }
};

export const listActivity = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId?: string | null;
  cursor?: string;
  limit?: number;
}): Promise<Result<{ items: MailActivityEvent[]; nextCursor: string | null }>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const cursor = decodeActivityCursor(params.cursor);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const rows = await sql<ActivityRow[]>`
    SELECT
      activity.id,
      activity.conversation_id,
      activity.actor_kind,
      activity.actor_id,
      COALESCE(
        NULLIF(actor_user.display_name, ''),
        actor_user.uid,
        actor_service.name,
        CASE activity.actor_kind
          WHEN 'workflow' THEN 'Workflow'
          WHEN 'system' THEN 'System'
          WHEN 'user' THEN 'Former user'
          ELSE 'Former service account'
        END
      ) AS actor_display_name,
      actor_user.avatar_hash AS actor_avatar_hash,
      activity.action,
      activity.outcome,
      activity.target_type,
      activity.target_id,
      activity.metadata,
      activity.created_at
    FROM mail.activity_events activity
    LEFT JOIN auth.users actor_user ON activity.actor_kind = 'user' AND actor_user.id = activity.actor_id
    LEFT JOIN auth.service_accounts actor_service
      ON activity.actor_kind = 'service_account' AND actor_service.id = activity.actor_id
    WHERE activity.mailbox_id = ${params.mailboxId}::uuid
      AND (${params.conversationId ?? null}::uuid IS NULL OR activity.conversation_id = ${params.conversationId ?? null}::uuid)
      AND (${cursor.data ?? null}::bigint IS NULL OR activity.id < ${cursor.data ?? null}::bigint)
    ORDER BY activity.id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => ({
    id: String(row.id),
    conversationId: row.conversation_id,
    actor: {
      kind: row.actor_kind,
      id: row.actor_id,
      displayName: row.actor_display_name,
      avatarHash: row.actor_avatar_hash,
    },
    action: row.action,
    outcome: row.outcome,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: parseMetadata(row.metadata),
    createdAt: toIso(row.created_at),
  }));
  const last = items.at(-1);
  return ok({
    items,
    nextCursor: hasMore && last ? encodeActivityCursor(last.id) : null,
  });
};
