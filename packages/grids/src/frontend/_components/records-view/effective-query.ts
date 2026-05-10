import type { ViewQuery } from "../../../contracts";
import type { View } from "../../../service";
import type { RecordsState } from "./query-url";

/**
 * Effective query = URL state layered on top of the saved view's stored
 * query. URL params override individual fields; missing URL fields fall
 * through to the view's stored value. When no view is active, URL state
 * is the whole story.
 *
 * Why we need this: a clean URL like `/app/grids/<base>?table=<t>&view=<v>`
 * carries no filter/sort/group/agg, but the view promises to render its
 * stored query. Before this helper, the SSR list path used only
 * `parsedFilter` / `parsedSort`, so opening a saved view via a clean URL
 * silently rendered unfiltered records (chunk 8 critical). Now SSR and
 * the client island both flow through this merge.
 *
 * Saved-view-only state:
 * - `limit` and `columns` come exclusively from the view (they are NOT
 *   URL state). When no view is active, both are undefined.
 *
 * `source` reports whether the active query is the view exactly, the
 * view with user customizations layered on top, or pure ad-hoc URL
 * state. The UI uses this to surface a "filter modified" badge.
 */
export type EffectiveQuery = ViewQuery & {
  source: "ad-hoc" | "view" | "view-customized";
};

const isNonEmpty = <T>(v: T[] | undefined): v is T[] =>
  Array.isArray(v) && v.length > 0;

export const resolveEffectiveQuery = (
  state: RecordsState,
  view: View | null,
): EffectiveQuery => {
  if (!view) {
    return { ...state.query, source: "ad-hoc" };
  }

  // URL fields override view fields when present; otherwise inherit.
  // Filter is binary (defined vs undefined). Arrays are "URL wins if
  // non-empty"; an empty URL array is treated as "URL doesn't override"
  // so deleting all sort rules in the toolbar doesn't silently restore
  // the view's stored sort. (If users want "no sort" on a view, they
  // edit the view itself; ad-hoc URL toolbar edits are non-destructive
  // overrides.)
  const merged: ViewQuery = {
    filter: state.query.filter ?? view.query.filter,
    sort: isNonEmpty(state.query.sort) ? state.query.sort : view.query.sort,
    groupBy: isNonEmpty(state.query.groupBy)
      ? state.query.groupBy
      : view.query.groupBy,
    aggregations: isNonEmpty(state.query.aggregations)
      ? state.query.aggregations
      : view.query.aggregations,
    includeDeleted: state.query.includeDeleted ?? view.query.includeDeleted,
    columns: view.query.columns,
    limit: view.query.limit,
  };

  // "view-customized" if the URL carried any explicit query field that
  // overrode the view's value. Ad-hoc cursor/selection don't count.
  const customized =
    state.query.filter !== undefined ||
    isNonEmpty(state.query.sort) ||
    isNonEmpty(state.query.groupBy) ||
    isNonEmpty(state.query.aggregations) ||
    state.query.includeDeleted !== undefined;

  return { ...merged, source: customized ? "view-customized" : "view" };
};
