import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Dropdown, dialogCore, PanelDialog, panelDialogOptions, prompts, toast } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  AggregationSpec,
  ColumnSpec,
  FieldColumnSpec,
  GroupBySpec,
  RecordDisplayConfig,
  RecordQuery,
  TableQueryResult,
  WorkflowRun,
} from "../../../contracts";
import { simpleQueryToGqlSource } from "../../../query-dsl/record-query-source";
import type { Field, Form, GridRecord, Table, View, Workflow } from "../../../service";
import { defaultTableAggregations } from "../../../table-defaults";
import {
  createFieldFromPrompt,
  deleteFieldWithChecks,
  openDocumentTemplatesDialog,
  openFormsDialog,
  openTableSettingsDialog,
} from "../dialogs/TableAdminDialogs";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
import { openFieldEditDialog } from "../fields/TableFieldDialogs";
import QueryWorkspace from "../query/QueryWorkspace";
import type { QueryWorkspaceCurrentSource } from "../query/query-workspace-model";
import { openExportRecordsDialog } from "../records/ExportRecordsDialog";
import RecordDetailPanel from "../records/RecordDetailPanel";
import DatabaseTable from "../table/DatabaseTable";
import GroupDetailPanel from "../table/GroupDetailPanel";
import GroupedTable, { type GroupBucket } from "../table/GroupedTable";
import type { AggKindUI, AggregationRow } from "../toolbar/AggregationsPanel";
import { CardSizeDropdown } from "../toolbar/CardSizeDropdown";
import type { FilterLeaf } from "../toolbar/FilterPanel";
import GridToolbar from "../toolbar/GridToolbar";
// These were once-islands but are now plain components rendered inside
// RecordsView's island. Nested islands break SSR (Seroval can't serialize
// the function props the parent passes down) — keeping them as plain
// children means they hydrate as part of RecordsView, sharing its state.
import SearchBar from "../toolbar/SearchBar";
import { errorMessage } from "../utils/api-helpers";
import { bulkSelectionRunPayload, bulkWorkflowActionLabel, pruneBulkSelection, sameBulkSelection } from "./bulk-selection";
import { activeDisplayConfig, calendarQueryFilter, cardImageFieldIds, removeCalendarQueryFilter } from "./display-mode";
import { fetchTableQuery } from "./fetcher";
import { createGridsRecordEventsProvider } from "./grids-record-events-provider";
import {
  highlightedIdsForLiveRefresh,
  liveRefreshQuery,
  shouldLoadNextLiveRefreshPage,
  shouldOptimisticallyRemoveDeletedRecord,
  visibleIdsFromResult,
} from "./live-refresh";
import { buildRecordsUrl, type CardSize, parseRecordsState, type RecordsState } from "./query-url";
import { RecordCalendarView } from "./RecordCalendarView";
import { RecordCardsView } from "./RecordCardsView";
import { cleanRecordMetaQuery, openRecordMetadataDialog, recordMetaActiveCount } from "./RecordMetadataDialog";
import { createRecordsViewColumnController, isFieldColumn } from "./records-view-columns";
import { applyToolbarQueryPatch, type ToolbarQueryPatch } from "./toolbar-query";

/** UI-supported agg kinds — narrower than the contract's AggregateKind
 *  (which also has median/earliest/latest, currently SQL-only). When a
 *  saved view stores one of those, the toolbar simply won't render it
 *  as an editable row. */
const UI_AGG_KINDS: ReadonlySet<AggKindUI> = new Set(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);

const ADMIN_BUTTON_CLASS = "btn-input-success btn-input-sm";
const QUERY_PANEL_DIALOG_OPTIONS = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(98vw,76rem)]"),
};

const toAggregationRows = (specs: AggregationSpec[] | undefined): AggregationRow[] =>
  (specs ?? [])
    .filter((s): s is AggregationSpec & { agg: AggKindUI } => UI_AGG_KINDS.has(s.agg as AggKindUI))
    .map((s) => ({ fieldId: s.fieldId, agg: s.agg, label: s.label }));

const filterRowsFromQuery = (filter: RecordQuery["filter"]): FilterLeaf[] => {
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
 * The detail panel column still lives outside this island. The panel
 * coordinates via the record-detail-context custom-event bus; this
 * island emits a `popstate` synthetic so the panel can resync its
 * highlight.
 */

type RuntimeView = View & {
  query: RecordQuery;
  displayConfig: RecordDisplayConfig;
};

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
  tables: Table[];
  viewsByTable: Record<string, View[]>;
  forms: Form[];
  canWrite: boolean;
  canManageTable: boolean;
  trashMode: boolean;
  initialAdminMode: boolean;
  initialAccessEntries: AccessEntry[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  activeView?: RuntimeView | null;
  activeViewAccessEntries?: AccessEntry[];
  canEditActiveView?: boolean;
  /** Tables in the same base, including the active table for self-relations. */
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
  activeRecordQuery: RecordQuery | null;
  displayConfig: RecordDisplayConfig;
  bulkSelectionWorkflows: Workflow[];
  dateConfig?: DateContext;
};

type RecordsTableQueryResult = TableQueryResult & {
  __recordsFetchEpoch?: number;
  __liveCommitId?: number;
};

type BulkWorkflowRunInput = {
  workflow: Workflow;
  selectedRecordIds: string[];
  query: RecordQuery;
};

export default function RecordsView(props: Props) {
  // ── Canonical state ────────────────────────────────────────────────
  const [tableName, setTableName] = createSignal(props.tableName);
  const [tableDescription, setTableDescription] = createSignal(props.tableDescription);
  const [tableIcon, setTableIcon] = createSignal(props.tableIcon ?? null);
  const [tableColumns, setTableColumns] = createSignal<FieldColumnSpec[]>(props.tableColumns);
  const [tableDisplayConfig, setTableDisplayConfig] = createSignal<RecordDisplayConfig>(
    props.activeView ? { mode: "table" } : props.displayConfig,
  );
  const [viewDisplayConfig, setViewDisplayConfig] = createSignal<RecordDisplayConfig | null>(props.activeView?.displayConfig ?? null);
  const displayConfig = () => activeDisplayConfig(tableDisplayConfig(), viewDisplayConfig());
  const [disableDirectInsert, setDisableDirectInsert] = createSignal(props.disableDirectInsert);
  const [fields, setFields] = createSignal<Field[]>([...props.fields].sort((a, b) => a.position - b.position));
  const [forms, setForms] = createSignal<Form[]>(props.forms);
  const isSavedView = () => props.viewMode || !!props.activeView || !!props.viewShortId;
  const canUseEditMode = () => (isSavedView() ? !!props.canEditActiveView : props.canManageTable);
  const queryWorkspaceHref = () =>
    props.viewShortId
      ? `/app/grids/${props.baseShortId}/table/${props.tableShortId}/view/${props.viewShortId}/query`
      : `/app/grids/${props.baseShortId}/table/${props.tableShortId}/query`;
  const [adminMode, setAdminMode] = createSignal(props.initialAdminMode && canUseEditMode());
  const [viewColumns, setViewColumns] = createSignal<ColumnSpec[] | undefined>(props.viewColumns ?? props.initialState.query.columns);
  const [query, setQuery] = createSignal<RecordQuery>(props.initialState.query);
  const [cursor, setCursor] = createSignal<string | null>(props.initialState.cursor);
  const [selectedRecordId, setSelectedRecordId] = createSignal<string | null>(props.initialState.selectedRecordId);
  const [bulkSelectedRecordIds, setBulkSelectedRecordIds] = createSignal<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = createSignal<GroupBucket | null>(null);
  const resolvedSearchState = (state: RecordsState["search"]): RecordsState["search"] => {
    if (state.override) return state;
    const saved = props.activeRecordQuery?.search;
    if (!saved) return state;
    return {
      q: saved.q,
      fieldIds: saved.fieldIds ?? [],
      override: false,
    };
  };
  const [search, setSearch] = createSignal<RecordsState["search"]>(resolvedSearchState(props.initialState.search));
  const [calendarState, setCalendarState] = createSignal<RecordsState["calendar"]>(props.initialState.calendar);
  const [cardSize, setCardSize] = createSignal<CardSize>(props.initialState.cardSize);
  const groupBy = () => (query().groupBy ?? []) as GroupBySpec[];
  const aggregations = () => (query().aggregations ?? []) as AggregationSpec[];
  const toolbarFilterRows = createMemo(() => filterRowsFromQuery(query().filter));
  const toolbarSortRows = createMemo(() => query().sort ?? []);
  const toolbarGroupByRows = createMemo(() => groupBy());
  const toolbarAggregationRows = createMemo(() => toAggregationRows(aggregations()));
  const activeRecordMetaCount = createMemo(() => recordMetaActiveCount(query().recordMeta));
  const isGrouped = () => groupBy().length > 0;
  const customForms = () => forms().filter((form) => !form.isDefault);
  const formsButtonLabel = () => {
    const count = customForms().length;
    return count > 0 ? `Forms (${count})` : "Add form";
  };
  const renderMode = () => (isGrouped() || props.trashMode ? "table" : displayConfig().mode);

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
  const queryWithSearch = (): RecordQuery => {
    const { search: _savedSearch, ...baseQuery } = query();
    const q = search().q.trim();
    const withSearch = q ? { ...baseQuery, search: { q, fieldIds: search().fieldIds } } : baseQuery;
    const withCalendar = {
      ...withSearch,
      filter: calendarQueryFilter({
        baseFilter: withSearch.filter,
        fields: fields(),
        displayConfig: displayConfig(),
        calendar: calendarState(),
        dateConfig: props.dateConfig,
      }),
    };
    return renderMode() === "calendar" && !withCalendar.limit ? { ...withCalendar, limit: 500 } : withCalendar;
  };

  const queryCurrentSource = (): QueryWorkspaceCurrentSource =>
    props.activeView
      ? {
          kind: "view",
          viewId: props.activeView.id,
          label: props.activeView.name,
          ref: props.activeView.shortId,
        }
      : {
          kind: "table",
          tableId: props.tableId,
          label: tableName(),
          ref: props.tableShortId,
        };

  const queryPanelInitialSource = () => {
    const source = simpleQueryToGqlSource({ tableId: props.tableId, query: queryWithSearch() });
    return source.ok ? source.source : "";
  };

  const openQueryPanel = () => {
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog>
          <PanelDialog.Header title="Query" subtitle={tableName()} icon="ti ti-code" close={() => close()} />
          <PanelDialog.Body>
            <div class="flex h-[min(72vh,46rem)] min-h-[30rem] overflow-hidden">
              <QueryWorkspace
                baseId={props.baseId}
                baseShortId={props.baseShortId}
                initialQuery={queryPanelInitialSource()}
                queryPath={queryWorkspaceHref()}
                currentSource={queryCurrentSource()}
                tables={props.tables}
                fieldsByTable={{ ...props.fieldsByTable, [props.tableId]: fields() }}
                viewsByTable={props.viewsByTable}
                syncQueryToUrl={false}
              />
            </div>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <a href={queryWorkspaceHref()} class="btn-input btn-sm">
              <i class="ti ti-arrows-maximize" /> Full workspace
            </a>
            <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
              Done
            </button>
          </PanelDialog.Footer>
        </PanelDialog>
      ),
      QUERY_PANEL_DIALOG_OPTIONS,
    );
  };

  const bulkSelectionEnabled = () =>
    props.bulkSelectionWorkflows.length > 0 && !props.trashMode && !isGrouped() && renderMode() === "table";
  const selectedBulkCount = () => bulkSelectedRecordIds().size;
  const clearBulkSelection = () => setBulkSelectedRecordIds(new Set<string>());
  const toggleBulkRecordSelection = (recordId: string, selected: boolean) => {
    setBulkSelectedRecordIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };
  const toggleVisibleBulkRecords = (selected: boolean) => {
    const ids = (items() as GridRecord[]).map((record) => record.id);
    setBulkSelectedRecordIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const runBulkWorkflow = mutations.create<WorkflowRun, BulkWorkflowRunInput>({
    mutation: async ({ workflow, selectedRecordIds, query }, { abortSignal }) => {
      const res = await apiClient.workflows[":workflowId"].run["bulk-selection"].$post(
        {
          param: { workflowId: workflow.id },
          json: bulkSelectionRunPayload(selectedRecordIds, query),
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not start workflow."));
      return res.json();
    },
    onSuccess: (run) => {
      clearBulkSelection();
      toast.success(`Workflow queued: ${run.status}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const queueBulkWorkflow = (workflow: Workflow) =>
    runBulkWorkflow.mutate({
      workflow,
      selectedRecordIds: [...bulkSelectedRecordIds()],
      query: queryWithSearch(),
    });

  const [data, { refetch, mutate }] = createResource<
    RecordsTableQueryResult,
    {
      tableId: string;
      viewId?: string;
      query: RecordQuery;
      cursor: string | null;
      filePreviewFieldIds?: string[];
      calendar: RecordsState["calendar"];
    }
  >(
    () => ({
      tableId: props.tableId,
      viewId: props.activeView?.id,
      query: queryWithSearch(),
      cursor: cursor(),
      filePreviewFieldIds: renderMode() === "cards" ? cardImageFieldIds(displayConfig()) : [],
      calendar: calendarState(),
    }),
    async (args): Promise<RecordsTableQueryResult> => {
      const epoch = ++resourceFetchEpochCounter;
      const result = await fetchTableQuery(args);
      return { ...result, __recordsFetchEpoch: epoch };
    },
    { initialValue: { ...props.initialData, __recordsFetchEpoch: 0 } as RecordsTableQueryResult },
  );

  const [flatItems, setFlatItems] = createSignal<GridRecord[]>(props.initialData.items ?? []);
  const [flatNextCursor, setFlatNextCursor] = createSignal<string | null>(props.initialData.nextCursor ?? null);
  const [flatFilePreviews, setFlatFilePreviews] = createSignal(props.initialData.filePreviews ?? {});
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
      setFlatFilePreviews(response.filePreviews ?? {});
      return;
    }
    if (!didApplyFirstFlatPage) {
      didApplyFirstFlatPage = true;
      setFlatItems(pageItems);
      setFlatFilePreviews(response.filePreviews ?? {});
      return;
    }
    if (!cursor()) {
      setFlatItems(pageItems);
      setFlatFilePreviews(response.filePreviews ?? {});
      return;
    }
    setFlatItems((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...pageItems.filter((r) => !seen.has(r.id))];
    });
    setFlatFilePreviews((prev) => ({ ...prev, ...(response.filePreviews ?? {}) }));
  });

  const items = () => (isGrouped() ? (data()?.items ?? []) : flatItems());
  const buckets = () => (data()?.buckets ?? []) as GroupBucket[];
  const aggregates = () => data()?.aggregates ?? {};

  let bulkSelectionScopeKey = "";
  createEffect(() => {
    const key = JSON.stringify({
      tableId: props.tableId,
      viewId: props.activeView?.id ?? null,
      trashMode: props.trashMode,
      renderMode: renderMode(),
      query: queryWithSearch(),
    });
    if (bulkSelectionScopeKey && key !== bulkSelectionScopeKey) clearBulkSelection();
    bulkSelectionScopeKey = key;
  });

  createEffect(() => {
    if (!bulkSelectionEnabled()) {
      if (selectedBulkCount() > 0) clearBulkSelection();
      return;
    }
    const visibleIds = new Set((items() as GridRecord[]).map((record) => record.id));
    setBulkSelectedRecordIds((prev) => {
      const next = pruneBulkSelection(prev, visibleIds);
      return sameBulkSelection(prev, next) ? prev : next;
    });
  });

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
  const queryForUrl = (): RecordQuery => {
    const current = query();
    if (renderMode() !== "calendar") return current;
    return {
      ...current,
      filter: removeCalendarQueryFilter({
        queryFilter: current.filter,
        fields: fields(),
        displayConfig: displayConfig(),
        calendar: calendarState(),
        dateConfig: props.dateConfig,
      }),
    };
  };

  const currentUrlState = (): RecordsState => ({
    query: queryForUrl(),
    cursor: null,
    selectedRecordId: selectedRecordId(),
    search: search(),
    calendar: calendarState(),
    cardSize: cardSize(),
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
      props.activeRecordQuery,
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
  const onToolbarCommit = (patch: ToolbarQueryPatch) => {
    invalidateLiveRefreshes();
    setQuery((prev) => applyToolbarQueryPatch(prev, patch));
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

  const onCalendarChange = (next: RecordsState["calendar"]) => {
    invalidateLiveRefreshes();
    setCalendarState(next);
    setSelectedGroup(null);
    setCursor(null);
    syncUrl({ replace: true });
  };

  const onCardSizeChange = (next: CardSize) => {
    setCardSize(next);
    syncUrl({ replace: true });
  };

  const openRecordMetaDialog = async () => {
    const next = await openRecordMetadataDialog({ tableId: props.tableId, initial: query().recordMeta });
    if (next === null) return;
    invalidateLiveRefreshes();
    setQuery((prev) => ({ ...prev, recordMeta: cleanRecordMetaQuery(next) }));
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

  const fetchFlatLiveRefresh = async (baseQuery: RecordQuery, targetCount: number, signal: AbortSignal): Promise<TableQueryResult> => {
    const filePreviewFieldIds = renderMode() === "cards" ? cardImageFieldIds(displayConfig()) : [];
    const desiredCount = Math.max(targetCount, 1);
    let nextCursor: string | null = null;
    let firstPage: TableQueryResult | null = null;
    const combinedItems: GridRecord[] = [];
    const combinedFilePreviews: NonNullable<TableQueryResult["filePreviews"]> = {};

    do {
      const page = await fetchTableQuery(
        {
          tableId: props.tableId,
          viewId: props.activeView?.id,
          query: liveRefreshQuery(baseQuery, Math.max(desiredCount - combinedItems.length, 1)),
          cursor: nextCursor,
          filePreviewFieldIds,
        },
        { signal },
      );
      firstPage ??= page;
      combinedItems.push(...((page.items ?? []) as GridRecord[]));
      Object.assign(combinedFilePreviews, page.filePreviews ?? {});
      nextCursor = page.nextCursor ?? null;
    } while (
      shouldLoadNextLiveRefreshPage({
        loadedCount: combinedItems.length,
        targetCount: desiredCount,
        nextCursor,
      })
    );

    return {
      ...(firstPage ?? { nextCursor: null }),
      items: combinedItems,
      filePreviews: Object.keys(combinedFilePreviews).length > 0 ? combinedFilePreviews : undefined,
      nextCursor,
    };
  };

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
      const next = isGrouped()
        ? await fetchTableQuery(
            {
              tableId: props.tableId,
              viewId: props.activeView?.id,
              query: queryWithSearch(),
              cursor: null,
              filePreviewFieldIds: renderMode() === "cards" ? cardImageFieldIds(displayConfig()) : [],
            },
            { signal: abort.signal },
          )
        : await fetchFlatLiveRefresh(queryWithSearch(), flatItems().length, abort.signal);
      if (requestId !== refreshRequestId) return;
      if (!isGrouped()) {
        const pageItems = (next.items ?? []) as GridRecord[];
        setFlatItems(pageItems);
        setFlatNextCursor(next.nextCursor ?? null);
        setFlatFilePreviews(next.filePreviews ?? {});
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
      setViewColumns(parsed.query.columns ?? props.viewColumns);
      setCursor(parsed.cursor);
      setSelectedRecordId(parsed.selectedRecordId);
      setSelectedGroup(null);
      setSearch(resolvedSearchState(parsed.search));
      setCalendarState(parsed.calendar);
      setCardSize(parsed.cardSize);
      setAdminMode(new URL(location.href).searchParams.get("edit") === "true" && canUseEditMode());
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
        if (!event) return;
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
    if (isGrouped()) {
      const n = buckets().length;
      if (n === 0) return "No groups";
      if (n === 1) return "1 group";
      return `${n} groups`;
    }
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
    displayConfig: tableDisplayConfig(),
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
      fields: fields(),
      initialAccessEntries: props.initialAccessEntries,
      onSaved: (table) => {
        setTableName(table.name);
        setTableDescription(table.description ?? null);
        setTableIcon(table.icon ?? null);
        setTableColumns(table.columns);
        setTableDisplayConfig(table.displayConfig);
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

  const openTemplates = () => {
    openDocumentTemplatesDialog({
      baseId: props.baseId,
      tableId: props.tableId,
      tableName: tableName(),
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
      onSaved: (next) => setViewDisplayConfig(next.ui.displayConfig ?? { mode: "table" }),
    });
  };

  const {
    effectiveViewColumns,
    visibleGroupedColumnOrder,
    hiddenViewColumnCount,
    moveViewColumnInline,
    openViewColumnSettings,
    moveGroupedViewColumnInline,
    openGroupedViewColumnSettings,
    openAddViewColumnDialog,
    openAddComputedColumn,
    clearComputedColumns,
  } = createRecordsViewColumnController({
    props: {
      activeView: props.activeView,
      tableId: props.tableId,
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
    },
    fields,
    tableColumns,
    setTableColumns,
    query,
    setQuery,
    viewColumns,
    setViewColumns,
    groupBy,
    aggregations,
    isGrouped,
    isSavedView,
    syncUrl,
  });

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
          <Show when={renderMode() === "cards" && (props.viewMode || props.trashMode)}>
            <CardSizeDropdown value={cardSize()} onChange={onCardSizeChange} />
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
            <Show when={activeRecordMetaCount() > 0}>
              <button type="button" class="btn-input btn-input-active btn-input-sm" onClick={openRecordMetaDialog}>
                <i class="ti ti-user-search" />
                Record info · {activeRecordMetaCount()}
              </button>
            </Show>
            <Show when={bulkSelectionEnabled() && selectedBulkCount() > 0}>
              <button type="button" class="btn-input btn-input-active btn-input-sm" onClick={clearBulkSelection}>
                <i class="ti ti-checklist" />
                {selectedBulkCount()} selected
                <i class="ti ti-x text-[10px] opacity-60" />
              </button>
            </Show>
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
                  icon: "ti ti-user-search",
                  label: "Record metadata",
                  action: openRecordMetaDialog,
                },
                {
                  icon: "ti ti-download",
                  label: "Export records",
                  action: openExportDialog,
                },
                ...props.bulkSelectionWorkflows.map((workflow) => ({
                  icon: "ti ti-route",
                  label: bulkWorkflowActionLabel(workflow.name, selectedBulkCount()),
                  action: () => queueBulkWorkflow(workflow),
                })),
                {
                  icon: "ti ti-code",
                  label: "Open query",
                  href: queryWorkspaceHref(),
                },
                {
                  icon: "ti ti-archive",
                  label: "Show deleted",
                  href: `/app/grids/${props.baseShortId}/table/${props.tableShortId}?trash=1`,
                },
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
              recordMeta={query().recordMeta}
              columns={effectiveViewColumns()}
              queryHref={queryWorkspaceHref()}
              onOpenQuery={openQueryPanel}
              onAddComputedColumn={openAddComputedColumn}
              onClearColumns={clearComputedColumns}
              currentSearch={search()}
              forms={forms()}
              canWrite={props.canWrite}
              onCommit={onToolbarCommit}
              onRecordCreated={onRecordCreated}
              onRecordsChanged={() => void refreshVisibleRecords({ force: true })}
              dateConfig={props.dateConfig}
              showCardSize={renderMode() === "cards"}
              cardSize={cardSize()}
              onCardSizeChange={onCardSizeChange}
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
                  <button type="button" class="btn-input-success btn-input-sm" onClick={openAddField}>
                    <i class="ti ti-plus" /> Add field
                  </button>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={() => openForms()}>
                    <i class="ti ti-forms" /> {formsButtonLabel()}
                  </button>
                  <button type="button" class={ADMIN_BUTTON_CLASS} onClick={openTemplates}>
                    <i class="ti ti-file-type-pdf" /> Templates
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
                  <button type="button" class="btn-input-success btn-input-sm" onClick={openAddViewColumnDialog}>
                    <i class="ti ti-plus" /> Add column
                  </button>
                </Show>
              </>
            </Show>
            <button type="button" class="btn-simple btn-sm ml-auto" onClick={() => setAdminModeAndUrl(false)}>
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
              <Show
                when={renderMode() === "cards"}
                fallback={
                  <Show
                    when={renderMode() === "calendar"}
                    fallback={
                      <DatabaseTable
                        result={{
                          items: items() as GridRecord[],
                          fields: fields(),
                          nextCursor: null,
                        }}
                        baseId={props.baseShortId}
                        tableShortIds={props.tableShortIds}
                        fieldsByTable={{ ...(props.fieldsByTable ?? {}), [props.tableId]: fields() }}
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
                        bulkSelection={
                          bulkSelectionEnabled()
                            ? {
                                selectedIds: bulkSelectedRecordIds(),
                                onToggleRecord: toggleBulkRecordSelection,
                                onToggleVisible: toggleVisibleBulkRecords,
                              }
                            : undefined
                        }
                        dateConfig={props.dateConfig}
                      />
                    }
                  >
                    <RecordCalendarView
                      items={items() as GridRecord[]}
                      fields={fields()}
                      displayConfig={displayConfig()}
                      calendarState={calendarState()}
                      onCalendarChange={onCalendarChange}
                      selectedRecordId={selectedRecordId()}
                      onRecordClick={onSelectRecord}
                      dateConfig={props.dateConfig}
                    />
                  </Show>
                }
              >
                <RecordCardsView
                  items={items() as GridRecord[]}
                  fields={fields()}
                  displayConfig={displayConfig()}
                  filePreviews={flatFilePreviews()}
                  baseId={props.baseShortId}
                  tableId={props.tableId}
                  tableShortIds={props.tableShortIds}
                  fieldsByTable={{ ...(props.fieldsByTable ?? {}), [props.tableId]: fields() }}
                  selectedId={selectedRecordId()}
                  highlightedIds={highlightedRecordIds()}
                  onRecordClick={onSelectRecord}
                  cardSize={cardSize()}
                  hasMore={!props.trashMode && !!flatNextCursor()}
                  loadingMore={data.loading && !!cursor()}
                  onLoadMore={loadNextFlatPage}
                  dateConfig={props.dateConfig}
                />
              </Show>
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
                fieldsByTable={{ ...(props.fieldsByTable ?? {}), [props.tableId]: fields() }}
                viewColumns={effectiveViewColumns()}
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
