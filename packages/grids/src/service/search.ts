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
import { canSearch } from "./field-storage";

/**
 * Searchable fields = alive fields whose storage descriptor flags them
 * as `searchable`. The descriptor (service/field-storage.ts) is the
 * single source of truth — text-family types (text, longtext, email,
 * url, phone, slug, barcode, isbn) are searchable, every other type
 * is not. Using the descriptor avoids the parallel SEARCHABLE_TYPES
 * set drifting from the filter compiler's text-op family.
 */
export const filterSearchableFields = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.deletedAt && canSearch(f));

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
