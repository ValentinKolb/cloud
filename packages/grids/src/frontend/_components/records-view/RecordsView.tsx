import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  AutocompleteEditor,
  Dropdown,
  dialogCore,
  MultiSelectInput,
  panelDialogOptions,
  PanelDialog,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { AggregationSpec, GroupBySpec, TableQueryResult, ViewQuery } from "../../../contracts";
import type { Field, Form, GridRecord, Table, View } from "../../../service";
import type { ColumnSpec, FieldColumnSpec } from "../../../service/views";
import { defaultTableAggregations } from "../../../table-defaults";
import { createFieldFromPrompt, deleteFieldWithChecks, openFormsDialog, openTableSettingsDialog } from "../dialogs/TableAdminDialogs";
import { openViewColumnSettingsDialog } from "../dialogs/ViewColumnSettingsDialog";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
import { buildFormulaCompletions, formulaFieldRefs, formulaHighlight } from "../fields/formula-authoring";
import { openFieldEditDialog } from "../fields/TableFieldDialogs";
import { openExportRecordsDialog } from "../records/ExportRecordsDialog";
import RecordDetailPanel from "../records/RecordDetailPanel";
import DatabaseTable from "../table/DatabaseTable";
import GroupDetailPanel from "../table/GroupDetailPanel";
import GroupedTable, { type GroupBucket, groupedAggregationColumnId, groupedGroupColumnId } from "../table/GroupedTable";
import type { AggKindUI, AggregationRow } from "../toolbar/AggregationsPanel";
import type { FilterLeaf } from "../toolbar/FilterPanel";
import GridToolbar from "../toolbar/GridToolbar";
// These were once-islands but are now plain components rendered inside
// RecordsView's island. Nested islands break SSR (Seroval can't serialize
// the function props the parent passes down) — keeping them as plain
// children means they hydrate as part of RecordsView, sharing its state.
import SearchBar from "../toolbar/SearchBar";
import { errorMessage } from "../utils/api-helpers";
import { fetchTableQuery } from "./fetcher";
import { createGridsRecordEventsProvider } from "./grids-record-events-provider";
import {
  highlightedIdsForLiveRefresh,
  liveRefreshQuery,
  mergeLiveRefreshItems,
  shouldOptimisticallyRemoveDeletedRecord,
  visibleIdsFromResult,
} from "./live-refresh";
import { buildRecordsUrl, parseRecordsState, type RecordsState } from "./query-url";

/** UI-supported agg kinds — narrower than the contract's AggregateKind
 *  (which also has median/earliest/latest, currently SQL-only). When a
 *  saved view stores one of those, the toolbar simply won't render it
 *  as an editable row. */
const UI_AGG_KINDS: ReadonlySet<AggKindUI> = new Set(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);

const ADMIN_BUTTON_CLASS = "btn-input-success btn-input-sm";

const isComputedColumn = (column: ColumnSpec): column is Extract<ColumnSpec, { kind: "computed" }> =>
  "kind" in column && column.kind === "computed";

const isFieldColumn = (column: ColumnSpec): column is FieldColumnSpec => !isComputedColumn(column);

const columnId = (column: ColumnSpec): string => (isComputedColumn(column) ? column.id : column.fieldId);

const randomComputedColumnId = (): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `computed_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
};

type ComputedColumnDialogResult =
  | { action: "save"; column: Extract<ColumnSpec, { kind: "computed" }> }
  | { action: "delete" };

const openComputedColumnDialog = (args: {
  fields: Field[];
  column?: Extract<ColumnSpec, { kind: "computed" }>;
}) =>
  dialogCore.open<ComputedColumnDialogResult | null>((close) => {
    const [label, setLabel] = createSignal(args.column?.label ?? "");
    const [expression, setExpression] = createSignal(args.column?.expression ?? "");
    const refs = () => formulaFieldRefs(args.fields);
    const save = () => {
      const nextLabel = label().trim();
      const nextExpression = expression().trim();
      if (!nextLabel) {
        prompts.error("Name is required");
        return;
      }
      if (!nextExpression) {
        prompts.error("Expression is required");
        return;
      }
      close({
        action: "save",
        column: {
          kind: "computed",
          id: args.column?.id ?? randomComputedColumnId(),
          label: nextLabel,
          expression: nextExpression,
          ...(args.column?.format ? { format: args.column.format } : {}),
        },
      });
    };
    return (
      <PanelDialog>
        <PanelDialog.Header title={args.column ? "Edit computed column" : "Computed column"} icon="ti ti-calculator" close={() => close(null)} />
        <PanelDialog.Body>
          <div class="info-block-info text-xs">
            Computed columns are view-only. They recalculate from the current row whenever the table is read and are saved with the view setup.
          </div>
          <TextInput label="Name" value={label} onInput={setLabel} icon="ti ti-typography" placeholder="e.g. Total with VAT" required />
          <div class="flex flex-col gap-1.5">
            <span class="text-label text-xs">Expression</span>
            <AutocompleteEditor
              value={expression}
              onInput={setExpression}
              placeholder="e.g. #price * 1.19"
              completions={buildFormulaCompletions(refs())}
              highlight={formulaHighlight}
              restoreExpansionOnBackspace={false}
              lines={4}
              ariaLabel="Computed column expression"
            />
            <p class="text-xs leading-snug text-dimmed">
              Search fields by name. Suggestions insert stable <code>#ref</code> values.
            </p>
          </div>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Show when={args.column} fallback={<span />}>
            <button type="button" class="btn-danger btn-sm" onClick={() => close({ action: "delete" })}>
              <i class="ti ti-trash" /> Delete column
            </button>
          </Show>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={save}>
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

const toAggregationRows = (specs: AggregationSpec[] | undefined): AggregationRow[] =>
  (specs ?? [])
    .filter((s): s is AggregationSpec & { agg: AggKindUI } => UI_AGG_KINDS.has(s.agg as AggKindUI))
    .map((s) => ({ fieldId: s.fieldId, agg: s.agg, label: s.label }));

const filterRowsFromQuery = (filter: ViewQuery["filter"]): FilterLeaf[] => {
  if (!filter || typeof filter !== "object" || (filter as { op?: string }).op !== "AND") return [];
  const filters = (filter as { filters?: unknown[] }).filters;
  if (!Array.isArray(filters)) return [];
  return filters.filter((l): l is FilterLeaf => typeof l === "object" && l !== null && "fieldId" in l && "op" in l);
};

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
  /** UUID of the base — for API calls. */
  baseId: string;
  /** UUID of the active table — for API calls (POST /api/grids/.../by-table/<uuid>). */
  tableId: string;
  /** Human table name for record-write dialog context. */
  tableName: string;
  tableDescription: string | null;
  tableIcon?: string | null;
  tableColumns: FieldColumnSpec[];
  /** Table-level setting: when true, records should be created through forms. */
  disableDirectInsert: boolean;
  /** Short-id of the base — for the path-based URL builder. Threaded
   *  through buildRecordsUrl so pagination / detail-open writes the
   *  right path. */
  baseShortId: string;
  /** Short-id of the active table — same rationale as baseShortId. */
  tableShortId: string;
  /** Table UUID -> short-id map for relation links inside cells. */
  tableShortIds: Record<string, string>;
  /** Short-id of the active saved view, or null when no view. Drives
   *  the `/view/<short>` URL segment. */
  viewShortId: string | null;
  fields: Field[];
  forms: Form[];
  canWrite: boolean;
  canManageTable: boolean;
  trashMode: boolean;
  initialAdminMode: boolean;
  initialAccessEntries: AccessEntry[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  activeView?: View | null;
  activeViewAccessEntries?: AccessEntry[];
  canEditActiveView?: boolean;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
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
  /**
   * Stored query of the currently active saved view, or null when the
   * URL has no `?view=` (ad-hoc records mode). Passed through to
   * `buildRecordsUrl` so query fields that match the view's stored
   * value get omitted from the URL — keeps view URLs symbolic instead
   * of freezing the view's snapshot at navigation time. See post-cleanup #4.
   */
  activeViewQuery: ViewQuery | null;
  dateConfig?: DateContext;
};

type RecordsTableQueryResult = TableQueryResult & {
  __recordsFetchEpoch?: number;
  __liveCommitId?: number;
};

export default function RecordsView(props: Props) {
  // ── Canonical state ────────────────────────────────────────────────
  const [tableName, setTableName] = createSignal(props.tableName);
  const [tableDescription, setTableDescription] = createSignal(props.tableDescription);
  const [tableIcon, setTableIcon] = createSignal(props.tableIcon ?? null);
  const [tableColumns, setTableColumns] = createSignal<FieldColumnSpec[]>(props.tableColumns);
  const [disableDirectInsert, setDisableDirectInsert] = createSignal(props.disableDirectInsert);
  const [fields, setFields] = createSignal<Field[]>([...props.fields].sort((a, b) => a.position - b.position));
  const [forms, setForms] = createSignal<Form[]>(props.forms);
  const isSavedView = () => props.viewMode || !!props.activeView || !!props.viewShortId;
  const canUseEditMode = () => (isSavedView() ? !!props.canEditActiveView : props.canManageTable);
  const [adminMode, setAdminMode] = createSignal(props.initialAdminMode && canUseEditMode());
  const [viewColumns, setViewColumns] = createSignal<ColumnSpec[] | undefined>(props.viewColumns);
  const [query, setQuery] = createSignal<ViewQuery>(props.initialState.query);
  const [cursor, setCursor] = createSignal<string | null>(props.initialState.cursor);
  const [selectedRecordId, setSelectedRecordId] = createSignal<string | null>(props.initialState.selectedRecordId);
  const [selectedGroup, setSelectedGroup] = createSignal<GroupBucket | null>(null);
  const resolvedSearchState = (state: RecordsState["search"]): RecordsState["search"] => {
    if (state.override) return state;
    const saved = props.activeViewQuery?.search;
    if (!saved) return state;
    return {
      q: saved.q,
      fieldIds: saved.fieldIds ?? [],
      override: false,
    };
  };
  const [search, setSearch] = createSignal<RecordsState["search"]>(resolvedSearchState(props.initialState.search));
  const groupBy = () => (query().groupBy ?? []) as GroupBySpec[];
  const aggregations = () => (query().aggregations ?? []) as AggregationSpec[];
  const toolbarFilterRows = createMemo(() => filterRowsFromQuery(query().filter));
  const toolbarSortRows = createMemo(() =>
    (query().sort ?? []).map((s) => ({
      fieldId: s.fieldId,
      direction: s.direction,
    })),
  );
  const toolbarGroupByRows = createMemo(() => groupBy());
  const toolbarAggregationRows = createMemo(() => toAggregationRows(aggregations()));
  const isGrouped = () => groupBy().length > 0;
  const customForms = () => forms().filter((form) => !form.isDefault);
  const formsButtonLabel = () => {
    const count = customForms().length;
    return count > 0 ? `Forms (${count})` : "Add form";
  };
  const defaultViewColumns = (): ColumnSpec[] =>
    tableColumns().length > 0
      ? tableColumns()
      : fields()
          .filter((f) => !f.deletedAt && !f.hideInTable)
          .sort((a, b) => a.position - b.position)
          .map((field) => ({ fieldId: field.id }));
  const effectiveViewColumns = () =>
    !isGrouped() ? (viewColumns() ?? defaultViewColumns()) : undefined;

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
  // step — the records service compiles it into SQL separately from the
  // structured FilterTree.
  let resourceFetchEpochCounter = 0;
  const queryWithSearch = (): ViewQuery => {
    const { search: _savedSearch, ...baseQuery } = query();
    const q = search().q.trim();
    if (!q) return baseQuery;
    return { ...baseQuery, search: { q, fieldIds: search().fieldIds } };
  };
  const [data, { refetch, mutate }] = createResource<RecordsTableQueryResult, { tableId: string; query: ViewQuery; cursor: string | null }>(
    () => ({ tableId: props.tableId, query: queryWithSearch(), cursor: cursor() }),
    async (args): Promise<RecordsTableQueryResult> => {
      const epoch = ++resourceFetchEpochCounter;
      const result = await fetchTableQuery(args);
      return { ...result, __recordsFetchEpoch: epoch };
    },
    { initialValue: { ...props.initialData, __recordsFetchEpoch: 0 } as RecordsTableQueryResult },
  );

  const [flatItems, setFlatItems] = createSignal<GridRecord[]>(props.initialData.items ?? []);
  const [flatNextCursor, setFlatNextCursor] = createSignal<string | null>(props.initialData.nextCursor ?? null);
  const [livePending, setLivePending] = createSignal(false);
  const [liveRefreshing, setLiveRefreshing] = createSignal(false);
  const [highlightedRecordIds, setHighlightedRecordIds] = createSignal<Set<string>>(new Set());
  let didApplyFirstFlatPage = false;
  let replaceNextFlatPage = false;
  let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let liveRefreshAbort: AbortController | undefined;
  let liveProvider: ReturnType<typeof createGridsRecordEventsProvider> | null = null;
  let pendingLiveCursor: string | null = null;
  let refreshRequestId = 0;
  let pendingLiveRecordIds = new Set<string>();
  let staleResourceEpochFloor = -1;
  let liveCommitId = 0;

  const invalidateLiveRefreshes = () => {
    refreshRequestId++;
    liveRefreshAbort?.abort();
    liveRefreshAbort = undefined;
    pendingLiveRecordIds = new Set();
    pendingLiveCursor = null;
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = undefined;
    }
    setLivePending(false);
    setLiveRefreshing(false);
  };

  createEffect(() => {
    const response = data() as RecordsTableQueryResult | undefined;
    if (!response || isGrouped()) return;
    const isLiveCommit = typeof response.__liveCommitId === "number" && response.__liveCommitId === liveCommitId;
    const fetchEpoch = response.__recordsFetchEpoch ?? 0;
    if (!isLiveCommit && fetchEpoch <= staleResourceEpochFloor) return;
    if (isLiveCommit) return;
    const pageItems = (response.items ?? []) as GridRecord[];
    setFlatNextCursor(response.nextCursor ?? null);
    if (replaceNextFlatPage) {
      replaceNextFlatPage = false;
      setFlatItems(pageItems);
      return;
    }
    if (!didApplyFirstFlatPage) {
      didApplyFirstFlatPage = true;
      setFlatItems(pageItems);
      return;
    }
    if (!cursor()) {
      setFlatItems(pageItems);
      return;
    }
    setFlatItems((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...pageItems.filter((r) => !seen.has(r.id))];
    });
  });

  const items = () => (isGrouped() ? (data()?.items ?? []) : flatItems());
  const buckets = () => (data()?.buckets ?? []) as GroupBucket[];
  const aggregates = () => data()?.aggregates ?? {};

  // Relation labels: SSR seeded a static prop, the API endpoint now
  // also emits `relationLabels` for group-mode bucket keys. Merge both
  // so GroupedTable / DatabaseTable see one consistent UUID→label
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
  createEffect(() => {
    const id = selectedRecordId();
    if (!id) {
      setFetchedSelected(null);
      return;
    }
    if (selectedRecord()) return; // already resolved
    const requestedId = id;
    apiClient.records[":tableId"][":recordId"].$get({ param: { tableId: props.tableId, recordId: id } }).then(async (res) => {
      if (!res.ok) return;
      const rec = await res.json();
      if (selectedRecordId() === requestedId) setFetchedSelected(() => rec);
    });
  });

  const detailMode = (): "live" | "trash" => (query().deletedOnly ? "trash" : "live");

  // ── URL sync ───────────────────────────────────────────────────────
  // syncUrl is the single point that touches history. `replace=true`
  // for query churn (filter / sort / group / agg / search — frequent),
  // `replace=false` for semantic navigation (cursor pagination, detail
  // panel open) so back-button has the right semantics.
  const currentUrlState = (): RecordsState => ({
    query: query(),
    cursor: null,
    selectedRecordId: selectedRecordId(),
    search: search(),
  });

  const withAdminModeParam = (url: string) => {
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set("edit", "true");
    return parsed.pathname + parsed.search;
  };

  const stripAdminModeParam = (url: string) => {
    const parsed = new URL(url, location.origin);
    parsed.searchParams.delete("edit");
    return parsed.pathname + parsed.search;
  };

  const syncUrl = (opts: { replace: boolean }) => {
    if (typeof history === "undefined") return;
    const next = buildRecordsUrl(
      {
        baseShortId: props.baseShortId,
        tableShortId: props.tableShortId,
        viewShortId: props.viewShortId,
      },
      currentUrlState(),
      props.activeViewQuery,
    );
    const finalUrl = adminMode() ? withAdminModeParam(next) : stripAdminModeParam(next);
    if (finalUrl === location.pathname + location.search) return;
    if (opts.replace) history.replaceState(null, "", finalUrl);
    else history.pushState(null, "", finalUrl);
  };

  const closeSelectedRecord = () => {
    setSelectedRecordId(null);
    setFetchedSelected(null);
    syncUrl({ replace: true });
  };

  const verifySelectedRecordAfterRefresh = async (result: TableQueryResult) => {
    const id = selectedRecordId();
    if (!id || visibleIdsFromResult(result).includes(id)) return;
    const res = await apiClient.records[":tableId"][":recordId"].$get({ param: { tableId: props.tableId, recordId: id } });
    if (selectedRecordId() !== id) return;
    if (res.ok) {
      const record = await res.json();
      if (selectedRecordId() === id) setFetchedSelected(() => record);
      return;
    }
    if (res.status === 403 || res.status === 404) closeSelectedRecord();
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
    invalidateLiveRefreshes();
    setQuery((prev) => ({
      ...prev,
      filter: patch.filter,
      sort: patch.sort,
      groupBy: patch.groupBy,
      aggregations: patch.aggregations,
    }));
    setSelectedGroup(null);
    setCursor(null);
    syncUrl({ replace: true });
  };

  /** SearchBar's onSearchChange. Mirror semantics to onToolbarCommit. */
  const onSearchChange = (next: { q: string; fieldIds: string[] }) => {
    invalidateLiveRefreshes();
    setSearch({ ...next, override: true });
    setSelectedGroup(null);
    setCursor(null);
    syncUrl({ replace: true });
  };

  const loadNextFlatPage = () => {
    const next = flatNextCursor();
    if (!next || data.loading || isGrouped()) return;
    invalidateLiveRefreshes();
    setCursor(next);
  };

  const hasBlockingDialog = () => dialogCore.isOpen();

  const refreshVisibleRecords = async (config: { recordIds?: Iterable<string>; force?: boolean } = {}) => {
    if (!config.force && (data.loading || hasBlockingDialog())) {
      if (config.recordIds) {
        for (const id of config.recordIds) pendingLiveRecordIds.add(id);
      }
      setLivePending(true);
      return;
    }

    const eventRecordIds = new Set(config.recordIds ?? pendingLiveRecordIds);
    pendingLiveRecordIds = new Set();
    const cursorToApply = pendingLiveCursor;
    const previousVisibleIds = isGrouped() ? [] : flatItems().map((record) => record.id);
    const requestId = ++refreshRequestId;
    liveRefreshAbort?.abort();
    const abort = new AbortController();
    liveRefreshAbort = abort;
    setLivePending(false);
    setLiveRefreshing(true);

    try {
      const next = await fetchTableQuery(
        {
          tableId: props.tableId,
          query: isGrouped() ? queryWithSearch() : liveRefreshQuery(queryWithSearch(), flatItems().length),
          cursor: null,
        },
        { signal: abort.signal },
      );
      if (requestId !== refreshRequestId) return;
      if (!isGrouped()) {
        const pageItems = (next.items ?? []) as GridRecord[];
        setFlatItems((current) => mergeLiveRefreshItems({ currentItems: current, nextItems: pageItems }));
        setFlatNextCursor(next.nextCursor ?? null);
      }
      liveCommitId++;
      staleResourceEpochFloor = resourceFetchEpochCounter;
      mutate({ ...next, __liveCommitId: liveCommitId } as RecordsTableQueryResult);
      await verifySelectedRecordAfterRefresh(next);
      liveProvider?.markApplied(cursorToApply);
      if (pendingLiveCursor === cursorToApply) pendingLiveCursor = null;

      if (!isGrouped()) {
        const highlighted = highlightedIdsForLiveRefresh({
          eventRecordIds,
          previousVisibleIds,
          nextVisibleIds: visibleIdsFromResult(next),
        });
        if (highlighted.length > 0) {
          if (highlightTimer) clearTimeout(highlightTimer);
          setHighlightedRecordIds(new Set(highlighted));
          highlightTimer = setTimeout(() => setHighlightedRecordIds(new Set()), 1400);
        }
      }
      if (pendingLiveCursor) {
        setLivePending(true);
        scheduleLiveRefresh();
      }
    } catch {
      if (abort.signal.aborted) return;
      if (requestId === refreshRequestId) {
        pendingLiveRecordIds = new Set([...eventRecordIds, ...pendingLiveRecordIds]);
        setLivePending(true);
      }
    } finally {
      if (liveRefreshAbort === abort) liveRefreshAbort = undefined;
      if (requestId === refreshRequestId) setLiveRefreshing(false);
    }
  };

  const applyLiveRefresh = () => refreshVisibleRecords();

  const scheduleLiveRefresh = () => {
    if (props.trashMode) return;
    setLivePending(true);
    if (hasBlockingDialog()) return;
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = undefined;
      if (hasBlockingDialog()) {
        setLivePending(true);
        return;
      }
      void refreshVisibleRecords();
    }, 250);
  };

  createEffect(() => {
    if (props.trashMode) return;
    if (!livePending()) return;
    if (liveRefreshing() || data.loading || hasBlockingDialog()) return;
    if (liveRefreshTimer) return;
    void refreshVisibleRecords();
  });

  /** Row click in the grid → open the detail panel. pushState so the
   *  browser back button closes the panel — that's the natural mental
   *  model ("back undoes my last forward action"). */
  const onSelectRecord = (rec: GridRecord) => {
    setSelectedGroup(null);
    setSelectedRecordId(rec.id);
    syncUrl({ replace: false });
  };

  const groupBucketKey = (bucket: GroupBucket | null): string | null => (bucket ? JSON.stringify(bucket.keys) : null);

  const onSelectGroup = (bucket: GroupBucket) => {
    setSelectedRecordId(null);
    setFetchedSelected(null);
    setSelectedGroup(bucket);
    syncUrl({ replace: true });
  };

  /** Detail-panel close button. replaceState because closing isn't a
   *  "forward" action — undoing it via back wouldn't be useful. */
  const onCloseDetail = () => {
    closeSelectedRecord();
  };

  const onCloseGroupDetail = () => {
    setSelectedGroup(null);
  };

  const onOpenGroupedRecord = (record: GridRecord) => {
    setSelectedGroup(null);
    setFetchedSelected(() => record);
    setSelectedRecordId(record.id);
    syncUrl({ replace: false });
  };

  /** Toolbar's row-create flow finished — open the new record's detail
   *  panel so the user can finish setting up relation fields (which
   *  the create-prompt can't render an input for). pushState so the
   *  back button collapses the picker first. */
  const onRecordCreated = (record: GridRecord) => {
    setFetchedSelected(() => record);
    setSelectedRecordId(record.id);
    syncUrl({ replace: false });
    void refreshVisibleRecords({ recordIds: [record.id], force: true });
  };

  /** After an in-panel edit: refetch the records resource so the grid
   *  reflects the new value. The selected-record panel closes itself
   *  via setSelectedRecord update on the next data() tick. */
  const onRecordUpdated = (record: GridRecord) => {
    setFetchedSelected(() => record);
    if (!isGrouped()) {
      setFlatItems((prev) => prev.map((item) => (item.id === record.id ? record : item)));
    }
    void refreshVisibleRecords({ recordIds: [record.id], force: true });
  };

  /** After a delete or restore: close the panel + refetch. */
  const onRecordRemoved = () => {
    const recordId = selectedRecordId();
    if (recordId && !isGrouped()) {
      setFlatItems((prev) => prev.filter((record) => record.id !== recordId));
      setHighlightedRecordIds((prev) => {
        const next = new Set(prev);
        next.delete(recordId);
        return next;
      });
    }
    closeSelectedRecord();
    void refreshVisibleRecords({ force: true });
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
      invalidateLiveRefreshes();
      const parsed = parseRecordsState(new URL(location.href).searchParams);
      // Update every URL-derived signal — filter / sort / group / agg
      // can change too if the user navigated to/from a saved view.
      setQuery(parsed.query);
      setCursor(parsed.cursor);
      setSelectedRecordId(parsed.selectedRecordId);
      setSelectedGroup(null);
      setSearch(resolvedSearchState(parsed.search));
      setAdminMode(new URL(location.href).searchParams.get("edit") === "true" && props.canManageTable);
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener("popstate", onPop);
      history.scrollRestoration = prevRestoration;
    });
  });

  onMount(() => {
    if (props.trashMode) return;
    if (typeof document === "undefined") return;

    const drainAfterDialogClose = () => {
      requestAnimationFrame(() => {
        if (!livePending() || liveRefreshing() || data.loading || hasBlockingDialog()) return;
        void refreshVisibleRecords();
      });
    };

    document.addEventListener("close", drainAfterDialogClose, true);
    onCleanup(() => document.removeEventListener("close", drainAfterDialogClose, true));
  });

  onMount(() => {
    if (props.trashMode) return;
    liveProvider = createGridsRecordEventsProvider({
      tableId: props.tableId,
      onReady: () => {
        void refreshVisibleRecords();
      },
      onEvent: (event, cursor) => {
        if (cursor) pendingLiveCursor = cursor;
        pendingLiveRecordIds.add(event.recordId);
        if (event.type === "record.deleted" && shouldOptimisticallyRemoveDeletedRecord(query())) {
          if (!isGrouped()) {
            setFlatItems((prev) => prev.filter((record) => record.id !== event.recordId));
            setHighlightedRecordIds((prev) => {
              const next = new Set(prev);
              next.delete(event.recordId);
              return next;
            });
          }
          if (event.recordId === selectedRecordId()) {
            closeSelectedRecord();
          }
        }
        scheduleLiveRefresh();
      },
      onError: () => {
        setLivePending(true);
      },
      onRevoked: (error) => {
        setLivePending(false);
        liveCommitId++;
        staleResourceEpochFloor = resourceFetchEpochCounter;
        setFlatItems([]);
        mutate({ items: [], buckets: [], aggregates: {}, nextCursor: null, __liveCommitId: liveCommitId } as RecordsTableQueryResult);
        prompts.error(error.message || "Your access to this table changed. Reload the page to continue.");
      },
      onFatal: (error) => {
        setLivePending(false);
        prompts.error(error.message || "Live updates are unavailable. Reload the page to continue.");
      },
    });

    liveProvider.connect();

    onCleanup(() => {
      liveProvider?.dispose();
      liveProvider = null;
      liveRefreshAbort?.abort();
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
    });
  });

  // ── Row-1 helpers (record count + export dialog) ───────────────────
  // Lifted out of GridToolbar because row 1 is always rendered (even on
  // saved views and in trash mode) — these need to live next to the
  // search bar, not inside the optional editing toolbar.
  const recordCountText = (): string => {
    const n = items().length;
    if (n === 0) return "No records";
    if (n === 1) return "1 record";
    return `${n} records`;
  };

  const tableAggregationSpecs = (): AggregationSpec[] => {
    if (props.trashMode || isGrouped()) return [];
    const explicit = aggregations();
    if (explicit.length > 0) return explicit;
    return defaultTableAggregations(fields());
  };

  const openExportDialog = () => {
    void openExportRecordsDialog({
      tableId: props.tableId,
      fields: fields(),
      query: queryWithSearch(),
      viewColumns: effectiveViewColumns()?.filter(isFieldColumn),
    });
  };

  const setAdminModeAndUrl = (next: boolean) => {
    if (!canUseEditMode()) return;
    setAdminMode(next);
    if (typeof history === "undefined") return;
    const current = location.pathname + location.search;
    const nextUrl = next ? withAdminModeParam(current) : stripAdminModeParam(current);
    history.replaceState(null, "", nextUrl);
  };

  const syncFields = (next: Field[]) => {
    setFields([...next].sort((a, b) => a.position - b.position));
    void refetch();
  };

  const normalizeFieldOrder = (ordered: Field[]) => ordered.map((field, position) => ({ ...field, position }));

  const tableHeader = () => ({
    id: props.tableId,
    baseId: props.baseId,
    baseShortId: props.baseShortId,
    shortId: props.tableShortId,
    name: tableName(),
    description: tableDescription(),
    icon: tableIcon(),
    columns: tableColumns(),
    disableDirectInsert: disableDirectInsert(),
  });

  const openFieldSettings = (field: Field) => {
    openFieldEditDialog({
      field,
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
      otherTables: props.otherTables,
      fieldsByTable: { ...props.fieldsByTable, [props.tableId]: fields() },
      tableColumns: tableColumns(),
      dateConfig: props.dateConfig,
      onSaved: (updated) => syncFields(fields().map((f) => (f.id === updated.id ? updated : f))),
      onTableColumnsSaved: setTableColumns,
      onDeleted: async () => {
        if (await deleteFieldWithChecks(field)) syncFields(fields().filter((f) => f.id !== field.id));
      },
    });
  };

  const openTableSettings = () => {
    openTableSettingsDialog({
      table: tableHeader(),
      initialAccessEntries: props.initialAccessEntries,
      onSaved: (table) => {
        setTableName(table.name);
        setTableDescription(table.description ?? null);
        setTableIcon(table.icon ?? null);
        setTableColumns(table.columns);
        setDisableDirectInsert(table.disableDirectInsert);
      },
    });
  };

  const openAddField = async () => {
    const created = await createFieldFromPrompt({ table: tableHeader() });
    if (!created) return;
    const next = normalizeFieldOrder([...fields(), created]);
    syncFields(next);
    if (!created.hideInTable && tableColumns().length > 0 && !tableColumns().some((column) => column.fieldId === created.id)) {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.tableId },
        json: { columns: [...tableColumns(), { fieldId: created.id }] },
      });
      if (!res.ok) {
        prompts.error(await errorMessage(res, "Field created, but table display was not updated"));
        return;
      }
      const table = await res.json();
      setTableColumns(table.columns);
    }
  };

  const openForms = () => {
    openFormsDialog({
      tableId: props.tableId,
      tableName: tableName(),
      fields: fields(),
      initialForms: forms(),
      initialFormAccessEntries: props.initialFormAccessEntries,
      onFormsChanged: (nextCustomForms) => {
        const defaults = forms().filter((form) => form.isDefault);
        setForms([...defaults, ...nextCustomForms]);
      },
    });
  };

  const openViewSettings = () => {
    const view = props.activeView;
    if (!view || !props.canEditActiveView) return;
    openViewSettingsDialog({
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
      viewShortId: view.shortId,
      tableName: tableName(),
      initialView: view,
      fields: fields(),
      initialAccessEntries: props.activeViewAccessEntries ?? [],
      canEditAccess: props.canManageTable,
    });
  };

  const patchViewQueryMut = mutations.create<View, Partial<ViewQuery>>({
    mutation: async (patch) => {
      const view = props.activeView;
      if (!view) throw new Error("No active view");
      const cur = await apiClient.views[":viewId"].$get({ param: { viewId: view.id } });
      if (!cur.ok) throw new Error(await errorMessage(cur, "Failed to load view"));
      const current = await cur.json();
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: view.id },
        json: { query: { ...current.query, ...patch } },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save view columns"));
      return res.json();
    },
    onSuccess: (view) => {
      setViewColumns(view.query.columns);
      setQuery((prev) => ({
        ...prev,
        columns: view.query.columns,
        groupBy: view.query.groupBy,
        aggregations: view.query.aggregations,
        groupedColumnOrder: view.query.groupedColumnOrder,
        hiddenGroupedColumns: view.query.hiddenGroupedColumns,
      }));
    },
    onError: (e) => prompts.error(e.message),
  });

  const patchTableColumnsMut = mutations.create<Table, FieldColumnSpec[]>({
    mutation: async (columns) => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.tableId },
        json: { columns: columns.map((column) => cleanViewColumn(column)).filter(isFieldColumn) },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table columns"));
      return res.json();
    },
    onSuccess: (table) => setTableColumns(table.columns),
    onError: (e) => prompts.error(e.message),
  });

  const cleanViewColumn = (column: ColumnSpec): ColumnSpec =>
    isComputedColumn(column)
      ? {
          kind: "computed",
          id: column.id,
          label: column.label.trim(),
          expression: column.expression.trim(),
          ...(column.format ? { format: column.format } : {}),
        }
      : {
          fieldId: column.fieldId,
          ...(column.label?.trim() ? { label: column.label.trim() } : {}),
          ...(column.format ? { format: column.format } : {}),
        };

  const persistFlatViewColumns = (columns: ColumnSpec[]) => {
    const cleaned = columns.map(cleanViewColumn);
    setViewColumns(cleaned);
    setQuery((prev) => ({ ...prev, columns: cleaned.some(isComputedColumn) || isSavedView() ? cleaned : undefined }));
    if (isSavedView()) patchViewQueryMut.mutate({ columns: cleaned });
    else if (!cleaned.some(isComputedColumn)) patchTableColumnsMut.mutate(cleaned.filter(isFieldColumn));
  };

  const moveViewColumnInline = (column: ColumnSpec, direction: -1 | 1) => {
    const current = effectiveViewColumns();
    if (!current) return;
    const index = current.findIndex((item) => columnId(item) === columnId(column));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    persistFlatViewColumns(next);
  };

  const openViewColumnSettings = async (column: ColumnSpec, field: Field | null) => {
    const current = effectiveViewColumns()?.find((item) => columnId(item) === columnId(column));
    if (!current) return;
    if (isComputedColumn(current)) {
      const result = await openComputedColumnDialog({ fields: fields(), column: current });
      if (!result) return;
      if (result.action === "delete") {
        persistFlatViewColumns((effectiveViewColumns() ?? []).filter((item) => columnId(item) !== current.id));
        return;
      }
      persistFlatViewColumns((effectiveViewColumns() ?? []).map((item) => (columnId(item) === current.id ? result.column : item)));
      return;
    }
    if (!field) return;
    const result = await openViewColumnSettingsDialog({
      title: field.name,
      labelPlaceholder: field.name,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field,
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      persistFlatViewColumns((effectiveViewColumns() ?? []).filter((column) => columnId(column) !== field.id));
      return;
    }
    persistFlatViewColumns(
      (effectiveViewColumns() ?? []).map((column) =>
        !isComputedColumn(column) && column.fieldId === field.id ? cleanViewColumn({ ...column, label: result.label, format: result.format }) : column,
      ),
    );
  };

  const displayAggregations = (): AggregationSpec[] => {
    const explicit = aggregations();
    const hasStarCount = explicit.some((a) => a.fieldId === "*" && a.agg === "count");
    return hasStarCount ? explicit : [{ fieldId: "*", agg: "count" }, ...explicit];
  };

  const moveGroupedColumn = <T,>(items: T[], index: number, direction: -1 | 1): T[] | null => {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return null;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (!moved) return null;
    next.splice(target, 0, moved);
    return next;
  };

  const groupedColumnIds = (): string[] => [
    ...groupBy().map((spec, index) => groupedGroupColumnId(spec, index)),
    ...displayAggregations().map((spec, index) => groupedAggregationColumnId(spec, index)),
  ];
  const hiddenGroupedColumnIds = () => new Set(query().hiddenGroupedColumns ?? []);

  const effectiveGroupedColumnOrder = (): string[] => {
    const ids = groupedColumnIds();
    const saved = query().groupedColumnOrder ?? [];
    const idSet = new Set(ids);
    const savedSet = new Set(saved);
    return [...saved.filter((id) => idSet.has(id)), ...ids.filter((id) => !savedSet.has(id))];
  };

  const visibleGroupedColumnOrder = (): string[] => effectiveGroupedColumnOrder().filter((id) => !hiddenGroupedColumnIds().has(id));

  const hideGroupedColumn = (columnId: string) => {
    const ids = new Set(groupedColumnIds());
    const next = [...new Set([...(query().hiddenGroupedColumns ?? []), columnId])].filter((id) => ids.has(id));
    patchViewQueryMut.mutate({ hiddenGroupedColumns: next });
  };

  const moveGroupedViewColumnInline = (columnId: string, direction: -1 | 1) => {
    const order = visibleGroupedColumnOrder();
    const index = order.indexOf(columnId);
    const next = moveGroupedColumn(order, index, direction);
    if (next) {
      const hidden = effectiveGroupedColumnOrder().filter((id) => hiddenGroupedColumnIds().has(id));
      patchViewQueryMut.mutate({ groupedColumnOrder: [...next, ...hidden] });
    }
  };

  const openGroupedViewColumnSettings = async (columnId: string) => {
    const groupIndex = groupBy().findIndex((spec, index) => groupedGroupColumnId(spec, index) === columnId);
    if (groupIndex >= 0) return openGroupColumnSettings(groupIndex);
    const aggregationIndex = displayAggregations().findIndex((spec, index) => groupedAggregationColumnId(spec, index) === columnId);
    if (aggregationIndex >= 0) return openAggregationColumnSettings(aggregationIndex);
  };

  const openGroupColumnSettings = async (index: number) => {
    const current = groupBy()[index];
    if (!current) return;
    const field = fields().find((f) => f.id === current.fieldId);
    const fallback = field ? field.name : "Group";
    const columnId = groupedGroupColumnId(current, index);
    const result = await openViewColumnSettingsDialog({
      title: fallback,
      labelPlaceholder: fallback,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field ?? null,
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      hideGroupedColumn(columnId);
      return;
    }
    patchViewQueryMut.mutate({
      groupBy: groupBy().map((spec, idx) => (idx === index ? { ...spec, label: result.label, format: result.format } : spec)),
    });
  };

  const openAggregationColumnSettings = async (index: number) => {
    const current = displayAggregations()[index];
    if (!current) return;
    const field = current.fieldId === "*" ? null : fields().find((f) => f.id === current.fieldId);
    const fallback = current.fieldId === "*" ? "# records" : `${current.agg} ${field?.name ?? "value"}`;
    const columnId = groupedAggregationColumnId(current, index);
    const result = await openViewColumnSettingsDialog({
      title: fallback,
      labelPlaceholder: fallback,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field ?? { type: "number", config: {} },
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      hideGroupedColumn(columnId);
      return;
    }
    patchViewQueryMut.mutate({
      aggregations: displayAggregations().map((spec, idx) =>
        idx === index ? { ...spec, label: result.label, format: result.format } : spec,
      ),
    });
  };

  const flatHiddenColumns = () => {
    const visibleIds = new Set((effectiveViewColumns() ?? []).filter(isFieldColumn).map((column) => column.fieldId));
    return fields()
      .filter((field) => !field.deletedAt && !visibleIds.has(field.id))
      .map((field) => ({
        id: field.id,
        label: field.name,
        description: field.type,
        icon: field.icon ?? "ti ti-columns",
        add: () => persistFlatViewColumns([...(effectiveViewColumns() ?? []), { fieldId: field.id }]),
      }));
  };

  const groupedColumnLabel = (columnId: string): { label: string; description: string; icon: string } | null => {
    const groupIndex = groupBy().findIndex((spec, index) => groupedGroupColumnId(spec, index) === columnId);
    if (groupIndex >= 0) {
      const spec = groupBy()[groupIndex];
      if (!spec) return null;
      const field = fields().find((f) => f.id === spec.fieldId);
      const fallback = field ? (spec.granularity ? `${field.name} (${spec.granularity})` : field.name) : "Group";
      return { label: spec.label?.trim() || fallback, description: "group", icon: "ti ti-hierarchy" };
    }
    const aggregationIndex = displayAggregations().findIndex((spec, index) => groupedAggregationColumnId(spec, index) === columnId);
    if (aggregationIndex >= 0) {
      const spec = displayAggregations()[aggregationIndex];
      if (!spec) return null;
      const field = spec.fieldId === "*" ? null : fields().find((f) => f.id === spec.fieldId);
      const fallback = spec.fieldId === "*" ? "# records" : `${spec.agg} ${field?.name ?? "value"}`;
      return { label: spec.label?.trim() || fallback, description: "aggregate", icon: "ti ti-math-function" };
    }
    return null;
  };

  const groupedHiddenColumns = () =>
    effectiveGroupedColumnOrder()
      .filter((id) => hiddenGroupedColumnIds().has(id))
      .map((id) => {
        const label = groupedColumnLabel(id);
        return label
          ? {
              id,
              ...label,
              add: () => {
                const next = (query().hiddenGroupedColumns ?? []).filter((hiddenId) => hiddenId !== id);
                patchViewQueryMut.mutate({ hiddenGroupedColumns: next });
              },
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

  const hiddenViewColumnCount = () => (isGrouped() ? groupedHiddenColumns().length : flatHiddenColumns().length);

  const openAddViewColumnDialog = async () => {
    if (!isSavedView()) return;
    const columns = isGrouped() ? groupedHiddenColumns() : flatHiddenColumns();
    if (columns.length === 0) {
      await prompts.alert("All columns are already visible.", { title: "No hidden columns", icon: "ti ti-check" });
      return;
    }
    dialogCore.open<void>((close) => {
      const [selectedColumnIds, setSelectedColumnIds] = createSignal<string[]>([]);
      const addSelected = () => {
        const selected = selectedColumnIds();
        if (selected.length === 0) return;
        if (isGrouped()) {
          patchViewQueryMut.mutate({
            hiddenGroupedColumns: (query().hiddenGroupedColumns ?? []).filter((hiddenId) => !selected.includes(hiddenId)),
          });
        } else {
          const existing = effectiveViewColumns() ?? [];
          const existingIds = new Set(existing.map(columnId));
          persistFlatViewColumns([...existing, ...selected.filter((id) => !existingIds.has(id)).map((fieldId) => ({ fieldId }))]);
        }
        close();
      };
      return (
        <PanelDialog>
          <PanelDialog.Header title="Add columns" icon="ti ti-plus" close={() => close()} />
          <PanelDialog.Body>
            <MultiSelectInput
              label="Columns"
              description="Choose one or more hidden columns to show."
              placeholder="Choose columns"
              icon="ti ti-columns"
              value={selectedColumnIds}
              onChange={setSelectedColumnIds}
              options={columns.map((column) => ({
                id: column.id,
                label: column.label,
                description: column.description,
                icon: column.icon,
              }))}
              clearable
            />
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <button type="button" class="btn-simple btn-sm" onClick={() => close()}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={addSelected} disabled={selectedColumnIds().length === 0}>
                Add columns
              </button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions);
  };

  const openAddComputedColumn = async () => {
    const result = await openComputedColumnDialog({ fields: fields() });
    if (!result || result.action !== "save") return;
    persistFlatViewColumns([...(effectiveViewColumns() ?? defaultViewColumns()), result.column]);
  };

  const clearComputedColumns = () => {
    const next = (effectiveViewColumns() ?? defaultViewColumns()).filter((column) => !isComputedColumn(column));
    persistFlatViewColumns(next);
  };

  // ── Render ─────────────────────────────────────────────────────────
  // Two-column layout (records + detail). The detail column appears
  // when a record is selected and disappears when none is — pure
  // signal-derived rendering, no DOM-class flipping.
  return (
    <div class="flex flex-col lg:flex-row gap-2 flex-1 min-w-0 min-h-0 overflow-hidden">
      {/* Records column splits into two zones:
          - header (search + toolbar) — fixed, never scrolls
          - body (records grid + pagination) — scrolls independently
            of the detail panel column on the right (which has its own
            scroll inside RecordDetailPanel).
          The column itself is `overflow-hidden` so neither zone leaks
          into the other; the inner body div is the single y-scroll
          container, paired with the table-head `position: sticky` in
          DataTable so the column headers stay pinned while rows
          scroll. Mirrors the contacts page layout. */}
      <div
        class={
          "order-1 flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col gap-2 transition-opacity duration-150 " +
          (data.loading ? "opacity-60" : "")
        }
      >
        {/* Row 1 — always visible. Search (left, flex-grow), record
            count + Actions dropdown (right). Trash mode swaps the
            Actions for a "Back to live records" link. */}
        <div class="flex flex-wrap items-center gap-2 shrink-0">
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
          <Show when={livePending() || liveRefreshing()}>
            <button
              type="button"
              class="btn-input btn-input-sm text-blue-700 dark:text-blue-300"
              disabled={liveRefreshing()}
              onClick={() => void applyLiveRefresh()}
              title="Refresh records"
            >
              <i class={`ti ${liveRefreshing() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} />
              Updates available
            </button>
          </Show>

          <Show
            when={!props.trashMode}
            fallback={
              <a href={`/app/grids/${props.baseShortId}/table/${props.tableShortId}`} class="btn-input btn-input-sm">
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
                  icon: "ti ti-download",
                  label: "Export records",
                  action: openExportDialog,
                },
                {
                  icon: "ti ti-archive",
                  label: "Show deleted",
                  href: `/app/grids/${props.baseShortId}/table/${props.tableShortId}?trash=1`,
                },
                ...(canUseEditMode()
                  ? [
                      {
                        icon: adminMode() ? "ti ti-check" : "ti ti-tool",
                        label: adminMode() ? "Exit edit mode" : isSavedView() ? "Edit view" : "Edit table",
                        action: () => setAdminModeAndUrl(!adminMode()),
                      },
                    ]
                  : []),
              ]}
            />
          </Show>
        </div>

        {/* Row 2 — full editing toolbar. Hidden on saved views (the
            view's query is frozen) and in trash mode (only the back-
            link is meaningful there). */}
        <Show when={!props.viewMode && !props.trashMode}>
          <div class="shrink-0">
            <GridToolbar
              baseId={props.baseId}
              tableId={props.tableId}
              tableName={tableName()}
              disableDirectInsert={disableDirectInsert()}
              fields={fields()}
              initialFilter={toolbarFilterRows()}
              initialSort={toolbarSortRows()}
              initialGroupBy={toolbarGroupByRows()}
              initialAggregations={toolbarAggregationRows()}
              columns={effectiveViewColumns()}
              onAddComputedColumn={openAddComputedColumn}
              onClearColumns={clearComputedColumns}
              currentSearch={search()}
              forms={forms()}
              canWrite={props.canWrite}
              onCommit={onToolbarCommit}
              onRecordCreated={onRecordCreated}
              onRecordsChanged={() => void refreshVisibleRecords({ force: true })}
              dateConfig={props.dateConfig}
            />
          </div>
        </Show>

        <Show when={canUseEditMode() && adminMode()}>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <Show
              when={isSavedView()}
              fallback={
                <>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={openTableSettings}>
                    <i class="ti ti-settings" /> General
                  </button>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={openAddField}>
                    <i class="ti ti-plus" /> Add field
                  </button>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={() => openForms()}>
                    <i class="ti ti-forms" /> {formsButtonLabel()}
                  </button>
                </>
              }
            >
              <>
                <button
                  type="button"
                  class={ADMIN_BUTTON_CLASS}
                  onClick={openViewSettings}
                  disabled={!props.activeView || !props.canEditActiveView}
                >
                  <i class="ti ti-table-spark" /> View
                </button>
                <Show when={hiddenViewColumnCount() > 0}>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={openAddViewColumnDialog}>
                    <i class="ti ti-plus" /> Add column
                  </button>
                </Show>
              </>
            </Show>
            <button
              type="button"
              class="btn-simple btn-sm ml-auto text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
              onClick={() => setAdminModeAndUrl(false)}
            >
              Done
            </button>
          </div>
        </Show>

        {/* Body layout column — pure flex-col, NO overflow. The
            scroll context lives one level deeper inside the grid's
            `<div class="paper overflow-auto">` so the sticky `<thead>`
            picks it as the nearest scroll-ancestor and pins correctly.
            Pre-fix, this div had `overflow-y-auto` and the grid had
            its own `overflow-x-auto` inside paper — two scroll
            contexts, the inner one (x-only) won the sticky lookup
            and the header never actually pinned during vertical
            scroll. */}
        <div class="flex-1 min-h-0 flex flex-col gap-2">
          <Show
            when={isGrouped()}
            fallback={
              <DatabaseTable
                result={{
                  items: items() as GridRecord[],
                  fields: fields(),
                  nextCursor: null,
                }}
                baseId={props.baseShortId}
                tableShortIds={props.tableShortIds}
                selectedId={selectedRecordId()}
                highlightedIds={highlightedRecordIds()}
                onRecordClick={onSelectRecord}
                viewColumns={effectiveViewColumns()}
                aggregates={props.trashMode ? {} : aggregates()}
                aggregationSpecs={tableAggregationSpecs()}
                hasMore={!props.trashMode && !!flatNextCursor()}
                loadingMore={data.loading && !!cursor()}
                onLoadMore={loadNextFlatPage}
                scrollPreserveKey={`grids-records-${props.tableId}-${props.viewShortId ?? "default"}`}
                adminMode={adminMode()}
                onFieldSettings={adminMode() && !isSavedView() && props.canManageTable ? openFieldSettings : undefined}
                onFieldMove={undefined}
                onViewColumnSettings={adminMode() && isSavedView() && props.canEditActiveView ? openViewColumnSettings : undefined}
                onViewColumnMove={
                  adminMode() && (isSavedView() ? props.canEditActiveView : props.canManageTable) ? moveViewColumnInline : undefined
                }
                dateConfig={props.dateConfig}
              />
            }
          >
            <GroupedTable
              baseId={props.baseShortId}
              tableShortIds={props.tableShortIds}
              fields={fields()}
              groupBy={groupBy()}
              aggregations={aggregations()}
              buckets={buckets()}
              explode={props.groupedExplode}
              relationLabels={mergedRelationLabels()}
              selectedBucketKey={groupBucketKey(selectedGroup())}
              onBucketClick={onSelectGroup}
              adminMode={adminMode() && isSavedView() && !!props.canEditActiveView}
              columnOrder={visibleGroupedColumnOrder()}
              hiddenColumnIds={query().hiddenGroupedColumns}
              scrollPreserveKey={`grids-groups-${props.tableId}-${props.viewShortId ?? "default"}`}
              onColumnSettings={openGroupedViewColumnSettings}
              onColumnMove={moveGroupedViewColumnInline}
              dateConfig={props.dateConfig}
            />
          </Show>
        </div>
      </div>

      <Show when={selectedRecordId() || selectedGroup()}>
        <div class="order-2 lg:order-3 w-full lg:w-[28rem] shrink-0 flex flex-col min-h-0 overflow-hidden">
          <Show
            when={selectedGroup()}
            fallback={
              <RecordDetailPanel
                baseId={props.baseId}
                baseShortId={props.baseShortId}
                tableId={props.tableId}
                tableName={tableName()}
                fields={fields()}
                record={selectedRecord}
                mode={detailMode}
                canWrite={props.canWrite}
                relationLabels={mergedRelationLabels()}
                tableShortIds={props.tableShortIds}
                onClose={onCloseDetail}
                onUpdated={onRecordUpdated}
                onRemoved={onRecordRemoved}
                dateConfig={props.dateConfig}
              />
            }
          >
            {(bucket) => (
              <GroupDetailPanel
                tableId={props.tableId}
                fields={fields()}
                query={queryWithSearch()}
                groupBy={groupBy()}
                aggregations={aggregations()}
                bucket={bucket()}
                relationLabels={mergedRelationLabels()}
                onClose={onCloseGroupDetail}
                onOpenRecord={onOpenGroupedRecord}
                dateConfig={props.dateConfig}
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
