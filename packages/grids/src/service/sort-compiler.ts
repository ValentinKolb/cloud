import { sql } from "bun";
import type { Field } from "./types";

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

const projectionForType = (fieldId: string, type: string): { sql: any; cast: CastKind } => {
  switch (type) {
    case "number": case "decimal": case "rating": case "autonumber":
      return { sql: sql`(data->>${fieldId})::numeric`, cast: "numeric" };
    case "date":
      return { sql: sql`(data->>${fieldId})::date`, cast: "date" };
    case "boolean":
      return { sql: sql`(data->>${fieldId})::boolean`, cast: "boolean" };
    default:
      return { sql: sql`data->>${fieldId}`, cast: "text" };
  }
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
    if (cursorIsNull) return sql`FALSE`; // null tier was first, already past
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
 * Mixed asc/desc directions are not supported in Phase-1B: even though the
 * per-column operators handle directions individually, the `id` tiebreaker
 * needs a single direction to match the page. Reject up-front so the caller
 * can't get a cursor it can't follow.
 */
export const compileSort = (
  specs: SortSpec[],
  fields: Field[],
  cursor: { values: unknown[]; id: string } | null,
): { ok: true; result: CompiledSort } | { ok: false; error: string } => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const effective = specs.length > 0 ? specs : [];

  // Validate fields exist + not deleted.
  for (const s of effective) {
    const f = fieldsById.get(s.fieldId);
    if (!f) return { ok: false, error: `unknown sort field "${s.fieldId}"` };
    if (f.deletedAt) return { ok: false, error: `sort field "${f.name}" is deleted` };
  }

  // Reject mixed asc/desc up-front so the caller can't end up with a cursor
  // it can't paginate. (Previous behavior only validated when a cursor was
  // present, which meant the first page would succeed and emit a cursor
  // that the next request would reject with 400.)
  if (effective.length > 1) {
    const direction = effective[0]!.direction;
    const allUniform = effective.every((s) => s.direction === direction);
    if (!allUniform) {
      return {
        ok: false,
        error: "mixed asc/desc sort directions are not supported in Phase-1B; use uniform direction",
      };
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
    const proj = projectionForType(spec.fieldId, field.type);
    const dir = spec.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    return sql`${proj.sql} ${dir} ${nulls}`;
  });

  // Tiebreaker on id matches the page direction (uniform across all sort cols).
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
        const proj = projectionForType(resolved[i]!.spec.fieldId, resolved[i]!.field.type);
        const value = cursor.values[i];
        const gt = orderGt(proj.sql, proj.cast, resolved[i]!.spec.direction, resolved[i]!.nullsFirst, value);
        // Equality prefix: all earlier columns equal.
        let prefix: any = sql`TRUE`;
        for (let j = 0; j < i; j++) {
          const pj = projectionForType(resolved[j]!.spec.fieldId, resolved[j]!.field.type);
          const eq = nullSafeEq(pj.sql, pj.cast, cursor.values[j]);
          prefix = sql`${prefix} AND ${eq}`;
        }
        branches.push(sql`(${prefix} AND (${gt}))`);
      }
      // Final branch: all sort cols equal AND id past cursor_id.
      let allEqPrefix: any = sql`TRUE`;
      for (let j = 0; j < resolved.length; j++) {
        const pj = projectionForType(resolved[j]!.spec.fieldId, resolved[j]!.field.type);
        const eq = nullSafeEq(pj.sql, pj.cast, cursor.values[j]);
        allEqPrefix = sql`${allEqPrefix} AND ${eq}`;
      }
      branches.push(sql`(${allEqPrefix} AND ${idCompare})`);

      cursorWhere = branches.reduce((acc, cur) => sql`${acc} OR ${cur}`);
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
        sqlCast: projectionForType(spec.fieldId, field.type).cast,
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
