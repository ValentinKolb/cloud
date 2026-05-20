import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Dropdown, dialogCore, prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { AggregationSpec, GroupBySpec, TableQueryResult, ViewQuery } from "../../../contracts";
import type { Field, Form, GridRecord, Table, View } from "../../../service";
import type { ColumnSpec } from "../../../service/views";
import { defaultTableAggregations } from "../../../table-defaults";
import { GridsBareDialog, gridsBareDialogOptions } from "../dialogs/dialog-layout";
import { createFieldFromPrompt, deleteFieldWithChecks, openFormsDialog, openTableSettingsDialog } from "../dialogs/TableAdminDialogs";
import { openViewColumnSettingsDialog } from "../dialogs/ViewColumnSettingsDialog";
import { openViewSettingsDialog } from "../dialogs/ViewSettingsDialogs";
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
import { buildRecordsUrl, parseRecordsState, type RecordsState } from "./query-url";

/** UI-supported agg kinds — narrower than the contract's AggregateKind
 *  (which also has median/earliest/latest, currently SQL-only). When a
 *  saved view stores one of those, the toolbar simply won't render it
 *  as an editable row. */
const UI_AGG_KINDS: ReadonlySet<AggKindUI> = new Set(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);

const ADMIN_BUTTON_CLASS = "btn-input-success btn-input-sm";

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
  tableColumns: ColumnSpec[];
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
};

export default function RecordsView(props: Props) {
  // ── Canonical state ────────────────────────────────────────────────
  const [tableName, setTableName] = createSignal(props.tableName);
  const [tableDescription, setTableDescription] = createSignal(props.tableDescription);
  const [tableIcon, setTableIcon] = createSignal(props.tableIcon ?? null);
  const [tableColumns, setTableColumns] = createSignal<ColumnSpec[]>(props.tableColumns);
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
    !isGrouped() ? (isSavedView() ? (viewColumns() ?? defaultViewColumns()) : defaultViewColumns()) : undefined;

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
  const queryWithSearch = (): ViewQuery => {
    const { search: _savedSearch, ...baseQuery } = query();
    const q = search().q.trim();
    if (!q) return baseQuery;
    return { ...baseQuery, search: { q, fieldIds: search().fieldIds } };
  };
  const [data, { refetch }] = createResource(
    () => ({ tableId: props.tableId, query: queryWithSearch(), cursor: cursor() }),
    (args) => fetchTableQuery(args),
    { initialValue: props.initialData },
  );

  const [flatItems, setFlatItems] = createSignal<GridRecord[]>(props.initialData.items ?? []);
  const [flatNextCursor, setFlatNextCursor] = createSignal<string | null>(props.initialData.nextCursor ?? null);
  let didApplyFirstFlatPage = false;

  createEffect(() => {
    const response = data();
    if (!response || isGrouped()) return;
    const pageItems = (response.items ?? []) as GridRecord[];
    setFlatNextCursor(response.nextCursor ?? null);
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
  createMemo(() => {
    const id = selectedRecordId();
    if (!id) {
      setFetchedSelected(null);
      return;
    }
    if (selectedRecord()) return; // already resolved
    apiClient.records[":tableId"][":recordId"].$get({ param: { tableId: props.tableId, recordId: id } }).then(async (res) => {
      if (!res.ok) return;
      const rec = (await res.json()) as GridRecord;
      setFetchedSelected(() => rec);
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
    setSearch({ ...next, override: true });
    setSelectedGroup(null);
    setCursor(null);
    syncUrl({ replace: true });
  };

  const loadNextFlatPage = () => {
    const next = flatNextCursor();
    if (!next || data.loading || isGrouped()) return;
    setCursor(next);
  };

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
    setSelectedRecordId(null);
    syncUrl({ replace: true });
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
      viewColumns: effectiveViewColumns(),
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
      otherTables: props.otherTables,
      fieldsByTable: { ...props.fieldsByTable, [props.tableId]: fields() },
      tableColumns: effectiveViewColumns(),
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
      const table = (await res.json()) as Pick<Table, "columns">;
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
      const current = (await cur.json()) as View;
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: view.id },
        json: { query: { ...current.query, ...patch } },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save view columns"));
      return (await res.json()) as View;
    },
    onSuccess: (view) => {
      setViewColumns(view.query.columns);
      setQuery((prev) => ({
        ...prev,
        groupBy: view.query.groupBy,
        aggregations: view.query.aggregations,
        groupedColumnOrder: view.query.groupedColumnOrder,
        hiddenGroupedColumns: view.query.hiddenGroupedColumns,
      }));
    },
    onError: (e) => prompts.error(e.message),
  });

  const patchTableColumnsMut = mutations.create<Table, ColumnSpec[]>({
    mutation: async (columns) => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.tableId },
        json: { columns: columns.map(cleanViewColumn) },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table columns"));
      return (await res.json()) as Table;
    },
    onSuccess: (table) => setTableColumns(table.columns),
    onError: (e) => prompts.error(e.message),
  });

  const cleanViewColumn = (column: ColumnSpec): ColumnSpec => ({
    fieldId: column.fieldId,
    ...(column.label?.trim() ? { label: column.label.trim() } : {}),
    ...(column.format ? { format: column.format } : {}),
  });

  const persistFlatViewColumns = (columns: ColumnSpec[]) => {
    if (isSavedView()) patchViewQueryMut.mutate({ columns: columns.map(cleanViewColumn) });
    else patchTableColumnsMut.mutate(columns);
  };

  const moveViewColumnInline = (field: Field, direction: -1 | 1) => {
    const current = effectiveViewColumns();
    if (!current) return;
    const index = current.findIndex((column) => column.fieldId === field.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    persistFlatViewColumns(next);
  };

  const openViewColumnSettings = async (field: Field) => {
    const current = effectiveViewColumns()?.find((column) => column.fieldId === field.id);
    if (!current) return;
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
      persistFlatViewColumns((effectiveViewColumns() ?? []).filter((column) => column.fieldId !== field.id));
      return;
    }
    persistFlatViewColumns(
      (effectiveViewColumns() ?? []).map((column) =>
        column.fieldId === field.id ? cleanViewColumn({ ...column, label: result.label, format: result.format }) : column,
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
    const visibleIds = new Set((effectiveViewColumns() ?? []).map((column) => column.fieldId));
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
    dialogCore.open<void>(
      (close) => (
        <GridsBareDialog title="Add column" icon="ti ti-plus" close={() => close()}>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <section class="paper p-2">
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <For each={columns}>
                  {(column) => (
                    <button
                      type="button"
                      class="paper p-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      onClick={() => {
                        column.add();
                        close();
                      }}
                    >
                      <div class="flex items-start gap-3">
                        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
                          <i class={`${column.icon} text-sm`} />
                        </span>
                        <span class="min-w-0">
                          <span class="block truncate text-sm font-semibold text-primary">{column.label}</span>
                          <span class="mt-0.5 block text-xs text-dimmed">{column.description}</span>
                        </span>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </section>
          </div>
        </GridsBareDialog>
      ),
      gridsBareDialogOptions,
    );
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
              currentSearch={search()}
              forms={forms()}
              canWrite={props.canWrite}
              onCommit={onToolbarCommit}
              onRecordCreated={onRecordCreated}
              onRecordsChanged={() => void refetch()}
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
                onRecordClick={onSelectRecord}
                viewColumns={effectiveViewColumns()}
                aggregates={props.trashMode ? {} : aggregates()}
                aggregationSpecs={tableAggregationSpecs()}
                hasMore={!props.trashMode && !!flatNextCursor()}
                loadingMore={data.loading && !!cursor()}
                onLoadMore={loadNextFlatPage}
                adminMode={adminMode()}
                onFieldSettings={adminMode() && !isSavedView() && props.canManageTable ? openFieldSettings : undefined}
                onFieldMove={undefined}
                onViewColumnSettings={adminMode() && isSavedView() && props.canEditActiveView ? openViewColumnSettings : undefined}
                onViewColumnMove={
                  adminMode() && (isSavedView() ? props.canEditActiveView : props.canManageTable) ? moveViewColumnInline : undefined
                }
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
              onColumnSettings={openGroupedViewColumnSettings}
              onColumnMove={moveGroupedViewColumnInline}
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
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
