import type { DateContext } from "@valentinkolb/stdlib";
import type { RecordDisplayConfig, RecordQuery } from "../../../contracts";
import type { DslResolverDiagnostic } from "../../../query-dsl/resolver";
import type { Field, GridRecord, Table, View, Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { filterSearchableFields } from "../../../service/search";
import { loadWorkflowCatalog, resolveWorkflowTableRef } from "../../../service/workflows";
import { activeDisplayConfig } from "../records-view/display-mode";
import { parseRecordsState, type RecordsState } from "../records-view/query-url";
import { compileViewSource, isComputedColumn, loadInitialRecords, outputFieldsForQuery } from "./workspace-records-query";
import { viewLevelForUser, workflowLevelForUser } from "./workspace-state-access";
import { buildViewer, okState } from "./workspace-state-helpers";
import type {
  AuthUser,
  GridsWorkspaceState,
  OkWorkspaceState,
  RuntimeView,
  WorkspaceCatalog,
  WorkspaceCommon,
  WorkspaceRecordsRoute,
} from "./workspace-state-model";

const diagnosticsMessage = (diagnostics: Array<Pick<DslResolverDiagnostic, "message">>) =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source";

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
        groupSort: initial.effectiveGroupSort,
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
