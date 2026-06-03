import { sql } from "bun";
import type { RecordMetaSortKey } from "../contracts";
import { type ProjectionKind, storageOf } from "./field-storage";
import type { Field } from "./types";

export type FieldSortSpec = {
  source?: "field";
  fieldId: string;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
};

export type RecordSortSpec = {
  source: "record";
  key: RecordMetaSortKey;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
};

export type SortSpec = FieldSortSpec | RecordSortSpec;

type CompiledSort = {
  /** ORDER BY fragments ready to be embedded after a WHERE clause. */
  orderBy: any;
  /** Cursor predicate fragment for keyset pagination, or null if no cursor. */
  cursorWhere: any | null;
  /** Stable identifiers used in the sort, in order — input for cursor length checks. */
  fieldIds: string[];
  /**
   * SQL SELECT-list extras: the sort projections aliased as `__sort_<i>`
   * so the cursor encoder reads the SAME value the ORDER BY used.
   * Without this, cursor encoding read `record.data[fieldId]` (the raw
   * JSONB value) and corrupt rows produced cursors that page 2 then
   * tried to cast as numeric/date and crashed (chunk 3 critical).
   *
   * Empty fragment when no sort columns are configured.
   */
  cursorSelect: any;
  /** Reads the sort-aliased columns from a SQL result row to build the
   *  next-page cursor token. The row must have `__sort_0` ... `__sort_N`
   *  plus `id` (uuid). Returns null when the page didn't run a sort. */
  encodeCursorFromRow: (row: Record<string, unknown>) => string;
};

type CastKind = "numeric" | "date" | "timestamptz" | "boolean" | "text";

/**
 * Maps the storage descriptor's projection kind onto the cast kind used
 * by sort cursors. Numeric/percent/duration project as numeric.
 * text/date/boolean carry through directly. Anything non-orderable (relation/computed/multi-
 * select/json/system-without-projection) reports as `null` here so the
 * caller can reject it with a clean compile error.
 */
const cursorCastFor = (kind: ProjectionKind): CastKind | null => {
  switch (kind) {
    case "numeric":
      return "numeric";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "boolean":
      return "boolean";
    case "text":
    case "system":
      return "text";
    default:
      return null;
  }
};

const projectionForField = (field: Field): { sql: any; cast: CastKind } | null => {
  // Storage descriptor is the source of truth for "how does this field
  // type project into SQL?" Non-projectable kinds (relation/computed/
  // select/json/unknown) return null here so the compiler can
  // reject them with a clean error rather than silently emitting a
  // text fallback that sorts everything to NULL.
  const desc = storageOf(field);
  if (!desc.sortable) return null;
  const projected = desc.project(field, "r");
  if (!projected) return null;
  const cast = desc.kind === "system" && field.type.endsWith("_at") ? "timestamptz" : cursorCastFor(desc.kind);
  if (!cast) return null;
  return { sql: projected as any, cast };
};

const isRecordSort = (spec: SortSpec): spec is RecordSortSpec => spec.source === "record";

const recordProjectionFor = (key: RecordMetaSortKey): { sql: any; cast: CastKind; label: string } | null => {
  switch (key) {
    case "createdAt":
      return { sql: sql`r.created_at`, cast: "timestamptz", label: "Created time" };
    case "updatedAt":
      return { sql: sql`r.updated_at`, cast: "timestamptz", label: "Modified time" };
    case "deletedAt":
      return { sql: sql`r.deleted_at`, cast: "timestamptz", label: "Deleted time" };
    default:
      return null;
  }
};

const sortIdentity = (spec: SortSpec): string => (isRecordSort(spec) ? `record:${spec.key}` : spec.fieldId);

const castedValue = (cast: CastKind, value: unknown): any => {
  if (value === null || value === undefined) {
    switch (cast) {
      case "numeric":
        return sql`NULL::numeric`;
      case "date":
        return sql`NULL::date`;
      case "timestamptz":
        return sql`NULL::timestamptz`;
      case "boolean":
        return sql`NULL::boolean`;
      case "text":
        return sql`NULL::text`;
    }
  }
  switch (cast) {
    case "numeric":
      return sql`${value}::numeric`;
    case "date":
      return sql`${value}::date`;
    case "timestamptz":
      return sql`${value}::timestamptz`;
    case "boolean":
      return sql`${value}::boolean`;
    case "text":
      return sql`${value}::text`;
  }
};

/**
 * Null-safe equality: TRUE when both NULL or both equal. Postgres' regular
 * `=` returns NULL when either side is NULL, which would break the cascading
 * tuple comparison (rows with same null sort value would be skipped).
 */
const nullSafeEq = (proj: any, cast: CastKind, value: unknown): any => {
  return sql`${proj} IS NOT DISTINCT FROM ${castedValue(cast, value)}`;
};

/**
 * "Comes after" comparator per column, accounting for direction + nulls
 * placement. Returns a SQL fragment that's TRUE when `proj` belongs after
 * `value` in the sort order.
 */
const orderGt = (proj: any, cast: CastKind, direction: "asc" | "desc", nullsFirst: boolean, value: unknown): any => {
  const cursorIsNull = value === null || value === undefined;

  if (direction === "asc" && nullsFirst) {
    // Order: NULL, NULL, ..., 1, 2, 3.
    if (cursorIsNull) return sql`${proj} IS NOT NULL`;
    return sql`${proj} > ${castedValue(cast, value)}`;
  }
  if (direction === "asc" && !nullsFirst) {
    // Order: 1, 2, 3, ..., NULL, NULL.
    if (cursorIsNull) return sql`FALSE`; // already at the trailing null tier
    return sql`(${proj} > ${castedValue(cast, value)}) OR (${proj} IS NULL)`;
  }
  if (direction === "desc" && nullsFirst) {
    // Order: NULL, NULL, ..., 9, 8, 1.
    // Cursor at null tier (first): after means the entire non-null tier.
    if (cursorIsNull) return sql`${proj} IS NOT NULL`;
    return sql`${proj} < ${castedValue(cast, value)}`;
  }
  // direction === "desc" && !nullsFirst
  // Order: 9, 8, ..., 1, NULL, NULL.
  if (cursorIsNull) return sql`FALSE`;
  return sql`(${proj} < ${castedValue(cast, value)}) OR (${proj} IS NULL)`;
};

/**
 * Compiles a multi-column sort spec to an ORDER BY fragment plus a
 * null-aware tuple cursor predicate. The cursor encodes the previous page's
 * sort values + id; pagination is built as a cascading lexicographic
 * comparison (see `orderGt` for per-column semantics). Always appends `id`
 * as a final tiebreaker so the order is total even when sort keys collide.
 *
 * v3 (Slice 7): mixed asc/desc directions are now supported. The
 * per-column `orderGt` operators already handle direction individually;
 * the only remaining concern was the `id` tiebreaker, which now uses
 * the FIRST column's direction (any consistent choice gives a total
 * order; first-column matches the user's primary intent visually).
 */
export const compileSort = (
  specs: SortSpec[],
  fields: Field[],
  cursor: { values: unknown[]; id: string } | null,
): { ok: true; result: CompiledSort } | { ok: false; error: string } => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const effective = specs.length > 0 ? specs : [];

  // Validate fields exist + not deleted + sortable. Storage descriptor
  // is the source of truth for sortability — relation/lookup/rollup/
  // formula/select/json all return null from projectionForField,
  // and we reject them with a clean compile error rather than silently
  // sorting all rows to NULL via a text fallback.
  for (const s of effective) {
    if (isRecordSort(s)) {
      if (!recordProjectionFor(s.key)) return { ok: false, error: "unknown record sort field" };
      continue;
    }
    const f = fieldsById.get(s.fieldId);
    if (!f) return { ok: false, error: "unknown sort field" };
    if (f.deletedAt) return { ok: false, error: `sort field "${f.name}" is deleted` };
    if (!projectionForField(f)) {
      return { ok: false, error: `field "${f.name}" (type "${f.type}") is not sortable` };
    }
  }

  // Resolve effective nullsFirst per column (default = nulls-first asc, last desc).
  const resolved = effective.map((s) => {
    const projection = isRecordSort(s) ? recordProjectionFor(s.key)! : projectionForField(fieldsById.get(s.fieldId)!)!;
    return {
      spec: s,
      projection,
      nullsFirst: s.nullsFirst ?? s.direction === "asc",
    };
  });

  // Build ORDER BY parts.
  const orderParts = resolved.map(({ spec, projection, nullsFirst }) => {
    const dir = spec.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    return sql`${projection.sql} ${dir} ${nulls}`;
  });

  // Tiebreaker on id uses the first sort column's direction. Any
  // consistent choice gives a total order; the first column matches
  // the user's primary intent (newest/oldest reading direction).
  const pageDirection: "asc" | "desc" = effective[0]?.direction ?? "asc";
  const idDirSql = pageDirection === "desc" ? sql`DESC` : sql`ASC`;
  // r.id (not bare id) — records.list now JOINs grids.tables and
  // grids.bases for the live-parent invariant, and all three tables
  // carry an `id` column. An unqualified reference raises 42702
  // "column reference 'id' is ambiguous" at runtime.
  const orderBy = (orderParts.length > 0 ? [...orderParts, sql`r.id ${idDirSql}`] : [sql`r.id ${idDirSql}`]).reduce(
    (acc, cur) => sql`${acc}, ${cur}`,
  );

  // Build cursor where clause if a cursor is present.
  let cursorWhere: any | null = null;
  if (cursor) {
    if (resolved.length === 0) {
      // ID-only paging.
      cursorWhere = pageDirection === "desc" ? sql`r.id < ${cursor.id}::uuid` : sql`r.id > ${cursor.id}::uuid`;
    } else {
      // Lexicographic null-aware comparison:
      //   gt(c1, v1)
      //   OR (eq(c1, v1) AND gt(c2, v2))
      //   OR ...
      //   OR (eq(...) AND id (>|<) cursor_id)
      const idCompare = pageDirection === "desc" ? sql`r.id < ${cursor.id}::uuid` : sql`r.id > ${cursor.id}::uuid`;

      const branches: any[] = [];
      for (let i = 0; i < resolved.length; i++) {
        const proj = resolved[i]!.projection;
        const value = cursor.values[i];
        const gt = orderGt(proj.sql, proj.cast, resolved[i]!.spec.direction, resolved[i]!.nullsFirst, value);
        // Equality prefix: all earlier columns equal.
        let prefix: any = sql`TRUE`;
        for (let j = 0; j < i; j++) {
          const pj = resolved[j]!.projection;
          const eq = nullSafeEq(pj.sql, pj.cast, cursor.values[j]);
          prefix = sql`${prefix} AND ${eq}`;
        }
        branches.push(sql`(${prefix} AND (${gt}))`);
      }
      // Final branch: all sort cols equal AND id past cursor_id.
      let allEqPrefix: any = sql`TRUE`;
      for (let j = 0; j < resolved.length; j++) {
        const pj = resolved[j]!.projection;
        const eq = nullSafeEq(pj.sql, pj.cast, cursor.values[j]);
        allEqPrefix = sql`${allEqPrefix} AND ${eq}`;
      }
      branches.push(sql`(${allEqPrefix} AND ${idCompare})`);

      // Wrap the OR-reduction in an outer parenthesis. Without this, the
      // caller's `... AND ${cursorWhere}` parses as `... AND A OR B OR C`,
      // i.e. `(... AND A) OR B OR C` — letting later branches escape the
      // table/deleted/filter predicates and return wrong rows.
      const orChain = branches.reduce((acc, cur) => sql`${acc} OR ${cur}`);
      cursorWhere = sql`(${orChain})`;
    }
  }

  // Cursor SELECT extras: emit each sort projection as `__sort_<i>`.
  // The result row will carry these columns alongside r.*, and the
  // cursor encoder reads them — same null-safe values the ORDER BY
  // sees, so corrupt JSONB doesn't leak through cursor encoding.
  const cursorSelect =
    resolved.length === 0
      ? sql``
      : resolved
          .map(({ projection }, i) => {
            return sql`, ${projection.sql} AS ${sql.unsafe(`__sort_${i}`)}`;
          })
          .reduce((acc, cur) => sql`${acc}${cur}`);

  const encodeCursorFromRow = (row: Record<string, unknown>): string => {
    const values: unknown[] = [];
    for (let i = 0; i < resolved.length; i++) {
      values.push(row[`__sort_${i}`] ?? null);
    }
    return JSON.stringify({ v: values, i: row.id as string });
  };

  return {
    ok: true,
    result: {
      orderBy,
      cursorWhere,
      fieldIds: effective.map(sortIdentity),
      cursorSelect,
      encodeCursorFromRow,
    },
  };
};

// Encoding moved to CompiledSort.encodeCursorFromRow — it reads the
// SQL-projected `__sort_<i>` aliases instead of `record.data[fieldId]`,
// which previously let corrupt JSONB leak into the cursor and crash
// page 2's WHERE-clause cast.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const decodeCursor = (token: string, expectedLength?: number): { values: unknown[]; id: string } | null => {
  let parsed: { v?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(token);
  } catch {
    return null;
  }
  if (typeof parsed.i !== "string" || !UUID_REGEX.test(parsed.i)) return null;
  if (!Array.isArray(parsed.v)) return null;
  // Length must match the active sort. A user navigating from a saved
  // view to an ad-hoc query (or vice versa) without re-fetching can
  // hold a cursor with the wrong length; reject explicitly so the API
  // returns 400 rather than letting a SQL cast misalign on page 2.
  if (expectedLength !== undefined && parsed.v.length !== expectedLength) return null;
  return { values: parsed.v as unknown[], id: parsed.i };
};
