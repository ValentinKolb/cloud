import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import type {
  ComputedColumnSpec,
  DslQueryPreviewResponse,
  GroupSortSpec,
  RecordDisplayConfig,
  RecordQuery,
} from "../../../contracts";
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
import type { Automation, Base, Dashboard, Field, Form, GridRecord, Table, View } from "../../../service";
import { gridsService } from "../../../service";
import { resolveWidgetData, type WidgetData } from "../../../service/dashboard-widget-data";
import { filterSearchableFields } from "../../../service/search";
import { activeDisplayConfig, calendarQueryFilter, cardImageFieldIds } from "../records-view/display-mode";
import { resolveEffectiveQuery } from "../records-view/effective-query";
import { parseRecordsState, type RecordsState } from "../records-view/query-url";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

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

export type WorkspaceGroupBucket = {
  keys: unknown[];
  values: Record<string, unknown>;
};

export type WorkspaceCatalog = {
  dashboards: Dashboard[];
  tables: Table[];
  tableLevels: Record<string, "none" | "read" | "write" | "admin">;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  formAccessEntriesByTable: Record<string, Record<string, AccessEntry[]>>;
  tableShortIds: Record<string, string>;
  sidebarForms: Array<{ form: Form; table: Table }>;
};

type RuntimeView = View & {
  query: RecordQuery;
  displayConfig: RecordDisplayConfig;
};

export type WorkspaceRecordsRoute = {
  kind: "records";
  activeTable: Table;
  activeView: RuntimeView | null;
  fields: Field[];
  formsForTable: Form[];
  canWriteRecords: boolean;
  canManageActiveTable: boolean;
  activeTableAccessEntries: AccessEntry[];
  activeFormAccessEntries: Record<string, AccessEntry[]>;
  activeViewAccessEntries: AccessEntry[];
  canEditActiveView: boolean;
  otherTables: Array<{ id: string; name: string }>;
  initialState: RecordsState;
  initialData: {
    items?: GridRecord[];
    buckets?: WorkspaceGroupBucket[];
    aggregates?: Record<string, unknown>;
    nextCursor: string | null;
    explode?: boolean;
    filePreviews?: Record<
      string,
      Record<string, { fileId: string; fieldId: string; recordId: string; filename: string; mimeType: string; sizeBytes: number }>
    >;
  };
  initialSelectedRecord: GridRecord | null;
  relationLabels: Record<string, string>;
  activeViewColumns: RecordQuery["columns"] | undefined;
  searchableFields: Field[];
  groupedExplode: boolean;
  activeRecordQuery: RecordQuery | null;
  displayConfig: RecordDisplayConfig;
};

export type WorkspaceDashboardRoute = {
  kind: "dashboard";
  dashboard: Dashboard;
  widgetData: Record<string, WidgetData>;
  recordLiveTableIds?: string[];
  activeDashboardAccessEntries: AccessEntry[];
  canEditActiveDashboard: boolean;
  isBaseDefault: boolean;
  manualAutomations: Automation[];
};

export type WorkspaceEmptyRoute = {
  kind: "empty";
};

export type WorkspaceAutomationsRoute = {
  kind: "automations";
};

export type WorkspaceQueryRoute = {
  kind: "query";
  initialQuery: string;
  initialPreview?: DslQueryPreviewResponse | null;
  queryPath: string;
  currentSource?:
    | { kind: "table"; tableId: string; label: string; ref: string }
    | { kind: "view"; viewId: string; label: string; ref: string };
};

export type GridsWorkspaceRoute =
  | WorkspaceRecordsRoute
  | WorkspaceDashboardRoute
  | WorkspaceAutomationsRoute
  | WorkspaceQueryRoute
  | WorkspaceEmptyRoute;

export type GridsWorkspaceState =
  | { kind: "notFound"; title: string; message: string }
  | { kind: "accessDenied"; title: string; message: string }
  | { kind: "invalidQuery"; title: string; message: string }
  | {
      kind: "ok";
      base: Base;
      baseShortId: string;
      title: Array<{ title: string; href?: string }>;
      rememberPath: string;
      adminModeRequested: boolean;
      editModeToggleHref: string;
      canManageBase: boolean;
      canCreateTables: boolean;
      canUseEditMode: boolean;
      canUseQueryWorkspace: boolean;
      dateConfig?: DateContext;
      catalog: WorkspaceCatalog;
      route: GridsWorkspaceRoute;
    };

const resolveBaseLevel = async (user: AuthUser, baseId: string) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
  });
  return gridsService.permission.resolve(grants, { baseId });
};

const urlWithParam = (href: string, key: string, value: string) => {
  const url = new URL(href, "http://grids.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
};

const urlWithoutParams = (href: string, keys: string[]) => {
  const url = new URL(href, "http://grids.local");
  for (const key of keys) url.searchParams.delete(key);
  return `${url.pathname}${url.search}`;
};

const loadFormAccessEntriesByTable = async (
  tables: Table[],
  tableLevels: Record<string, "none" | "read" | "write" | "admin">,
  formsByTable: Record<string, Form[]>,
) => {
  const formAccessEntriesByTable: Record<string, Record<string, AccessEntry[]>> = {};
  await Promise.all(
    tables
      .filter((t) => gridsService.permission.hasAtLeast(tableLevels[t.id] ?? "none", "admin"))
      .map(async (t) => {
        const entries: Record<string, AccessEntry[]> = {};
        await Promise.all(
          (formsByTable[t.id] ?? [])
            .filter((form) => !form.isDefault)
            .map(async (form) => {
              entries[form.id] = await gridsService.access.listForForm(form.id);
            }),
        );
        formAccessEntriesByTable[t.id] = entries;
      }),
  );
  return formAccessEntriesByTable;
};

type LoadWorkspaceParams = {
  user: AuthUser;
  baseShortId: string;
  href: string;
  activeTableSlug?: string | null;
  activeViewSlug?: string | null;
  activeDashboardSlug?: string | null;
  dateConfig?: DateContext;
};

type WorkspaceChrome = {
  url: URL;
  adminModeRequested: boolean;
  trashMode: boolean;
  rememberPath: string;
  editModeToggleHref: string;
  titleBase: Array<{ title: string; href?: string }>;
};

type WorkspaceCommon = {
  params: LoadWorkspaceParams;
  base: Base;
  chrome: WorkspaceChrome;
  catalog: WorkspaceCatalog;
  canManageBase: boolean;
  canCreateTables: boolean;
  canUseEditMode: boolean;
  canUseQueryWorkspace: boolean;
};

type OkWorkspaceState = Extract<GridsWorkspaceState, { kind: "ok" }>;

const buildViewer = (user: AuthUser) => ({
  userId: user.id,
  userGroups: user.memberofGroupIds,
  isAdmin: hasRole(user, "admin"),
});

const buildChrome = (href: string, base: Base): WorkspaceChrome => {
  const url = new URL(href, "http://grids.local");
  const adminModeRequested = url.searchParams.get("edit") === "true";
  const trashMode = url.searchParams.get("trash") === "1";
  const currentPath = `${url.pathname}${url.search}`;
  const rememberPath = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeOnHref = urlWithParam(urlWithoutParams(currentPath, ["form"]), "edit", "true");
  const editModeOffHref = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeToggleHref = adminModeRequested ? editModeOffHref : editModeOnHref;
  return {
    url,
    adminModeRequested,
    trashMode,
    rememberPath,
    editModeToggleHref,
    titleBase: [
      { title: "Start", href: "/" },
      { title: "Grids", href: "/app/grids" },
      { title: base.name, href: `/app/grids/${base.shortId}` },
    ],
  };
};

const loadCatalog = async (baseId: string, user: AuthUser): Promise<WorkspaceCatalog> => {
  const catalogRaw = await gridsService.base.catalog({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    isAdmin: hasRole(user, "admin"),
  });
  const tables = catalogRaw.tables;
  const formTables = catalogRaw.formTables ?? [];
  const tableById = Object.fromEntries([...tables, ...formTables].map((t) => [t.id, t]));
  const sidebarForms: Array<{ form: Form; table: Table }> = [];
  for (const { form, tableId } of catalogRaw.sidebarForms) {
    const table = tableById[tableId];
    if (table) sidebarForms.push({ form, table });
  }
  sidebarForms.sort((a, b) => a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }));

  const formAccessEntriesByTable = await loadFormAccessEntriesByTable(tables, catalogRaw.tableLevels, catalogRaw.formsByTable);
  return {
    dashboards: catalogRaw.dashboards,
    tables,
    tableLevels: catalogRaw.tableLevels,
    fieldsByTable: catalogRaw.fieldsByTable,
    viewsByTable: catalogRaw.viewsByTable,
    formsByTable: catalogRaw.formsByTable,
    formAccessEntriesByTable,
    tableShortIds: Object.fromEntries([...tables, ...formTables].map((t) => [t.id, t.shortId])),
    sidebarForms,
  };
};

const canUseEditModeForCatalog = (catalog: WorkspaceCatalog, user: AuthUser, canManageBase: boolean, canCreateTables: boolean) =>
  canCreateTables ||
  catalog.tables.some((t) => gridsService.permission.hasAtLeast(catalog.tableLevels[t.id] ?? "none", "admin")) ||
  catalog.dashboards.some((d) => d.ownerUserId === user.id || (d.ownerUserId === null && canManageBase));

const okState = (common: WorkspaceCommon, route: GridsWorkspaceRoute, title = common.chrome.titleBase): OkWorkspaceState => ({
  kind: "ok",
  base: common.base,
  baseShortId: common.base.shortId,
  title,
  rememberPath: common.chrome.rememberPath,
  adminModeRequested: common.chrome.adminModeRequested,
  editModeToggleHref: common.chrome.editModeToggleHref,
  canManageBase: common.canManageBase,
  canCreateTables: common.canCreateTables,
  canUseEditMode: common.canUseEditMode,
  canUseQueryWorkspace: common.canUseQueryWorkspace,
  dateConfig: common.params.dateConfig,
  catalog: common.catalog,
  route,
});

const resolveActiveDashboard = async (params: LoadWorkspaceParams, base: Base, dashboards: Dashboard[]) => {
  const explicit = params.activeDashboardSlug ? await gridsService.dashboard.getByIdOrShortId(base.id, params.activeDashboardSlug) : null;
  if (params.activeTableSlug || explicit || !base.defaultDashboardId) return explicit;

  const defaultDashboard = await gridsService.dashboard.get(base.defaultDashboardId);
  if (defaultDashboard && defaultDashboard.deletedAt === null) return defaultDashboard;
  return null;
};

const loadDashboardState = async (common: WorkspaceCommon, dashboard: Dashboard): Promise<OkWorkspaceState> => {
  const widgets = dashboard.config.rows.flatMap((r) => r.cells);
  const results = await Promise.all(
    widgets.map((w) =>
      resolveWidgetData(w, buildViewer(common.params.user), { dateConfig: common.params.dateConfig }).then((data) => [w.id, data] as const),
    ),
  );
  const widgetData = Object.fromEntries(results);
  const canEditActiveDashboard =
    dashboard.ownerUserId === common.params.user.id || (dashboard.ownerUserId === null && common.canManageBase);
  const manualAutomations =
    common.canManageBase && common.chrome.adminModeRequested
      ? (await gridsService.automation.listForBase(common.base.id)).filter((automation) => automation.trigger.kind === "manual")
      : [];

  return okState(common, {
    kind: "dashboard",
    dashboard,
    widgetData,
    recordLiveTableIds: await gridsService.dashboard.sourceTableIds(dashboard),
    activeDashboardAccessEntries: canEditActiveDashboard ? await gridsService.access.listForDashboard(dashboard.id) : [],
    canEditActiveDashboard,
    isBaseDefault: common.base.defaultDashboardId === dashboard.id,
    manualAutomations,
  });
};

const gqlDiagnosticsMessage = (diagnostics: Array<Pick<DslResolverDiagnostic, "message">>) =>
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

const buildWorkspaceGqlResolverContext = (catalog: WorkspaceCatalog, currentTableId: string, ast: DslQueryAst): DslResolverContext => {
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

const compileWorkspaceViewSource = (
  catalog: WorkspaceCatalog,
  activeTable: Table,
  view: View,
): { ok: true; query: RecordQuery } | { ok: false; diagnostics: Array<Pick<DslResolverDiagnostic, "message">> } => {
  const parsed = parseGridsQueryDsl(view.source);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const context = buildWorkspaceGqlResolverContext(catalog, activeTable.id, parsed.ast);
  const resolved = resolveDslQueryToRecordQuery(parsed.ast, context);
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  return { ok: true, query: withViewPresentation(resolved.plan.query, view.ui) };
};

const outputFieldsForRecordQuery = (fields: Field[], query: RecordQuery): Field[] => {
  const ids = new Set<string>();
  for (const column of query.columns ?? []) {
    if ("fieldId" in column) ids.add(column.fieldId);
  }
  for (const group of query.groupBy ?? []) ids.add(group.fieldId);
  return ids.size === 0 ? fields : fields.filter((field) => ids.has(field.id));
};

const viewLevelForUser = async (user: AuthUser, baseId: string, tableId: string, viewId: string) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
    tableId,
    viewId,
  });
  return gridsService.permission.resolve(grants, { baseId, tableId, viewId });
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
    (a): a is AggregationRaw => a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
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
    query.effectiveGroupBy.map((g) => g.fieldId),
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

  const aggResult = await gridsService.record.aggregate({
    tableId: args.activeTable.id,
    filter: query.effectiveFilter,
    search: query.searchSpec,
    recordMeta: query.effectiveRecordMeta,
    includeDeleted: query.effectiveIncludeDeleted,
    deletedOnly: args.trashMode,
    requests: query.effectiveAggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
    viewer,
    dateConfig: args.dateConfig,
  });
  if (aggResult.ok) data.aggregates = { ...data.aggregates, ...aggResult.data };
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

  return {
    ...query,
    ...data,
  };
};

const loadRecordsState = async (
  common: WorkspaceCommon,
  activeTable: Table,
  activeViewSlug?: string | null,
): Promise<OkWorkspaceState | Extract<GridsWorkspaceState, { kind: "invalidQuery" }>> => {
  const activeTableLevel = common.catalog.tableLevels[activeTable.id] ?? "none";
  const viewsForTable = common.catalog.viewsByTable[activeTable.id] ?? [];
  const candidateView = activeViewSlug ? await gridsService.view.getByIdOrShortId(activeTable.id, activeViewSlug) : null;
  const catalogView = candidateView ? (viewsForTable.find((v) => v.id === candidateView.id) ?? null) : null;
  const candidateViewLevel = candidateView ? await viewLevelForUser(common.params.user, common.base.id, activeTable.id, candidateView.id) : "none";
  const activeView =
    catalogView ??
    (candidateView && gridsService.permission.hasAtLeast(candidateViewLevel, "read") ? candidateView : null);
  const allFields =
    common.catalog.fieldsByTable[activeTable.id] ??
    (activeView ? await gridsService.field.listByTable(activeTable.id) : []);
  const viewCompilerCatalog: WorkspaceCatalog =
    activeView && !catalogView
      ? {
          ...common.catalog,
          tables: common.catalog.tables.some((table) => table.id === activeTable.id) ? common.catalog.tables : [...common.catalog.tables, activeTable],
          tableLevels: { ...common.catalog.tableLevels, [activeTable.id]: activeTableLevel },
          fieldsByTable: { ...common.catalog.fieldsByTable, [activeTable.id]: allFields },
          viewsByTable: { ...common.catalog.viewsByTable, [activeTable.id]: [activeView] },
        }
      : common.catalog;
  const compiledView = activeView ? compileWorkspaceViewSource(viewCompilerCatalog, activeTable, activeView) : null;
  if (compiledView && !compiledView.ok) {
    return {
      kind: "invalidQuery",
      title: "Invalid view GQL source",
      message: gqlDiagnosticsMessage(compiledView.diagnostics),
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
  const fields = activeViewForQuery ? outputFieldsForRecordQuery(allFields, activeViewForQuery.query) : allFields;
  const recordsState = parseRecordsState(common.chrome.url.searchParams);
  const displayConfig = activeDisplayConfig(activeTable.displayConfig, activeViewForQuery?.displayConfig);
  const initial = await loadInitialRecords({
    activeTable,
    fields,
    recordsState,
    activeView: activeViewForQuery,
    displayConfig,
    trashMode: common.chrome.trashMode,
    user: common.params.user,
    dateConfig: common.params.dateConfig,
  });

  const selectedRecordId = recordsState.selectedRecordId;
  const selectedRecord = !selectedRecordId
    ? null
    : (initial.records.items.find((r) => r.id === selectedRecordId) ??
      (await gridsService.record.get(activeTable.id, selectedRecordId, { dateConfig: common.params.dateConfig })));
  const canEditActiveView =
    !!activeView &&
    (activeView.ownerUserId === common.params.user.id || gridsService.permission.hasAtLeast(candidateViewLevel, "admin"));

  return okState(
    common,
    {
      kind: "records",
      activeTable,
      activeView: activeViewForQuery,
      fields,
      formsForTable: gridsService.permission.hasAtLeast(activeTableLevel, "read") ? (common.catalog.formsByTable[activeTable.id] ?? []) : [],
      canWriteRecords: gridsService.permission.hasAtLeast(activeTableLevel, "write"),
      canManageActiveTable: gridsService.permission.hasAtLeast(activeTableLevel, "admin"),
      activeTableAccessEntries: gridsService.permission.hasAtLeast(activeTableLevel, "admin")
        ? await gridsService.access.listForTable(activeTable.id)
        : [],
      activeFormAccessEntries: common.catalog.formAccessEntriesByTable[activeTable.id] ?? {},
      activeViewAccessEntries: activeView && canEditActiveView ? await gridsService.access.listForView(activeView.id) : [],
      canEditActiveView,
      otherTables: common.catalog.tables.map((t) => ({ id: t.id, name: t.name })),
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
      searchableFields: filterSearchableFields(fields),
      groupedExplode: initial.groupedExplode,
      activeRecordQuery: activeViewForQuery?.query ?? null,
      displayConfig,
    },
    [
      ...common.chrome.titleBase,
      ...(activeView
        ? [{ title: activeTable.name, href: `/app/grids/${common.base.shortId}/table/${activeTable.shortId}` }, { title: activeView.name }]
        : [{ title: activeTable.name }]),
    ],
  );
};

export const loadGridsWorkspaceState = async (params: LoadWorkspaceParams): Promise<GridsWorkspaceState> => {
  const base = await gridsService.base.getByIdOrShortId(params.baseShortId);
  if (!base) return { kind: "notFound", title: "Not found", message: "Base not found" };

  const baseId = base.id;
  const level = await resolveBaseLevel(params.user, baseId);
  const catalog = await loadCatalog(baseId, params.user);
  const hasBaseRead = gridsService.permission.hasAtLeast(level, "read");
  const hasFormOnlyAccess = catalog.sidebarForms.length > 0;
  const requestedViewTable =
    params.activeTableSlug && params.activeViewSlug ? await gridsService.table.getByIdOrShortId(baseId, params.activeTableSlug) : null;
  const requestedView =
    requestedViewTable && params.activeViewSlug ? await gridsService.view.getByIdOrShortId(requestedViewTable.id, params.activeViewSlug) : null;
  const hasViewRouteAccess = requestedView
    ? gridsService.permission.hasAtLeast(await viewLevelForUser(params.user, baseId, requestedView.tableId, requestedView.id), "read")
    : false;
  if (!hasBaseRead && !hasFormOnlyAccess && !hasViewRouteAccess) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this base" };
  }

  const chrome = buildChrome(params.href, base);
  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  const canUseEditMode = canUseEditModeForCatalog(catalog, params.user, canManageBase, canCreateTables);
  const common: WorkspaceCommon = {
    params,
    base,
    chrome,
    catalog,
    canManageBase,
    canCreateTables,
    canUseEditMode,
    canUseQueryWorkspace: hasBaseRead,
  };
  const queryWorkspaceRequested = chrome.url.pathname.endsWith("/query");
  const activeDashboard = queryWorkspaceRequested ? null : await resolveActiveDashboard(params, base, catalog.dashboards);
  const renderDashboard = activeDashboard ? (catalog.dashboards.find((d) => d.id === activeDashboard.id) ?? null) : null;
  const activeTableFromSlug = requestedViewTable ?? (params.activeTableSlug ? await gridsService.table.getByIdOrShortId(baseId, params.activeTableSlug) : null);
  if (queryWorkspaceRequested) {
    if (!hasBaseRead) return { kind: "accessDenied", title: "Access denied", message: "No access to this base" };
    const queryTable = activeTableFromSlug ? (catalog.tables.find((t) => t.id === activeTableFromSlug.id) ?? null) : null;
    if (params.activeTableSlug && !queryTable) {
      return { kind: "accessDenied", title: "Access denied", message: "No access to this table" };
    }
    const queryViews = queryTable ? (catalog.viewsByTable[queryTable.id] ?? []) : [];
    const candidateQueryView =
      queryTable && params.activeViewSlug ? await gridsService.view.getByIdOrShortId(queryTable.id, params.activeViewSlug) : null;
    const queryView = candidateQueryView ? (queryViews.find((v) => v.id === candidateQueryView.id) ?? null) : null;
    if (params.activeViewSlug && !queryView) {
      return { kind: "accessDenied", title: "Access denied", message: "No access to this view" };
    }

    const currentSource = queryView
      ? ({ kind: "view", viewId: queryView.id, label: queryView.name, ref: queryView.shortId } as const)
      : queryTable
        ? ({ kind: "table", tableId: queryTable.id, label: queryTable.name, ref: queryTable.shortId } as const)
        : undefined;
    return okState(
      common,
      {
        kind: "query",
        initialQuery: chrome.url.searchParams.get("q") ?? "",
        queryPath: chrome.url.pathname,
        ...(currentSource ? { currentSource } : {}),
      },
      [
        ...chrome.titleBase,
        ...(queryTable
          ? [
              { title: queryTable.name, href: `/app/grids/${base.shortId}/table/${queryTable.shortId}` },
              ...(queryView
                ? [{ title: queryView.name, href: `/app/grids/${base.shortId}/table/${queryTable.shortId}/view/${queryView.shortId}` }]
                : []),
            ]
          : []),
        { title: "Query" },
      ],
    );
  }
  if (chrome.url.pathname.endsWith("/automations")) {
    if (!canManageBase) return { kind: "accessDenied", title: "Access denied", message: "Only base admins can manage automations" };
    return okState(common, { kind: "automations" }, [...chrome.titleBase, { title: "Automations" }]);
  }

  const activeTableId = activeTableFromSlug?.id ?? null;
  const activeTable = activeTableId
    ? (catalog.tables.find((t) => t.id === activeTableId) ?? (params.activeViewSlug ? activeTableFromSlug : null))
    : activeDashboard
      ? null
      : (catalog.tables[0] ?? null);

  if (renderDashboard) return loadDashboardState(common, renderDashboard);

  if (!activeTable) return okState(common, { kind: "empty" });
  return loadRecordsState(common, activeTable, params.activeViewSlug);
};
