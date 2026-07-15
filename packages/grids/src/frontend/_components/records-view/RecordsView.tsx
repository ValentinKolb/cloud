import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { AppWorkspace, Dropdown, dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, toast } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  AggregationSpec,
  ColumnSpec,
  FieldColumnSpec,
  GroupBySpec,
  RecordDisplayConfig,
  RecordQuery,
  TableQueryResult,
} from "../../../contracts";
import { simpleQueryToGqlSource } from "../../../query-dsl/record-query-source";
import type { Field, Form, GridRecord, Table, View } from "../../../service";
import { defaultTableAggregations } from "../../../table-defaults";
import QueryWorkspace from "../query/QueryWorkspace";
import type { QueryWorkspaceCurrentSource } from "../query/query-workspace-model";
import { openExportRecordsDialog } from "../records/ExportRecordsDialog";
import RecordDetailPanel from "../records/RecordDetailPanel";
import DatabaseTable from "../table/DatabaseTable";
import GroupDetailPanel from "../table/GroupDetailPanel";
import GroupedTable, { type GroupBucket } from "../table/GroupedTable";
import { CardSizeDropdown } from "../toolbar/CardSizeDropdown";
import GridToolbar from "../toolbar/GridToolbar";
// Plain children share RecordsView's hydrated state; nested islands cannot
// serialize the callback props used by these controls.
import SearchBar from "../toolbar/SearchBar";
import { errorMessage } from "../utils/api-helpers";
import { workspaceMainClass } from "../workspace/workspace-layout";
import type { WorkspaceBulkLauncher } from "../workspace/workspace-state-model";
import { bulkSelectionRunPayload, bulkWorkflowActionLabel, pruneBulkSelection, sameBulkSelection } from "./bulk-selection";
import { activeDisplayConfig, calendarQueryFilter, cardImageFieldIds, removeCalendarQueryFilter } from "./display-mode";
import { visibleIdsFromResult } from "./live-refresh";
import type { CardSize, RecordsState } from "./query-url";
import { RecordCalendarView } from "./RecordCalendarView";
import { RecordCardsView } from "./RecordCardsView";
import { cleanRecordMetaQuery, openRecordMetadataDialog, recordMetaActiveCount } from "./RecordMetadataDialog";
import { RecordsAdminToolbar } from "./RecordsAdminToolbar";
import { createRecordsAdminController } from "./records-admin-controller";
import { createRecordsDataController } from "./records-data-controller";
import { createRecordsUrlController } from "./records-url-controller";
import { createRecordsViewColumnController, isFieldColumn } from "./records-view-columns";
import { aggregationRowsFromQuery, applyToolbarQueryPatch, filterRowsFromQuery, type ToolbarQueryPatch } from "./toolbar-query";

const QUERY_PANEL_DIALOG_OPTIONS = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(98vw,76rem)]"),
};

/**
 * Records-area island. It owns presentation state and delegates URL,
 * query/live data, columns, and admin mutations to focused controllers.
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
  /** True on a saved-view route. Its query is edited through view settings,
   *  so the ad-hoc table toolbar is hidden. */
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
  /** Stored query of the active path-based view, used as the base for URL overrides. */
  activeRecordQuery: RecordQuery | null;
  displayConfig: RecordDisplayConfig;
  bulkSelectionLaunchers: WorkspaceBulkLauncher[];
  dateConfig?: DateContext;
  workspaceRouteKey: string;
};

type BulkWorkflowRunInput = {
  launcher: WorkspaceBulkLauncher;
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
  const [query, setQuery] = createSignal<RecordQuery>({
    ...props.initialState.query,
    ...(props.activeRecordQuery?.limit !== undefined ? { limit: props.activeRecordQuery.limit } : {}),
  });
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
  const toolbarAggregationRows = createMemo(() => aggregationRowsFromQuery(aggregations()));
  const activeRecordMetaCount = createMemo(() => recordMetaActiveCount(query().recordMeta));
  const isGrouped = () => groupBy().length > 0;
  const customForms = () => forms().filter((form) => !form.isDefault);
  const formsButtonLabel = () => {
    const count = customForms().length;
    return count > 0 ? `Forms (${count})` : "Add form";
  };
  const renderMode = () => (isGrouped() || props.trashMode ? "table" : displayConfig().mode);

  // ── Query source ──────────────────────────────────────────────────
  // Search is a peer of filter/sort/group/agg in the wire query. We fold
  // the SearchBar's `{q, fieldIds}` signal into `query.search` here so a
  // keystroke updates the source signal and the API request body in one
  // step — the records service compiles it into SQL separately from the
  // structured FilterTree.
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
    props.bulkSelectionLaunchers.length > 0 && !props.trashMode && !isGrouped() && renderMode() === "table";
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

  const runBulkWorkflow = mutations.create<{ runId: string; status: string }, BulkWorkflowRunInput>({
    mutation: async ({ launcher, selectedRecordIds, query }, { abortSignal }) => {
      const res = await apiClient.workflows.launchers[":launcherId"].invoke.bulk.$post(
        {
          param: { launcherId: launcher.id },
          json: {
            operationId: crypto.randomUUID(),
            mode: "execute",
            expectedRevision: launcher.workflowRevision,
            inputs: {},
            ...bulkSelectionRunPayload(selectedRecordIds, query),
          },
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

  const queueBulkWorkflow = (launcher: WorkspaceBulkLauncher) =>
    runBulkWorkflow.mutate({
      launcher,
      selectedRecordIds: [...bulkSelectedRecordIds()],
      query: queryWithSearch(),
    });

  const recordsData = createRecordsDataController({
    tableId: props.tableId,
    trashMode: props.trashMode,
    source: () => ({
      tableId: props.tableId,
      viewId: props.activeView?.id,
      query: queryWithSearch(),
      cursor: cursor(),
      filePreviewFieldIds: renderMode() === "cards" ? cardImageFieldIds(displayConfig()) : [],
      calendar: calendarState(),
    }),
    initialData: props.initialData,
    cursor,
    setCursor,
    isGrouped,
    hasBlockingDialog: () => dialogCore.isOpen(),
    onOptimisticDelete: (recordId) => {
      if (recordId === selectedRecordId()) closeSelectedRecord();
    },
    onRefreshed: (result) => verifySelectedRecordAfterRefresh(result),
    onRevoked: (error) => prompts.error(error.message || "Your access to this table changed. Reload the page to continue."),
    onFatal: (error) => prompts.error(error.message || "Live updates are unavailable. Reload the page to continue."),
  });
  const {
    data,
    failure: queryFailure,
    refetch,
    items,
    buckets,
    aggregates,
    relationLabels: liveRelationLabels,
    filePreviews,
    nextCursor,
    livePending,
    liveRefreshing,
    highlightedRecordIds,
    invalidate: invalidateLiveRefreshes,
    loadNextPage: loadNextFlatPage,
    refreshVisibleRecords,
    replaceRecord,
    removeRecord,
  } = recordsData;
  const retryQuery = () => void refetch();

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

  const { sync: syncUrl } = createRecordsUrlController({
    path: {
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
      viewShortId: props.viewShortId,
    },
    activeRecordQuery: props.activeRecordQuery,
    state: () => ({
      query: queryForUrl(),
      cursor: null,
      selectedRecordId: selectedRecordId(),
      search: search(),
      calendar: calendarState(),
      cardSize: cardSize(),
    }),
    adminMode,
    canUseEditMode,
    beforePopState: invalidateLiveRefreshes,
    applyPopState: ({ state: restored, adminMode: restoredAdminMode }) => {
      setQuery(restored.query);
      setViewColumns(restored.query.columns ?? props.viewColumns);
      setCursor(restored.cursor);
      setSelectedRecordId(restored.selectedRecordId);
      setSelectedGroup(null);
      setSearch(resolvedSearchState(restored.search));
      setCalendarState(restored.calendar);
      setCardSize(restored.cardSize);
      setAdminMode(restoredAdminMode);
    },
  });

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
    ...liveRelationLabels(),
  });

  // ── Selected record resolution ─────────────────────────────────────
  // Prefer the row from the visible page (cheap, no network). Fall back
  // to the SSR-provided initialSelectedRecord (deep-link case where the
  // record isn't on this page). Final fallback: client-side fetch.
  const [fetchedSelected, setFetchedSelected] = createSignal<GridRecord | null>(null);
  const [selectedRecordFailure, setSelectedRecordFailure] = createSignal<Error | null>(null);
  const [selectedRecordLoadAttempt, setSelectedRecordLoadAttempt] = createSignal(0);
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

  const closeSelectedRecord = () => {
    setSelectedRecordId(null);
    setFetchedSelected(null);
    setSelectedRecordFailure(null);
    syncUrl({ replace: true });
  };

  // When a selected id can't be found locally, fetch it once. This is
  // the rare deep-link / paginated-out path; common case (row click)
  // hands us the record directly via items().
  createEffect(() => {
    selectedRecordLoadAttempt();
    const id = selectedRecordId();
    if (!id) {
      setFetchedSelected(null);
      setSelectedRecordFailure(null);
      return;
    }
    if (selectedRecord()) {
      setSelectedRecordFailure(null);
      return;
    }
    const abort = new AbortController();
    onCleanup(() => abort.abort());
    const requestedId = id;
    setSelectedRecordFailure(null);
    void apiClient.records[":tableId"][":recordId"]
      .$get({ param: { tableId: props.tableId, recordId: id } }, { init: { signal: abort.signal } })
      .then(async (res) => {
        if (res.status === 403 || res.status === 404) {
          if (selectedRecordId() === requestedId) closeSelectedRecord();
          return;
        }
        if (!res.ok) throw new Error(await errorMessage(res, "Could not load record"));
        const rec = await res.json();
        if (selectedRecordId() === requestedId) setFetchedSelected(() => rec);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || selectedRecordId() !== requestedId) return;
        setSelectedRecordFailure(error instanceof Error ? error : new Error("Could not load record."));
      });
  });

  const detailMode = (): "live" | "trash" => (query().deletedOnly ? "trash" : "live");

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

  const applyLiveRefresh = () => refreshVisibleRecords();

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

  /** Keep the selected panel and visible page in sync after an in-place edit. */
  const onRecordUpdated = (record: GridRecord) => {
    setFetchedSelected(() => record);
    replaceRecord(record);
    void refreshVisibleRecords({ recordIds: [record.id], force: true });
  };

  /** After a delete or restore: close the panel + refetch. */
  const onRecordRemoved = () => {
    const recordId = selectedRecordId();
    if (recordId) removeRecord(recordId);
    closeSelectedRecord();
    void refreshVisibleRecords({ force: true });
  };

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
    syncUrl({ replace: true });
  };

  const { openFieldSettings, openTableSettings, openAddField, openForms, openTemplates, openViewSettings } = createRecordsAdminController({
    baseId: props.baseId,
    baseShortId: props.baseShortId,
    tableId: props.tableId,
    tableShortId: props.tableShortId,
    tableName,
    setTableName,
    tableDescription,
    setTableDescription,
    tableIcon,
    setTableIcon,
    tableColumns,
    setTableColumns,
    tableDisplayConfig,
    setTableDisplayConfig,
    disableDirectInsert,
    setDisableDirectInsert,
    fields,
    setFields,
    forms,
    setForms,
    otherTables: props.otherTables,
    fieldsByTable: props.fieldsByTable,
    initialAccessEntries: props.initialAccessEntries,
    initialFormAccessEntries: props.initialFormAccessEntries,
    activeView: props.activeView,
    activeViewAccessEntries: props.activeViewAccessEntries,
    canEditActiveView: props.canEditActiveView,
    canManageTable: props.canManageTable,
    dateConfig: props.dateConfig,
    refetch: () => void refetch(),
    setViewDisplayConfig,
  });

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

  const hasOpenDetail = () => Boolean(selectedRecordId() || selectedGroup());

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <AppWorkspace.Content>
      <AppWorkspace.Main class={workspaceMainClass("records")}>
        <div class="flex flex-1 min-w-0 min-h-0 overflow-hidden" data-route-key={props.workspaceRouteKey}>
          {/* Records workbench splits into two zones:
          - header (search + toolbar) — fixed, never scrolls
          - body (records grid + pagination) — scrolls independently
            of the workspace detail panel.
          The column itself is `overflow-hidden` so neither zone leaks
          into the other; the inner body div is the single y-scroll
          container, paired with the table-head `position: sticky` in
          DataTable so the column headers stay pinned while rows scroll. */}
          <div
            class={
              "flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col gap-2 transition-opacity duration-150 " +
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
                  class="btn-input btn-input-sm app-accent-text"
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
                    ...props.bulkSelectionLaunchers.map((launcher) => ({
                      icon: "ti ti-route",
                      label: bulkWorkflowActionLabel(launcher.name, selectedBulkCount()),
                      action: () => queueBulkWorkflow(launcher),
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

            {/* Saved views use their settings dialog; trash mode only exposes recovery actions. */}
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
              <RecordsAdminToolbar
                savedView={isSavedView()}
                activeViewAvailable={!!props.activeView}
                canEditActiveView={!!props.canEditActiveView}
                hiddenViewColumnCount={hiddenViewColumnCount()}
                formsButtonLabel={formsButtonLabel()}
                onOpenTableSettings={openTableSettings}
                onAddField={() => void openAddField()}
                onOpenForms={openForms}
                onOpenTemplates={openTemplates}
                onOpenViewSettings={openViewSettings}
                onAddViewColumn={openAddViewColumnDialog}
                onDone={() => setAdminModeAndUrl(false)}
              />
            </Show>

            <Show when={queryFailure()}>
              {(failure) => (
                <Placeholder
                  state="error"
                  surface="paper"
                  align="left"
                  title="Could not refresh records"
                  description={failure().error.message}
                  class="shrink-0 py-2"
                  action={
                    <button type="button" class="btn-input btn-input-sm" onClick={retryQuery}>
                      <i class="ti ti-refresh" aria-hidden="true" /> Retry
                    </button>
                  }
                />
              )}
            </Show>

            {/* DatabaseTable owns the single scroll context required by its sticky header. */}
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
                            hasMore={!props.trashMode && !!nextCursor()}
                            loadingMore={data.loading && !!cursor()}
                            onLoadMore={loadNextFlatPage}
                            scrollPreserveKey={`grids-records-${props.tableId}-${props.viewShortId ?? "default"}`}
                            adminMode={adminMode()}
                            onFieldSettings={adminMode() && !isSavedView() && props.canManageTable ? openFieldSettings : undefined}
                            onFieldMove={undefined}
                            onViewColumnSettings={
                              adminMode() && isSavedView() && props.canEditActiveView ? openViewColumnSettings : undefined
                            }
                            onViewColumnMove={
                              adminMode() && (isSavedView() ? props.canEditActiveView : props.canManageTable)
                                ? moveViewColumnInline
                                : undefined
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
                          fieldsByTable={{ ...(props.fieldsByTable ?? {}), [props.tableId]: fields() }}
                        />
                      </Show>
                    }
                  >
                    <RecordCardsView
                      items={items() as GridRecord[]}
                      fields={fields()}
                      displayConfig={displayConfig()}
                      filePreviews={filePreviews()}
                      baseId={props.baseShortId}
                      tableId={props.tableId}
                      tableShortIds={props.tableShortIds}
                      fieldsByTable={{ ...(props.fieldsByTable ?? {}), [props.tableId]: fields() }}
                      selectedId={selectedRecordId()}
                      highlightedIds={highlightedRecordIds()}
                      onRecordClick={onSelectRecord}
                      cardSize={cardSize()}
                      hasMore={!props.trashMode && !!nextCursor()}
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
        </div>
      </AppWorkspace.Main>

      <AppWorkspace.Detail id="record" open={hasOpenDetail()} width="lg" viewTransitionName="grids-record-detail">
        <Show when={selectedRecordId() || selectedGroup()}>
          <Show
            when={selectedGroup()}
            fallback={
              <Show
                when={!selectedRecordFailure()}
                fallback={
                  <Placeholder
                    state="error"
                    surface="paper"
                    title="Could not load record"
                    description={selectedRecordFailure()?.message}
                    class="h-full"
                    action={
                      <div class="flex items-center gap-1">
                        <button type="button" class="btn-input btn-input-sm" onClick={closeSelectedRecord}>
                          Close
                        </button>
                        <button
                          type="button"
                          class="btn-input btn-input-sm"
                          onClick={() => setSelectedRecordLoadAttempt((attempt) => attempt + 1)}
                        >
                          <i class="ti ti-refresh" aria-hidden="true" /> Retry
                        </button>
                      </div>
                    }
                  />
                }
              >
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
              </Show>
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
        </Show>
      </AppWorkspace.Detail>
    </AppWorkspace.Content>
  );
}
