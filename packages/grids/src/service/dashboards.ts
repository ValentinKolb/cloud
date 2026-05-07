import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { generateUniqueSlug } from "./slug";
import {
  DashboardConfigSchema,
  type Dashboard,
  type DashboardConfig,
} from "../contracts";

type DbRow = Record<string, unknown>;

// =============================================================================
// Dashboards — per-base composition surface (P0: stat-card + embedded-view
// widgets; chart widgets ship in P1).
//
// Data model mirrors views: id+slug, soft-delete, ownerUserId for shared-vs-
// personal, per-resource access junction (grids.dashboard_access). The big
// shape difference is the parent: dashboards belong to a base, not a table,
// because they aggregate across multiple tables of the base.
//
// Permission model:
//   - Shared dashboard (ownerUserId=null) is visible to anyone with
//     base-read by default; dashboard_access can narrow that.
//   - Personal dashboard (ownerUserId=X) is visible to X plus anyone
//     explicitly granted via dashboard_access.
//   - Edit-rights flow from base-write (for shared) or owner (for personal),
//     not from a per-dashboard ACL — ACLs are read-only.
//
// The save-time validator parses config through DashboardConfigSchema; a
// stored blob that doesn't validate (schema drift, manual SQL edit) is
// surfaced as `config = { rows: [] }` rather than crashing the listing,
// same defensive pattern used by views.ts.
// =============================================================================

const slugTakenInBase = (baseId: string) => async (slug: string): Promise<boolean> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM grids.dashboards
      WHERE base_id = ${baseId}::uuid AND slug = ${slug} AND deleted_at IS NULL
    ) AS exists
  `;
  return Boolean(row?.exists);
};

const mapRow = (row: DbRow): Dashboard => {
  const rawConfig = parseJsonbRow<unknown>(row.config, { rows: [] });
  const parsed = DashboardConfigSchema.safeParse(rawConfig);
  return {
    id: row.id as string,
    slug: (row.slug as string | null) ?? "",
    baseId: row.base_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    config: parsed.success ? parsed.data : { rows: [] },
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    position: row.position as number,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

/**
 * Looks up a dashboard by (baseId, slug). Used at the SSR-route boundary
 * to resolve `?dashboard=<slug>` URL params. Returns null for soft-deleted
 * dashboards.
 */
export const getBySlug = async (baseId: string, slug: string): Promise<Dashboard | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
    FROM grids.dashboards
    WHERE base_id = ${baseId}::uuid AND slug = ${slug} AND deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup. Accepts either UUID or slug — same length-based
 * heuristic the other Grids services use. UUIDs in URLs are rare (only
 * deep-links from cell-link components), but free to support.
 */
export const getByIdOrSlug = async (
  baseId: string,
  idOrSlug: string,
): Promise<Dashboard | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const d = await get(idOrSlug);
    return d && d.baseId === baseId ? d : null;
  }
  return getBySlug(baseId, idOrSlug);
};

export const get = async (
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Dashboard | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
        FROM grids.dashboards WHERE id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
        FROM grids.dashboards WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

/**
 * Lists dashboards visible to a user on a base. Visibility rules mirror
 * views.listForTable exactly:
 *
 *   1. Shared dashboards (owner_user_id NULL) and the user's own personal
 *      dashboards are visible by default.
 *   2. dashboard_access grants OVERRIDE the default — explicit `read` on
 *      someone else's personal dashboard makes it visible to the grantee;
 *      explicit `none` on a shared dashboard hides it.
 *
 * Most-specific-wins per principal tier (user > group > authenticated >
 * public). Within a tier, any deny beats any read — needed because the
 * grant API inserts a fresh auth.access row per POST so duplicate
 * principal rows are possible.
 */
export const listForBase = async (params: {
  baseId: string;
  userId: string | null;
  userGroups?: string[];
}): Promise<Dashboard[]> => {
  const groups = toPgUuidArray(params.userGroups);

  const rows = await sql<(DbRow & {
    user_rank: number | null;
    group_rank: number | null;
    auth_rank: number | null;
    public_rank: number | null;
  })[]>`
    SELECT d.id, d.slug, d.base_id, d.name, d.description, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
        WHERE da.dashboard_id = d.id AND a.user_id = ${params.userId}::uuid
      ) AS user_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
        WHERE da.dashboard_id = d.id AND a.group_id = ANY(${groups}::uuid[])
      ) AS group_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
        WHERE da.dashboard_id = d.id
          AND a.authenticated_only = TRUE
          AND ${params.userId}::uuid IS NOT NULL
      ) AS auth_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
        WHERE da.dashboard_id = d.id
          AND a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE
      ) AS public_rank
    FROM grids.dashboards d
    WHERE d.base_id = ${params.baseId}::uuid AND d.deleted_at IS NULL
    ORDER BY d.position, d.created_at
  `;

  return rows
    .filter((row) => {
      const winning = row.user_rank ?? row.group_rank ?? row.auth_rank ?? row.public_rank;
      if (winning !== null && winning !== undefined) return winning >= 1;
      // Default visibility: shared OR own personal.
      const owner = row.owner_user_id as string | null;
      return owner === null || owner === params.userId;
    })
    .map(mapRow);
};

export type CreateDashboardServiceInput = {
  baseId: string;
  name: string;
  description?: string | null;
  config?: DashboardConfig;
  ownerUserId?: string | null;
};

export const create = async (
  input: CreateDashboardServiceInput,
  actorId: string | null,
): Promise<Result<Dashboard>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  // Re-validate config at the service boundary even though the API layer
  // does too — defensive against future entry paths (SSR seed scripts,
  // imports) that might bypass the API.
  const configParsed = DashboardConfigSchema.safeParse(input.config ?? { rows: [] });
  if (!configParsed.success) {
    return fail(err.badInput(`invalid dashboard config: ${configParsed.error.message}`));
  }

  const slug = await generateUniqueSlug(slugTakenInBase(input.baseId));
  const description = input.description?.trim() || null;

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.dashboards (slug, base_id, name, description, config, owner_user_id, position)
    VALUES (
      ${slug},
      ${input.baseId}::uuid,
      ${name},
      ${description}::text,
      ${configParsed.data}::jsonb,
      ${input.ownerUserId ?? null}::uuid,
      COALESCE((SELECT MAX(position) + 1 FROM grids.dashboards WHERE base_id = ${input.baseId}::uuid), 0)
    )
    RETURNING id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("insert failed"));
  const dashboard = mapRow(row);
  await logAudit({
    baseId: input.baseId,
    userId: actorId,
    action: "created",
    diff: { dashboard: { old: null, new: { id: dashboard.id, name: dashboard.name } } },
  });
  return ok(dashboard);
};

export type UpdateDashboardServiceInput = {
  name?: string;
  description?: string | null;
  config?: DashboardConfig;
  position?: number;
  /** Shared toggle: true → ownerUserId becomes null; false → becomes
   *  `actorId`. undefined leaves ownership unchanged. */
  shared?: boolean;
};

export const update = async (
  id: string,
  input: UpdateDashboardServiceInput,
  actorId: string | null,
): Promise<Result<Dashboard>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Dashboard"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) {
    return fail(err.badInput("name cannot be empty"));
  }

  const ownerUserId =
    input.shared === undefined
      ? existing.ownerUserId
      : input.shared
      ? null
      : actorId;

  let nextConfig: DashboardConfig = existing.config;
  if (input.config !== undefined) {
    const configParsed = DashboardConfigSchema.safeParse(input.config);
    if (!configParsed.success) {
      return fail(err.badInput(`invalid dashboard config: ${configParsed.error.message}`));
    }
    nextConfig = configParsed.data;
  }

  const next = {
    name: name ?? existing.name,
    description:
      input.description !== undefined
        ? input.description?.trim() || null
        : existing.description,
    config: nextConfig,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.dashboards
    SET name = ${next.name},
        description = ${next.description}::text,
        config = ${next.config}::jsonb,
        position = ${next.position},
        owner_user_id = ${ownerUserId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const dashboard = mapRow(row);
  await logAudit({
    baseId: existing.baseId,
    userId: actorId,
    action: "updated",
    diff: { dashboard: { old: existing.name, new: dashboard.name } },
  });
  return ok(dashboard);
};

/**
 * Soft-deletes the dashboard. If the base referenced this dashboard as
 * its default, the reference is cleared in the same transaction so that
 * `getDefaultDashboard` returns null rather than a dangling id.
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Dashboard"));
  await sql.begin(async (tx) => {
    await tx`UPDATE grids.dashboards SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
    // Only clear the base's default if it pointed here. Cheap to do
    // unconditionally since the WHERE narrows to the one base.
    await tx`
      UPDATE grids.bases
      SET default_dashboard_id = NULL, updated_at = now()
      WHERE id = ${existing.baseId}::uuid AND default_dashboard_id = ${id}::uuid
    `;
  });
  await logAudit({ baseId: existing.baseId, userId: actorId, action: "deleted" });
  return ok();
};

export const restore = async (
  id: string,
  actorId: string | null,
): Promise<Result<Dashboard>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("Dashboard"));
  if (existing.deletedAt === null) return ok(existing);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.dashboards SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, slug, base_id, name, description, config, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("restore failed"));
  const dashboard = mapRow(row);
  await logAudit({ baseId: existing.baseId, userId: actorId, action: "restored" });
  return ok(dashboard);
};
