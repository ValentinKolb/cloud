import {
  type AccessEntry,
  createAccess,
  deleteAccess,
  hasPermission,
  type PermissionLevel,
  type Principal,
  updateAccess,
} from "@valentinkolb/cloud/server";
import { audit } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result, tryCatch, unwrap } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { auditActorFromRequest, capByCredentialScopes, isPlatformAdmin, isResourceBoundToMailbox, type MailRequestContext } from "./auth";

type SqlClient = typeof sql;

type DbAccess = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  service_account_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date | string;
};

const principalFromRow = (row: DbAccess): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.service_account_id) return { type: "service_account", serviceAccountId: row.service_account_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

const mapAccess = (row: DbAccess): AccessEntry => ({
  id: row.id,
  principal: principalFromRow(row),
  permission: row.permission,
  createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
});

const assertShareablePrincipal = (principal: Principal): Result<void> => {
  if (principal.type === "user" || principal.type === "group" || principal.type === "service_account") return ok();
  return fail(err.badInput("Mailboxes can be shared only with users, groups, or service accounts"));
};

const lockMailbox = async (mailboxId: string, db: SqlClient): Promise<boolean> => {
  const [row] = await db<{ id: string }[]>`
    SELECT id
    FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  return Boolean(row);
};

const getPrincipalGrant = async (mailboxId: string, principal: Principal, db: SqlClient): Promise<DbAccess | null> => {
  if (principal.type === "user") {
    const [row] = await db<DbAccess[]>`
      SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
      FROM mail.mailbox_access ma
      JOIN auth.access a ON a.id = ma.access_id
      WHERE ma.mailbox_id = ${mailboxId}::uuid AND a.user_id = ${principal.userId}::uuid
      LIMIT 1
    `;
    return row ?? null;
  }
  if (principal.type === "group") {
    const [row] = await db<DbAccess[]>`
      SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
      FROM mail.mailbox_access ma
      JOIN auth.access a ON a.id = ma.access_id
      WHERE ma.mailbox_id = ${mailboxId}::uuid AND a.group_id = ${principal.groupId}::uuid
      LIMIT 1
    `;
    return row ?? null;
  }
  if (principal.type === "service_account") {
    const [row] = await db<DbAccess[]>`
      SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
      FROM mail.mailbox_access ma
      JOIN auth.access a ON a.id = ma.access_id
      WHERE ma.mailbox_id = ${mailboxId}::uuid AND a.service_account_id = ${principal.serviceAccountId}::uuid
      LIMIT 1
    `;
    return row ?? null;
  }
  return null;
};

export const getMailboxPermission = async (
  context: MailRequestContext,
  mailboxId: string,
  db: SqlClient = sql,
): Promise<PermissionLevel> => {
  if (!isResourceBoundToMailbox(context, mailboxId)) return "none";

  let permission: PermissionLevel = "none";
  if (isPlatformAdmin(context)) {
    permission = "admin";
  } else {
    const userId = context.accessSubject.type === "user" ? context.accessSubject.userId : null;
    const serviceAccountId = context.accessSubject.type === "service_account" ? context.accessSubject.serviceAccountId : null;
    const [row] = await db<{ permission: PermissionLevel }[]>`
      WITH RECURSIVE subject_groups(group_id, path) AS (
        SELECT ug.group_id, ARRAY[ug.group_id]::uuid[]
        FROM auth.user_groups_v2 ug
        WHERE ug.user_id = ${userId}::uuid

        UNION ALL

        SELECT gg.parent_group_id, sg.path || gg.parent_group_id
        FROM auth.group_groups_v2 gg
        JOIN subject_groups sg ON sg.group_id = gg.child_group_id
        WHERE NOT gg.parent_group_id = ANY(sg.path)
      )
      SELECT a.permission
      FROM mail.mailbox_access ma
      JOIN auth.access a ON a.id = ma.access_id
      WHERE ma.mailbox_id = ${mailboxId}::uuid
        AND (
          a.user_id = ${userId}::uuid
          OR a.service_account_id = ${serviceAccountId}::uuid
          OR a.group_id IN (SELECT group_id FROM subject_groups)
        )
      ORDER BY CASE a.permission
        WHEN 'admin' THEN 3
        WHEN 'write' THEN 2
        WHEN 'read' THEN 1
        ELSE 0
      END DESC
      LIMIT 1
    `;
    permission = row?.permission ?? "none";
  }

  return capByCredentialScopes(context, permission);
};

export const requireMailboxPermission = async (
  context: MailRequestContext,
  mailboxId: string,
  required: Exclude<PermissionLevel, "none">,
  db: SqlClient = sql,
): Promise<Result<PermissionLevel>> => {
  const permission = await getMailboxPermission(context, mailboxId, db);
  return hasPermission(permission, required) ? ok(permission) : fail(err.forbidden("Access denied"));
};

export const listMailboxAccess = async (context: MailRequestContext, mailboxId: string): Promise<Result<AccessEntry[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "admin");
  if (!allowed.ok) return allowed;

  const rows = await sql<DbAccess[]>`
    SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
    FROM mail.mailbox_access ma
    JOIN auth.access a ON a.id = ma.access_id
    WHERE ma.mailbox_id = ${mailboxId}::uuid
    ORDER BY CASE a.permission
      WHEN 'admin' THEN 3
      WHEN 'write' THEN 2
      WHEN 'read' THEN 1
      ELSE 0
    END DESC, a.created_at, a.id
  `;
  return ok(rows.map(mapAccess));
};

export const grantMailboxAccess = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  principal: Principal;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<AccessEntry>> => {
  const principalResult = assertShareablePrincipal(params.principal);
  if (!principalResult.ok) return principalResult;

  return tryCatch(
    () =>
      sql.begin(async (tx) => {
        if (!(await lockMailbox(params.mailboxId, tx))) unwrap(fail(err.notFound("Mailbox")));
        unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
        if (await getPrincipalGrant(params.mailboxId, params.principal, tx)) unwrap(fail(err.conflict("Mailbox access")));

        const created = unwrap(await createAccess({ principal: params.principal, permission: params.permission }, tx));
        await tx`
          INSERT INTO mail.mailbox_access (mailbox_id, access_id)
          VALUES (${params.mailboxId}::uuid, ${created.id}::uuid)
        `;
        await audit.record(
          {
            action: "mail.mailbox.access.grant",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "mailbox", id: params.mailboxId },
            requestId: params.context.requestId,
            metadata: { accessId: created.id, principal: params.principal, permission: params.permission },
          },
          tx,
        );

        const [row] = await tx<DbAccess[]>`
          SELECT id, user_id, group_id, service_account_id, authenticated_only, permission, created_at
          FROM auth.access
          WHERE id = ${created.id}::uuid
        `;
        if (!row) throw new Error("Created access entry could not be loaded");
        return mapAccess(row);
      }),
    () => err.internal("Failed to grant mailbox access"),
  );
};

const lockAccessEntries = async (mailboxId: string, db: SqlClient): Promise<DbAccess[]> =>
  db<DbAccess[]>`
    SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
    FROM mail.mailbox_access ma
    JOIN auth.access a ON a.id = ma.access_id
    WHERE ma.mailbox_id = ${mailboxId}::uuid
    ORDER BY a.id
    FOR UPDATE OF a
  `;

const ensureAdminRemains = (entries: DbAccess[], accessId: string, nextPermission: PermissionLevel | null): Result<void> => {
  const current = entries.find((entry) => entry.id === accessId);
  if (!current) return fail(err.notFound("Mailbox access"));
  if (current.permission !== "admin" || nextPermission === "admin") return ok();
  if (entries.some((entry) => entry.id !== accessId && entry.permission === "admin")) return ok();
  return fail(err.badInput("A mailbox must keep at least one administrator"));
};

export const updateMailboxAccess = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  accessId: string;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<void>> =>
  tryCatch(
    () =>
      sql.begin(async (tx) => {
        if (!(await lockMailbox(params.mailboxId, tx))) unwrap(fail(err.notFound("Mailbox")));
        unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
        const entries = await lockAccessEntries(params.mailboxId, tx);
        unwrap(ensureAdminRemains(entries, params.accessId, params.permission));
        unwrap(await updateAccess({ id: params.accessId, permission: params.permission }, tx));
        await audit.record(
          {
            action: "mail.mailbox.access.update",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "mailbox", id: params.mailboxId },
            requestId: params.context.requestId,
            metadata: { accessId: params.accessId, permission: params.permission },
          },
          tx,
        );
      }),
    () => err.internal("Failed to update mailbox access"),
  );

export const revokeMailboxAccess = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  accessId: string;
}): Promise<Result<void>> =>
  tryCatch(
    () =>
      sql.begin(async (tx) => {
        if (!(await lockMailbox(params.mailboxId, tx))) unwrap(fail(err.notFound("Mailbox")));
        unwrap(await requireMailboxPermission(params.context, params.mailboxId, "admin", tx));
        const entries = await lockAccessEntries(params.mailboxId, tx);
        unwrap(ensureAdminRemains(entries, params.accessId, null));
        await tx`
          DELETE FROM mail.mailbox_access
          WHERE mailbox_id = ${params.mailboxId}::uuid AND access_id = ${params.accessId}::uuid
        `;
        unwrap(await deleteAccess({ id: params.accessId }, tx));
        await audit.record(
          {
            action: "mail.mailbox.access.revoke",
            outcome: "allowed",
            actor: auditActorFromRequest(params.context),
            target: { type: "mailbox", id: params.mailboxId },
            requestId: params.context.requestId,
            metadata: { accessId: params.accessId },
          },
          tx,
        );
      }),
    () => err.internal("Failed to revoke mailbox access"),
  );
