import { sql } from "bun";
import type { Field } from "./types";
import { storageOf, type ProjectionKind } from "./field-storage";

export type SortSpec = {
  fieldId: string;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
};

export type CompiledSort = {
  /** ORDER BY fragments ready to be embedded after a WHERE clause. */
  orderBy: any;
  /** Cursor predicate fragment for keyset pagination, or null if no cursor. */
  cursorWhere: any | null;
  /** Names of fields used in the sort, in order — input for cursor formatting. */
  fieldIds: string[];
  /** Per-field projection used to extract a row's sort values for the next cursor. */
  projections: Array<{ fieldId: string; sqlCast: string }>;
};

type CastKind = "numeric" | "date" | "boolean" | "text";

/**
 * Maps the storage descriptor's projection kind onto the cast kind used
 * by sort cursors. Both currency and decimal/numeric/percent/duration
 * project as numeric — currency does so via `data->fieldId->>'amount'`
 * but the cursor still encodes as a numeric. text/date/boolean carry
 * through directly. Anything non-orderable (relation/computed/multi-
 * select/json/system-without-projection) reports as `null` here so the
 * caller can reject it with a clean compile error.
 */
const cursorCastFor = (kind: ProjectionKind): CastKind | null => {
  switch (kind) {
    case "numeric":
    case "decimal":
    case "currencyAmount":
      return "numeric";
    case "date":
    case "datetime":
      return "date";
    case "boolean":
      return "boolean";
    case "text":
    case "selectId":
    case "system":
      return "text";
    default:
      return null;
  }
};

const projectionForField = (field: Field): { sql: any; cast: CastKind } | null => {
  // Storage descriptor is the source of truth for "how does this field
  // type project into SQL?" Non-projectable kinds (relation/computed/
  // multi-select/json/unknown) return null here so the compiler can
  // reject them with a clean error rather than silently emitting a
  // text fallback that sorts everything to NULL.
  const desc = storageOf(field);
  if (!desc.sortable) return null;
  const projected = desc.project(field, "r");
  if (!projected) return null;
  const cast = cursorCastFor(desc.kind);
  if (!cast) return null;
  return { sql: projected as any, cast };
};

const castedValue = (cast: CastKind, value: unknown): any => {
  if (value === null || value === undefined) {
    switch (cast) {
      case "numeric": return sql`NULL::numeric`;
      case "date": return sql`NULL::date`;
      case "boolean": return sql`NULL::boolean`;
      case "text": return sql`NULL::text`;
    }
  }
  switch (cast) {
    case "numeric": return sql`${value}::numeric`;
    case "date": return sql`${value}::date`;
    case "boolean": return sql`${value}::boolean`;
    case "text": return sql`${value}::text`;
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
const orderGt = (
  proj: any,
  cast: CastKind,
  direction: "asc" | "desc",
  nullsFirst: boolean,
  value: unknown,
): any => {
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
  // formula/multi-select/json all return null from projectionForField,
  // and we reject them with a clean compile error rather than silently
  // sorting all rows to NULL via a text fallback.
  for (const s of effective) {
    const f = fieldsById.get(s.fieldId);
    if (!f) return { ok: false, error: `unknown sort field "${s.fieldId}"` };
    if (f.deletedAt) return { ok: false, error: `sort field "${f.name}" is deleted` };
    if (!projectionForField(f)) {
      return { ok: false, error: `field "${f.name}" (type "${f.type}") is not sortable` };
    }
  }

  // Resolve effective nullsFirst per column (default = nulls-first asc, last desc).
  const resolved = effective.map((s) => ({
    spec: s,
    field: fieldsById.get(s.fieldId)!,
    nullsFirst: s.nullsFirst ?? s.direction === "asc",
  }));

  // Build ORDER BY parts.
  const orderParts = resolved.map(({ spec, field, nullsFirst }) => {
    const proj = projectionForField(field)!;
    const dir = spec.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    return sql`${proj.sql} ${dir} ${nulls}`;
  });

  // Tiebreaker on id uses the first sort column's direction. Any
  // consistent choice gives a total order; the first column matches
  // the user's primary intent (newest/oldest reading direction).
  const pageDirection: "asc" | "desc" = effective[0]?.direction ?? "asc";
  const idDirSql = pageDirection === "desc" ? sql`DESC` : sql`ASC`;
  const orderBy = (orderParts.length > 0 ? [...orderParts, sql`id ${idDirSql}`] : [sql`id ${idDirSql}`])
    .reduce((acc, cur) => sql`${acc}, ${cur}`);

  // Build cursor where clause if a cursor is present.
  let cursorWhere: any | null = null;
  if (cursor) {
    if (resolved.length === 0) {
      // ID-only paging.
      cursorWhere = pageDirection === "desc"
        ? sql`id < ${cursor.id}::uuid`
        : sql`id > ${cursor.id}::uuid`;
    } else {
      // Lexicographic null-aware comparison:
      //   gt(c1, v1)
      //   OR (eq(c1, v1) AND gt(c2, v2))
      //   OR ...
      //   OR (eq(...) AND id (>|<) cursor_id)
      const idCompare = pageDirection === "desc"
        ? sql`id < ${cursor.id}::uuid`
        : sql`id > ${cursor.id}::uuid`;

      const branches: any[] = [];
      for (let i = 0; i < resolved.length; i++) {
        const proj = projectionForField(resolved[i]!.field)!;
        const value = cursor.values[i];
        const gt = orderGt(proj.sql, proj.cast, resolved[i]!.spec.direction, resolved[i]!.nullsFirst, value);
        // Equality prefix: all earlier columns equal.
        let prefix: any = sql`TRUE`;
        for (let j = 0; j < i; j++) {
          const pj = projectionForField(resolved[j]!.field)!;
          const eq = nullSafeEq(pj.sql, pj.cast, cursor.values[j]);
          prefix = sql`${prefix} AND ${eq}`;
        }
        branches.push(sql`(${prefix} AND (${gt}))`);
      }
      // Final branch: all sort cols equal AND id past cursor_id.
      let allEqPrefix: any = sql`TRUE`;
      for (let j = 0; j < resolved.length; j++) {
        const pj = projectionForField(resolved[j]!.field)!;
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

  return {
    ok: true,
    result: {
      orderBy,
      cursorWhere,
      fieldIds: effective.map((s) => s.fieldId),
      projections: resolved.map(({ spec, field }) => ({
        fieldId: spec.fieldId,
        sqlCast: projectionForField(field)!.cast,
      })),
    },
  };
};

/** Encodes the next-page cursor token from the last row of the current page. */
export const encodeCursor = (lastRow: { sortValues: unknown[]; id: string }): string => {
  return JSON.stringify({ v: lastRow.sortValues, i: lastRow.id });
};

export const decodeCursor = (token: string): { values: unknown[]; id: string } | null => {
  try {
    const parsed = JSON.parse(token) as { v?: unknown[]; i?: string };
    if (typeof parsed.i !== "string" || !Array.isArray(parsed.v)) return null;
    return { values: parsed.v, id: parsed.i };
  } catch {
    return null;
  }
};
