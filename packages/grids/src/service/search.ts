/**
 * Free-text search → FilterTree merging.
 *
 * Both the SSR records page (which paints the initial grid) and the
 * `POST /tables/:id/query` API endpoint (which serves every subsequent
 * client-side fetch) need to apply the same `?q=…&qFields=…` semantics
 * on top of a user-supplied filter. Keeping the logic here means the
 * two paths can never drift — typing into the search bar after first
 * paint produces the exact same SQL as deep-linking the same URL.
 *
 * The shape: `q` becomes an OR across `contains q` for every scoped
 * field; that OR-group is AND'd into the user's filter so the result
 * is `filter ∧ (any of the searchable cols matches q)`.
 *
 * - empty q → returns the original filter unchanged
 * - empty qFieldIds → defaults to every searchable field on the table
 * - a non-AND user filter is wrapped: `{op:AND, filters:[F, search]}`
 */

import type { FilterTree } from "../contracts";
import type { Field } from "./types";

/** Field types the free-text search will apply `contains` against. Mirrors
 *  the TEXT_OPS family in filter-ops.ts: anything that's a text-shaped JSONB
 *  scalar. select / boolean / number etc. are intentionally excluded —
 *  searching them as text would be misleading at best. */
const SEARCHABLE_TYPES = new Set([
  "text",
  "longtext",
  "email",
  "url",
  "phone",
  "slug",
  "barcode",
  "isbn",
]);

export const filterSearchableFields = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.deletedAt && SEARCHABLE_TYPES.has(f.type));

export const mergeSearchIntoFilter = (
  userFilter: FilterTree | null,
  q: string,
  qFieldIds: string[],
  fields: Field[],
): FilterTree | null => {
  const query = q.trim();
  if (!query) return userFilter;
  const searchable = filterSearchableFields(fields);
  if (searchable.length === 0) return userFilter;

  // Honour an explicit column-scope (drop unknown ids); otherwise search every
  // searchable column on the table.
  const scopedIds =
    qFieldIds.length > 0
      ? qFieldIds.filter((id) => searchable.some((f) => f.id === id))
      : searchable.map((f) => f.id);
  if (scopedIds.length === 0) return userFilter;

  const searchGroup: FilterTree = {
    op: "OR",
    filters: scopedIds.map((fid) => ({
      fieldId: fid,
      op: "contains",
      value: query,
      caseInsensitive: true,
    })),
  };

  if (!userFilter) return searchGroup;
  if (
    typeof userFilter === "object" &&
    "op" in userFilter &&
    userFilter.op === "AND" &&
    Array.isArray((userFilter as { filters: FilterTree[] }).filters)
  ) {
    return {
      op: "AND",
      filters: [...(userFilter as { filters: FilterTree[] }).filters, searchGroup],
    };
  }
  return { op: "AND", filters: [userFilter, searchGroup] };
};
