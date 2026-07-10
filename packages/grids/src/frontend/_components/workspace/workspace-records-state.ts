import type { DateContext } from "@valentinkolb/stdlib";
import type { ComputedColumnSpec, GroupSortSpec, RecordDisplayConfig, RecordQuery } from "../../../contracts";
import { parseGridsQueryDsl } from "../../../query-dsl/parser";
import {
  type DslResolverContext,
  type DslResolverDiagnostic,
  type DslTableSource,
  type DslViewSource,
  resolveDslQueryToRecordQuery,
} from "../../../query-dsl/resolver";
import { collectDslFieldTableIds } from "../../../query-dsl/source-plan";
import type { DslQueryAst } from "../../../query-dsl/types";
import type { Field, GridRecord, Table, View, Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { filterSearchableFields } from "../../../service/search";
import { loadWorkflowCatalog, resolveWorkflowTableRef } from "../../../service/workflows";
import { activeDisplayConfig, calendarQueryFilter, cardImageFieldIds } from "../records-view/display-mode";
import { resolveEffectiveQuery } from "../records-view/effective-query";
import { parseRecordsState, type RecordsState } from "../records-view/query-url";
import { viewLevelForUser, workflowLevelForUser } from "./workspace-state-access";
import { buildViewer, okState } from "./workspace-state-helpers";
import type {
  AuthUser,
  GridsWorkspaceState,
  OkWorkspaceState,
  RuntimeView,
  WorkspaceCatalog,
  WorkspaceCommon,
  WorkspaceGroupBucket,
  WorkspaceRecordsRoute,
} from "./workspace-state-model";

type GroupByRaw = {
  fieldId: string;
  direction?: "asc" | "desc";
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

type AggregationRaw = {
  fieldId: string | "*";
  agg: "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max";
  label?: string;
};

const isComputedColumn = (column: NonNullable<RecordQuery["columns"]>[number]): column is ComputedColumnSpec =>
  "kind" in column && column.kind === "computed";

const diagnosticsMessage = (diagnostics: Array<Pick<DslResolverDiagnostic, "message">>) =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source";

const withViewPresentation = (query: RecordQuery, presentation: View["ui"] | undefined): RecordQuery => {
  if (!presentation) return query;
  return {
    ...query,
    ...(presentation.columns ? { columns: presentation.columns } : {}),
    ...(presentation.groupedColumnOrder ? { groupedColumnOrder: presentation.groupedColumnOrder } : {}),
    ...(presentation.hiddenGroupedColumns ? { hiddenGroupedColumns: presentation.hiddenGroupedColumns } : {}),
  };
};

const buildResolverContext = (catalog: WorkspaceCatalog, currentTableId: string, ast: DslQueryAst): DslResolverContext => {
  const tables: DslTableSource[] = catalog.tables.map((table) => ({
    kind: "table",
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  }));
  const views: DslViewSource[] = Object.values(catalog.viewsByTable)
    .flat()
    .map((view) => ({
      kind: "view" as const,
      id: view.id,
      shortId: view.shortId,
      name: view.name,
      tableId: view.tableId,
      source: view.source,
      query: {},
    }));
  const fieldTableIds = collectDslFieldTableIds({ ast, currentTableId, tables, views });
  const fieldsByTableId = Object.fromEntries(fieldTableIds.map((tableId) => [tableId, catalog.fieldsByTable[tableId] ?? []])) as Record<
    string,
    Field[]
  >;
  const currentTable = tables.find((table) => table.id === currentTableId);
  return {
    ...(currentTable ? { currentTable } : {}),
    tables,
    views,
    fieldsByTableId,
  };
};

const compileViewSource = (
  catalog: WorkspaceCatalog,
  activeTable: Table,
  view: View,
): { ok: true; query: RecordQuery } | { ok: false; diagnostics: Array<Pick<DslResolverDiagnostic, "message">> } => {
  const parsed = parseGridsQueryDsl(view.source);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const resolved = resolveDslQueryToRecordQuery(parsed.ast, buildResolverContext(catalog, activeTable.id, parsed.ast));
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  return { ok: true, query: withViewPresentation(resolved.plan.query, view.ui) };
};

const outputFieldsForQuery = (fields: Field[], query: RecordQuery): Field[] => {
  const ids = new Set<string>();
  for (const column of query.columns ?? []) {
    if ("fieldId" in column) ids.add(column.fieldId);
  }
  for (const group of query.groupBy ?? []) ids.add(group.fieldId);
  return ids.size === 0 ? fields : fields.filter((field) => ids.has(field.id));
};

const bulkSelectionWorkflowsForTable = async (user: AuthUser, baseId: string, tableId: string): Promise<Workflow[]> => {
  if (!gridsService.workflow?.listEnabledForBase) return [];
  const workflows = await gridsService.workflow.listEnabledForBase(baseId);
  const catalog = await loadWorkflowCatalog(baseId);
  const matches: Workflow[] = [];
  for (const workflow of workflows) {
    const bulk = workflow.compiled.triggers.bulkSelection;
    if (!bulk) continue;
    const input = workflow.compiled.inputs?.[bulk.input];
    if (!input || input.type !== "recordList" || !input.table) continue;
    const table = resolveWorkflowTableRef(catalog, input.table);
    if (!table || table.id !== tableId) continue;
    const level = await workflowLevelForUser(user, baseId, workflow.id);
    if (gridsService.permission.hasAtLeast(level, "write")) matches.push(workflow);
  }
  return matches.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
};

type InitialRecordsArgs = {
  activeTable: Table;
  fields: Field[];
  recordsState: RecordsState;
  activeView: RuntimeView | null;
  displayConfig: RecordDisplayConfig;
  trashMode: boolean;
  user: AuthUser;
  dateConfig?: DateContext;
};

const resolveInitialQuery = (recordsState: RecordsState, activeView: RuntimeView | null) => {
  const effective = resolveEffectiveQuery(recordsState, activeView);
  const effectiveFilter = effective.filter ?? null;
  const effectiveSort = effective.sort ?? [];
  const effectiveRecordMeta = effective.recordMeta ?? null;
  const effectiveIncludeDeleted = effective.includeDeleted ?? false;
  const effectiveSearch = effective.search
    ? { q: effective.search.q, fieldIds: effective.search.fieldIds ?? [], override: recordsState.search.override }
    : { q: "", fieldIds: [], override: recordsState.search.override };
  const effectiveGroupBy = (effective.groupBy ?? []) as GroupByRaw[];
  const effectiveGroupSort = (effective.groupSort ?? []) as GroupSortSpec[];
  const effectiveAggregations = (effective.aggregations ?? []).filter(
    (aggregation): aggregation is AggregationRaw =>
      aggregation.agg !== "median" && aggregation.agg !== "earliest" && aggregation.agg !== "latest",
  );
  const searchSpec = effective.search ?? null;
  const viewLimit = effective.limit;
  const effectiveLimit = viewLimit !== undefined ? Math.min(100, viewLimit) : 100;
  return {
    effective,
    effectiveFilter,
    effectiveSort,
    effectiveRecordMeta,
    effectiveIncludeDeleted,
    effectiveSearch,
    effectiveGroupBy,
    effectiveGroupSort,
    effectiveAggregations,
    searchSpec,
    viewLimit,
    effectiveLimit,
  };
};

const emptyInitialRecords = () => ({
  records: { items: [] as GridRecord[], nextCursor: null as string | null } as {
    items: GridRecord[];
    nextCursor: string | null;
    aggregates?: Record<string, unknown>;
    filePreviews?: Record<
      string,
      Record<string, { fileId: string; fieldId: string; recordId: string; filename: string; mimeType: string; sizeBytes: number }>
    >;
  },
  aggregates: {} as Record<string, unknown>,
  groupedBuckets: [] as WorkspaceGroupBucket[],
  groupedExplode: false,
  relationLabels: {} as Record<string, string>,
});

const loadGroupedInitialRecords = async (
  args: InitialRecordsArgs,
  query: ReturnType<typeof resolveInitialQuery>,
  viewer: ReturnType<typeof buildViewer>,
) => {
  const data = emptyInitialRecords();
  const groupResult = await gridsService.record.group({
    tableId: args.activeTable.id,
    groupBy: query.effectiveGroupBy,
    aggregations: query.effectiveAggregations,
    groupSort: query.effectiveGroupSort,
    filter: query.effectiveFilter,
    recordMeta: query.effectiveRecordMeta,
    search: query.effectiveSearch.q ? { q: query.effectiveSearch.q, fieldIds: query.effectiveSearch.fieldIds } : null,
    limit: 1000,
    viewer,
    dateConfig: args.dateConfig,
  });
  if (!groupResult.ok) return data;

  data.groupedBuckets = groupResult.data.buckets as WorkspaceGroupBucket[];
  data.groupedExplode = groupResult.data.explode;
  data.relationLabels = await gridsService.relations.buildLabelCacheForGroupedKeys(
    data.groupedBuckets,
    query.effectiveGroupBy.map((group) => group.fieldId),
    args.fields,
    viewer,
  );
  return data;
};

const loadListedInitialRecords = async (
  args: InitialRecordsArgs,
  query: ReturnType<typeof resolveInitialQuery>,
  viewer: ReturnType<typeof buildViewer>,
) => {
  const data = emptyInitialRecords();
  const listResult = await gridsService.record.list({
    tableId: args.activeTable.id,
    limit: query.effectiveLimit,
    includeDeleted: query.effectiveIncludeDeleted,
    deletedOnly: args.trashMode,
    filter: query.effectiveFilter,
    search: query.searchSpec,
    recordMeta: query.effectiveRecordMeta,
    sort: query.effectiveSort,
    cursor: args.recordsState.cursor,
    includeRelations: true,
    viewer,
    dateConfig: args.dateConfig,
    computedColumns: query.effective.columns?.filter(isComputedColumn),
    filePreviewFieldIds: cardImageFieldIds(args.displayConfig),
  });
  if (listResult.ok) {
    data.records = query.viewLimit !== undefined ? { ...listResult.data, nextCursor: null } : listResult.data;
    data.aggregates = data.records.aggregates ?? {};
  }
  data.relationLabels = await gridsService.relations.buildLabelCache(data.records.items, args.fields);
  if (args.trashMode || args.fields.length === 0 || query.effectiveAggregations.length === 0) return data;

  const aggregateResult = await gridsService.record.aggregate({
    tableId: args.activeTable.id,
    filter: query.effectiveFilter,
    search: query.searchSpec,
    recordMeta: query.effectiveRecordMeta,
    includeDeleted: query.effectiveIncludeDeleted,
    deletedOnly: args.trashMode,
    requests: query.effectiveAggregations.map((aggregation) => ({ fieldId: aggregation.fieldId, agg: aggregation.agg })),
    viewer,
    dateConfig: args.dateConfig,
  });
  if (aggregateResult.ok) data.aggregates = { ...data.aggregates, ...aggregateResult.data };
  return data;
};

const loadInitialRecords = async (args: InitialRecordsArgs) => {
  const query = resolveInitialQuery(args.recordsState, args.activeView);
  query.effectiveFilter =
    calendarQueryFilter({
      baseFilter: query.effectiveFilter ?? undefined,
      fields: args.fields,
      displayConfig: args.displayConfig,
      calendar: args.recordsState.calendar,
      dateConfig: args.dateConfig,
    }) ?? null;
  query.effective.filter = query.effectiveFilter ?? undefined;
  if (args.displayConfig.mode === "calendar" && query.viewLimit === undefined) query.effectiveLimit = 500;
  const viewer = buildViewer(args.user);
  const data =
    query.effectiveGroupBy.length > 0 && !args.trashMode
      ? await loadGroupedInitialRecords(args, query, viewer)
      : await loadListedInitialRecords(args, query, viewer);
  return { ...query, ...data };
};

const selectedRecordMeta = (
  recordMeta: RecordQuery["recordMeta"] | null,
  selectedRecordId: string,
): NonNullable<RecordQuery["recordMeta"]> | null => {
  if (recordMeta?.ids?.length && !recordMeta.ids.includes(selectedRecordId)) return null;
  return { ...(recordMeta ?? {}), ids: [selectedRecordId] };
};

const loadSelectedRecordThroughView = async (params: {
  activeTable: Table;
  selectedRecordId: string;
  initial: Awaited<ReturnType<typeof loadInitialRecords>>;
  user: AuthUser;
  trashMode: boolean;
  dateConfig?: DateContext;
}): Promise<GridRecord | null> => {
  const recordMeta = selectedRecordMeta(params.initial.effectiveRecordMeta, params.selectedRecordId);
  if (!recordMeta) return null;
  const result = await gridsService.record.list({
    tableId: params.activeTable.id,
    limit: 1,
    includeDeleted: params.initial.effectiveIncludeDeleted,
    deletedOnly: params.trashMode,
    filter: params.initial.effectiveFilter,
    search: params.initial.searchSpec,
    recordMeta,
    sort: [],
    cursor: null,
    includeRelations: true,
    viewer: buildViewer(params.user),
    dateConfig: params.dateConfig,
    computedColumns: params.initial.effective.columns?.filter(isComputedColumn),
  });
  if (!result.ok) return null;
  return result.data.items.find((record) => record.id === params.selectedRecordId) ?? null;
};

type ResolvedRecordsView = {
  activeTableLevel: "none" | "read" | "write" | "admin";
  activeView: View | null;
  activeViewForQuery: RuntimeView | null;
  canEditActiveView: boolean;
  fields: Field[];
};

const resolveRecordsView = async (
  common: WorkspaceCommon,
  activeTable: Table,
  activeViewSlug?: string | null,
): Promise<ResolvedRecordsView | Extract<GridsWorkspaceState, { kind: "invalidQuery" }>> => {
  const activeTableLevel = common.catalog.tableLevels[activeTable.id] ?? "none";
  const viewsForTable = common.catalog.viewsByTable[activeTable.id] ?? [];
  const candidateView = activeViewSlug ? await gridsService.view.getByIdOrShortId(activeTable.id, activeViewSlug) : null;
  const catalogView = candidateView ? (viewsForTable.find((view) => view.id === candidateView.id) ?? null) : null;
  const candidateViewLevel = candidateView
    ? await viewLevelForUser(common.params.user, common.base.id, activeTable.id, candidateView.id)
    : "none";
  const activeView =
    catalogView ?? (candidateView && gridsService.permission.hasAtLeast(candidateViewLevel, "read") ? candidateView : null);
  const allFields =
    common.catalog.fieldsByTable[activeTable.id] ?? (activeView ? await gridsService.field.listByTable(activeTable.id) : []);
  const viewCompilerCatalog: WorkspaceCatalog =
    activeView && !catalogView
      ? {
          ...common.catalog,
          tables: common.catalog.tables.some((table) => table.id === activeTable.id)
            ? common.catalog.tables
            : [...common.catalog.tables, activeTable],
          tableLevels: { ...common.catalog.tableLevels, [activeTable.id]: activeTableLevel },
          fieldsByTable: { ...common.catalog.fieldsByTable, [activeTable.id]: allFields },
          viewsByTable: { ...common.catalog.viewsByTable, [activeTable.id]: [activeView] },
        }
      : common.catalog;
  const compiledView = activeView ? compileViewSource(viewCompilerCatalog, activeTable, activeView) : null;
  if (compiledView && !compiledView.ok) {
    return {
      kind: "invalidQuery",
      title: "Invalid view GQL source",
      message: diagnosticsMessage(compiledView.diagnostics),
    };
  }
  const activeViewForQuery: RuntimeView | null =
    activeView && compiledView?.ok
      ? {
          ...activeView,
          query: compiledView.query,
          displayConfig: activeView.ui.displayConfig ?? { mode: "table" },
        }
      : null;
  return {
    activeTableLevel,
    activeView,
    activeViewForQuery,
    canEditActiveView:
      !!activeView && (activeView.ownerUserId === common.params.user.id || gridsService.permission.hasAtLeast(candidateViewLevel, "admin")),
    fields: activeViewForQuery ? outputFieldsForQuery(allFields, activeViewForQuery.query) : allFields,
  };
};

const loadSelectedRecord = async (params: {
  common: WorkspaceCommon;
  activeTable: Table;
  view: ResolvedRecordsView;
  recordsState: RecordsState;
  initial: Awaited<ReturnType<typeof loadInitialRecords>>;
}): Promise<GridRecord | null> => {
  const selectedRecordId = params.recordsState.selectedRecordId;
  if (!selectedRecordId) return null;
  const listedRecord = params.initial.records.items.find((record) => record.id === selectedRecordId);
  if (listedRecord) return listedRecord;
  if (params.view.activeViewForQuery && !gridsService.permission.hasAtLeast(params.view.activeTableLevel, "read")) {
    return loadSelectedRecordThroughView({
      activeTable: params.activeTable,
      selectedRecordId,
      initial: params.initial,
      user: params.common.params.user,
      trashMode: params.common.chrome.trashMode,
      dateConfig: params.common.params.dateConfig,
    });
  }
  return gridsService.record.get(params.activeTable.id, selectedRecordId, { dateConfig: params.common.params.dateConfig });
};

const buildRecordsRoute = async (params: {
  common: WorkspaceCommon;
  activeTable: Table;
  view: ResolvedRecordsView;
  recordsState: RecordsState;
  displayConfig: RecordDisplayConfig;
  initial: Awaited<ReturnType<typeof loadInitialRecords>>;
  selectedRecord: GridRecord | null;
}): Promise<WorkspaceRecordsRoute> => {
  const { common, activeTable, view, recordsState, displayConfig, initial, selectedRecord } = params;
  return {
    kind: "records",
    activeTable,
    activeView: view.activeViewForQuery,
    fields: view.fields,
    formsForTable: gridsService.permission.hasAtLeast(view.activeTableLevel, "read")
      ? (common.catalog.formsByTable[activeTable.id] ?? [])
      : [],
    canWriteRecords: gridsService.permission.hasAtLeast(view.activeTableLevel, "write"),
    canManageActiveTable: gridsService.permission.hasAtLeast(view.activeTableLevel, "admin"),
    activeTableAccessEntries: gridsService.permission.hasAtLeast(view.activeTableLevel, "admin")
      ? await gridsService.access.listForTable(activeTable.id)
      : [],
    activeFormAccessEntries: common.catalog.formAccessEntriesByTable[activeTable.id] ?? {},
    activeViewAccessEntries: view.activeView && view.canEditActiveView ? await gridsService.access.listForView(view.activeView.id) : [],
    canEditActiveView: view.canEditActiveView,
    otherTables: common.catalog.tables.map((table) => ({ id: table.id, name: table.name })),
    initialState: {
      query: {
        filter: initial.effectiveFilter ?? undefined,
        recordMeta: initial.effectiveRecordMeta ?? undefined,
        sort: initial.effectiveSort,
        groupBy: initial.effectiveGroupBy,
        aggregations: initial.effectiveAggregations,
        columns: initial.effective.columns,
        includeDeleted: initial.effectiveIncludeDeleted,
        deletedOnly: common.chrome.trashMode,
      },
      cursor: recordsState.cursor,
      selectedRecordId: recordsState.selectedRecordId,
      search: initial.effectiveSearch,
      calendar: recordsState.calendar,
      cardSize: recordsState.cardSize,
    },
    initialData: {
      items: initial.records.items,
      buckets: initial.groupedBuckets,
      aggregates: initial.aggregates,
      nextCursor: initial.records.nextCursor,
      explode: initial.groupedExplode,
      filePreviews: initial.records.filePreviews,
    },
    initialSelectedRecord: selectedRecord,
    relationLabels: initial.relationLabels,
    activeViewColumns: initial.effective.columns,
    searchableFields: filterSearchableFields(view.fields),
    groupedExplode: initial.groupedExplode,
    activeRecordQuery: view.activeViewForQuery?.query ?? null,
    displayConfig,
    bulkSelectionWorkflows: await bulkSelectionWorkflowsForTable(common.params.user, common.base.id, activeTable.id),
  };
};

export const loadRecordsState = async (
  common: WorkspaceCommon,
  activeTable: Table,
  activeViewSlug?: string | null,
): Promise<OkWorkspaceState | Extract<GridsWorkspaceState, { kind: "invalidQuery" }>> => {
  const view = await resolveRecordsView(common, activeTable, activeViewSlug);
  if ("kind" in view) return view;
  const recordsState = parseRecordsState(common.chrome.url.searchParams);
  const displayConfig = activeDisplayConfig(activeTable.displayConfig, view.activeViewForQuery?.displayConfig);
  const initial = await loadInitialRecords({
    activeTable,
    fields: view.fields,
    recordsState,
    activeView: view.activeViewForQuery,
    displayConfig,
    trashMode: common.chrome.trashMode,
    user: common.params.user,
    dateConfig: common.params.dateConfig,
  });
  const selectedRecord = await loadSelectedRecord({ common, activeTable, view, recordsState, initial });
  const route = await buildRecordsRoute({ common, activeTable, view, recordsState, displayConfig, initial, selectedRecord });
  return okState(common, route, [
    ...common.chrome.titleBase,
    ...(view.activeView
      ? [
          {
            title: activeTable.name,
            href: "/app/grids/" + common.base.shortId + "/table/" + activeTable.shortId,
          },
          { title: view.activeView.name },
        ]
      : [{ title: activeTable.name }]),
  ]);
};
