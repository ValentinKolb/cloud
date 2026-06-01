/**
 * URL ↔ records-area state serialization. Single source of truth for
 * what's encoded in the URL — used by both the SSR initial render
 * (parses incoming search params) and the client RecordsView island
 * (writes via history.replaceState / pushState, reads via popstate).
 *
 * Designed to be tolerant: malformed JSON in any param falls back to
 * the empty fragment for that field rather than throwing. A stale
 * URL doesn't lock the user out of their data.
 *
 * URL shape (path-based, mirrors notebooks; query params are reserved
 * for UI state on top of the resource identified by the path):
 *
 *   /app/grids/<base>/table/<table>                 — records page
 *   /app/grids/<base>/table/<table>/view/<view>     — saved-view page
 *
 *   ?filter=<FilterTree JSON>
 *   ?sort=<SortSpec[] JSON>
 *   ?groupBy=<GroupBySpec[] JSON>
 *   ?groupSort=<GroupSortSpec[] JSON>
 *   ?aggregations=<AggregationSpec[] JSON>
 *   ?cursor=<JSON-encoded keyset cursor token>
 *   ?record=<UUID — selected detail-panel record>
 *   ?trash=1                                — trash mode
 *   ?q=<text>&qFields=<csv UUIDs>           — free-text search
 *
 * Note: `table` / `view` / `dashboard` are not query params — they live
 * in the path.
 */

import type { ViewQuery } from "../../../contracts";

/**
 * URL-owned subset of ViewQuery. The full ViewQuery additionally
 * includes `limit`, `columns`, and `search` — those are NEVER URL state:
 * `limit`/`columns` are saved-view metadata only, `search` lives on the
 * sibling `search` field. Narrowing the type makes the round-trip
 * `parse(build(s)) === s` actually hold for every well-formed state.
 */
type RecordsUrlQuery = Pick<ViewQuery, "filter" | "sort" | "groupBy" | "groupSort" | "aggregations" | "includeDeleted" | "deletedOnly">;

export type RecordsState = {
  query: RecordsUrlQuery;
  cursor: string | null;
  selectedRecordId: string | null;
  /** Free-text search params — kept separate from the URL-owned query
   *  subset, then folded into `query.search` for the server-side SQL
   *  search compiler. */
  search: { q: string; fieldIds: string[]; override?: boolean };
};

const tryParseJson = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Tolerant typed-array parser — keeps only entries with the required keys. */
const tryParseArray = <T extends Record<string, unknown>>(raw: string | null | undefined, required: ReadonlyArray<keyof T>): T[] => {
  const parsed = tryParseJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is T => typeof x === "object" && x !== null && required.every((k) => k in (x as object)));
};

const entryOf = <K extends string, V>(key: K, value: V | undefined): Array<[K, V]> => (value === undefined ? [] : [[key, value]]);

const nonEmptyArray = <T>(items: T[]): T[] | undefined => (items.length > 0 ? items : undefined);

const parseFilterParam = (params: URLSearchParams): ViewQuery["filter"] | undefined =>
  tryParseJson<ViewQuery["filter"]>(params.get("filter")) ?? undefined;

const parseSortParam = (params: URLSearchParams): RecordsUrlQuery["sort"] | undefined =>
  nonEmptyArray(tryParseArray<{ fieldId: string; direction: "asc" | "desc" }>(params.get("sort"), ["fieldId", "direction"]));

const parseGroupByParam = (params: URLSearchParams): RecordsUrlQuery["groupBy"] | undefined =>
  nonEmptyArray(tryParseArray<{ fieldId: string }>(params.get("groupBy"), ["fieldId"])) as RecordsUrlQuery["groupBy"] | undefined;

const parseGroupSortParam = (params: URLSearchParams): RecordsUrlQuery["groupSort"] | undefined =>
  nonEmptyArray(
    tryParseArray<{ fieldId: string; agg: string; direction?: "asc" | "desc" }>(params.get("groupSort"), ["fieldId", "agg"]),
  ) as RecordsUrlQuery["groupSort"] | undefined;

const parseAggregationsParam = (params: URLSearchParams): RecordsUrlQuery["aggregations"] | undefined =>
  nonEmptyArray(tryParseArray<{ fieldId: string; agg: string }>(params.get("aggregations"), ["fieldId", "agg"])) as
    | RecordsUrlQuery["aggregations"]
    | undefined;

const parseDeletedOnlyParam = (params: URLSearchParams): true | undefined => (params.get("trash") === "1" ? true : undefined);

const parseRecordsQuery = (params: URLSearchParams): RecordsUrlQuery =>
  Object.fromEntries([
    ...entryOf("filter", parseFilterParam(params)),
    ...entryOf("sort", parseSortParam(params)),
    ...entryOf("groupBy", parseGroupByParam(params)),
    ...entryOf("groupSort", parseGroupSortParam(params)),
    ...entryOf("aggregations", parseAggregationsParam(params)),
    ...entryOf("deletedOnly", parseDeletedOnlyParam(params)),
  ]) as RecordsUrlQuery;

const csvParam = (value: string | null): string[] => (value ? value.split(",").filter(Boolean) : []);

const parseSearchState = (params: URLSearchParams): RecordsState["search"] => ({
  q: (params.get("q") ?? "").trim(),
  fieldIds: csvParam(params.get("qFields")),
  override: params.has("q") || params.has("qFields"),
});

/**
 * Reads URLSearchParams and produces a typed RecordsState. Bad / missing
 * params produce empty fragments — never throws.
 *
 * Pure UI state only — the active table / view / dashboard live in the
 * URL path now (path-based routing) and are read at the SSR handler
 * boundary via `c.req.param("tableId" / "viewId" / "dashboardId")`, not
 * here.
 */
export const parseRecordsState = (params: URLSearchParams): RecordsState => ({
  query: parseRecordsQuery(params),
  cursor: params.get("cursor") || null,
  selectedRecordId: params.get("record") || null,
  // Free-text search lives outside ViewQuery (SSR merges it into the filter
  // tree before the service call so ad-hoc typing layers cleanly on top of
  // saved-view filters).
  search: parseSearchState(params),
});

/**
 * Path-based URL context for `buildRecordsUrl`. The values are SHORT
 * IDS (not UUIDs) because they're what live in URL segments. The page
 * boundary resolves short_ids → UUIDs for service calls; the island
 * keeps both around.
 */
export type UrlPathContext = {
  baseShortId: string;
  tableShortId: string;
  /** When set, the URL goes `/table/<t>/view/<v>` instead of just
   *  `/table/<t>`. Drives the sidebar's "active view" highlight too. */
  viewShortId: string | null;
};

const recordsPath = (path: UrlPathContext): string =>
  path.viewShortId
    ? `/app/grids/${path.baseShortId}/table/${path.tableShortId}/view/${path.viewShortId}`
    : `/app/grids/${path.baseShortId}/table/${path.tableShortId}`;

// Stable JSON.stringify is fine for equality here — both sides come
// from the same Zod-validated shapes, so key order is stable in practice.
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const matchesViewQuery = (query: RecordsUrlQuery, viewQuery: ViewQuery | null | undefined, key: keyof RecordsUrlQuery): boolean =>
  Boolean(viewQuery && sameJson(query[key], viewQuery[key]));

const hasUrlValue = (value: unknown): boolean => Boolean(value) && (!Array.isArray(value) || value.length > 0);

const appendJsonOverride = (
  url: URL,
  query: RecordsUrlQuery,
  viewQuery: ViewQuery | null | undefined,
  key: keyof RecordsUrlQuery,
) => {
  const value = query[key];
  if (hasUrlValue(value) && !matchesViewQuery(query, viewQuery, key)) url.searchParams.set(key, JSON.stringify(value));
};

const viewSearchOf = (viewQuery: ViewQuery | null | undefined): { q: string; fieldIds: string[] } | null =>
  viewQuery?.search
    ? {
        q: viewQuery.search.q.trim(),
        fieldIds: viewQuery.search.fieldIds ?? [],
      }
    : null;

const searchMatchesView = (search: RecordsState["search"], viewSearch: { q: string; fieldIds: string[] } | null): boolean =>
  Boolean(viewSearch && search.q.trim() === viewSearch.q && sameJson(search.fieldIds, viewSearch.fieldIds));

const shouldWriteSearchOverride = (search: RecordsState["search"], viewSearch: { q: string; fieldIds: string[] } | null): boolean =>
  search.override === true ? Boolean(search.q || viewSearch) : Boolean(search.q && !searchMatchesView(search, viewSearch));

const appendSearchOverride = (url: URL, search: RecordsState["search"], viewQuery: ViewQuery | null | undefined) => {
  const viewSearch = viewSearchOf(viewQuery);
  if (!shouldWriteSearchOverride(search, viewSearch)) return;

  url.searchParams.set("q", search.q);
  if (search.fieldIds.length > 0) url.searchParams.set("qFields", search.fieldIds.join(","));
};

/**
 * Builds the URL representation for the records page. Inverse of
 * parseRecordsState + the path-based routes registered in
 * [baseId]/table/[tableId][/view/[viewId]]/page.tsx.
 *
 * `viewQuery` is the active view's stored query (or null when no view
 * is active). When passed, query fields whose value exactly matches
 * the view's stored value are OMITTED from the URL — they fall through
 * to `view.query` at the next render via `resolveEffectiveQuery`, so
 * the URL stays a pure list of "user overrides on top of the view".
 *
 * Why this matters: without the suppression, opening a clean view URL
 * (e.g. `/grids/X/table/Y/view/Z`) and then paginating would write the
 * merged effective query — including the view's filter — into the
 * query string. Bookmarking that result freezes the view's filter at
 * navigation time, so a later edit to the saved view stays invisible
 * to the bookmark. Suppressing matches keeps view URLs symbolic
 * ("the view, as it stands") rather than denormalized snapshots.
 */
export const buildRecordsUrl = (path: UrlPathContext, state: RecordsState, viewQuery?: ViewQuery | null): string => {
  const url = new URL(recordsPath(path), "http://x");

  const { query, search } = state;
  appendJsonOverride(url, query, viewQuery, "filter");
  appendJsonOverride(url, query, viewQuery, "sort");
  appendJsonOverride(url, query, viewQuery, "groupBy");
  appendJsonOverride(url, query, viewQuery, "groupSort");
  appendJsonOverride(url, query, viewQuery, "aggregations");
  if (query.deletedOnly) url.searchParams.set("trash", "1");

  appendSearchOverride(url, search, viewQuery);
  if (state.cursor) url.searchParams.set("cursor", state.cursor);
  if (state.selectedRecordId) url.searchParams.set("record", state.selectedRecordId);

  return `${url.pathname}${url.search}`;
};
