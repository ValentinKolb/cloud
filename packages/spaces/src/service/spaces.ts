import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { serviceAccounts } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { CreateSpace, MutationResult, Space, SpaceDetail, UpdateSpace } from "@/contracts";
import { getSpacePermission, grantSpaceAccess, SPACE_RESOURCE_TYPE, SPACES_APP_ID } from "./access";
import { rank } from "./rank";

/**
 * Escapes group IDs into a Postgres `uuid[]` literal for `ANY(...)` access filters.
 */
const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

// ==========================
// Spaces Service
// ==========================

type DbSpace = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  ical_token: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbSpaceAdmin = DbSpace & {
  permission_count: number;
};

export type SpaceAdminListItem = Space & {
  permissionCount: number;
};

type DbColumn = {
  id: string;
  space_id: string;
  name: string;
  color: string | null;
  rank: string;
  is_done: boolean;
};

type DbTag = {
  id: string;
  space_id: string;
  name: string;
  color: string;
};

/**
 * Converts one `spaces.spaces` row into the API-facing `Space` model.
 */
const mapToSpace = (row: DbSpace): Space => ({
  id: row.id,
  name: row.name,
  description: row.description,
  color: row.color,
  icalToken: row.ical_token,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapToSpaceAdminItem = (row: DbSpaceAdmin): SpaceAdminListItem => ({
  ...mapToSpace(row),
  permissionCount: row.permission_count,
});

const DEFAULT_COLUMNS = [
  { name: "To Do", color: "#6b7280", isDone: false },
  { name: "In Progress", color: "#3b82f6", isDone: false },
  { name: "Done", color: "#22c55e", isDone: true },
];

/**
 * Check if an actor has access to a space.
 */
export const canAccess = async (params: {
  spaceId: string;
  userId?: string | null;
  userGroups?: string[];
  serviceAccountId?: string | null;
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const { spaceId, requiredLevel = "read" } = params;

  const permission = await getSpacePermission({
    spaceId,
    userId: params.userId ?? null,
    userGroups: params.userGroups ?? [],
    serviceAccountId: params.serviceAccountId ?? null,
  });

  if (permission !== "none") {
    return hasPermission(permission, requiredLevel);
  }

  return false;
};

/**
 * Get the effective permission level for an actor on a space.
 */
export const getPermission = async (params: {
  spaceId: string;
  userId?: string | null;
  userGroups?: string[];
  serviceAccountId?: string | null;
}): Promise<PermissionLevel> => {
  const permission = await getSpacePermission(params);

  if (permission !== "none") {
    return permission;
  }

  return "none";
};

/**
 * List all spaces accessible to a user via the permission system.
 */
export const list = async (params: { userId: string | null; groups: string[] }): Promise<Space[]> => {
  const { userId } = params;
  const groups = params.groups ?? [];

  const rows = await sql<DbSpace[]>`
    SELECT DISTINCT s.id, s.name, s.description, s.color, s.ical_token, s.created_at, s.updated_at
    FROM spaces.spaces s
    LEFT JOIN spaces.space_access sa ON s.id = sa.space_id
    LEFT JOIN auth.access a ON sa.access_id = a.id
    WHERE
      a.user_id = ${userId}::uuid
      OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
      OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
      OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
    ORDER BY s.name
  `;
  return rows.map(mapToSpace);
};

/**
 * List all spaces for admin pages with a permission-entry count.
 */
export const listAdmin = async (params: {
  search?: string;
  pagination: { limit: number; offset: number };
}): Promise<{ items: SpaceAdminListItem[]; total: number }> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const rows = await sql<DbSpaceAdmin[]>`
    SELECT
      s.id,
      s.name,
      s.description,
      s.color,
      s.ical_token,
      s.created_at,
      s.updated_at,
      COUNT(sa.access_id)::int AS permission_count
    FROM spaces.spaces s
    LEFT JOIN spaces.space_access sa ON sa.space_id = s.id
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(s.name) LIKE ${pattern}
    )
    GROUP BY s.id, s.name, s.description, s.color, s.ical_token, s.created_at, s.updated_at
    ORDER BY LOWER(s.name) ASC, s.created_at ASC
    LIMIT ${params.pagination.limit}
    OFFSET ${params.pagination.offset}
  `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM spaces.spaces s
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(s.name) LIKE ${pattern}
    )
  `;

  return {
    items: rows.map(mapToSpaceAdminItem),
    total: countRow?.count ?? 0,
  };
};

/**
 * Aggregated admin stats — single SQL roundtrip. Filtered by `search` so the
 * numbers match what the admin sees in the table. Counted in the DB, NOT in
 * the page-bound items array (which only sees the visible page).
 */
export const adminSummary = async (params: {
  search?: string;
}): Promise<{
  total: number;
  orphaned: number;
  totalPermissions: number;
}> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const [row] = await sql<{ total: number; orphaned: number; total_permissions: number }[]>`
    WITH filtered AS (
      SELECT s.id, COUNT(sa.access_id)::int AS permission_count
      FROM spaces.spaces s
      LEFT JOIN spaces.space_access sa ON sa.space_id = s.id
      WHERE (${pattern}::text IS NULL OR LOWER(s.name) LIKE ${pattern})
      GROUP BY s.id
    )
    SELECT
      COUNT(*)::int                                             AS total,
      COUNT(*) FILTER (WHERE permission_count = 0)::int         AS orphaned,
      COALESCE(SUM(permission_count), 0)::int                   AS total_permissions
    FROM filtered
  `;
  return {
    total: row?.total ?? 0,
    orphaned: row?.orphaned ?? 0,
    totalPermissions: row?.total_permissions ?? 0,
  };
};

/**
 * Get a space by ID
 */
export const get = async (params: { id: string }): Promise<Space | null> => {
  const [row] = await sql<DbSpace[]>`
    SELECT id, name, description, color, ical_token, created_at, updated_at
    FROM spaces.spaces
    WHERE id = ${params.id}
  `;
  return row ? mapToSpace(row) : null;
};

/**
 * Get a space with its columns and tags
 */
export const getDetail = async (params: { id: string }): Promise<SpaceDetail | null> => {
  const [spaceRow] = await sql<DbSpace[]>`
    SELECT id, name, description, color, ical_token, created_at, updated_at
    FROM spaces.spaces
    WHERE id = ${params.id}
  `;

  if (!spaceRow) return null;

  const columns = await sql<DbColumn[]>`
    SELECT id, space_id, name, color, rank::text AS rank, is_done
    FROM spaces.columns
    WHERE space_id = ${params.id}
    ORDER BY rank
  `;

  const tags = await sql<DbTag[]>`
    SELECT id, space_id, name, color
    FROM spaces.tags
    WHERE space_id = ${params.id}
    ORDER BY name
  `;

  return {
    ...mapToSpace(spaceRow),
    columns: columns.map((c) => ({
      id: c.id,
      spaceId: c.space_id,
      name: c.name,
      color: c.color,
      rank: c.rank,
      isDone: c.is_done,
    })),
    tags: tags.map((t) => ({
      id: t.id,
      spaceId: t.space_id,
      name: t.name,
      color: t.color,
    })),
  };
};

/**
 * Create a new space with default columns.
 * Automatically grants admin access to the creator.
 */
export const create = async (params: { data: CreateSpace; creatorId: string }): Promise<MutationResult<Space>> => {
  const { data, creatorId } = params;

  const row = await sql.begin(async (tx): Promise<DbSpace | null> => {
    const [created] = await tx<DbSpace[]>`
      INSERT INTO spaces.spaces (name, description, color)
      VALUES (${data.name}, ${data.description ?? null}, ${data.color})
      RETURNING id, name, description, color, ical_token, created_at, updated_at
    `;

    if (!created) return null;

    for (const [index, col] of DEFAULT_COLUMNS.entries()) {
      await tx`
      INSERT INTO spaces.columns (space_id, name, color, rank, is_done)
      VALUES (${created.id}, ${col.name}, ${col.color}, ${rank.toDb(rank.atIndex(index))}::bigint, ${col.isDone})
    `;
    }

    return created;
  });

  if (!row) {
    return { ok: false, error: "Failed to create space", status: 500 };
  }

  const access = await grantSpaceAccess({
    spaceId: row.id,
    principal: { type: "user", userId: creatorId },
    permission: "admin",
  });
  if (!access.ok) {
    await sql`
      DELETE FROM spaces.spaces
      WHERE id = ${row.id}::uuid
    `;
    return { ok: false, error: access.error.message, status: access.error.status };
  }

  return { ok: true, data: mapToSpace(row) };
};

/**
 * Update a space
 */
export const update = async (params: { id: string; data: UpdateSpace }): Promise<MutationResult<Space>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Space not found", status: 404 };
  }

  const name = data.name ?? existing.name;
  const description = data.description === undefined ? existing.description : data.description;
  const color = data.color ?? existing.color;

  const [row] = await sql<DbSpace[]>`
    UPDATE spaces.spaces
    SET name = ${name}, description = ${description}, color = ${color}, updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, description, color, ical_token, created_at, updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to update space", status: 500 };
  }

  return { ok: true, data: mapToSpace(row) };
};

/**
 * Delete a space
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM spaces.spaces
    WHERE id = ${params.id}
  `;

  if (result.count === 0) {
    return { ok: false, error: "Space not found", status: 404 };
  }

  await serviceAccounts.deleteForResource({
    appId: SPACES_APP_ID,
    resourceType: SPACE_RESOURCE_TYPE,
    resourceId: params.id,
  });

  return { ok: true, data: undefined };
};

/**
 * Regenerate the iCal token for a space
 */
export const regenerateICalToken = async (params: { id: string }): Promise<MutationResult<{ icalToken: string }>> => {
  const [row] = await sql<{ ical_token: string }[]>`
    UPDATE spaces.spaces
    SET ical_token = encode(gen_random_bytes(24), 'hex'), updated_at = now()
    WHERE id = ${params.id}
    RETURNING ical_token
  `;

  if (!row) {
    return { ok: false, error: "Space not found", status: 404 };
  }

  return { ok: true, data: { icalToken: row.ical_token } };
};

/**
 * Get a space by its iCal token (for public iCal feed)
 */
export const getByICalToken = async (params: { token: string }): Promise<Space | null> => {
  const [row] = await sql<DbSpace[]>`
    SELECT id, name, description, color, ical_token, created_at, updated_at
    FROM spaces.spaces
    WHERE ical_token = ${params.token}
  `;
  return row ? mapToSpace(row) : null;
};
