import { err, fail, ok, type Result } from "@k2b/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
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
 * Look up a view by `(tableId, slug)` at the path-based SSR boundary.
 * Soft-deleted views and views below a trashed table or base are not live.
 */
export const getByShortIdForTable = async (tableId: string, shortId: string): Promise<View | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT v.*
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.table_id = ${tableId}::uuid AND v.short_id = ${shortId} AND v.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/** Resolves the only public view identifier to the internal resource. */
export const getByShortId = async (shortId: string): Promise<View | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT v.*
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.short_id = ${shortId} AND v.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/** Lists every live view in tables whose owning base was already authorized. */
export const listForTables = async (params: {
  tableIds: readonly string[];
  userId: string | null;
  userGroups?: string[];
  serviceAccountId?: string | null;
}): Promise<View[]> => {
  if (params.tableIds.length === 0) return [];
  const rows = await sql<DbRow[]>`
    SELECT v.*
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.table_id = ANY(${toPgUuidArray([...params.tableIds])}::uuid[])
      AND v.deleted_at IS NULL
    ORDER BY v.position, v.created_at
  `;

  return rows.map(mapRow);
};

export const listForTable = async (params: {
  tableId: string;
  userId: string | null;
  userGroups?: string[];
  serviceAccountId?: string | null;
}): Promise<View[]> =>
  listForTables({
    tableIds: [params.tableId],
    userId: params.userId,
    userGroups: params.userGroups,
    serviceAccountId: params.serviceAccountId,
  });

// ──────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────

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
 * Soft-deletes the view. The row stays restorable.
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
