import { createAccess, type PermissionLevel } from "@valentinkolb/cloud/server";
import { audit } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result, tryCatch, unwrap } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateMailboxInput, Mailbox } from "../contracts";
import { getMailboxPermission, requireMailboxPermission } from "./access";
import {
  actorRefFromRequest,
  auditActorFromRequest,
  capByCredentialScopes,
  isPlatformAdmin,
  isResourceBoundToMailbox,
  type MailRequestContext,
  userBackedActor,
} from "./auth";

type DbMailbox = {
  id: string;
  name: string;
  description: string | null;
  connection_policy: Mailbox["connectionPolicy"];
  health: Mailbox["health"];
  health_reason: string | null;
  sync_enabled: boolean;
  search_backend: Mailbox["searchBackend"];
  created_at: Date | string;
  updated_at: Date | string;
};

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const mapMailbox = (row: DbMailbox): Mailbox => ({
  id: row.id,
  name: row.name,
  description: row.description,
  connectionPolicy: row.connection_policy,
  health: row.health,
  healthReason: row.health_reason,
  syncEnabled: row.sync_enabled,
  searchBackend: row.search_backend,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mailboxColumns = sql`
  m.id, m.name, m.description, m.connection_policy, m.health, m.health_reason,
  m.sync_enabled, m.search_backend, m.created_at, m.updated_at
`;

export const createMailbox = async (context: MailRequestContext, input: CreateMailboxInput): Promise<Result<Mailbox>> => {
  const owner = userBackedActor(context);
  if (!owner) return fail(err.forbidden("Creating a mailbox requires a user-backed actor"));

  const actorRef = actorRefFromRequest(context);
  return tryCatch(
    () =>
      sql.begin(async (tx) => {
        const [row] = await tx<DbMailbox[]>`
          INSERT INTO mail.mailboxes (
            name,
            description,
            connection_policy,
            created_by_user_id,
            created_by_service_account_id
          )
          VALUES (
            ${input.name.trim()},
            ${input.description?.trim() || null},
            ${input.connectionPolicy},
            ${owner.id}::uuid,
            ${context.actor.kind === "service_account" ? context.actor.serviceAccount.id : null}::uuid
          )
          RETURNING id, name, description, connection_policy, health, health_reason, sync_enabled, search_backend, created_at, updated_at
        `;
        if (!row) throw new Error("Mailbox insert returned no row");

        const access = unwrap(await createAccess({ principal: { type: "user", userId: owner.id }, permission: "admin" }, tx));
        await tx`
          INSERT INTO mail.mailbox_access (mailbox_id, access_id)
          VALUES (${row.id}::uuid, ${access.id}::uuid)
        `;
        await tx`
          INSERT INTO mail.activity_events (
            mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
          )
          VALUES (
            ${row.id}::uuid,
            ${actorRef.kind},
            ${actorRef.kind === "user" ? actorRef.userId : actorRef.kind === "service_account" ? actorRef.serviceAccountId : null}::uuid,
            'mailbox.created',
            'confirmed',
            'mailbox',
            ${row.id}::uuid,
            ${{ connectionPolicy: input.connectionPolicy }}::jsonb
          )
        `;
        await audit.record(
          {
            action: "mail.mailbox.create",
            outcome: "allowed",
            actor: auditActorFromRequest(context),
            target: { type: "mailbox", id: row.id, label: row.name },
            requestId: context.requestId,
            metadata: { connectionPolicy: row.connection_policy },
          },
          tx,
        );
        return mapMailbox(row);
      }),
    () => err.internal("Failed to create mailbox"),
  );
};

export const getMailbox = async (context: MailRequestContext, mailboxId: string): Promise<Result<Mailbox>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const [row] = await sql<DbMailbox[]>`
    SELECT ${mailboxColumns}
    FROM mail.mailboxes m
    WHERE m.id = ${mailboxId}::uuid AND m.deleted_at IS NULL
  `;
  return row ? ok(mapMailbox(row)) : fail(err.notFound("Mailbox"));
};

export const listMailboxes = async (
  context: MailRequestContext,
  limit = 100,
): Promise<Result<Array<Mailbox & { permission: PermissionLevel }>>> => {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  if (context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound") {
    const mailboxId = context.actor.serviceAccount.resourceId;
    if (!mailboxId || !isResourceBoundToMailbox(context, mailboxId)) return ok([]);
    const mailbox = await getMailbox(context, mailboxId);
    if (!mailbox.ok) return mailbox.error.code === "FORBIDDEN" || mailbox.error.code === "NOT_FOUND" ? ok([]) : mailbox;
    const permission = await getMailboxPermission(context, mailboxId);
    return permission === "none" ? ok([]) : ok([{ ...mailbox.data, permission }]);
  }

  if (isPlatformAdmin(context)) {
    const rows = await sql<DbMailbox[]>`
      SELECT ${mailboxColumns}
      FROM mail.mailboxes m
      WHERE m.deleted_at IS NULL
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT ${boundedLimit}
    `;
    const permission = capByCredentialScopes(context, "admin");
    return permission === "none" ? ok([]) : ok(rows.map((row) => ({ ...mapMailbox(row), permission })));
  }

  const userId = context.accessSubject.type === "user" ? context.accessSubject.userId : null;
  const serviceAccountId = context.accessSubject.type === "service_account" ? context.accessSubject.serviceAccountId : null;
  const rows = await sql<(DbMailbox & { permission: PermissionLevel })[]>`
    WITH RECURSIVE subject_groups(group_id, path) AS (
      SELECT ug.group_id, ARRAY[ug.group_id]::uuid[]
      FROM auth.user_groups_v2 ug
      WHERE ug.user_id = ${userId}::uuid

      UNION ALL

      SELECT gg.parent_group_id, sg.path || gg.parent_group_id
      FROM auth.group_groups_v2 gg
      JOIN subject_groups sg ON sg.group_id = gg.child_group_id
      WHERE NOT gg.parent_group_id = ANY(sg.path)
    ), ranked AS (
      SELECT
        ma.mailbox_id,
        max(CASE a.permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END) AS permission_rank
      FROM mail.mailbox_access ma
      JOIN auth.access a ON a.id = ma.access_id
      WHERE a.user_id = ${userId}::uuid
        OR a.service_account_id = ${serviceAccountId}::uuid
        OR a.group_id IN (SELECT group_id FROM subject_groups)
      GROUP BY ma.mailbox_id
    )
    SELECT
      ${mailboxColumns},
      CASE ranked.permission_rank WHEN 3 THEN 'admin'::auth.permission_level WHEN 2 THEN 'write'::auth.permission_level ELSE 'read'::auth.permission_level END AS permission
    FROM mail.mailboxes m
    JOIN ranked ON ranked.mailbox_id = m.id AND ranked.permission_rank >= 1
    WHERE m.deleted_at IS NULL
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT ${boundedLimit}
  `;

  return ok(
    rows
      .map((row) => ({ ...mapMailbox(row), permission: capByCredentialScopes(context, row.permission) }))
      .filter((row) => row.permission !== "none"),
  );
};

export const updateMailbox = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  name?: string;
  description?: string | null;
  syncEnabled?: boolean;
  searchBackend?: Mailbox["searchBackend"];
}): Promise<Result<Mailbox>> => {
  const name = params.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 160)) return fail(err.badInput("Mailbox name is invalid"));
  const description = params.description?.trim() || null;
  if (description && description.length > 2_000) return fail(err.badInput("Mailbox description is too long"));

  return tryCatch(
    () =>
      sql.begin(async (tx) => {
        const [locked] = await tx<{ id: string }[]>`
          SELECT id FROM mail.mailboxes WHERE id = ${params.mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
        `;
        if (!locked) unwrap(fail(err.notFound("Mailbox")));
        unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
        const [row] = await tx<DbMailbox[]>`
          UPDATE mail.mailboxes
          SET
            name = COALESCE(${name ?? null}, name),
            description = CASE WHEN ${params.description !== undefined} THEN ${description} ELSE description END,
            sync_enabled = COALESCE(${params.syncEnabled ?? null}, sync_enabled),
            search_backend = COALESCE(${params.searchBackend ?? null}, search_backend),
            health = CASE
              WHEN ${params.syncEnabled === false} THEN 'paused'
              WHEN ${params.syncEnabled === true} AND health = 'paused' THEN 'bootstrapping'
              ELSE health
            END,
            health_reason = CASE
              WHEN ${params.syncEnabled === false} THEN 'Synchronization paused by a mailbox administrator'
              WHEN ${params.syncEnabled === true} AND health = 'paused' THEN 'Synchronization resumed; provider reconciliation pending'
              ELSE health_reason
            END
          WHERE id = ${params.mailboxId}::uuid
          RETURNING id, name, description, connection_policy, health, health_reason, sync_enabled, search_backend, created_at, updated_at
        `;
        if (!row) throw new Error("Mailbox update returned no row");
        await audit.record(
          {
            action: "mail.mailbox.update",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "mailbox", id: params.mailboxId, label: row.name },
            requestId: params.context.requestId,
            metadata: { changed: Object.keys(params).filter((key) => key !== "context" && key !== "mailboxId") },
          },
          tx,
        );
        return mapMailbox(row);
      }),
    () => err.internal("Failed to update mailbox"),
  );
};

export const deleteMailbox = async (context: MailRequestContext, mailboxId: string): Promise<Result<void>> =>
  tryCatch(
    () =>
      sql.begin(async (tx) => {
        const [row] = await tx<{ id: string; name: string }[]>`
          SELECT id, name FROM mail.mailboxes WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL FOR UPDATE
        `;
        if (!row) {
          const notFound = err.notFound("Mailbox");
          throw Object.assign(new Error(notFound.message), notFound);
        }
        unwrap(await requireMailboxPermission(context, mailboxId, "admin", tx));
        await tx`
          UPDATE mail.mailboxes
          SET deleted_at = now(), sync_enabled = false, health = 'paused', health_reason = 'Mailbox deleted'
          WHERE id = ${mailboxId}::uuid
        `;
        await audit.record(
          {
            action: "mail.mailbox.delete",
            outcome: "allowed",
            actor: auditActorFromRequest(context),
            target: { type: "mailbox", id: mailboxId, label: row.name },
            requestId: context.requestId,
          },
          tx,
        );
      }),
    () => err.internal("Failed to delete mailbox"),
  );
