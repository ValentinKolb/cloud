import {
  err,
  fail,
  ok,
  resolveDisplayNames,
  type AccessEntry,
  type PermissionLevel,
  type Principal,
  type Result,
} from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { PulseBase } from "../contracts";
import { requireBaseAccess, type UserScope } from "./access-control";
import { submitBaseDataClearJob, submitBaseDeletionJob } from "./base-lifecycle";
import { PULSE_APP_ID, PULSE_SOURCE_RESOURCE_TYPE } from "./source-management";
import { iso, isoNullable } from "./telemetry-values";

type BaseRow = {
  id: string;
  name: string;
  description: string | null;
  retention_days: number;
  created_by: string | null;
  deletion_started_at: Date | string | null;
  deletion_failed_at: Date | string | null;
  deletion_error: string | null;
  data_clear_started_at: Date | string | null;
  data_clear_completed_at: Date | string | null;
  data_clear_failed_at: Date | string | null;
  data_clear_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AccessRow = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date | string;
};

type BaseUpdateInput = {
  name?: string;
  description?: string | null;
  retentionDays?: number;
};

type BaseUpdateValues = {
  name: string;
  description: string | null;
  retentionDays: number;
};

const mapBase = (row: BaseRow): PulseBase => ({
  id: row.id,
  name: row.name,
  description: row.description,
  retentionDays: row.retention_days,
  createdBy: row.created_by,
  deletionStartedAt: isoNullable(row.deletion_started_at),
  deletionFailedAt: isoNullable(row.deletion_failed_at),
  deletionError: row.deletion_error,
  dataClearStartedAt: isoNullable(row.data_clear_started_at),
  dataClearCompletedAt: isoNullable(row.data_clear_completed_at),
  dataClearFailedAt: isoNullable(row.data_clear_failed_at),
  dataClearError: row.data_clear_error,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const principalFromAccessRow = (row: Pick<AccessRow, "user_id" | "group_id" | "authenticated_only">): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

const mapAccessRow = (row: AccessRow): AccessEntry => ({
  id: row.id,
  principal: principalFromAccessRow(row),
  permission: row.permission,
  createdAt: iso(row.created_at),
});

export const listBases = async (user: UserScope): Promise<Result<PulseBase[]>> => {
  const groups = toPgUuidArray(user.memberofGroupIds ?? []);
  const rows = await sql<BaseRow[]>`
    SELECT DISTINCT b.*
    FROM pulse.bases b
    JOIN pulse.base_access ba ON ba.base_id = b.id
    JOIN auth.access a ON a.id = ba.access_id
    WHERE b.deletion_started_at IS NULL
      AND (
        a.user_id = ${user.id}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
      )
    ORDER BY b.updated_at DESC, b.name ASC
  `;
  return ok(rows.map(mapBase));
};

export const createBase = async (params: { name: string; description?: string | null; user: UserScope }): Promise<Result<PulseBase>> => {
  const name = params.name.trim();
  if (!name) return fail(err.badInput("Base name is required"));

  const created = await sql.begin(async (tx): Promise<Result<BaseRow>> => {
    const [base] = await tx<BaseRow[]>`
      INSERT INTO pulse.bases (name, description, created_by)
      VALUES (${name}, ${params.description?.trim() || null}, ${params.user.id}::uuid)
      RETURNING *
    `;
    if (!base) return fail(err.internal("Failed to create Pulse base"));

    const [access] = await tx<{ id: string }[]>`
      INSERT INTO auth.access (user_id, permission)
      VALUES (${params.user.id}::uuid, 'admin'::auth.permission_level)
      RETURNING id
    `;
    if (!access) return fail(err.internal("Failed to create base access"));
    await tx`
      INSERT INTO pulse.base_access (base_id, access_id)
      VALUES (${base.id}::uuid, ${access.id}::uuid)
    `;
    return ok(base);
  });

  if (!created.ok) return created;
  return ok(mapBase(created.data));
};

export const listBaseAccess = async (baseId: string, user: UserScope): Promise<Result<AccessEntry[]>> => {
  const access = await requireBaseAccess(baseId, user, "admin");
  if (!access.ok) return fail(access.error);
  const rows = await sql<AccessRow[]>`
    SELECT a.id, a.user_id, a.group_id, a.authenticated_only, a.permission, a.created_at
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${baseId}::uuid
    ORDER BY a.created_at
  `;
  return ok(await resolveDisplayNames(rows.map(mapAccessRow)));
};

export const grantBaseAccess = async (params: {
  baseId: string;
  user: UserScope;
  principal: Principal;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<AccessEntry>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  const created = await sql.begin(async (tx): Promise<Result<AccessRow>> => {
    let userId: string | null = null;
    let groupId: string | null = null;
    let authenticatedOnly = false;

    if (params.principal.type === "user") {
      userId = params.principal.userId;
      const [userRow] = await tx<{ id: string }[]>`SELECT id FROM auth.users WHERE id = ${userId}::uuid`;
      if (!userRow) return fail(err.notFound("User"));
    } else if (params.principal.type === "group") {
      groupId = params.principal.groupId;
      const [groupRow] = await tx<{ id: string }[]>`SELECT id FROM auth.groups WHERE id = ${groupId}::uuid`;
      if (!groupRow) return fail(err.notFound("Group"));
    } else if (params.principal.type === "authenticated") {
      authenticatedOnly = true;
    }

    const [row] = await tx<AccessRow[]>`
      INSERT INTO auth.access (user_id, group_id, authenticated_only, permission)
      VALUES (${userId}::uuid, ${groupId}::uuid, ${authenticatedOnly}, ${params.permission}::auth.permission_level)
      RETURNING id, user_id, group_id, authenticated_only, permission, created_at
    `;
    if (!row) return fail(err.internal("Failed to create access entry"));
    await tx`
      INSERT INTO pulse.base_access (base_id, access_id)
      VALUES (${params.baseId}::uuid, ${row.id}::uuid)
    `;
    return ok(row);
  });

  if (!created.ok) return fail(created.error);
  const [entry] = await resolveDisplayNames([mapAccessRow(created.data)]);
  return entry ? ok(entry) : fail(err.internal("Failed to resolve access entry"));
};

const hasBaseAccessBinding = async (baseId: string, accessId: string): Promise<boolean> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM pulse.base_access WHERE base_id = ${baseId}::uuid AND access_id = ${accessId}::uuid
    ) AS exists
  `;
  return row?.exists === true;
};

export const updateBaseAccess = async (params: {
  baseId: string;
  accessId: string;
  user: UserScope;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  if (!(await hasBaseAccessBinding(params.baseId, params.accessId))) return fail(err.notFound("Access entry"));
  const updated = await sql`
    UPDATE auth.access
    SET permission = ${params.permission}::auth.permission_level
    WHERE id = ${params.accessId}::uuid
  `;
  if (updated.count === 0) return fail(err.notFound("Access entry"));
  return ok();
};

export const revokeBaseAccess = async (params: { baseId: string; accessId: string; user: UserScope }): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  if (!(await hasBaseAccessBinding(params.baseId, params.accessId))) return fail(err.notFound("Access entry"));
  const deleted = await sql`DELETE FROM auth.access WHERE id = ${params.accessId}::uuid`;
  if (deleted.count === 0) return fail(err.notFound("Access entry"));
  return ok();
};

export const getBase = async (baseId: string, user: UserScope): Promise<Result<PulseBase>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const [row] = await sql<BaseRow[]>`
    SELECT *
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
      AND deletion_started_at IS NULL
  `;
  return row ? ok(mapBase(row)) : fail(err.notFound("Pulse base"));
};

const getMutableBase = async (baseId: string): Promise<Result<BaseRow>> => {
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));
  if (existing.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));
  return ok(existing);
};

const normalizeBaseName = (input: BaseUpdateInput, existing: BaseRow): string =>
  input.name?.trim() || existing.name;

const normalizeBaseDescription = (input: BaseUpdateInput, existing: BaseRow): string | null =>
  input.description === undefined ? existing.description : input.description?.trim() || null;

const validateRetentionDays = (retentionDays: number): Result<number> =>
  Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650
    ? ok(retentionDays)
    : fail(err.badInput("Retention must be between 1 and 3650 days"));

const normalizeBaseUpdateValues = (input: BaseUpdateInput, existing: BaseRow): Result<BaseUpdateValues> => {
  const retention = validateRetentionDays(input.retentionDays ?? existing.retention_days);
  if (!retention.ok) return fail(retention.error);
  return ok({
    name: normalizeBaseName(input, existing),
    description: normalizeBaseDescription(input, existing),
    retentionDays: retention.data,
  });
};

const persistBaseUpdate = async (baseId: string, values: BaseUpdateValues): Promise<Result<BaseRow>> => {
  const [row] = await sql<BaseRow[]>`
    UPDATE pulse.bases
    SET name = ${values.name}, description = ${values.description}, retention_days = ${values.retentionDays}, updated_at = now()
    WHERE id = ${baseId}::uuid
    RETURNING *
  `;
  return row ? ok(row) : fail(err.internal("Failed to update Pulse base"));
};

export const updateBase = async (params: {
  baseId: string;
  user: UserScope;
  name?: string;
  description?: string | null;
  retentionDays?: number;
}): Promise<Result<PulseBase>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const existing = await getMutableBase(params.baseId);
  if (!existing.ok) return fail(existing.error);
  const values = normalizeBaseUpdateValues(params, existing.data);
  if (!values.ok) return fail(values.error);
  const row = await persistBaseUpdate(params.baseId, values.data);
  return row.ok ? ok(mapBase(row.data)) : fail(row.error);
};

export const deleteBase = async (params: { baseId: string; user: UserScope }): Promise<Result<void>> => {
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${params.baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));

  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  if (existing.deletion_started_at) {
    await submitBaseDeletionJob(params.baseId);
    return ok();
  }

  const queued = await sql.begin(async (tx): Promise<Result<void>> => {
    await tx`
      UPDATE pulse.bases
      SET deletion_started_at = now(),
          deletion_failed_at = NULL,
          deletion_error = NULL,
          updated_at = now()
      WHERE id = ${params.baseId}::uuid
    `;
    await tx`
      UPDATE pulse.sources
      SET enabled = FALSE, updated_at = now()
      WHERE base_id = ${params.baseId}::uuid
    `;
    await tx`
      DELETE FROM auth.service_accounts
      WHERE kind = 'resource_bound'
        AND app_id = ${PULSE_APP_ID}
        AND resource_type = ${PULSE_SOURCE_RESOURCE_TYPE}
        AND resource_id IN (
          SELECT id::text
          FROM pulse.sources
          WHERE base_id = ${params.baseId}::uuid
        )
    `;
    await tx`
      INSERT INTO pulse.base_deletions (base_id, requested_by, status, phase, updated_at)
      VALUES (${params.baseId}::uuid, ${params.user.id}::uuid, 'queued', 'queued', now())
      ON CONFLICT (base_id)
      DO UPDATE SET
        requested_by = EXCLUDED.requested_by,
        status = 'queued',
        phase = 'queued',
        error_message = NULL,
        updated_at = now()
    `;
    return ok();
  });

  if (!queued.ok) return fail(queued.error);
  await submitBaseDeletionJob(params.baseId);
  return ok();
};

export const clearBaseData = async (params: { baseId: string; user: UserScope }): Promise<Result<void>> => {
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${params.baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));

  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  if (existing.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));
  if (existing.data_clear_started_at && !existing.data_clear_completed_at && !existing.data_clear_failed_at) {
    await submitBaseDataClearJob(params.baseId);
    return ok();
  }

  const queued = await sql.begin(async (tx): Promise<Result<void>> => {
    await tx`
      UPDATE pulse.bases
      SET data_clear_started_at = now(),
          data_clear_completed_at = NULL,
          data_clear_failed_at = NULL,
          data_clear_error = NULL,
          updated_at = now()
      WHERE id = ${params.baseId}::uuid
    `;
    await tx`
      INSERT INTO pulse.base_data_clears (
        base_id,
        requested_by,
        status,
        phase,
        deleted_rows,
        last_batch_rows,
        error_message,
        completed_at,
        updated_at
      )
      VALUES (
        ${params.baseId}::uuid,
        ${params.user.id}::uuid,
        'queued',
        'queued',
        0,
        0,
        NULL,
        NULL,
        now()
      )
      ON CONFLICT (base_id)
      DO UPDATE SET
        requested_by = EXCLUDED.requested_by,
        status = 'queued',
        phase = 'queued',
        deleted_rows = 0,
        last_batch_rows = 0,
        error_message = NULL,
        completed_at = NULL,
        updated_at = now()
    `;
    return ok();
  });

  if (!queued.ok) return fail(queued.error);
  await submitBaseDataClearJob(params.baseId);
  return ok();
};
