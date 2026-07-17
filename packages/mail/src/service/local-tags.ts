import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateLocalTag, DeleteLocalTag, SetConversationLocalTags, UpdateLocalTag } from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { insertActivity } from "./collaboration";
import { publishMailCollaborationEvent, publishMailMailboxEvent } from "./events";

type SqlClient = typeof sql;

type LocalTagRow = {
  id: string;
  mailbox_id: string;
  name: string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type LocalTag = {
  id: string;
  mailboxId: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationLocalTags = {
  conversationId: string;
  conversationRevision: number;
  tags: LocalTag[];
};

type ActorIdentity = { kind: "user" | "service_account"; id: string };

const localTagColumns = sql`tag.id, tag.mailbox_id, tag.name, tag.revision, tag.created_at, tag.updated_at`;
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const mapTag = (row: LocalTagRow): LocalTag => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  name: row.name,
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});
const normalizeName = (name: string): string => name.trim().replace(/\s+/gu, " ");

const mutationActor = (context: MailRequestContext): ActorIdentity => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  if (actor.kind === "service_account") return { kind: "service_account", id: actor.serviceAccountId };
  throw new Error("Request actor cannot mutate local tags");
};

const lockMailboxForWrite = async (context: MailRequestContext, mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed = await requireMailboxPermission(context, mailboxId, "write", db);
  return allowed.ok ? ok() : allowed;
};

const insertMailboxActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  mailboxId: string;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}): Promise<string> => {
  const actor = mutationActor(params.context);
  const [event] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'local_tag',
      ${params.targetId}::uuid,
      ${params.metadata}::jsonb
    )
    RETURNING id
  `;
  if (!event) throw new Error("Local tag activity insert returned no row");
  return String(event.id);
};

const databaseCode = (error: unknown): string | null => {
  const value = error as { code?: unknown; errno?: unknown } | null;
  return typeof value?.code === "string" ? value.code : typeof value?.errno === "string" ? value.errno : null;
};

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  if (isServiceError(error)) return fail(error);
  if (databaseCode(error) === "23505") return fail(err.conflict("Local tag name already exists"));
  return fail(err.internal(fallback));
};

export const listLocalTags = async (context: MailRequestContext, mailboxId: string): Promise<Result<LocalTag[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<LocalTagRow[]>`
    SELECT ${localTagColumns}
    FROM mail.local_tags tag
    WHERE tag.mailbox_id = ${mailboxId}::uuid
    ORDER BY tag.normalized_name, tag.id
  `;
  return ok(rows.map(mapTag));
};

export const createLocalTag = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateLocalTag;
}): Promise<Result<LocalTag>> => {
  const name = normalizeName(params.input.name);
  const actor = mutationActor(params.context);
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ tag: LocalTag; activityId: string }>> => {
      const allowed = await lockMailboxForWrite(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [row] = await tx<LocalTagRow[]>`
        INSERT INTO mail.local_tags (
          mailbox_id, name, normalized_name, created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${name},
          lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING id, mailbox_id, name, revision, created_at, updated_at
      `;
      if (!row) throw new Error("Local tag insert returned no row");
      const tag = mapTag(row);
      const activityId = await insertMailboxActivity({
        db: tx,
        context: params.context,
        mailboxId: params.mailboxId,
        action: "local_tag.created",
        targetId: tag.id,
        metadata: { name: tag.name, revision: tag.revision },
      });
      await audit.record(
        {
          action: "mail.local_tag.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "local_tag", id: tag.id, label: tag.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, revision: tag.revision },
        },
        tx,
      );
      return ok({ tag, activityId });
    });
    if (!result.ok) return result;
    await publishMailMailboxEvent({
      mailboxId: params.mailboxId,
      conversationId: null,
      reason: "local_tag",
      targetId: result.data.tag.id,
      activityId: result.data.activityId,
    });
    return ok(result.data.tag);
  } catch (error) {
    return mutationFailure(error, "Failed to create local tag");
  }
};

export const updateLocalTag = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  tagId: string;
  input: UpdateLocalTag;
}): Promise<Result<LocalTag>> => {
  const name = normalizeName(params.input.name);
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ tag: LocalTag; activityId: string | null }>> => {
      const allowed = await lockMailboxForWrite(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [current] = await tx<LocalTagRow[]>`
        SELECT ${localTagColumns}
        FROM mail.local_tags tag
        WHERE tag.id = ${params.tagId}::uuid AND tag.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Local tag"));
      if (Number(current.revision) !== params.input.expectedRevision) return fail(err.conflict("Local tag was changed"));
      if (current.name === name) return ok({ tag: mapTag(current), activityId: null });
      const [updated] = await tx<LocalTagRow[]>`
        UPDATE mail.local_tags tag
        SET name = ${name}, normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')), revision = revision + 1
        WHERE tag.id = ${params.tagId}::uuid
        RETURNING tag.id, tag.mailbox_id, tag.name, tag.revision, tag.created_at, tag.updated_at
      `;
      if (!updated) throw new Error("Local tag update returned no row");
      const tag = mapTag(updated);
      const activityId = await insertMailboxActivity({
        db: tx,
        context: params.context,
        mailboxId: params.mailboxId,
        action: "local_tag.updated",
        targetId: tag.id,
        metadata: { before: { name: current.name, revision: Number(current.revision) }, after: { name: tag.name, revision: tag.revision } },
      });
      await audit.record(
        {
          action: "mail.local_tag.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "local_tag", id: tag.id, label: tag.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, beforeName: current.name, revision: tag.revision },
        },
        tx,
      );
      return ok({ tag, activityId });
    });
    if (!result.ok) return result;
    if (result.data.activityId) {
      await publishMailMailboxEvent({
        mailboxId: params.mailboxId,
        conversationId: null,
        reason: "local_tag",
        targetId: result.data.tag.id,
        activityId: result.data.activityId,
      });
    }
    return ok(result.data.tag);
  } catch (error) {
    return mutationFailure(error, "Failed to update local tag");
  }
};

export const deleteLocalTag = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  tagId: string;
  input: DeleteLocalTag;
}): Promise<Result<void>> => {
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ activityId: string }>> => {
      const allowed = await lockMailboxForWrite(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [current] = await tx<LocalTagRow[]>`
        SELECT ${localTagColumns}
        FROM mail.local_tags tag
        WHERE tag.id = ${params.tagId}::uuid AND tag.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Local tag"));
      if (Number(current.revision) !== params.input.expectedRevision) return fail(err.conflict("Local tag was changed"));
      const affectedConversations = await tx<{ conversation_id: string }[]>`
        SELECT conversation_id
        FROM mail.conversation_local_tags
        WHERE mailbox_id = ${params.mailboxId}::uuid AND tag_id = ${params.tagId}::uuid
        ORDER BY conversation_id
        FOR UPDATE
      `;
      await tx`DELETE FROM mail.local_tags WHERE id = ${params.tagId}::uuid`;
      if (affectedConversations.length > 0) {
        await tx`
          UPDATE mail.conversations
          SET revision = revision + 1, updated_at = now()
          WHERE mailbox_id = ${params.mailboxId}::uuid
            AND id IN (
              SELECT value::uuid
              FROM jsonb_array_elements_text(${affectedConversations.map((row) => row.conversation_id)}::jsonb)
            )
        `;
      }
      const activityId = await insertMailboxActivity({
        db: tx,
        context: params.context,
        mailboxId: params.mailboxId,
        action: "local_tag.deleted",
        targetId: params.tagId,
        metadata: { name: current.name, revision: Number(current.revision), affectedConversations: affectedConversations.length },
      });
      await audit.record(
        {
          action: "mail.local_tag.delete",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "local_tag", id: params.tagId, label: current.name },
          requestId: params.context.requestId,
          metadata: {
            mailboxId: params.mailboxId,
            revision: Number(current.revision),
            affectedConversations: affectedConversations.length,
          },
        },
        tx,
      );
      return ok({ activityId });
    });
    if (!result.ok) return result;
    await publishMailMailboxEvent({
      mailboxId: params.mailboxId,
      conversationId: null,
      reason: "local_tag",
      targetId: params.tagId,
      activityId: result.data.activityId,
    });
    return ok();
  } catch (error) {
    return mutationFailure(error, "Failed to delete local tag");
  }
};

const loadConversationLocalTags = async (
  mailboxId: string,
  conversationId: string,
  db: SqlClient = sql,
): Promise<ConversationLocalTags | null> => {
  const [conversation] = await db<{ revision: string | number }[]>`
    SELECT revision
    FROM mail.conversations
    WHERE id = ${conversationId}::uuid AND mailbox_id = ${mailboxId}::uuid
  `;
  if (!conversation) return null;
  const rows = await db<LocalTagRow[]>`
    SELECT ${localTagColumns}
    FROM mail.conversation_local_tags assignment
    JOIN mail.local_tags tag ON tag.id = assignment.tag_id AND tag.mailbox_id = assignment.mailbox_id
    WHERE assignment.mailbox_id = ${mailboxId}::uuid AND assignment.conversation_id = ${conversationId}::uuid
    ORDER BY tag.normalized_name, tag.id
  `;
  return { conversationId, conversationRevision: Number(conversation.revision), tags: rows.map(mapTag) };
};

export const getConversationLocalTags = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
}): Promise<Result<ConversationLocalTags>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "read");
  if (!allowed.ok) return allowed;
  const state = await loadConversationLocalTags(params.mailboxId, params.conversationId);
  return state ? ok(state) : fail(err.notFound("Conversation"));
};

export const setConversationLocalTags = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  conversationId: string;
  input: SetConversationLocalTags;
}): Promise<Result<ConversationLocalTags>> => {
  const actor = mutationActor(params.context);
  const requestedTagIds = [...params.input.tagIds].sort();
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ state: ConversationLocalTags; activityId: string | null }>> => {
      const allowed = await lockMailboxForWrite(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [conversation] = await tx<{ revision: string | number }[]>`
        SELECT revision
        FROM mail.conversations
        WHERE id = ${params.conversationId}::uuid AND mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!conversation) return fail(err.notFound("Conversation"));
      if (Number(conversation.revision) !== params.input.expectedRevision) {
        return fail(err.conflict("Conversation was changed by another collaborator"));
      }
      const validTags = await tx<{ id: string }[]>`
        SELECT id
        FROM mail.local_tags
        WHERE mailbox_id = ${params.mailboxId}::uuid
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${requestedTagIds}::jsonb))
        ORDER BY id
        FOR SHARE
      `;
      if (validTags.length !== requestedTagIds.length) return fail(err.badInput("Every local tag must belong to this mailbox"));
      const existingRows = await tx<{ tag_id: string }[]>`
        SELECT tag_id
        FROM mail.conversation_local_tags
        WHERE mailbox_id = ${params.mailboxId}::uuid AND conversation_id = ${params.conversationId}::uuid
        ORDER BY tag_id
        FOR UPDATE
      `;
      const existingTagIds = existingRows.map((row) => row.tag_id);
      if (existingTagIds.length === requestedTagIds.length && existingTagIds.every((id, index) => id === requestedTagIds[index])) {
        const state = await loadConversationLocalTags(params.mailboxId, params.conversationId, tx);
        if (!state) return fail(err.notFound("Conversation"));
        return ok({ state, activityId: null });
      }
      await tx`
        DELETE FROM mail.conversation_local_tags
        WHERE mailbox_id = ${params.mailboxId}::uuid AND conversation_id = ${params.conversationId}::uuid
      `;
      if (requestedTagIds.length > 0) {
        await tx`
          INSERT INTO mail.conversation_local_tags (
            mailbox_id, conversation_id, tag_id, assigned_by_actor_kind, assigned_by_actor_id
          )
          SELECT
            ${params.mailboxId}::uuid,
            ${params.conversationId}::uuid,
            value::uuid,
            ${actor.kind},
            ${actor.id}::uuid
          FROM jsonb_array_elements_text(${requestedTagIds}::jsonb)
        `;
      }
      await tx`
        UPDATE mail.conversations
        SET revision = revision + 1, updated_at = now()
        WHERE id = ${params.conversationId}::uuid
      `;
      const state = await loadConversationLocalTags(params.mailboxId, params.conversationId, tx);
      if (!state) return fail(err.internal("Updated conversation tags could not be loaded"));
      const activityId = await insertActivity({
        db: tx,
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        context: params.context,
        action: "conversation.local_tags_updated",
        targetType: "conversation",
        targetId: params.conversationId,
        metadata: {
          before: { tagIds: existingTagIds, revision: Number(conversation.revision) },
          after: { tagIds: requestedTagIds, revision: state.conversationRevision },
        },
      });
      await audit.record(
        {
          action: "mail.conversation.local_tags.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "conversation", id: params.conversationId },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, beforeTagIds: existingTagIds, afterTagIds: requestedTagIds },
        },
        tx,
      );
      return ok({ state, activityId });
    });
    if (!result.ok) return result;
    if (result.data.activityId) {
      await publishMailCollaborationEvent({
        mailboxId: params.mailboxId,
        conversationId: params.conversationId,
        reason: "local_tag",
        targetId: params.conversationId,
        activityId: result.data.activityId,
      });
    }
    return ok(result.data.state);
  } catch (error) {
    return mutationFailure(error, "Failed to update conversation local tags");
  }
};
