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

const projectionForType = (fieldId: string, type: string) => {
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

/**
 * Compiles a multi-column sort spec to an ORDER BY fragment plus a tuple
 * cursor predicate. The cursor encodes the previous page's last-row sort
 * values + id; pagination is `(sortVal_1, ..., sortVal_n, id) < (...cursor)`
 * (or `>` for ascending). Always appends `id` as a final tiebreaker so the
 * order is total even if sort keys collide.
 */
export const compileSort = (
  specs: SortSpec[],
  fields: Field[],
  cursor: { values: unknown[]; id: string } | null,
): { ok: true; result: CompiledSort } | { ok: false; error: string } => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  // Default sort if none specified: id ASC (matches Phase-1A behavior).
  const effective = specs.length > 0 ? specs : [];

  // Validate fields exist + not deleted.
  for (const s of effective) {
    const f = fieldsById.get(s.fieldId);
    if (!f) return { ok: false, error: `unknown sort field "${s.fieldId}"` };
    if (f.deletedAt) return { ok: false, error: `sort field "${f.name}" is deleted` };
  }

  // Build ORDER BY parts.
  const orderParts = effective.map((s) => {
    const field = fieldsById.get(s.fieldId)!;
    const proj = projectionForType(s.fieldId, field.type);
    const dir = s.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = s.nullsFirst ? sql`NULLS FIRST` : s.direction === "desc" ? sql`NULLS LAST` : sql`NULLS FIRST`;
    return sql`${proj.sql} ${dir} ${nulls}`;
  });
  // Tiebreaker on id matches the page direction of the FIRST sort spec
  // (or ASC if no sort spec at all).
  const idDir = effective[0]?.direction === "desc" ? sql`DESC` : sql`ASC`;
  const tiebreak = sql`id ${idDir}`;
  const orderBy = (orderParts.length > 0 ? [...orderParts, tiebreak] : [tiebreak]).reduce(
    (acc, cur) => sql`${acc}, ${cur}`,
  );

  // Tuple cursor predicate. Postgres supports row-comparison directly:
  // `(a, b, c) < (1, 2, 3)`. We mix ASC/DESC by using the appropriate
  // operator per the page direction. To keep it simple we require all
  // sort columns to share a direction; mixed-direction sorts fall back to
  // a per-column nested OR. Phase-1B uses uniform direction.
  let cursorWhere: any | null = null;
  if (cursor) {
    if (effective.length === 0) {
      // ID-only paging.
      cursorWhere = idDir.toString().includes("DESC") ? sql`id < ${cursor.id}::uuid` : sql`id > ${cursor.id}::uuid`;
    } else {
      // Row constructor cursor: identical direction across all sort cols.
      const direction = effective[0]!.direction;
      const allUniform = effective.every((s) => s.direction === direction);
      if (!allUniform) {
        return {
          ok: false,
          error: "mixed asc/desc sort directions are not supported in Phase-1B; use uniform direction",
        };
      }
      const op = direction === "desc" ? sql`<` : sql`>`;
      const lhs = effective
        .map((s) => projectionForType(s.fieldId, fieldsById.get(s.fieldId)!.type).sql)
        .reduce((acc, cur) => sql`${acc}, ${cur}`);
      // Cast cursor values per field to the right Postgres type so the
      // row-compare doesn't trip over implicit casts.
      const rhs = effective
        .map((s, i) => {
          const proj = projectionForType(s.fieldId, fieldsById.get(s.fieldId)!.type);
          const v = cursor.values[i];
          // Hand-pick the cast token from a closed set — never interpolate
          // user data as a SQL identifier.
          switch (proj.cast) {
            case "numeric":
              return v === null || v === undefined ? sql`NULL::numeric` : sql`${v}::numeric`;
            case "date":
              return v === null || v === undefined ? sql`NULL::date` : sql`${v}::date`;
            case "boolean":
              return v === null || v === undefined ? sql`NULL::boolean` : sql`${v}::boolean`;
            default:
              return v === null || v === undefined ? sql`NULL::text` : sql`${v}::text`;
          }
        })
        .reduce((acc, cur) => sql`${acc}, ${cur}`);
      cursorWhere = sql`(${lhs}, id) ${op} (${rhs}, ${cursor.id}::uuid)`;
    }
  }

  return {
    ok: true,
    result: {
      orderBy,
      cursorWhere,
      fieldIds: effective.map((s) => s.fieldId),
      projections: effective.map((s) => ({
        fieldId: s.fieldId,
        sqlCast: projectionForType(s.fieldId, fieldsById.get(s.fieldId)!.type).cast,
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
