import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CreateSavedConversationView,
  SavedConversationViewFilter,
  SavedConversationViewScope,
  UpdateSavedConversationView,
} from "../contracts";
import { type MailRequestContext, userBackedActor } from "./auth";
import { lockMailboxForCollaboration } from "./collaboration";
import { hasCurrentMailboxUserPermission } from "./collaborators";
import { listConversations } from "./messages";

type SqlClient = typeof sql;

type SavedViewRow = {
  id: string;
  mailbox_id: string;
  scope: SavedConversationViewScope;
  owner_user_id: string | null;
  name: string;
  filter: SavedConversationViewFilter | string;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SavedConversationView = {
  id: string;
  mailboxId: string;
  scope: SavedConversationViewScope;
  ownerUserId: string | null;
  name: string;
  filter: SavedConversationViewFilter;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const parseFilter = (value: SavedConversationViewFilter | string): SavedConversationViewFilter =>
  typeof value === "string" ? (JSON.parse(value) as SavedConversationViewFilter) : value;

const mapView = (row: SavedViewRow): SavedConversationView => ({
  id: row.id,
  mailboxId: row.mailbox_id,
  scope: row.scope,
  ownerUserId: row.owner_user_id,
  name: row.name,
  filter: parseFilter(row.filter),
  revision: Number(row.revision),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const viewColumns = sql`
  id,
  mailbox_id,
  scope,
  owner_user_id,
  name,
  filter,
  revision,
  created_at,
  updated_at
`;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";

const actorIdentity = (context: MailRequestContext): { kind: "user" | "service_account"; id: string } => {
  return context.actor.kind === "user"
    ? { kind: "user", id: context.actor.user.id }
    : { kind: "service_account", id: context.actor.serviceAccount.id };
};

const insertViewActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  mailboxId: string;
  viewId: string;
  action: string;
  metadata: Record<string, unknown>;
}): Promise<void> => {
  const actor = actorIdentity(params.context);
  await params.db`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'saved_conversation_view',
      ${params.viewId}::uuid,
      ${params.metadata}::jsonb
    )
  `;
};

const validateFilterReferences = async (params: {
  db: SqlClient;
  mailboxId: string;
  filter: SavedConversationViewFilter;
}): Promise<Result<void>> => {
  if (params.filter.folderId) {
    const [folder] = await params.db<{ id: string }[]>`
      SELECT folder.id
      FROM mail.folders folder
      JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
      WHERE folder.id = ${params.filter.folderId}::uuid AND resource.mailbox_id = ${params.mailboxId}::uuid
    `;
    if (!folder) return fail(err.badInput("Saved view folder must belong to this mailbox"));
  }
  if (params.filter.assignee?.kind === "user") {
    const allowed = await hasCurrentMailboxUserPermission({
      mailboxId: params.mailboxId,
      db: params.db,
      userId: params.filter.assignee.userId,
      minimumPermission: "write",
    });
    if (!allowed) return fail(err.badInput("Saved view assignee must have current write access to this mailbox"));
  }
  return ok();
};

const loadVisibleView = async (params: {
  db?: SqlClient;
  mailboxId: string;
  viewId: string;
  userId: string | null;
  forUpdate?: boolean;
}): Promise<SavedViewRow | null> => {
  const db = params.db ?? sql;
  const rows = params.forUpdate
    ? await db<SavedViewRow[]>`
        SELECT ${viewColumns}
        FROM mail.saved_conversation_views
        WHERE id = ${params.viewId}::uuid
          AND mailbox_id = ${params.mailboxId}::uuid
          AND (scope = 'mailbox' OR owner_user_id = ${params.userId}::uuid)
        FOR UPDATE
      `
    : await db<SavedViewRow[]>`
        SELECT ${viewColumns}
        FROM mail.saved_conversation_views
        WHERE id = ${params.viewId}::uuid
          AND mailbox_id = ${params.mailboxId}::uuid
          AND (scope = 'mailbox' OR owner_user_id = ${params.userId}::uuid)
      `;
  return rows[0] ?? null;
};

export const listSavedConversationViews = async (params: {
  context: MailRequestContext;
  mailboxId: string;
}): Promise<Result<SavedConversationView[]>> => {
  const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", sql);
  if (!allowed.ok) return allowed;
  const userId = userBackedActor(params.context)?.id ?? null;
  const rows = await sql<SavedViewRow[]>`
    SELECT ${viewColumns}
    FROM mail.saved_conversation_views
    WHERE mailbox_id = ${params.mailboxId}::uuid
      AND (scope = 'mailbox' OR owner_user_id = ${userId}::uuid)
    ORDER BY CASE scope WHEN 'private' THEN 0 ELSE 1 END, lower(name), id
  `;
  return ok(rows.map(mapView));
};

export const getSavedConversationView = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  viewId: string;
}): Promise<Result<SavedConversationView>> => {
  const allowed = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", sql);
  if (!allowed.ok) return allowed;
  const row = await loadVisibleView({
    mailboxId: params.mailboxId,
    viewId: params.viewId,
    userId: userBackedActor(params.context)?.id ?? null,
  });
  return row ? ok(mapView(row)) : fail(err.notFound("Saved conversation view"));
};

export const createSavedConversationView = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateSavedConversationView;
}): Promise<Result<SavedConversationView>> => {
  const ownerUserId = params.input.scope === "private" ? (userBackedActor(params.context)?.id ?? null) : null;
  if (params.input.scope === "private" && !ownerUserId) {
    return fail(err.forbidden("Private saved views require a user-backed actor"));
  }
  try {
    return await sql.begin(async (tx): Promise<Result<SavedConversationView>> => {
      const allowed = await lockMailboxForCollaboration(
        params.context,
        params.mailboxId,
        params.input.scope === "mailbox" ? "write" : "read",
        tx,
      );
      if (!allowed.ok) return allowed;
      const references = await validateFilterReferences({ db: tx, mailboxId: params.mailboxId, filter: params.input.filter });
      if (!references.ok) return references;
      const actor = actorIdentity(params.context);
      const [row] = await tx<SavedViewRow[]>`
        INSERT INTO mail.saved_conversation_views (
          mailbox_id, scope, owner_user_id, name, filter, created_by_kind, created_by_id
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${params.input.scope},
          ${ownerUserId}::uuid,
          ${params.input.name},
          ${params.input.filter}::jsonb,
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING ${viewColumns}
      `;
      if (!row) return fail(err.internal("Saved conversation view insert returned no row"));
      if (row.scope === "mailbox") {
        await insertViewActivity({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          viewId: row.id,
          action: "conversation_view.created",
          metadata: { scope: row.scope, name: row.name },
        });
      }
      return ok(mapView(row));
    });
  } catch (error) {
    return isUniqueViolation(error)
      ? fail(err.conflict("A saved view with this name already exists in this scope"))
      : fail(err.internal("Failed to create saved conversation view"));
  }
};

export const updateSavedConversationView = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  viewId: string;
  input: UpdateSavedConversationView;
}): Promise<Result<SavedConversationView>> => {
  try {
    return await sql.begin(async (tx): Promise<Result<SavedConversationView>> => {
      const read = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", tx);
      if (!read.ok) return read;
      const userId = userBackedActor(params.context)?.id ?? null;
      const current = await loadVisibleView({
        db: tx,
        mailboxId: params.mailboxId,
        viewId: params.viewId,
        userId,
        forUpdate: true,
      });
      if (!current) return fail(err.notFound("Saved conversation view"));
      if (current.scope === "mailbox") {
        const write = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", tx);
        if (!write.ok) return write;
      }
      if (Number(current.revision) !== params.input.expectedRevision) {
        return fail(err.conflict("Saved conversation view was changed by another request"));
      }
      const filter = params.input.filter ?? parseFilter(current.filter);
      const references = await validateFilterReferences({ db: tx, mailboxId: params.mailboxId, filter });
      if (!references.ok) return references;
      const revision = Number(current.revision) + 1;
      const [row] = await tx<SavedViewRow[]>`
        UPDATE mail.saved_conversation_views
        SET name = ${params.input.name ?? current.name}, filter = ${filter}::jsonb, revision = ${revision}
        WHERE id = ${current.id}::uuid
        RETURNING ${viewColumns}
      `;
      if (!row) return fail(err.internal("Updated saved conversation view could not be loaded"));
      if (row.scope === "mailbox") {
        await insertViewActivity({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          viewId: row.id,
          action: "conversation_view.updated",
          metadata: { scope: row.scope, name: row.name, revision },
        });
      }
      return ok(mapView(row));
    });
  } catch (error) {
    return isUniqueViolation(error)
      ? fail(err.conflict("A saved view with this name already exists in this scope"))
      : fail(err.internal("Failed to update saved conversation view"));
  }
};

export const deleteSavedConversationView = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  viewId: string;
  expectedRevision: number;
}): Promise<Result<{ id: string }>> => {
  try {
    return await sql.begin(async (tx): Promise<Result<{ id: string }>> => {
      const read = await lockMailboxForCollaboration(params.context, params.mailboxId, "read", tx);
      if (!read.ok) return read;
      const current = await loadVisibleView({
        db: tx,
        mailboxId: params.mailboxId,
        viewId: params.viewId,
        userId: userBackedActor(params.context)?.id ?? null,
        forUpdate: true,
      });
      if (!current) return fail(err.notFound("Saved conversation view"));
      if (current.scope === "mailbox") {
        const write = await lockMailboxForCollaboration(params.context, params.mailboxId, "write", tx);
        if (!write.ok) return write;
      }
      if (Number(current.revision) !== params.expectedRevision) {
        return fail(err.conflict("Saved conversation view was changed by another request"));
      }
      if (current.scope === "mailbox") {
        await insertViewActivity({
          db: tx,
          context: params.context,
          mailboxId: params.mailboxId,
          viewId: current.id,
          action: "conversation_view.deleted",
          metadata: { scope: current.scope, name: current.name, revision: Number(current.revision) },
        });
      }
      await tx`DELETE FROM mail.saved_conversation_views WHERE id = ${current.id}::uuid`;
      return ok({ id: current.id });
    });
  } catch {
    return fail(err.internal("Failed to delete saved conversation view"));
  }
};

export const listSavedViewConversations = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  viewId: string;
  cursor?: string;
  limit?: number;
}) => {
  const view = await getSavedConversationView(params);
  if (!view.ok) return view;
  return listConversations({
    context: params.context,
    mailboxId: params.mailboxId,
    filter: view.data.filter,
    cursor: params.cursor,
    limit: params.limit,
  });
};
