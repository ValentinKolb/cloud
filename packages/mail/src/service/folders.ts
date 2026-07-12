import { audit } from "@valentinkolb/cloud/services";
import { err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  configurableFolderRoleSchema,
  type ConfigurableFolderRole,
  type FolderRole,
} from "../contracts";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";

type SqlClient = typeof sql;

export type ResolvedRoleFolder = {
  id: string;
  role: ConfigurableFolderRole;
  providerRole: FolderRole;
  configured: boolean;
};

export const resolveRoleFolder = async (
  mailboxId: string,
  role: ConfigurableFolderRole,
  db: SqlClient = sql,
): Promise<Result<ResolvedRoleFolder>> => {
  const parsedRole = configurableFolderRoleSchema.safeParse(role);
  if (!parsedRole.success) return fail(err.badInput("Unsupported configurable folder role"));
  const rows = await db<{ id: string; provider_role: FolderRole; configured: boolean }[]>`
    WITH configured AS (
      SELECT override.folder_id
      FROM mail.folder_role_overrides override
      WHERE override.mailbox_id = ${mailboxId}::uuid AND override.role = ${parsedRole.data}
    )
    SELECT
      folder.id,
      folder.role AS provider_role,
      configured.folder_id IS NOT NULL AS configured
    FROM mail.folders folder
    JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
    LEFT JOIN configured ON configured.folder_id = folder.id
    WHERE resource.mailbox_id = ${mailboxId}::uuid
      AND folder.discovery_state = 'active'
      AND folder.selectable
      AND (configured.folder_id IS NOT NULL OR folder.role = ${parsedRole.data})
    ORDER BY configured DESC, folder.id
  `;
  const configured = rows.find((row) => row.configured);
  if (configured) return ok({ id: configured.id, role: parsedRole.data, providerRole: configured.provider_role, configured: true });
  if (rows.length === 1) {
    const folder = rows[0]!;
    return ok({ id: folder.id, role: parsedRole.data, providerRole: folder.provider_role, configured: false });
  }
  return rows.length === 0
    ? fail(err.badInput(`No ${parsedRole.data} folder is configured`))
    : fail(err.conflict(`Several provider folders claim the ${parsedRole.data} role; configure one explicitly`));
};

export const setFolderRole = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  folderId: string;
  role: ConfigurableFolderRole;
}): Promise<Result<ResolvedRoleFolder>> => {
  const parsedRole = configurableFolderRoleSchema.safeParse(params.role);
  if (!parsedRole.success) return fail(err.badInput("Unsupported configurable folder role"));
  const actor = actorRefFromRequest(params.context);
  try {
    return await sql.begin(async (tx) => {
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;
      const [folder] = await tx<{ id: string; provider_role: FolderRole }[]>`
        SELECT folder.id, folder.role AS provider_role
        FROM mail.folders folder
        JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
        WHERE folder.id = ${params.folderId}::uuid
          AND resource.mailbox_id = ${params.mailboxId}::uuid
          AND folder.discovery_state = 'active'
          AND folder.selectable
        FOR UPDATE OF folder
      `;
      if (!folder) return fail(err.notFound("Mail folder"));
      await tx`DELETE FROM mail.folder_role_overrides WHERE mailbox_id = ${params.mailboxId}::uuid AND folder_id = ${params.folderId}::uuid`;
      await tx`
        INSERT INTO mail.folder_role_overrides (mailbox_id, role, folder_id)
        VALUES (${params.mailboxId}::uuid, ${parsedRole.data}, ${params.folderId}::uuid)
        ON CONFLICT (mailbox_id, role) DO UPDATE SET folder_id = EXCLUDED.folder_id, updated_at = now()
      `;
      await tx`
        INSERT INTO mail.activity_events (
          mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${actor.kind},
          ${actor.kind === "user" ? actor.userId : actor.kind === "service_account" ? actor.serviceAccountId : null}::uuid,
          'folder.role_configured',
          'confirmed',
          'folder',
          ${params.folderId}::uuid,
          ${{ role: parsedRole.data }}::jsonb
        )
      `;
      await audit.record(
        {
          action: "mail.folder.role.configure",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: { folderId: params.folderId, role: parsedRole.data },
        },
        tx,
      );
      return ok({ id: folder.id, role: parsedRole.data, providerRole: folder.provider_role, configured: true });
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to configure folder role"));
  }
};

export const clearFolderRole = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  role: ConfigurableFolderRole;
}): Promise<Result<void>> => {
  const parsedRole = configurableFolderRoleSchema.safeParse(params.role);
  if (!parsedRole.success) return fail(err.badInput("Unsupported configurable folder role"));
  const actor = actorRefFromRequest(params.context);
  try {
    return await sql.begin(async (tx) => {
      const permission = await requireMailboxPermission(params.context, params.mailboxId, "admin", tx);
      if (!permission.ok) return permission;
      const [removed] = await tx<{ folder_id: string }[]>`
        DELETE FROM mail.folder_role_overrides
        WHERE mailbox_id = ${params.mailboxId}::uuid AND role = ${parsedRole.data}
        RETURNING folder_id
      `;
      if (removed) {
        await tx`
          INSERT INTO mail.activity_events (
            mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
          ) VALUES (
            ${params.mailboxId}::uuid,
            ${actor.kind},
            ${actor.kind === "user" ? actor.userId : actor.kind === "service_account" ? actor.serviceAccountId : null}::uuid,
            'folder.role_cleared',
            'confirmed',
            'folder',
            ${removed.folder_id}::uuid,
            ${{ role: parsedRole.data }}::jsonb
          )
        `;
      }
      await audit.record(
        {
          action: "mail.folder.role.clear",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "mailbox", id: params.mailboxId },
          requestId: params.context.requestId,
          metadata: { role: parsedRole.data, folderId: removed?.folder_id ?? null, changed: Boolean(removed) },
        },
        tx,
      );
      return ok();
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to clear folder role"));
  }
};
