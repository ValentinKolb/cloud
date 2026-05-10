import { Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Dropdown } from "@valentinkolb/cloud/ui";
import type { Field, GridRecord } from "../../../service";
import type {
  AggregationSpec,
  GroupBySpec,
  TableQueryResult,
  ViewQuery,
} from "../../../contracts";
import { fetchTableQuery } from "./fetcher";
import {
  buildRecordsUrl,
  parseRecordsState,
  type RecordsState,
} from "./query-url";
// These were once-islands but are now plain components rendered inside
// RecordsView's island. Nested islands break SSR (Seroval can't serialize
// the function props the parent passes down) — keeping them as plain
// children means they hydrate as part of RecordsView, sharing its state.
import SearchBar from "../SearchBar";
import GridToolbar from "../GridToolbar";
import RecordsGrid from "../RecordsGrid";
import GroupedTable, { type GroupBucket } from "../GroupedTable";
import RecordDetailPanel from "../RecordDetailPanel";
import { apiClient } from "../../../api/client";
import type { FilterLeaf } from "../FilterPanel";
import type { AggregationRow, AggKindUI } from "../AggregationsPanel";
import type { ColumnSpec } from "../../../service/views";

/** UI-supported agg kinds — narrower than the contract's AggregateKind
 *  (which also has median/earliest/latest, currently SQL-only). When a
 *  saved view stores one of those, the toolbar simply won't render it
 *  as an editable row. */
const UI_AGG_KINDS: ReadonlySet<AggKindUI> = new Set([
  "count",
  "countEmpty",
  "countUnique",
  "sum",
  "avg",
  "min",
  "max",
]);

const toAggregationRows = (
  specs: AggregationSpec[] | undefined,
): AggregationRow[] =>
  (specs ?? [])
    .filter((s): s is AggregationSpec & { agg: AggKindUI } =>
      UI_AGG_KINDS.has(s.agg as AggKindUI),
    )
    .map((s) => ({ fieldId: s.fieldId, agg: s.agg, label: s.label }));

/**
 * Records-area island. Phase 3: owns the canonical {query, cursor,
 * selectedRecordId, search} state machine. Toolbar + SearchBar emit
 * patches via callbacks; this island merges them into the query
 * signal, syncs the URL via history.replaceState (or pushState for
 * pagination), and lets createResource refetch the records-data
 * envelope from POST /tables/:id/query.
 *
 * The detail panel column still lives outside this island (Phase 4
 * will absorb it). Until then the panel coordinates via the legacy
 * record-detail-context custom-event bus, which we honour by emitting
 * a `popstate` synthetic so the panel can resync its highlight.
 */

type Props = {
  baseId: string;
  tableId: string;
  fields: Field[];
  canWrite: boolean;
  trashMode: boolean;
  /**
   * True when the user is on a saved view (`?view=<id>`). Views are
   * frozen presets — filter / sort / group / aggregate are baked into
   * the view's stored query, so the editing toolbar gets hidden and
   * Add row goes away (an aggregate footer would make a fresh row
   * meaningless anyway). To change a view's query, the user creates a
   * new one from the table page.
   */
  viewMode: boolean;
  initialState: RecordsState;
  initialData: TableQueryResult;
  /** Selected-record payload from SSR — non-null when the URL had
   *  ?record=<id> at initial render. Lets the panel show immediately
   *  on deep-link without a client-side fetch. */
  initialSelectedRecord: GridRecord | null;
  relationLabels: Record<string, string>;
  viewColumns: ColumnSpec[] | undefined;
  searchableFields: Field[];
  groupedExplode: boolean;
};

export default function RecordsView(props: Props) {
  // ── Canonical state ────────────────────────────────────────────────
  const [query, setQuery] = createSignal<ViewQuery>(props.initialState.query);
  const [cursor, setCursor] = createSignal<string | null>(props.initialState.cursor);
  const [selectedRecordId, setSelectedRecordId] = createSignal<string | null>(
    props.initialState.selectedRecordId,
  );
  const [search, setSearch] = createSignal<{ q: string; fieldIds: string[] }>(
    props.initialState.search,
  );

  // ── Resource over POST /tables/:id/query ──────────────────────────
  // Source signal carries everything that affects the response shape;
  // changing any field triggers a refetch. initialValue ensures the
  // SSR data is rendered immediately on first paint without a fetch.
  // Solid's ResourceFetcherInfo is { value, refetching } — no AbortSignal.
  // We adapt the fetcher to that signature; in-flight cancellation is left
  // to Solid's own stale-resolution discarding (good enough for the rapid-
  // fire filter case — server work is cheap).
  //
  // Search is a peer of filter/sort/group/agg in the wire query. We fold
  // the SearchBar's `{q, fieldIds}` signal into `query.search` here so a
  // keystroke updates the source signal and the API request body in one
  // step — the server-side merger in api/tables.ts compiles it into SQL.
  const queryWithSearch = (): ViewQuery => {
    const q = search().q.trim();
    if (!q) return query();
    return { ...query(), search: { q, fieldIds: search().fieldIds } };
  };
  const [data, { refetch }] = createResource(
    () => ({ tableId: props.tableId, query: queryWithSearch(), cursor: cursor() }),
    (args) => fetchTableQuery(args),
    { initialValue: props.initialData },
  );

  const items = () => data()?.items ?? [];
  const buckets = () => (data()?.buckets ?? []) as GroupBucket[];
  const aggregates = () => data()?.aggregates ?? {};
  const nextCursor = () => data()?.nextCursor ?? null;

  // Relation labels: SSR seeded a static prop, the API endpoint now
  // also emits `relationLabels` for group-mode bucket keys. Merge both
  // so the GroupedTable / RecordsGrid see one consistent UUID→label
  // map regardless of which data path filled it. Server-side labels
  // take precedence (newer ground truth).
  const mergedRelationLabels = () => ({
    ...props.relationLabels,
    ...(data()?.relationLabels ?? {}),
  });

  // ── Selected record resolution ─────────────────────────────────────
  // Prefer the row from the visible page (cheap, no network). Fall back
  // to the SSR-provided initialSelectedRecord (deep-link case where the
  // record isn't on this page). Final fallback: client-side fetch.
  const [fetchedSelected, setFetchedSelected] = createSignal<GridRecord | null>(null);
  const selectedRecord = createMemo<GridRecord | null>(() => {
    const id = selectedRecordId();
    if (!id) return null;
    const fromPage = items().find((r) => r.id === id);
    if (fromPage) return fromPage;
    if (props.initialSelectedRecord && props.initialSelectedRecord.id === id) {
      return props.initialSelectedRecord;
    }
    const fetched = fetchedSelected();
    if (fetched && fetched.id === id) return fetched;
    return null;
  });

  // When a selected id can't be found locally, fetch it once. This is
  // the rare deep-link / paginated-out path; common case (row click)
  // hands us the record directly via items().
  createMemo(() => {
    const id = selectedRecordId();
    if (!id) {
      setFetchedSelected(null);
      return;
    }
    if (selectedRecord()) return; // already resolved
    apiClient.records[":tableId"][":recordId"]
      .$get({ param: { tableId: props.tableId, recordId: id } })
      .then(async (res) => {
        if (!res.ok) return;
        const rec = (await res.json()) as GridRecord;
        setFetchedSelected(() => rec);
      });
  });

  const detailMode = (): "live" | "trash" =>
    query().includeDeleted ? "trash" : "live";

  const groupBy = () => (query().groupBy ?? []) as GroupBySpec[];
  const aggregations = () => (query().aggregations ?? []) as AggregationSpec[];
  const isGrouped = () => groupBy().length > 0;

  // ── URL sync ───────────────────────────────────────────────────────
  // syncUrl is the single point that touches history. `replace=true`
  // for query churn (filter / sort / group / agg / search — frequent),
  // `replace=false` for semantic navigation (cursor pagination, detail
  // panel open) so back-button has the right semantics.
  const currentUrlState = (): RecordsState => ({
    query: query(),
    cursor: cursor(),
    selectedRecordId: selectedRecordId(),
    activeViewId: props.initialState.activeViewId,
    search: search(),
  });

  const syncUrl = (opts: { replace: boolean }) => {
    if (typeof history === "undefined") return;
    const next = buildRecordsUrl(
      { baseId: props.baseId, tableId: props.tableId },
      currentUrlState(),
    );
    if (next === location.pathname + location.search) return;
    if (opts.replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
  };

  // ── Commit handlers (called from children) ─────────────────────────
  /**
   * Toolbar emits the current shape of filter/sort/group/agg. We merge
   * it into the canonical query, drop cursor (its domain depends on
   * sort + grouped-vs-flat), and replaceState the URL.
   */
  const onToolbarCommit = (patch: {
    filter?: ViewQuery["filter"];
    sort?: ViewQuery["sort"];
    groupBy?: ViewQuery["groupBy"];
    aggregations?: ViewQuery["aggregations"];
  }) => {
    setQuery({
      ...patch,
      // Preserve the trash flag (toolbar doesn't own it).
      includeDeleted: query().includeDeleted,
    });
    setCursor(null);
    syncUrl({ replace: true });
  };

  /** SearchBar's onSearchChange. Mirror semantics to onToolbarCommit. */
  const onSearchChange = (next: { q: string; fieldIds: string[] }) => {
    setSearch(next);
    setCursor(null);
    syncUrl({ replace: true });
  };

  /** Clicking the next-page link advances the cursor. pushState so
   *  back-button returns to the previous page. */
  const onPaginate = (nextCursor: string | null) => {
    setCursor(nextCursor);
    syncUrl({ replace: false });
  };

  /** Row click in the grid → open the detail panel. pushState so the
   *  browser back button closes the panel — that's the natural mental
   *  model ("back undoes my last forward action"). */
  const onSelectRecord = (rec: GridRecord) => {
    setSelectedRecordId(rec.id);
    syncUrl({ replace: false });
  };

  /** Detail-panel close button. replaceState because closing isn't a
   *  "forward" action — undoing it via back wouldn't be useful. */
  const onCloseDetail = () => {
    setSelectedRecordId(null);
    syncUrl({ replace: true });
  };

  /** Toolbar's row-create flow finished — open the new record's detail
   *  panel so the user can finish setting up relation fields (which
   *  the create-prompt can't render an input for). pushState so the
   *  back button collapses the picker first. */
  const onRecordCreated = (recordId: string) => {
    setSelectedRecordId(recordId);
    syncUrl({ replace: false });
    void refetch();
  };

  /** After an in-panel edit: refetch the records resource so the grid
   *  reflects the new value. The selected-record panel closes itself
   *  via setSelectedRecord update on the next data() tick. */
  const onRecordUpdated = () => {
    void refetch();
  };

  /** After a delete or restore: close the panel + refetch. */
  const onRecordRemoved = () => {
    setSelectedRecordId(null);
    setFetchedSelected(null);
    syncUrl({ replace: true });
    void refetch();
  };

  // ── popstate listener + scroll-restoration takeover ───────────────
  // Back/forward navigation rehydrates state from the URL. Browser's
  // default scroll-restoration would fight the records grid's
  // overflow-auto container — switch to manual so popstate doesn't
  // randomly reset our scroll position mid-fetch.
  onMount(() => {
    if (typeof history === "undefined") return;
    const prevRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";

    const onPop = () => {
      const parsed = parseRecordsState(new URL(location.href).searchParams);
      // Update every URL-derived signal — filter / sort / group / agg
      // can change too if the user navigated to/from a saved view.
      setQuery(parsed.query);
      setCursor(parsed.cursor);
      setSelectedRecordId(parsed.selectedRecordId);
      setSearch(parsed.search);
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener("popstate", onPop);
      history.scrollRestoration = prevRestoration;
    });
  });

  // ── Row-1 helpers (record count + export URL) ──────────────────────
  // Lifted out of GridToolbar because row 1 is always rendered (even on
  // saved views and in trash mode) — these need to live next to the
  // search bar, not inside the optional editing toolbar.
  const recordCountText = (): string => {
    const n = items().length;
    if (n === 0) return "No records";
    if (n === 1) return "1 record";
    return `${n} records`;
  };

  const exportUrl = (format: "csv" | "json"): string => {
    // SSR-safe: when this fires from the server-render path
    // window.location is undefined; fall back to a relative URL the
    // browser resolves at click time.
    const origin = typeof window !== "undefined" ? window.location.origin : "http://x";
    const url = new URL(
      `/api/grids/records/by-table/${props.tableId}/export`,
      origin,
    );
    url.searchParams.set("format", format);
    // Roundtrip the query state into the export so a deleted-records
    // export ≠ a live-records export. We project from the live query
    // signal so it tracks any in-session filter / sort changes.
    const q = query();
    if (q.filter) url.searchParams.set("filter", JSON.stringify(q.filter));
    if (q.sort && q.sort.length > 0) url.searchParams.set("sort", JSON.stringify(q.sort));
    return url.pathname + url.search;
  };

  // ── Initial filter rows for the toolbar ─────────────────────────────
  // Reconstruct the flat leaf list from the AND-tree the URL parser
  // produced. The toolbar holds its own signal seeded from this; it's
  // computed once at mount because the toolbar's signals are NOT
  // controlled by us during a session (popstate would diverge them,
  // accepted as known limitation for Phase 3 — Phase 4 may revisit).
  const initialFilterRows: FilterLeaf[] = (() => {
    const f = props.initialState.query.filter;
    if (!f || typeof f !== "object" || (f as { op?: string }).op !== "AND") return [];
    const filters = (f as { filters?: unknown[] }).filters;
    if (!Array.isArray(filters)) return [];
    return filters.filter(
      (l): l is FilterLeaf =>
        typeof l === "object" && l !== null && "fieldId" in l && "op" in l,
    );
  })();

  // ── Render ─────────────────────────────────────────────────────────
  // Two-column layout (records + detail). The detail column appears
  // when a record is selected and disappears when none is — pure
  // signal-derived rendering, no DOM-class flipping.
  return (
    <div class="flex flex-col lg:flex-row gap-4 flex-1 min-w-0 min-h-0 overflow-hidden">
      <div
        class={
          "order-1 flex-1 min-w-0 min-h-0 overflow-auto flex flex-col gap-2 transition-opacity duration-150 " +
          (data.loading ? "opacity-60" : "")
        }
      >
        {/* Row 1 — always visible. Search (left, flex-grow), record
            count + Actions dropdown (right). Trash mode swaps the
            Actions for a "Back to live records" link. */}
        <div class="flex flex-wrap items-center gap-2">
          <Show when={props.searchableFields.length > 0}>
            <div class="flex-1 min-w-0">
              <SearchBar
                fields={props.searchableFields}
                initialQ={search().q}
                initialQFields={search().fieldIds}
                onSearchChange={onSearchChange}
              />
            </div>
          </Show>

          <span class="text-xs text-dimmed whitespace-nowrap">
            {props.trashMode && "Deleted: "}
            {recordCountText()}
          </span>

          <Show
            when={!props.trashMode}
            fallback={
              <a
                href={`/app/grids/${props.baseId}?table=${props.tableId}`}
                class="btn-input btn-input-sm"
              >
                <i class="ti ti-arrow-back" />
                Back to live records
              </a>
            }
          >
            <Dropdown
              // bottom-LEFT = drop below, right-edge aligned with the
              // trigger. The trigger lives at the far right of row 1
              // so the default (bottom-right = expand-rightward) clips
              // off the viewport. This flips the menu inward.
              position="bottom-left"
              trigger={
                <span class="btn-input btn-input-sm">
                  Actions
                  <i class="ti ti-chevron-down text-[10px] opacity-60" />
                </span>
              }
              elements={[
                {
                  icon: "ti ti-file-type-csv",
                  label: "Export CSV",
                  href: exportUrl("csv"),
                },
                {
                  icon: "ti ti-braces",
                  label: "Export JSON",
                  href: exportUrl("json"),
                },
                {
                  icon: "ti ti-archive",
                  label: "Show deleted",
                  href: `/app/grids/${props.baseId}?table=${props.tableId}&trash=1`,
                },
              ]}
            />
          </Show>
        </div>

        {/* Row 2 — full editing toolbar. Hidden on saved views (the
            view's query is frozen) and in trash mode (only the back-
            link is meaningful there). */}
        <Show when={!props.viewMode && !props.trashMode}>
          <GridToolbar
            baseId={props.baseId}
            tableId={props.tableId}
            fields={props.fields}
            initialFilter={initialFilterRows}
            initialSort={(props.initialState.query.sort ?? []).map((s) => ({
              fieldId: s.fieldId,
              direction: s.direction,
            }))}
            initialGroupBy={groupBy()}
            initialAggregations={toAggregationRows(aggregations())}
            canWrite={props.canWrite}
            onCommit={onToolbarCommit}
            onRecordCreated={onRecordCreated}
          />
        </Show>

        <Show
          when={isGrouped()}
          fallback={
            <RecordsGrid
              baseId={props.baseId}
              tableId={props.tableId}
              fields={props.fields}
              records={items() as GridRecord[]}
              canWrite={props.canWrite}
              mode={props.trashMode ? "trash" : "live"}
              selectedId={selectedRecordId()}
              onSelectRecord={onSelectRecord}
              viewColumns={props.viewColumns}
              relationLabels={mergedRelationLabels()}
              aggregates={props.trashMode ? {} : aggregates()}
              aggregationSpecs={props.trashMode ? [] : aggregations()}
            />
          }
        >
          <GroupedTable
            baseId={props.baseId}
            fields={props.fields}
            groupBy={groupBy()}
            aggregations={aggregations()}
            buckets={buckets()}
            explode={props.groupedExplode}
            relationLabels={mergedRelationLabels()}
          />
        </Show>

        <Show when={nextCursor()}>
          {(_) => (
            <div class="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                class="btn-secondary btn-sm"
                onClick={() => onPaginate(nextCursor())}
              >
                Next page <i class="ti ti-arrow-right" />
              </button>
            </div>
          )}
        </Show>
      </div>

      <Show when={selectedRecordId()}>
        <div class="order-2 lg:order-3 w-full lg:w-[28rem] shrink-0 flex flex-col min-h-0 overflow-hidden">
          <RecordDetailPanel
            baseId={props.baseId}
            tableId={props.tableId}
            fields={props.fields}
            record={selectedRecord}
            mode={detailMode}
            canWrite={props.canWrite}
            relationLabels={mergedRelationLabels()}
            onClose={onCloseDetail}
            onUpdated={onRecordUpdated}
            onRemoved={onRecordRemoved}
          />
        </div>
      </Show>
    </div>
  );
}
