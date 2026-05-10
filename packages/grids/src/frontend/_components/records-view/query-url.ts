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
 *   ?aggregations=<AggregationSpec[] JSON>
 *   ?cursor=<JSON-encoded keyset cursor token>
 *   ?record=<UUID — selected detail-panel record>
 *   ?trash=1                                — trash mode
 *   ?q=<text>&qFields=<csv UUIDs>           — free-text search
 *
 * Note: `table` / `view` / `dashboard` are NO LONGER query params —
 * they live in the path. Old links carrying them still work because
 * the SSR handler reads them as a fallback (see [baseId]/page.tsx),
 * but new code emits only the path form.
 */

import type { ViewQuery } from "../../../contracts";

/**
 * URL-owned subset of ViewQuery. The full ViewQuery additionally
 * includes `limit`, `columns`, and `search` — those are NEVER URL state:
 * `limit`/`columns` are saved-view metadata only, `search` lives on the
 * sibling `search` field. Narrowing the type makes the round-trip
 * `parse(build(s)) === s` actually hold for every well-formed state.
 */
export type RecordsUrlQuery = Pick<
  ViewQuery,
  "filter" | "sort" | "groupBy" | "aggregations" | "includeDeleted"
>;

export type RecordsState = {
  query: RecordsUrlQuery;
  cursor: string | null;
  selectedRecordId: string | null;
  /** Free-text search params — kept separate from `query.search` so
   *  SSR's mergeSearchIntoFilter can still build the OR-group across
   *  searchable fields the same way it does today. */
  search: { q: string; fieldIds: string[] };
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
const tryParseArray = <T extends Record<string, unknown>>(
  raw: string | null | undefined,
  required: ReadonlyArray<keyof T>,
): T[] => {
  const parsed = tryParseJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (x): x is T =>
      typeof x === "object" &&
      x !== null &&
      required.every((k) => k in (x as object)),
  );
};

/**
 * Reads URLSearchParams and produces a typed RecordsState. Bad / missing
 * params produce empty fragments — never throws.
 *
 * Pure UI state only — the active table / view / dashboard live in the
 * URL path now (path-based routing) and are read at the SSR handler
 * boundary via `c.req.param("tableId" / "viewId" / "dashboardId")`, not
 * here.
 */
export const parseRecordsState = (params: URLSearchParams): RecordsState => {
  const query: RecordsUrlQuery = {};

  // Filter
  const filterParsed = tryParseJson<ViewQuery["filter"]>(params.get("filter"));
  if (filterParsed) query.filter = filterParsed;

  // Sort, groupBy, aggregations — array-shaped, validated by required-key check
  const sort = tryParseArray<{ fieldId: string; direction: "asc" | "desc" }>(
    params.get("sort"),
    ["fieldId", "direction"],
  );
  if (sort.length > 0) query.sort = sort;

  const groupBy = tryParseArray<{ fieldId: string }>(
    params.get("groupBy"),
    ["fieldId"],
  );
  if (groupBy.length > 0) query.groupBy = groupBy as RecordsUrlQuery["groupBy"];

  const aggregations = tryParseArray<{ fieldId: string; agg: string }>(
    params.get("aggregations"),
    ["fieldId", "agg"],
  );
  if (aggregations.length > 0) {
    query.aggregations = aggregations as RecordsUrlQuery["aggregations"];
  }

  if (params.get("trash") === "1") query.includeDeleted = true;

  // Free-text search lives outside ViewQuery (SSR merges it into the filter
  // tree before the service call so ad-hoc typing layers cleanly on top of
  // saved-view filters).
  const q = (params.get("q") ?? "").trim();
  const qFieldsRaw = params.get("qFields") ?? "";
  const fieldIds = qFieldsRaw ? qFieldsRaw.split(",").filter(Boolean) : [];

  return {
    query,
    cursor: params.get("cursor") || null,
    selectedRecordId: params.get("record") || null,
    search: { q, fieldIds },
  };
};

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
export const buildRecordsUrl = (
  path: UrlPathContext,
  state: RecordsState,
  viewQuery?: ViewQuery | null,
): string => {
  const base = path.viewShortId
    ? `/app/grids/${path.baseShortId}/table/${path.tableShortId}/view/${path.viewShortId}`
    : `/app/grids/${path.baseShortId}/table/${path.tableShortId}`;
  const url = new URL(base, "http://x");

  const { query, search } = state;

  // Stable JSON.stringify is fine for equality here — both sides come
  // from the same Zod-validated shapes, so key order is stable in practice.
  const matchesView = (key: keyof RecordsUrlQuery): boolean => {
    if (!viewQuery) return false;
    return JSON.stringify(query[key]) === JSON.stringify(viewQuery[key]);
  };

  if (query.filter && !matchesView("filter")) {
    url.searchParams.set("filter", JSON.stringify(query.filter));
  }
  if (query.sort && query.sort.length > 0 && !matchesView("sort")) {
    url.searchParams.set("sort", JSON.stringify(query.sort));
  }
  if (query.groupBy && query.groupBy.length > 0 && !matchesView("groupBy")) {
    url.searchParams.set("groupBy", JSON.stringify(query.groupBy));
  }
  if (
    query.aggregations &&
    query.aggregations.length > 0 &&
    !matchesView("aggregations")
  ) {
    url.searchParams.set("aggregations", JSON.stringify(query.aggregations));
  }
  if (query.includeDeleted) url.searchParams.set("trash", "1");

  if (search.q) url.searchParams.set("q", search.q);
  if (search.fieldIds.length > 0) {
    url.searchParams.set("qFields", search.fieldIds.join(","));
  }

  if (state.cursor) url.searchParams.set("cursor", state.cursor);
  if (state.selectedRecordId) url.searchParams.set("record", state.selectedRecordId);

  return `${url.pathname}${url.search}`;
};
