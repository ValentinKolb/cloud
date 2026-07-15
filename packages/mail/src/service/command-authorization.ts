import { accounts, toPgTextArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";

export type StoredCommandAuthorization = {
  mailbox_id: string;
  actor_kind: "user" | "service_account" | "workflow" | "system";
  actor_id: string | null;
  initiator_actor_kind: "user" | "service_account" | null;
  initiator_actor_id: string | null;
  access_subject_kind: "user" | "service_account" | "system";
  access_subject_id: string | null;
  credential_scopes: string[] | null;
  credential_id: string | null;
  credential_expires_at: Date | string | null;
};

const permissionRank = (permission: string | null | undefined): number => {
  if (permission === "admin") return 3;
  if (permission === "write") return 2;
  if (permission === "read") return 1;
  return 0;
};

const requiredRank = (permission: "write" | "admin"): number => (permission === "admin" ? 3 : 2);

const scopeRank = (scopes: readonly string[]): number => {
  if (scopes.includes("admin") || scopes.includes("mail:admin") || scopes.includes("mail:*")) return 3;
  if (scopes.includes("write") || scopes.includes("mail:write")) return 2;
  if (scopes.includes("read") || scopes.includes("mail:read")) return 1;
  return 0;
};

const serviceAccountActorAllowed = async (command: StoredCommandAuthorization, permission: "write" | "admin"): Promise<boolean> => {
  const actorKind = command.initiator_actor_kind ?? command.actor_kind;
  const actorId = command.initiator_actor_id ?? command.actor_id;
  if (actorKind !== "service_account") return true;
  if (!actorId || scopeRank(command.credential_scopes ?? []) < requiredRank(permission)) return false;
  if (command.credential_id) {
    const [credential] = await sql<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM auth.service_account_credentials credential
        WHERE credential.id = ${command.credential_id}::uuid
          AND credential.service_account_id = ${actorId}::uuid
          AND credential.status = 'active'
          AND credential.revoked_at IS NULL
          AND (credential.expires_at IS NULL OR credential.expires_at > now())
          AND credential.scopes @> ${toPgTextArray(command.credential_scopes ?? [])}::text[]
          AND credential.scopes <@ ${toPgTextArray(command.credential_scopes ?? [])}::text[]
      ) AS active
    `;
    if (credential?.active !== true) return false;
  } else {
    const expiresAt = command.credential_expires_at ? new Date(command.credential_expires_at).getTime() : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  }
  const [serviceAccount] = await sql<
    {
      status: string;
      kind: string;
      app_id: string | null;
      resource_type: string | null;
      resource_id: string | null;
    }[]
  >`
    SELECT status, kind, app_id, resource_type, resource_id
    FROM auth.service_accounts
    WHERE id = ${actorId}::uuid
  `;
  if (!serviceAccount || serviceAccount.status !== "active") return false;
  if (serviceAccount.kind !== "resource_bound") return true;
  return (
    serviceAccount.app_id === "mail" && serviceAccount.resource_type === "mailbox" && serviceAccount.resource_id === command.mailbox_id
  );
};

const loadAccessSubjectState = async (command: StoredCommandAuthorization): Promise<{ active: boolean; admin: boolean }> => {
  if (!command.access_subject_id) return { active: false, admin: false };
  if (command.access_subject_kind === "user") {
    const user = await accounts.users.get({ id: command.access_subject_id });
    const active = Boolean(user && (user.accountExpires === null || Date.parse(user.accountExpires) > Date.now()));
    return { active, admin: active && user?.roles.includes("admin") === true };
  }
  const [serviceAccount] = await sql<{ status: string }[]>`
    SELECT status FROM auth.service_accounts WHERE id = ${command.access_subject_id}::uuid
  `;
  return { active: serviceAccount?.status === "active", admin: false };
};

const loadMailboxGrant = async (command: StoredCommandAuthorization): Promise<string | null> => {
  const userId = command.access_subject_kind === "user" ? command.access_subject_id : null;
  const serviceAccountId = command.access_subject_kind === "service_account" ? command.access_subject_id : null;
  const [grant] = await sql<{ permission: string }[]>`
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
    WHERE ma.mailbox_id = ${command.mailbox_id}::uuid
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
  return grant?.permission ?? null;
};

export const commandStillAuthorized = async (command: StoredCommandAuthorization, permission: "write" | "admin"): Promise<boolean> => {
  if (command.access_subject_kind === "system") {
    if (command.actor_kind === "system") return true;
    if (command.actor_kind !== "workflow" || !command.actor_id) return false;
    const [workflow] = await sql<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM mail.workflows workflow
        WHERE workflow.mailbox_id = ${command.mailbox_id}::uuid
          AND workflow.active_version_id = ${command.actor_id}::uuid
      ) AS active
    `;
    return workflow?.active === true;
  }
  if (!(await serviceAccountActorAllowed(command, permission))) return false;
  const subject = await loadAccessSubjectState(command);
  if (!subject.active) return false;
  return subject.admin || permissionRank(await loadMailboxGrant(command)) >= requiredRank(permission);
};
