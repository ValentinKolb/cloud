import { type AccessSubject, buildAccessPrincipalTierConditions } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@k2b/stdlib";
import { sql } from "bun";
import { type Dashboard, type DashboardConfig, DashboardConfigSchema, type DashboardWidgetSource, type Widget } from "../contracts";
import { logAudit } from "./audit";
import { compileDashboardWidgetQuery } from "./dashboard-widget-query";
import { parseJsonbRow } from "./jsonb";
import { emitMetadataEvent } from "./metadata-events";
import { tableBelongsToBase } from "./query-validation";
import { insertWithShortId } from "./short-id";

type DbRow = Record<string, unknown>;
type SqlClient = typeof sql;

// Dashboards are per-base composition surfaces that may aggregate multiple
// tables. Read visibility combines base, owner, and dashboard ACL context;
// mutation routes require base-admin at the API boundary.
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

const ensureTableInBase = async (tableId: string, baseId: string, label: string): Promise<Result<void>> => {
  if (await tableBelongsToBase(tableId, baseId)) return ok();
  return fail(err.badInput(`${label} must reference an alive table in this base`));
};

const ensureViewInBase = async (viewId: string, baseId: string, label: string): Promise<Result<{ tableId: string }>> => {
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

const ensureFormInBase = async (formId: string, baseId: string, label: string): Promise<Result<void>> => {
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

const ensureDashboardInBase = async (dashboardId: string, baseId: string, label: string): Promise<Result<void>> => {
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

const ensureWorkflowLauncherInBase = async (launcherId: string, baseId: string, label: string): Promise<Result<void>> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.workflow_launchers launcher
      JOIN grids.workflow_profile workflow ON workflow.id = launcher.workflow_id AND workflow.deleted_at IS NULL
      JOIN grids.bases b ON b.id = launcher.base_id AND b.deleted_at IS NULL
      WHERE launcher.id = ${launcherId}::uuid
        AND launcher.base_id = ${baseId}::uuid
        AND workflow.base_id = launcher.base_id
        AND launcher.kind IN ('dashboard', 'scanner')
        AND launcher.deleted_at IS NULL
    ) AS exists
  `;
  return row?.exists ? ok() : fail(err.badInput(`${label} must reference an alive dashboard or scanner launcher in this base`));
};

const widgetsOf = (config: DashboardConfig): Widget[] => config.rows.flatMap((row) => row.cells);

export const sourceTableIds = async (dashboard: Dashboard): Promise<string[]> => {
  const tableIds = new Set<string>();
  const viewIds = new Set<string>();
  const gqlSources = new Set<string>();
  const formIds = new Set<string>();

  const collectSource = (source: DashboardWidgetSource) => {
    if (source.kind === "view") viewIds.add(source.viewId);
    else gqlSources.add(source.source);
  };

  for (const widget of widgetsOf(dashboard.config)) {
    if (widget.kind === "stat") {
      collectSource(widget.source);
      if (widget.trend) collectSource(widget.trend.source);
    } else if (widget.kind === "chart" || widget.kind === "view-stats") {
      collectSource(widget.source);
    } else if (widget.kind === "view") {
      collectSource(widget.source);
    } else if (widget.kind === "form") {
      formIds.add(widget.formId);
    }
  }

  const directPlans = await Promise.all([...gqlSources].map((source) => compileDashboardWidgetQuery({ baseId: dashboard.baseId, source })));
  for (const compiled of directPlans) {
    if (!compiled.ok) continue;
    for (const tableId of compiled.data.plan.readableTableIds) tableIds.add(tableId);
  }

  const viewList = [...viewIds];
  if (viewList.length > 0) {
    const rows = await sql<{ table_id: string; source: string }[]>`
      SELECT v.table_id::text AS table_id, v.source
      FROM grids.views v
      JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
      WHERE v.id = ANY(${toPgUuidArray(viewList)}::uuid[])
        AND v.deleted_at IS NULL
        AND t.base_id = ${dashboard.baseId}::uuid
    `;
    const viewPlans = await Promise.all(
      rows.map((row) => compileDashboardWidgetQuery({ baseId: dashboard.baseId, source: row.source, currentTableId: row.table_id })),
    );
    for (const compiled of viewPlans) {
      if (!compiled.ok) continue;
      for (const tableId of compiled.data.plan.readableTableIds) tableIds.add(tableId);
    }
  }

  const formList = [...formIds];
  if (formList.length > 0) {
    const rows = await sql<{ table_id: string }[]>`
      SELECT DISTINCT f.table_id::text AS table_id
      FROM grids.forms f
      JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
      WHERE f.id = ANY(${toPgUuidArray(formList)}::uuid[])
        AND f.deleted_at IS NULL
        AND t.base_id = ${dashboard.baseId}::uuid
    `;
    for (const row of rows) tableIds.add(row.table_id);
  }

  return [...tableIds].sort();
};

const validateWidgetSource = async (source: DashboardWidgetSource, baseId: string, label: string): Promise<Result<void>> => {
  if (source.kind === "view") {
    const view = await ensureViewInBase(source.viewId, baseId, label);
    return view.ok ? ok() : view;
  }
  const compiled = await compileDashboardWidgetQuery({ baseId, source: source.source });
  return compiled.ok ? ok() : fail(err.badInput(`${label} is invalid: ${compiled.error}`));
};

const validateWidgetRefs = async (widget: Widget, baseId: string): Promise<Result<void>> => {
  switch (widget.kind) {
    case "stat": {
      const source = await validateWidgetSource(widget.source, baseId, "stat source");
      if (!source.ok) return source;
      if (widget.trend) {
        const trend = await validateWidgetSource(widget.trend.source, baseId, "stat trend source");
        if (!trend.ok) return trend;
      }
      return ok();
    }
    case "chart": {
      return validateWidgetSource(widget.source, baseId, "chart source");
    }
    case "view-stats": {
      return validateWidgetSource(widget.source, baseId, "view-stats source");
    }
    case "view": {
      return validateWidgetSource(widget.source, baseId, "view widget source");
    }
    case "form":
      return ensureFormInBase(widget.formId, baseId, "form widget source");
    case "markdown":
      return ok();
    case "workflow-button":
      return ensureWorkflowLauncherInBase(widget.launcherId, baseId, "workflow button");
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

const validateDashboardConfig = async (baseId: string, config: DashboardConfig): Promise<Result<void>> => {
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
export const getByIdOrShortId = async (baseId: string, idOrSlug: string): Promise<Dashboard | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const d = await get(idOrSlug);
    return d && d.baseId === baseId ? d : null;
  }
  return getByShortId(baseId, idOrSlug);
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}, db: SqlClient = sql): Promise<Dashboard | null> => {
  // Live-parent invariant: dashboards under a trashed base never resolve
  // outside the top-down restore flow.
  const [row] = opts.includeDeleted
    ? await db<DbRow[]>`
        SELECT d.id, d.short_id, d.base_id, d.name, d.description, d.icon, d.config, d.owner_user_id, d.position, d.deleted_at, d.created_at, d.updated_at
        FROM grids.dashboards d
        JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
        WHERE d.id = ${id}::uuid
      `
    : await db<DbRow[]>`
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
  serviceAccountId?: string | null;
}): Promise<Dashboard[]> => {
  const serviceAccountId = params.serviceAccountId ?? null;
  const subject: AccessSubject | null = params.userId
    ? { type: "user", userId: params.userId }
    : serviceAccountId
      ? { type: "service_account", serviceAccountId }
      : null;
  const principalTiers = buildAccessPrincipalTierConditions({
    subject,
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });

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
          WHERE da.dashboard_id = d.id AND ${principalTiers.serviceAccount}
        ) AS service_account_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
          WHERE da.dashboard_id = d.id AND ${principalTiers.user}
        ) AS user_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
          WHERE da.dashboard_id = d.id AND ${principalTiers.group}
        ) AS group_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
          WHERE da.dashboard_id = d.id AND ${principalTiers.authenticated}
        ) AS auth_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.dashboard_access da JOIN auth.access a ON a.id = da.access_id
          WHERE da.dashboard_id = d.id AND ${principalTiers.public}
        ) AS public_rank
      FROM grids.dashboards d
      JOIN grids.bases b ON b.id = d.base_id AND b.deleted_at IS NULL
      WHERE d.base_id = ${params.baseId}::uuid AND d.deleted_at IS NULL
    )
    SELECT id, short_id, base_id, name, description, icon, config, owner_user_id, position, deleted_at, created_at, updated_at
    FROM ranked
    WHERE COALESCE(service_account_rank, user_rank, group_rank, auth_rank, public_rank) >= 1
       OR (
         COALESCE(service_account_rank, user_rank, group_rank, auth_rank, public_rank) IS NULL
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

type CreateDashboardServiceInput = {
  baseId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  config?: DashboardConfig;
  ownerUserId?: string | null;
};

export const create = async (input: CreateDashboardServiceInput, actorId: string | null): Promise<Result<Dashboard>> => {
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
  await emitMetadataEvent({
    type: "dashboard.created",
    baseId: input.baseId,
    resource: { kind: "dashboard", id: dashboard.id },
    actorId,
  });
  return ok(dashboard);
};

type UpdateDashboardServiceInput = {
  name?: string;
  description?: string | null;
  icon?: string | null;
  config?: DashboardConfig;
  position?: number;
  /** Shared toggle: true → ownerUserId becomes null; false → becomes
   *  `actorId`. undefined leaves ownership unchanged. */
  shared?: boolean;
};

export const update = async (id: string, input: UpdateDashboardServiceInput, actorId: string | null): Promise<Result<Dashboard>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Dashboard"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) {
    return fail(err.badInput("name cannot be empty"));
  }

  let config: DashboardConfig | undefined;
  if (input.config !== undefined) {
    const configParsed = DashboardConfigSchema.safeParse(input.config);
    if (!configParsed.success) {
      return fail(err.badInput(`invalid dashboard config: ${configParsed.error.message}`));
    }
    const configValid = await validateDashboardConfig(existing.baseId, configParsed.data);
    if (!configValid.ok) return configValid;
    config = configParsed.data;
  }

  const description = input.description?.trim() || null;
  const ownerUserId = input.shared ? null : actorId;

  const [row] = await sql<DbRow[]>`
    UPDATE grids.dashboards
    SET name = CASE WHEN ${name !== undefined} THEN ${name ?? ""} ELSE name END,
        description = CASE WHEN ${input.description !== undefined} THEN ${description}::text ELSE description END,
        icon = CASE WHEN ${input.icon !== undefined} THEN ${input.icon ?? null} ELSE icon END,
        config = CASE WHEN ${config !== undefined} THEN ${config ?? { rows: [] }}::jsonb ELSE config END,
        position = CASE WHEN ${input.position !== undefined} THEN ${input.position ?? 0} ELSE position END,
        owner_user_id = CASE WHEN ${input.shared !== undefined} THEN ${ownerUserId}::uuid ELSE owner_user_id END,
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
  await emitMetadataEvent({
    type: "dashboard.updated",
    baseId: existing.baseId,
    resource: { kind: "dashboard", id: dashboard.id },
    actorId,
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
  await emitMetadataEvent({
    type: "dashboard.deleted",
    baseId: existing.baseId,
    resource: { kind: "dashboard", id },
    actorId,
  });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<Dashboard>> => {
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
  await emitMetadataEvent({
    type: "dashboard.restored",
    baseId: existing.baseId,
    resource: { kind: "dashboard", id },
    actorId,
  });
  return ok(dashboard);
};
