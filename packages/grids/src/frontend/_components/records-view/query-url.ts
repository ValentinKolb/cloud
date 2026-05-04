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
 * URL params (kept as separate JSON-encoded strings — easier to
 * bookmark, debug, and selectively edit than a single ?q=<base64>):
 *
 *   ?filter=<FilterTree JSON>
 *   ?sort=<SortSpec[] JSON>
 *   ?groupBy=<GroupBySpec[] JSON>
 *   ?aggregations=<AggregationSpec[] JSON>
 *   ?cursor=<JSON-encoded keyset cursor token>
 *   ?record=<UUID — selected detail-panel record>
 *   ?view=<UUID — currently active saved view, drives sidebar highlight>
 *   ?trash=1                                — trash mode
 *   ?q=<text>&qFields=<csv UUIDs>           — free-text search
 */

import type { ViewQuery } from "../../../contracts";

export type RecordsState = {
  query: ViewQuery;
  cursor: string | null;
  selectedRecordId: string | null;
  /** ID of the currently-active saved view (if any). Drives sidebar
   *  highlight + the "is the URL diverged from the view?" indicator. */
  activeViewId: string | null;
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
 */
export const parseRecordsState = (params: URLSearchParams): RecordsState => {
  const query: ViewQuery = {};

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
  if (groupBy.length > 0) query.groupBy = groupBy as ViewQuery["groupBy"];

  const aggregations = tryParseArray<{ fieldId: string; agg: string }>(
    params.get("aggregations"),
    ["fieldId", "agg"],
  );
  if (aggregations.length > 0) {
    query.aggregations = aggregations as ViewQuery["aggregations"];
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
    activeViewId: params.get("view") || null,
    search: { q, fieldIds },
  };
};

/**
 * Builds the URL representation for the records page. Inverse of
 * parseRecordsState: parse(build(s)) === s for every well-formed s.
 *
 * Always emits the `table` param so the records page knows which table
 * to render. Other params are conditional — empty values get omitted
 * to keep URLs minimal and compare-friendly.
 */
export const buildRecordsUrl = (
  base: { baseId: string; tableId: string },
  state: RecordsState,
): string => {
  const url = new URL(`/app/grids/${base.baseId}`, "http://x");
  url.searchParams.set("table", base.tableId);

  const { query, search } = state;

  if (state.activeViewId) url.searchParams.set("view", state.activeViewId);

  if (query.filter) url.searchParams.set("filter", JSON.stringify(query.filter));
  if (query.sort && query.sort.length > 0) {
    url.searchParams.set("sort", JSON.stringify(query.sort));
  }
  if (query.groupBy && query.groupBy.length > 0) {
    url.searchParams.set("groupBy", JSON.stringify(query.groupBy));
  }
  if (query.aggregations && query.aggregations.length > 0) {
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

/**
 * Compares two RecordsStates for equality at the URL-meaningful level.
 * Used by RecordsView to detect no-op commits (skip navigation when
 * the URL would be identical).
 */
export const recordsStatesEqual = (a: RecordsState, b: RecordsState): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
