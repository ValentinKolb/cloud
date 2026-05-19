import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { insertWithShortId } from "./short-id";
import {
  tableBelongsToBase,
  validateStatSourceForTable,
} from "./query-validation";
import {
  DashboardConfigSchema,
  type Dashboard,
  type DashboardConfig,
  type Widget,
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

const mapRow = (row: DbRow): Dashboard => {
  const rawConfig = parseJsonbRow<unknown>(row.config, { rows: [] });
  const parsed = DashboardConfigSchema.safeParse(rawConfig);
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    baseId: row.base_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    config: parsed.success ? parsed.data : { rows: [] },
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    position: row.position as number,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

const ensureTableInBase = async (
  tableId: string,
  baseId: string,
  label: string,
): Promise<Result<void>> => {
  if (await tableBelongsToBase(tableId, baseId)) return ok();
  return fail(err.badInput(`${label} must reference an alive table in this base`));
};

const ensureViewInBase = async (
  viewId: string,
  baseId: string,
  label: string,
): Promise<Result<{ tableId: string }>> => {
  const [row] = await sql<{ table_id: string }[]>`
    SELECT v.table_id::text AS table_id
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.id = ${viewId}::uuid
      AND t.base_id = ${baseId}::uuid
      AND v.deleted_at IS NULL
  `;
  if (!row) return fail(err.badInput(`${label} must reference an alive view in this base`));
  return ok({ tableId: row.table_id });
};

const ensureFormInBase = async (
  formId: string,
  baseId: string,
  label: string,
): Promise<Result<void>> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.forms f
      JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE f.id = ${formId}::uuid
        AND t.base_id = ${baseId}::uuid
        AND f.deleted_at IS NULL
    ) AS exists
  `;
  return row?.exists ? ok() : fail(err.badInput(`${label} must reference an alive form in this base`));
};

const ensureDashboardInBase = async (
  dashboardId: string,
  baseId: string,
  label: string,
): Promise<Result<void>> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.dashboards d
      JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
      WHERE d.id = ${dashboardId}::uuid
        AND d.base_id = ${baseId}::uuid
        AND d.deleted_at IS NULL
    ) AS exists
  `;
  return row?.exists ? ok() : fail(err.badInput(`${label} must reference an alive dashboard in this base`));
};

const widgetsOf = (config: DashboardConfig): Widget[] =>
  config.rows.flatMap((row) => row.cells);

const validateWidgetRefs = async (
  widget: Widget,
  baseId: string,
): Promise<Result<void>> => {
  switch (widget.kind) {
    case "stat": {
      const table = await ensureTableInBase(widget.source.tableId, baseId, "stat source");
      if (!table.ok) return table;
      return validateStatSourceForTable(widget.source.tableId, widget.source);
    }
    case "chart": {
      const view = await ensureViewInBase(widget.viewId, baseId, "chart source");
      return view.ok ? ok() : view;
    }
    case "view-stats": {
      const view = await ensureViewInBase(widget.viewId, baseId, "view-stats source");
      return view.ok ? ok() : view;
    }
    case "view":
      if (widget.source.kind === "view") {
        const view = await ensureViewInBase(widget.source.viewId, baseId, "view widget source");
        return view.ok ? ok() : view;
      }
      return ensureTableInBase(widget.source.tableId, baseId, "view widget source");
    case "form":
      return ensureFormInBase(widget.formId, baseId, "form widget source");
    case "markdown":
      return ok();
    case "link":
      if (widget.target.kind === "dashboard") return ensureDashboardInBase(widget.target.dashboardId, baseId, "link target");
      if (widget.target.kind === "table") return ensureTableInBase(widget.target.tableId, baseId, "link target");
      if (widget.target.kind === "view") {
        const view = await ensureViewInBase(widget.target.viewId, baseId, "link target");
        return view.ok ? ok() : view;
      }
      if (widget.target.kind === "form") return ensureFormInBase(widget.target.formId, baseId, "link target");
      return ok();
  }
};

const validateDashboardConfig = async (
  baseId: string,
  config: DashboardConfig,
): Promise<Result<void>> => {
  for (const widget of widgetsOf(config)) {
    const valid = await validateWidgetRefs(widget, baseId);
    if (!valid.ok) return valid;
  }
  return ok();
};

/**
 * Looks up a dashboard by (baseId, slug). Used at the SSR-route boundary
 * to resolve `?dashboard=<slug>` URL params. Returns null for soft-deleted
 * dashboards.
 */
export const getByShortId = async (baseId: string, shortId: string): Promise<Dashboard | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at
    FROM grids.dashboards d
    JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
    WHERE d.base_id = ${baseId}::uuid AND d.short_id = ${shortId} AND d.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup. Accepts either UUID or slug — same length-based
 * heuristic the other Grids services use. UUIDs in URLs are rare (only
 * deep-links from cell-link components), but free to support.
 */
export const getByIdOrShortId = async (
  baseId: string,
  idOrSlug: string,
): Promise<Dashboard | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const d = await get(idOrSlug);
    return d && d.baseId === baseId ? d : null;
  }
  return getByShortId(baseId, idOrSlug);
};

export const get = async (
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Dashboard | null> => {
  // Live-parent invariant: dashboards under a trashed base never resolve
  // outside the top-down restore flow.
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at
        FROM grids.dashboards d
        JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
        WHERE d.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at
        FROM grids.dashboards d
        JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
        WHERE d.id = ${id}::uuid AND d.deleted_at IS NULL
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

  const rows = await sql<DbRow[]>`
    WITH ranked AS (
      SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at,
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
      JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
      WHERE d.base_id = ${params.baseId}::uuid AND d.deleted_at IS NULL
    )
    SELECT id, short_id, base_id, name, description, icon, config, owner_user_id, position, deleted_at, created_at, updated_at
    FROM ranked
    WHERE COALESCE(user_rank, group_rank, auth_rank, public_rank) >= 1
       OR (
         COALESCE(user_rank, group_rank, auth_rank, public_rank) IS NULL
         AND (owner_user_id IS NULL OR owner_user_id = ${params.userId}::uuid)
       )
    ORDER BY position, created_at
  `;

  return rows.map(mapRow);
};

/**
 * Lists trashed dashboards for the base trash UI. The parent base must
 * be alive; base restore handles dashboards under trashed bases.
 */
export const listTrashedByBase = async (baseId: string): Promise<Dashboard[]> => {
  const rows = await sql<DbRow[]>`
    SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at
    FROM grids.dashboards d
    JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
    WHERE d.base_id = ${baseId}::uuid AND d.deleted_at IS NOT NULL
    ORDER BY d.deleted_at DESC, d.position, d.created_at
  `;
  return rows.map(mapRow);
};

export type CreateDashboardServiceInput = {
  baseId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
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
  const configValid = await validateDashboardConfig(input.baseId, configParsed.data);
  if (!configValid.ok) return configValid;

  const description = input.description?.trim() || null;

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.dashboards (short_id, base_id, name, description, icon, config, owner_user_id, position)
      VALUES (
        ${shortId},
        ${input.baseId}::uuid,
        ${name},
        ${description}::text,
        ${input.icon ?? null},
        ${configParsed.data}::jsonb,
        ${input.ownerUserId ?? null}::uuid,
        COALESCE((SELECT MAX(position) + 1 FROM grids.dashboards WHERE base_id = ${input.baseId}::uuid), 0)
      )
      RETURNING id, short_id, base_id, name, description, icon, config, owner_user_id, position, deleted_at, created_at, updated_at
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_dashboards_short_id");
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
  icon?: string | null;
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
    const configValid = await validateDashboardConfig(existing.baseId, configParsed.data);
    if (!configValid.ok) return configValid;
    nextConfig = configParsed.data;
  }

  const next = {
    name: name ?? existing.name,
    description:
      input.description !== undefined
        ? input.description?.trim() || null
        : existing.description,
    icon: input.icon !== undefined ? input.icon : existing.icon,
    config: nextConfig,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.dashboards
    SET name = ${next.name},
        description = ${next.description}::text,
        icon = ${next.icon},
        config = ${next.config}::jsonb,
        position = ${next.position},
        owner_user_id = ${ownerUserId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id, short_id, base_id, name, description, icon, config, owner_user_id, position, deleted_at, created_at, updated_at
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
    RETURNING id, short_id, base_id, name, description, icon, config, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("restore failed"));
  const dashboard = mapRow(row);
  await logAudit({ baseId: existing.baseId, userId: actorId, action: "restored" });
  return ok(dashboard);
};
