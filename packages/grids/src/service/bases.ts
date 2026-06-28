import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { DocumentProfileSchema } from "../contracts";
import { grantAccess } from "./access";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { emitMetadataEvent } from "./metadata-events";
import { insertWithShortId } from "./short-id";
import type { Base, CreateBaseInput, UpdateBaseInput } from "./types";

type DbRow = Record<string, unknown>;

const COLS = sql`id, short_id, name, description, document_profile, created_by, default_dashboard_id, deleted_at, created_at, updated_at`;

const mapDocumentProfile = (value: unknown): Base["documentProfile"] => {
  const parsed = DocumentProfileSchema.safeParse(parseJsonbRow(value, {}));
  return parsed.success ? parsed.data : {};
};

const mapRow = (row: DbRow): Base => ({
  id: row.id as string,
  shortId: row.short_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  documentProfile: mapDocumentProfile(row.document_profile),
  createdBy: (row.created_by as string | null) ?? null,
  defaultDashboardId: (row.default_dashboard_id as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

/**
 * Lists active (non-soft-deleted) bases. Pass `includeDeleted: true`
 * to include trashed entries — used by the trash/restore UI.
 */
export const list = async (opts: { includeDeleted?: boolean } = {}): Promise<Base[]> => {
  const rows = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.bases
        ORDER BY created_at DESC
      `
    : await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.bases
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
      `;
  return rows.map(mapRow);
};

export const listVisible = async (params: {
  userId: string;
  userGroups: string[];
  isAdmin?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Base[]; total: number }> => {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const query = params.query?.trim().toLowerCase();
  const conditions: any[] = [sql`b.deleted_at IS NULL`];
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(sql`(
      LOWER(b.name) LIKE ${pattern} ESCAPE '\\'
      OR LOWER(COALESCE(b.description, '')) LIKE ${pattern} ESCAPE '\\'
      OR LOWER(b.short_id) LIKE ${pattern} ESCAPE '\\'
    )`);
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  if (params.isAdmin) {
    const [countRow] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM grids.bases b WHERE ${where}
    `;
    const rows = await sql<DbRow[]>`
      SELECT ${COLS}
      FROM grids.bases b
      WHERE ${where}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return { items: rows.map(mapRow), total: countRow?.total ?? 0 };
  }

  const groups = toPgUuidArray(params.userGroups);
  const permissionRank = sql`CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 ELSE 0 END`;
  const rankFor = (principal: "user" | "group" | "authenticated" | "public") => {
    const principalWhere =
      principal === "user"
        ? sql`a.user_id = ${params.userId}::uuid`
        : principal === "group"
          ? sql`a.group_id = ANY(${groups}::uuid[])`
          : principal === "authenticated"
            ? sql`a.authenticated_only = TRUE AND ${params.userId}::uuid IS NOT NULL`
            : sql`a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = FALSE`;
    return sql`(
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        WHEN bool_or(a.permission = 'none') THEN 0
        ELSE MAX(${permissionRank})
      END
      FROM grids.base_access ba
      JOIN auth.access a ON a.id = ba.access_id
      WHERE ba.base_id = b.id AND ${principalWhere}
    )`;
  };

  const ranked = () => sql`
    SELECT b.*,
      ${rankFor("user")} AS user_rank,
      ${rankFor("group")} AS group_rank,
      ${rankFor("authenticated")} AS auth_rank,
      ${rankFor("public")} AS public_rank
    FROM grids.bases b
    WHERE ${where}
  `;
  const visibleWhere = sql`COALESCE(user_rank, group_rank, auth_rank, public_rank, 0) >= 1`;
  const [countRow] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM (${ranked()}) visible
    WHERE ${visibleWhere}
  `;
  const rows = await sql<DbRow[]>`
    SELECT *
    FROM (${ranked()}) visible
    WHERE ${visibleWhere}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { items: rows.map(mapRow), total: countRow?.total ?? 0 };
};

/**
 * Returns the base or null. Soft-deleted bases return null by default —
 * callers that need to render the trash listing or perform restore must
 * pass `includeDeleted: true`.
 */
export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<Base | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.bases WHERE id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.bases WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

/**
 * Look up a base by its short slug. Used at the SSR-route boundary to
 * resolve URL slugs (`/app/grids/k3Mp9`) to UUIDs that the rest of the
 * service layer + API works with. Returns null for soft-deleted bases.
 */
export const getByShortId = async (shortId: string): Promise<Base | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT ${COLS}
    FROM grids.bases WHERE short_id = ${shortId} AND deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup — accepts either the short slug (5 chars) or the full
 * UUID (36 chars with hyphens). Used by URL handlers that may receive
 * either form: sidebar links and breadcrumbs use slugs, but deep-link
 * URLs from relation cells (record-cross-table navigation) still pass
 * UUIDs from `field.config.targetTableId`. Cheap to support both — slugs
 * and UUIDs are length-distinguishable so no DB round-trip is wasted.
 */
export const getByIdOrShortId = async (idOrSlug: string): Promise<Base | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    return get(idOrSlug);
  }
  return getByShortId(idOrSlug);
};

export const create = async (input: CreateBaseInput, actorId: string | null): Promise<Result<Base>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.bases (short_id, name, description, created_by)
      VALUES (${shortId}, ${name}, ${input.description ?? null}, ${actorId}::uuid)
      RETURNING ${COLS}
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_bases_short_id");
  const base = mapRow(row);

  // Auto-grant admin to the creator so they can immediately use the new base.
  // Without this, no ACL row exists and the resolver returns "none" — the
  // creator would lock themselves out at the moment of creation.
  //
  // grantAccess reaches into cloud/services/accounts (auth.access table)
  // so threading a transaction across both apps is a bigger refactor;
  // instead, on failure we rollback the just-created base manually.
  // Imperfect (the cleanup DELETE could itself fail) but strictly better
  // than today's behaviour of leaving the orphan and returning fail.
  if (actorId) {
    const granted = await grantAccess({
      resourceType: "base",
      resourceId: base.id,
      principal: { type: "user", userId: actorId },
      permission: "admin",
      actorId,
    });
    if (!granted.ok) {
      // Hard delete (not soft) — there's no audit value in keeping a
      // base that was never visible to anyone.
      await sql`DELETE FROM grids.bases WHERE id = ${base.id}::uuid`.catch(() => {});
      return fail(granted.error);
    }
  }

  await logAudit({ baseId: base.id, userId: actorId, action: "created" });
  await emitMetadataEvent({
    type: "base.created",
    baseId: base.id,
    resource: { kind: "base", id: base.id },
    actorId,
  });
  return ok(base);
};

export const update = async (id: string, input: UpdateBaseInput, actorId: string | null): Promise<Result<Base>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("base"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  // defaultDashboardId is allowed through the same update path (caller
  // gates with base-admin). Validate that the referenced dashboard
  // exists, belongs to this base, and is alive — otherwise we'd be
  // happily writing dangling references.
  if (input.defaultDashboardId !== undefined && input.defaultDashboardId !== null) {
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM grids.dashboards
        WHERE id = ${input.defaultDashboardId}::uuid
          AND base_id = ${id}::uuid
          AND deleted_at IS NULL
      ) AS exists
    `;
    if (!row?.exists) {
      return fail(err.badInput("defaultDashboardId must reference an alive dashboard in this base"));
    }
  }

  const next = {
    name: name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    documentProfile: input.documentProfile !== undefined ? input.documentProfile : existing.documentProfile,
    defaultDashboardId: input.defaultDashboardId !== undefined ? input.defaultDashboardId : existing.defaultDashboardId,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.bases
    SET name = ${next.name},
        description = ${next.description},
        document_profile = ${next.documentProfile}::jsonb,
        default_dashboard_id = ${next.defaultDashboardId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.internal("update failed"));
  const base = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.description !== existing.description) {
    diff.description = { old: existing.description, new: next.description };
  }
  if (JSON.stringify(next.documentProfile) !== JSON.stringify(existing.documentProfile)) {
    diff.documentProfile = { old: existing.documentProfile, new: next.documentProfile };
  }
  if (next.defaultDashboardId !== existing.defaultDashboardId) {
    diff.defaultDashboardId = {
      old: existing.defaultDashboardId,
      new: next.defaultDashboardId,
    };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ baseId: id, userId: actorId, action: "updated", diff });
    await emitMetadataEvent({
      type: "base.updated",
      baseId: id,
      resource: { kind: "base", id },
      actorId,
    });
  }

  return ok(base);
};

/**
 * Soft-deletes the base. The row stays in the DB with `deleted_at` set,
 * which makes it invisible to all default queries (list/get) while
 * keeping its tables/fields/records/views/forms recoverable. Hard
 * deletion happens via the maintenance purge job after the grace period
 * (cf. `maintenance.purgeSoftDeleted`).
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const result = await sql`
    UPDATE grids.bases SET deleted_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;
  if (result.count === 0) return fail(err.notFound("base"));
  await logAudit({ baseId: id, userId: actorId, action: "deleted" });
  await emitMetadataEvent({
    type: "base.deleted",
    baseId: id,
    resource: { kind: "base", id },
    actorId,
  });
  return ok();
};

/**
 * Restores a soft-deleted base. Children (tables/fields/records/views/forms)
 * that were independently deleted stay deleted — restore is non-cascading
 * by design, matching the user's mental model of "I deleted the base by
 * accident; the table I trashed last week is unrelated".
 */
export const restore = async (id: string, actorId: string | null): Promise<Result<Base>> => {
  const [row] = await sql<DbRow[]>`
    UPDATE grids.bases SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NOT NULL
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.notFound("base"));
  const base = mapRow(row);
  await logAudit({ baseId: id, userId: actorId, action: "restored" });
  await emitMetadataEvent({
    type: "base.restored",
    baseId: id,
    resource: { kind: "base", id },
    actorId,
  });
  return ok(base);
};

// ──────────────────────────────────────────────────────────────────
// Admin views (platform-admin only — bypasses per-base ACLs)
// ──────────────────────────────────────────────────────────────────

export type AdminListItem = Base & {
  tableCount: number;
  recordCount: number;
  accessCount: number;
};

const escapeLikePattern = (s: string): string => s.replace(/([\\%_])/g, "\\$1");

export const adminList = async (params: {
  pagination?: { perPage?: number; offset?: number };
  filter?: { query?: string };
}): Promise<{ items: AdminListItem[]; total: number; page: number; perPage: number }> => {
  const perPage = Math.min(Math.max(params.pagination?.perPage ?? 100, 1), 500);
  const offset = Math.max(params.pagination?.offset ?? 0, 0);
  const page = Math.floor(offset / perPage) + 1;
  const query = params.filter?.query?.trim().toLowerCase();

  const conditions: any[] = [sql`TRUE`];
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(sql`(LOWER(b.name) LIKE ${pattern} ESCAPE '\\' OR LOWER(COALESCE(b.description, '')) LIKE ${pattern} ESCAPE '\\')`);
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const [countRow] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM grids.bases b WHERE ${where}
  `;

  const rows = await sql<DbRow[]>`
    SELECT
      b.id, b.short_id, b.name, b.description, b.created_by, b.default_dashboard_id, b.deleted_at, b.created_at, b.updated_at,
      (SELECT COUNT(*)::int FROM grids.tables WHERE base_id = b.id) AS table_count,
      (SELECT COUNT(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = b.id AND r.deleted_at IS NULL) AS record_count,
      (SELECT COUNT(*)::int FROM grids.base_access WHERE base_id = b.id) AS access_count
    FROM grids.bases b
    WHERE ${where}
    ORDER BY b.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    items: rows.map((row) => ({
      ...mapRow(row),
      tableCount: row.table_count as number,
      recordCount: row.record_count as number,
      accessCount: row.access_count as number,
    })),
    total: countRow?.total ?? 0,
    page,
    perPage,
  };
};

export const adminSummary = async (params: {
  filter?: { query?: string };
}): Promise<{ totalBases: number; totalTables: number; totalRecords: number; orphanedBases: number }> => {
  const query = params.filter?.query?.trim().toLowerCase();
  const conditions: any[] = [sql`TRUE`];
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(sql`(LOWER(b.name) LIKE ${pattern} ESCAPE '\\' OR LOWER(COALESCE(b.description, '')) LIKE ${pattern} ESCAPE '\\')`);
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const [row] = await sql<DbRow[]>`
    SELECT
      (SELECT COUNT(*)::int FROM grids.bases b WHERE ${where}) AS total_bases,
      (SELECT COUNT(*)::int FROM grids.tables t JOIN grids.bases b ON b.id = t.base_id WHERE ${where}) AS total_tables,
      (SELECT COUNT(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id JOIN grids.bases b ON b.id = t.base_id WHERE r.deleted_at IS NULL AND ${where}) AS total_records,
      (SELECT COUNT(*)::int FROM grids.bases b WHERE NOT EXISTS (SELECT 1 FROM grids.base_access WHERE base_id = b.id) AND ${where}) AS orphaned_bases
  `;
  return {
    totalBases: (row?.total_bases as number) ?? 0,
    totalTables: (row?.total_tables as number) ?? 0,
    totalRecords: (row?.total_records as number) ?? 0,
    orphanedBases: (row?.orphaned_bases as number) ?? 0,
  };
};
