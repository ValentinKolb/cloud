import type { RecordQuery } from "../../../contracts";
import type { View } from "../../../service";
import type { RecordsState } from "./query-url";

type RuntimeView = View & { query: RecordQuery };

/**
 * Effective query = URL state layered on top of the saved view's stored
 * query. URL params override individual fields; missing URL fields fall
 * through to the view's stored value. When no view is active, URL state
 * is the whole story.
 *
 * A clean path-based view URL carries no filter/sort/group/aggregation
 * overrides, so both SSR and browser-history restoration must inherit
 * the stored view query through this helper.
 *
 * Saved-view-only state:
 * - `limit` comes exclusively from the view. `columns` normally comes
 *   from the view, but URL columns can override it for ad-hoc computed
 *   columns.
 * - Search is URL-owned when `?q`/`?qFields` is present. Otherwise it
 *   falls through to the saved view's search.
 *
 * `source` reports whether the active query is the view exactly, the
 * view with user customizations layered on top, or pure ad-hoc URL
 * state. The UI uses this to surface a "filter modified" badge.
 */
type EffectiveQuery = RecordQuery & {
  source: "ad-hoc" | "view" | "view-customized";
};

const isNonEmpty = <T>(v: T[] | undefined): v is T[] => Array.isArray(v) && v.length > 0;

export const resolveEffectiveQueryFromStored = (state: RecordsState, viewQuery: RecordQuery | null): EffectiveQuery => {
  if (!viewQuery) {
    const q = state.search.q.trim();
    return {
      ...state.query,
      search: q ? { q, fieldIds: state.search.fieldIds } : undefined,
      source: "ad-hoc",
    };
  }

  // URL fields override view fields when present; otherwise inherit.
  // Filter is binary (defined vs undefined). Arrays are "URL wins if
  // non-empty"; an empty URL array is treated as "URL doesn't override"
  // so deleting all sort rules in the toolbar doesn't silently restore
  // the view's stored sort. (If users want "no sort" on a view, they
  // edit the view itself; ad-hoc URL toolbar edits are non-destructive
  // overrides.)
  const merged: RecordQuery = {
    filter: state.query.filter ?? viewQuery.filter,
    recordMeta: state.query.recordMeta ?? viewQuery.recordMeta,
    search: state.search.override
      ? state.search.q.trim()
        ? { q: state.search.q.trim(), fieldIds: state.search.fieldIds }
        : undefined
      : viewQuery.search,
    sort: isNonEmpty(state.query.sort) ? state.query.sort : viewQuery.sort,
    groupBy: isNonEmpty(state.query.groupBy) ? state.query.groupBy : viewQuery.groupBy,
    groupSort: isNonEmpty(state.query.groupSort) ? state.query.groupSort : viewQuery.groupSort,
    aggregations: isNonEmpty(state.query.aggregations) ? state.query.aggregations : viewQuery.aggregations,
    includeDeleted: state.query.includeDeleted ?? viewQuery.includeDeleted,
    deletedOnly: state.query.deletedOnly ?? viewQuery.deletedOnly,
    columns: isNonEmpty(state.query.columns) ? state.query.columns : viewQuery.columns,
    limit: viewQuery.limit,
  };

  // "view-customized" if the URL carried any explicit query field that
  // overrode the view's value. Ad-hoc cursor/selection don't count.
  const customized =
    state.query.filter !== undefined ||
    state.query.recordMeta !== undefined ||
    isNonEmpty(state.query.sort) ||
    isNonEmpty(state.query.groupBy) ||
    isNonEmpty(state.query.groupSort) ||
    isNonEmpty(state.query.aggregations) ||
    isNonEmpty(state.query.columns) ||
    state.search.override === true ||
    state.query.includeDeleted !== undefined ||
    state.query.deletedOnly !== undefined;

  return { ...merged, source: customized ? "view-customized" : "view" };
};

export const resolveEffectiveQuery = (state: RecordsState, view: RuntimeView | null): EffectiveQuery =>
  resolveEffectiveQueryFromStored(state, view?.query ?? null);
