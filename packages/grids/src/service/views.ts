import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type View, type ViewUiSettings, ViewUiSettingsSchema } from "../contracts";
import { normalizeRefKey } from "../ref-syntax";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { emitTableMetadataEvent } from "./metadata-events";
import { writeNamedResource } from "./named-resource-conflict";
import { insertWithShortId } from "./short-id";

type DbRow = Record<string, unknown>;

const parseUi = (raw: unknown): ViewUiSettings => {
  const parsed = ViewUiSettingsSchema.safeParse(parseJsonbRow<unknown>(raw, {}));
  return parsed.success ? parsed.data : {};
};

const mapRow = (row: DbRow): View => {
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    tableId: row.table_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    source: row.source as string,
    ui: parseUi(row.ui),
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    position: row.position as number,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

/**
 * Look up a view by (tableId, slug). Used at the SSR-route boundary
 * to resolve the `?view=<slug>` URL param to a UUID. Returns null for
 * soft-deleted views AND for views whose parent table or base is
 * trashed (live-parent invariant).
 */
export const getByShortId = async (tableId: string, shortId: string): Promise<View | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT v.*
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.table_id = ${tableId}::uuid AND v.short_id = ${shortId} AND v.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup — accepts either UUID or slug. Same length-based
 * heuristic as `bases.getByIdOrShortId` / `tables.getByIdOrShortId`.
 */
export const getByIdOrShortId = async (tableId: string, idOrSlug: string): Promise<View | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const v = await get(idOrSlug);
    // Scope-check: a leaked UUID from another table must not resolve here.
    return v && v.tableId === tableId ? v : null;
  }
  return getByShortId(tableId, idOrSlug);
};

/**
 * Lists views visible to a user on a table. Visibility rules:
 *   1. Shared views (owner_user_id NULL) and the user's own personal
 *      views are visible by default.
 *   2. View-level ACL grants OVERRIDE that default — an explicit
 *      level=read on someone else's personal view makes it visible to
 *      the grantee, and an explicit level=none on a shared view hides
 *      it from the denied user.
 *
 * Most-specific-wins: a view-level grant for this user (or any of their
 *   groups) supersedes the default-visibility check. If the highest
 *   matching grant is `none`, the view is hidden even if it would
 *   otherwise be a default-shared view.
 */
export const listForTable = async (params: {
  tableId: string;
  userId: string | null;
  userGroups?: string[];
  serviceAccountId?: string | null;
}): Promise<View[]> => {
  // Defensive encoding: bun.sql may surface an empty uuid[] column as the
  // string "{}" instead of [], and admin users with no group memberships
  // hit exactly that path. toPgUuidArray normalizes both shapes.
  const groups = toPgUuidArray(params.userGroups);
  const serviceAccountId = params.serviceAccountId ?? null;

  // Most-specific-wins per principal tier (user > group > authenticated >
  // public). Within a tier: any deny wins over any read — needed because
  // (a) `grantAccess` inserts a fresh auth.access row per POST so duplicate
  // principal rows are possible, and (b) a user can be in multiple groups
  // that disagree. Per-tier rule: NULL if no rows, 0 if any deny, else
  // MAX(positive rank).
  const rows = await sql<DbRow[]>`
    WITH ranked AS (
      SELECT v.id, v.short_id, v.table_id, v.name, v.description, v.icon, v.source, v.ui, v.owner_user_id, v.position, v.deleted_at, v.created_at, v.updated_at,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
          WHERE va.view_id = v.id AND a.service_account_id = ${serviceAccountId}::uuid
        ) AS service_account_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
          WHERE va.view_id = v.id AND a.user_id = ${params.userId}::uuid
        ) AS user_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
          WHERE va.view_id = v.id AND a.group_id = ANY(${groups}::uuid[])
        ) AS group_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
          WHERE va.view_id = v.id
            AND a.authenticated_only = TRUE
            AND (${params.userId}::uuid IS NOT NULL OR ${serviceAccountId}::uuid IS NOT NULL)
        ) AS auth_rank,
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN bool_or(a.permission = 'none') THEN 0
            ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
          END
          FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
          WHERE va.view_id = v.id
            AND a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = FALSE
        ) AS public_rank
      FROM grids.views v
      JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE v.table_id = ${params.tableId}::uuid AND v.deleted_at IS NULL
    )
    SELECT id, short_id, table_id, name, description, icon, source, ui, owner_user_id, position, deleted_at, created_at, updated_at
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

// ──────────────────────────────────────────────────────────────────
// Pure ACL tier resolution (testable)
// ──────────────────────────────────────────────────────────────────

type TierRanks = {
  /** Highest matching rank from direct user grants, or 0 if any user-deny exists, or null when no user rows match. */
  userRank: number | null;
  groupRank: number | null;
  authRank: number | null;
  publicRank: number | null;
};

/**
 * Walks ACL specificity tiers top-down (user > group > authenticated >
 * public). The first tier with any matching grant decides. If that tier's
 * rank is >= 1 (read/write/admin), the view is visible; rank 0 (deny)
 * hides it. If no tier matched, falls back to default visibility (shared
 * view or own personal view). Pure logic — no DB.
 */
export const isVisibleByAclTiers = (ranks: TierRanks, defaults: { ownerUserId: string | null; viewerUserId: string | null }): boolean => {
  const winning = ranks.userRank ?? ranks.groupRank ?? ranks.authRank ?? ranks.publicRank;
  if (winning !== null && winning !== undefined) return winning >= 1;
  return defaults.ownerUserId === null || defaults.ownerUserId === defaults.viewerUserId;
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<View | null> => {
  // SELECT v.* keeps the slug in the projection for mapRow. Live-parent
  // invariant: parent table + base must be alive; trashed views require
  // explicit `includeDeleted`.
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT v.*
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE v.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT v.*
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE v.id = ${id}::uuid AND v.deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

const ensureUniqueViewName = async (tableId: string, name: string, exceptViewId: string | null = null): Promise<Result<void>> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id
    WHERE t.base_id = (
        SELECT base_id FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
      )
      AND v.deleted_at IS NULL
      AND lower(trim(v.name)) = ${normalizeRefKey(name)}
      AND (${exceptViewId}::uuid IS NULL OR v.id <> ${exceptViewId}::uuid)
  `;
  return (row?.count ?? 0) === 0 ? ok() : fail(err.conflict("view name must be unique within this grid"));
};

type CreateViewServiceInput = {
  tableId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  /** Canonical GQL source. Undefined means the base table source. */
  source?: string;
  ui?: ViewUiSettings;
  ownerUserId?: string | null;
};

export const create = async (input: CreateViewServiceInput, actorId: string | null): Promise<Result<View>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  const uniqueName = await ensureUniqueViewName(input.tableId, name);
  if (!uniqueName.ok) return uniqueName;

  const source = input.source?.trim() || `from table {${input.tableId}}`;
  if (source.length === 0) return fail(err.badInput("view source required"));
  if (source.length > 20_000) return fail(err.badInput("view source is too long"));
  const uiParsed = ViewUiSettingsSchema.safeParse(input.ui ?? {});
  if (!uiParsed.success) return fail(err.badInput("invalid view UI settings"));

  const inserted = await writeNamedResource(
    () =>
      insertWithShortId<DbRow>(async (shortId) => {
        const [r] = await sql<DbRow[]>`
        INSERT INTO grids.views (short_id, table_id, base_id, name, description, icon, source, ui, owner_user_id, position)
        VALUES (
          ${shortId},
          ${input.tableId}::uuid,
          (SELECT base_id FROM grids.tables WHERE id = ${input.tableId}::uuid),
          ${name},
          ${input.description ?? null},
          ${input.icon ?? null},
          ${source},
          ${uiParsed.data}::jsonb,
          ${input.ownerUserId ?? null}::uuid,
          COALESCE((SELECT MAX(position) + 1 FROM grids.views WHERE table_id = ${input.tableId}::uuid), 0)
        )
        RETURNING id, short_id, table_id, name, description, icon, source, ui, owner_user_id, position, deleted_at, created_at, updated_at
      `;
        if (!r) throw new Error("insert returned no row");
        return r;
      }, "idx_grids_views_short_id"),
    "idx_grids_views_live_name",
    "view name must be unique within this grid",
  );
  if (!inserted.ok) return inserted;
  const view = mapRow(inserted.data);
  await logAudit({
    tableId: input.tableId,
    userId: actorId,
    action: "created",
    diff: { view: { old: null, new: { id: view.id, name: view.name } } },
  });
  await emitTableMetadataEvent(input.tableId, {
    type: "view.created",
    resource: { kind: "view", id: view.id, tableId: input.tableId },
    actorId,
  });
  return ok(view);
};

type UpdateViewServiceInput = {
  name?: string;
  description?: string | null;
  icon?: string | null;
  source?: string;
  ui?: ViewUiSettings;
  position?: number;
  /** Shared toggle: true → ownerUserId becomes null (anyone can read);
   *  false → ownerUserId becomes `actorId` (the editor takes ownership). */
  shared?: boolean;
};

export const update = async (id: string, input: UpdateViewServiceInput, actorId: string | null): Promise<Result<View>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));
  const uniqueName = await ensureUniqueViewName(existing.tableId, name ?? existing.name, existing.id);
  if (!uniqueName.ok) return uniqueName;

  const ownerUserId = input.shared === undefined ? existing.ownerUserId : input.shared ? null : actorId;

  const uiParsed = ViewUiSettingsSchema.safeParse(input.ui ?? existing.ui);
  if (!uiParsed.success) return fail(err.badInput("invalid view UI settings"));
  const nextSource = input.source?.trim() ?? existing.source;
  if (nextSource.length === 0) return fail(err.badInput("view source required"));
  if (nextSource.length > 20_000) return fail(err.badInput("view source is too long"));

  const next = {
    name: name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    icon: input.icon !== undefined ? input.icon : existing.icon,
    source: nextSource,
    ui: uiParsed.data,
    position: input.position ?? existing.position,
  };

  const updated = await writeNamedResource(
    async () => {
      const [row] = await sql<DbRow[]>`
        UPDATE grids.views
        SET name = ${next.name},
            description = ${next.description},
            icon = ${next.icon},
            source = ${next.source},
            ui = ${next.ui}::jsonb,
            position = ${next.position},
            owner_user_id = ${ownerUserId}::uuid,
            updated_at = now()
        WHERE id = ${id}::uuid AND deleted_at IS NULL
        RETURNING id, short_id, table_id, name, description, icon, source, ui, owner_user_id, position, deleted_at, created_at, updated_at
      `;
      return row;
    },
    "idx_grids_views_live_name",
    "view name must be unique within this grid",
  );
  if (!updated.ok) return updated;
  const row = updated.data;
  if (!row) return fail(err.internal("update failed"));
  const view = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff: { view: { old: existing.name, new: view.name } } });
  await emitTableMetadataEvent(existing.tableId, {
    type: "view.updated",
    resource: { kind: "view", id: view.id, tableId: existing.tableId },
    actorId,
  });
  return ok(view);
};

/**
 * Soft-deletes the view. Hard purge happens via maintenance job after
 * the grace period; the row stays restorable until then.
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));
  await sql`UPDATE grids.views SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  await emitTableMetadataEvent(existing.tableId, {
    type: "view.deleted",
    resource: { kind: "view", id, tableId: existing.tableId },
    actorId,
  });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<View>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("View"));
  if (existing.deletedAt === null) return ok(existing);
  const restored = await writeNamedResource(
    async () => {
      const [row] = await sql<DbRow[]>`
        UPDATE grids.views SET deleted_at = NULL, updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id, short_id, table_id, name, description, icon, source, ui, owner_user_id, position, deleted_at, created_at, updated_at
      `;
      return row;
    },
    "idx_grids_views_live_name",
    "view name must be unique within this grid",
  );
  if (!restored.ok) return restored;
  const row = restored.data;
  if (!row) return fail(err.internal("restore failed"));
  const view = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "restored" });
  await emitTableMetadataEvent(existing.tableId, {
    type: "view.restored",
    resource: { kind: "view", id, tableId: existing.tableId },
    actorId,
  });
  return ok(view);
};
