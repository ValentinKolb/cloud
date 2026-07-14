import type { ServiceAccount } from "@valentinkolb/cloud/contracts";
import {
  buildAccessPrincipalCondition,
  err,
  fail,
  ok,
  type AccessSubject,
  type PermissionLevel,
  type Result,
} from "@valentinkolb/cloud/server";
import { sql } from "bun";

export type UserScope = {
  id: string;
};

export type ResourceScope = {
  subject: Extract<AccessSubject, { type: "service_account" }>;
  serviceAccount: Pick<ServiceAccount, "appId" | "resourceType" | "resourceId">;
  scopes: readonly string[];
};

export type AccessScope = UserScope | ResourceScope;

const PERMISSION_RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };

const isResourceScope = (scope: AccessScope): scope is ResourceScope => "subject" in scope;

const subjectForScope = (scope: AccessScope): AccessSubject =>
  isResourceScope(scope) ? scope.subject : { type: "user", userId: scope.id };

export const userIdForScope = (scope: AccessScope): string | null =>
  isResourceScope(scope) ? null : scope.id;

const scopedPermission = (scope: AccessScope): PermissionLevel => {
  if (!isResourceScope(scope)) return "admin";
  if (scope.scopes.includes("admin")) return "admin";
  if (scope.scopes.includes("write")) return "write";
  if (scope.scopes.includes("read")) return "read";
  return "none";
};

const isBoundToBase = (baseId: string, scope: AccessScope): boolean =>
  !isResourceScope(scope) ||
  (scope.serviceAccount.appId === "pulse" &&
    scope.serviceAccount.resourceType === "pulse_base" &&
    scope.serviceAccount.resourceId === baseId);

const boundBaseIdForScope = (scope: AccessScope): string | null => {
  if (!isResourceScope(scope)) return null;
  return scope.serviceAccount.appId === "pulse" && scope.serviceAccount.resourceType === "pulse_base"
    ? scope.serviceAccount.resourceId
    : null;
};

const canRequestPermission = (scope: AccessScope, required: PermissionLevel): boolean =>
  PERMISSION_RANK[scopedPermission(scope)] >= PERMISSION_RANK[required];

export const requireBaseAccess = async (
  baseId: string,
  scope: AccessScope,
  required: PermissionLevel,
): Promise<Result<void>> => {
  if (!isBoundToBase(baseId, scope) || !canRequestPermission(scope, required)) {
    return fail(err.forbidden("Access denied"));
  }

  const principalMatch = buildAccessPrincipalCondition({
    subject: subjectForScope(scope),
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });
  const [row] = await sql<{ permission: PermissionLevel }[]>`
    SELECT MAX(a.permission)::text AS permission
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${baseId}::uuid
      AND ${principalMatch}
  `;
  const level = row?.permission ?? "none";
  return PERMISSION_RANK[level] >= PERMISSION_RANK[required]
    ? ok()
    : fail(err.forbidden("Access denied"));
};

export const listBaseIdsVisibleTo = async (scope: AccessScope): Promise<string[]> => {
  if (!canRequestPermission(scope, "read")) return [];
  const boundBaseId = boundBaseIdForScope(scope);
  if (isResourceScope(scope) && !boundBaseId) return [];

  const principalMatch = buildAccessPrincipalCondition({
    subject: subjectForScope(scope),
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });
  const rows = await sql<{ id: string }[]>`
    SELECT DISTINCT ba.base_id AS id
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ${principalMatch}
      AND (${boundBaseId}::text IS NULL OR ba.base_id::text = ${boundBaseId})
  `;
  return rows.map((row) => row.id);
};

export const requireBaseActive = async (baseId: string): Promise<Result<void>> => {
  const [row] = await sql<{
    deletion_started_at: Date | string | null;
    data_clear_started_at: Date | string | null;
    data_clear_completed_at: Date | string | null;
    data_clear_failed_at: Date | string | null;
  }[]>`
    SELECT deletion_started_at, data_clear_started_at, data_clear_completed_at, data_clear_failed_at
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  if (!row) return fail(err.notFound("Pulse base"));
  if (row.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));
  if (row.data_clear_started_at && !row.data_clear_completed_at && !row.data_clear_failed_at) {
    return fail(err.conflict("Pulse base data is being cleared"));
  }
  return ok();
};
