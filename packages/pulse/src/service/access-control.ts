import { err, fail, ok, type PermissionLevel, type Result } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";

export type UserScope = {
  id: string;
  memberofGroupIds?: string[];
};

export const requireBaseAccess = async (
  baseId: string,
  user: UserScope,
  required: PermissionLevel,
): Promise<Result<void>> => {
  const groups = toPgUuidArray(user.memberofGroupIds ?? []);
  const [row] = await sql<{ permission: PermissionLevel }[]>`
    SELECT MAX(a.permission)::text AS permission
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${baseId}::uuid
      AND (
        a.user_id = ${user.id}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
      )
  `;
  const level = row?.permission ?? "none";
  const rank: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };
  return rank[level] >= rank[required] ? ok() : fail(err.forbidden("Access denied"));
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
