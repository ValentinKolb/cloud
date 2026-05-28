import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { Base, Dashboard, Field, Form, GridRecord, Table, View } from "../../../service";
import { gridsService } from "../../../service";
import { resolveWidgetData, type WidgetData } from "../../../service/dashboard-widget-data";
import { filterSearchableFields } from "../../../service/search";
import type { GroupSortSpec, ViewQuery } from "../../../contracts";
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

export type WorkspaceRecordsRoute = {
  kind: "records";
  activeTable: Table;
  activeView: View | null;
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
  };
  initialSelectedRecord: GridRecord | null;
  relationLabels: Record<string, string>;
  activeViewColumns: ViewQuery["columns"] | undefined;
  searchableFields: Field[];
  groupedExplode: boolean;
  activeViewQuery: ViewQuery | null;
};

export type WorkspaceDashboardRoute = {
  kind: "dashboard";
  dashboard: Dashboard;
  widgetData: Record<string, WidgetData>;
  activeDashboardAccessEntries: AccessEntry[];
  canEditActiveDashboard: boolean;
  isBaseDefault: boolean;
};

export type WorkspaceEmptyRoute = {
  kind: "empty";
};

export type WorkspaceAutomationsRoute = {
  kind: "automations";
};

export type GridsWorkspaceRoute = WorkspaceRecordsRoute | WorkspaceDashboardRoute | WorkspaceAutomationsRoute | WorkspaceEmptyRoute;

export type GridsWorkspaceState =
  | { kind: "notFound"; title: string; message: string }
  | { kind: "accessDenied"; title: string; message: string }
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

export const loadGridsWorkspaceState = async (params: {
  user: AuthUser;
  baseShortId: string;
  href: string;
  activeTableSlug?: string | null;
  activeViewSlug?: string | null;
  activeDashboardSlug?: string | null;
}): Promise<GridsWorkspaceState> => {
  const url = new URL(params.href, "http://grids.local");
  const adminModeRequested = url.searchParams.get("edit") === "true";
  const trashMode = url.searchParams.get("trash") === "1";
  const currentPath = `${url.pathname}${url.search}`;
  const rememberPath = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeOnHref = urlWithParam(urlWithoutParams(currentPath, ["form"]), "edit", "true");
  const editModeOffHref = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeToggleHref = adminModeRequested ? editModeOffHref : editModeOnHref;

  const base = await gridsService.base.getByIdOrShortId(params.baseShortId);
  if (!base) return { kind: "notFound", title: "Not found", message: "Base not found" };

  const baseId = base.id;
  const level = await resolveBaseLevel(params.user, baseId);
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this base" };
  }

  const catalogRaw = await gridsService.base.catalog({
    baseId,
    userId: params.user.id,
    userGroups: params.user.memberofGroupIds,
    isAdmin: hasRole(params.user, "admin"),
  });
  const dashboards = catalogRaw.dashboards;
  const tables = catalogRaw.tables;
  const tableById = Object.fromEntries(tables.map((t) => [t.id, t]));
  const sidebarForms: Array<{ form: Form; table: Table }> = [];
  for (const { form, tableId } of catalogRaw.sidebarForms) {
    const table = tableById[tableId];
    if (table) sidebarForms.push({ form, table });
  }
  sidebarForms.sort((a, b) => a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }));
  const formAccessEntriesByTable = await loadFormAccessEntriesByTable(tables, catalogRaw.tableLevels, catalogRaw.formsByTable);
  const catalog: WorkspaceCatalog = {
    dashboards,
    tables,
    tableLevels: catalogRaw.tableLevels,
    fieldsByTable: catalogRaw.fieldsByTable,
    viewsByTable: catalogRaw.viewsByTable,
    formsByTable: catalogRaw.formsByTable,
    formAccessEntriesByTable,
    tableShortIds: Object.fromEntries(tables.map((t) => [t.id, t.shortId])),
    sidebarForms,
  };

  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  const canUseEditMode =
    canCreateTables ||
    tables.some((t) => gridsService.permission.hasAtLeast(catalog.tableLevels[t.id] ?? "none", "admin")) ||
    dashboards.some((d) => d.ownerUserId === params.user.id || (d.ownerUserId === null && canManageBase));

  const titleBase = [
    { title: "Start", href: "/" },
    { title: "Grids", href: "/app/grids" },
    { title: base.name, href: `/app/grids/${base.shortId}` },
  ];

  let activeDashboard = params.activeDashboardSlug
    ? await gridsService.dashboard.getByIdOrShortId(baseId, params.activeDashboardSlug)
    : null;
  if (!params.activeTableSlug && !activeDashboard && base.defaultDashboardId) {
    const defaultDashboard = await gridsService.dashboard.get(base.defaultDashboardId);
    if (defaultDashboard && defaultDashboard.deletedAt === null) activeDashboard = defaultDashboard;
  }
  const renderDashboard = activeDashboard ? (dashboards.find((d) => d.id === activeDashboard.id) ?? null) : null;
  const activeTableFromSlug = params.activeTableSlug ? await gridsService.table.getByIdOrShortId(baseId, params.activeTableSlug) : null;
  if (url.pathname.endsWith("/automations")) {
    if (!canManageBase) return { kind: "accessDenied", title: "Access denied", message: "Only base admins can manage automations" };
    return {
      kind: "ok",
      base,
      baseShortId: base.shortId,
      title: [...titleBase, { title: "Automations" }],
      rememberPath,
      adminModeRequested,
      editModeToggleHref,
      canManageBase,
      canCreateTables,
      canUseEditMode,
      catalog,
      route: { kind: "automations" },
    };
  }

  const activeTableId = activeTableFromSlug?.id ?? null;
  const activeTable = activeTableId ? (tables.find((t) => t.id === activeTableId) ?? null) : activeDashboard ? null : (tables[0] ?? null);

  if (renderDashboard) {
    const widgets = renderDashboard.config.rows.flatMap((r) => r.cells);
    const results = await Promise.all(
      widgets.map((w) =>
        resolveWidgetData(w, {
          userId: params.user.id,
          userGroups: params.user.memberofGroupIds,
          isAdmin: hasRole(params.user, "admin"),
        }).then((data) => [w.id, data] as const),
      ),
    );
    const widgetData = Object.fromEntries(results);
    const canEditActiveDashboard =
      renderDashboard.ownerUserId === params.user.id || (renderDashboard.ownerUserId === null && canManageBase);
    return {
      kind: "ok",
      base,
      baseShortId: base.shortId,
      title: titleBase,
      rememberPath,
      adminModeRequested,
      editModeToggleHref,
      canManageBase,
      canCreateTables,
      canUseEditMode,
      catalog,
      route: {
        kind: "dashboard",
        dashboard: renderDashboard,
        widgetData,
        activeDashboardAccessEntries: canEditActiveDashboard ? await gridsService.access.listForDashboard(renderDashboard.id) : [],
        canEditActiveDashboard,
        isBaseDefault: base.defaultDashboardId === renderDashboard.id,
      },
    };
  }

  if (!activeTable) {
    return {
      kind: "ok",
      base,
      baseShortId: base.shortId,
      title: titleBase,
      rememberPath,
      adminModeRequested,
      editModeToggleHref,
      canManageBase,
      canCreateTables,
      canUseEditMode,
      catalog,
      route: { kind: "empty" },
    };
  }

  const activeTableLevel = catalog.tableLevels[activeTable.id] ?? "none";
  const fields = catalog.fieldsByTable[activeTable.id] ?? [];
  const viewsForTable = catalog.viewsByTable[activeTable.id] ?? [];
  const candidateView = params.activeViewSlug ? await gridsService.view.getByIdOrShortId(activeTable.id, params.activeViewSlug) : null;
  const activeView = candidateView ? (viewsForTable.find((v) => v.id === candidateView.id) ?? null) : null;

  const recordsState = parseRecordsState(url.searchParams);
  const effective = resolveEffectiveQuery(recordsState, activeView);
  const effectiveFilter = effective.filter ?? null;
  const effectiveSort = effective.sort ?? [];
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
  const rawCursor = recordsState.cursor;

  let records: { items: GridRecord[]; nextCursor: string | null; aggregates?: Record<string, unknown> } = { items: [], nextCursor: null };
  let aggregates: Record<string, unknown> = {};
  let groupedBuckets: WorkspaceGroupBucket[] = [];
  let groupedExplode = false;
  let relationLabels: Record<string, string> = {};

  if (effectiveGroupBy.length > 0 && !trashMode) {
    const groupResult = await gridsService.record.group({
      tableId: activeTable.id,
      groupBy: effectiveGroupBy,
      aggregations: effectiveAggregations,
      groupSort: effectiveGroupSort,
      filter: effectiveFilter,
      search: effectiveSearch.q ? { q: effectiveSearch.q, fieldIds: effectiveSearch.fieldIds } : null,
      limit: 1000,
      viewer: {
        userId: params.user.id,
        userGroups: params.user.memberofGroupIds,
        isAdmin: hasRole(params.user, "admin"),
      },
    });
    if (groupResult.ok) {
      groupedBuckets = groupResult.data.buckets as WorkspaceGroupBucket[];
      groupedExplode = groupResult.data.explode;
      relationLabels = await gridsService.relations.buildLabelCacheForGroupedKeys(
        groupedBuckets,
        effectiveGroupBy.map((g) => g.fieldId),
        fields,
      );
    }
  } else {
    const listResult = await gridsService.record.list({
      tableId: activeTable.id,
      limit: effectiveLimit,
      includeDeleted: effectiveIncludeDeleted,
      deletedOnly: trashMode,
      filter: effectiveFilter,
      search: searchSpec,
      sort: effectiveSort,
      cursor: rawCursor,
      includeRelations: true,
      viewer: {
        userId: params.user.id,
        userGroups: params.user.memberofGroupIds,
        isAdmin: hasRole(params.user, "admin"),
      },
    });
    if (listResult.ok) {
      records = viewLimit !== undefined ? { ...listResult.data, nextCursor: null } : listResult.data;
      aggregates = records.aggregates ?? {};
    }
    relationLabels = await gridsService.relations.buildLabelCache(records.items, fields);
    if (!trashMode && fields.length > 0 && effectiveAggregations.length > 0) {
      const aggResult = await gridsService.record.aggregate({
        tableId: activeTable.id,
        filter: effectiveFilter,
        search: searchSpec,
        includeDeleted: effectiveIncludeDeleted,
        deletedOnly: trashMode,
        requests: effectiveAggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
        viewer: {
          userId: params.user.id,
          userGroups: params.user.memberofGroupIds,
          isAdmin: hasRole(params.user, "admin"),
        },
      });
      if (aggResult.ok) aggregates = { ...aggregates, ...aggResult.data };
    }
  }

  let selectedRecord: GridRecord | null = null;
  if (recordsState.selectedRecordId) {
    selectedRecord =
      records.items.find((r) => r.id === recordsState.selectedRecordId) ??
      (await gridsService.record.get(activeTable.id, recordsState.selectedRecordId));
  }

  const canEditActiveView =
    !!activeView &&
    (activeView.ownerUserId === null
      ? gridsService.permission.hasAtLeast(activeTableLevel, "write")
      : activeView.ownerUserId === params.user.id && gridsService.permission.hasAtLeast(activeTableLevel, "read"));

  return {
    kind: "ok",
    base,
    baseShortId: base.shortId,
    title: [
      ...titleBase,
      ...(activeView
        ? [{ title: activeTable.name, href: `/app/grids/${base.shortId}/table/${activeTable.shortId}` }, { title: activeView.name }]
        : [{ title: activeTable.name }]),
    ],
    rememberPath,
    adminModeRequested,
    editModeToggleHref,
    canManageBase,
    canCreateTables,
    canUseEditMode,
    catalog,
    route: {
      kind: "records",
      activeTable,
      activeView,
      fields,
      formsForTable: catalog.formsByTable[activeTable.id] ?? [],
      canWriteRecords: gridsService.permission.hasAtLeast(activeTableLevel, "write"),
      canManageActiveTable: gridsService.permission.hasAtLeast(activeTableLevel, "admin"),
      activeTableAccessEntries: gridsService.permission.hasAtLeast(activeTableLevel, "admin")
        ? await gridsService.access.listForTable(activeTable.id)
        : [],
      activeFormAccessEntries: formAccessEntriesByTable[activeTable.id] ?? {},
      activeViewAccessEntries: activeView && canEditActiveView ? await gridsService.access.listForView(activeView.id) : [],
      canEditActiveView,
      otherTables: tables.filter((t) => t.id !== activeTable.id).map((t) => ({ id: t.id, name: t.name })),
      initialState: {
        query: {
          filter: effectiveFilter ?? undefined,
          sort: effectiveSort,
          groupBy: effectiveGroupBy,
          aggregations: effectiveAggregations,
          includeDeleted: effectiveIncludeDeleted,
          deletedOnly: trashMode,
        },
        cursor: rawCursor,
        selectedRecordId: recordsState.selectedRecordId,
        search: effectiveSearch,
      },
      initialData: {
        items: records.items,
        buckets: groupedBuckets,
        aggregates,
        nextCursor: records.nextCursor,
        explode: groupedExplode,
      },
      initialSelectedRecord: selectedRecord,
      relationLabels,
      activeViewColumns: activeView?.query.columns,
      searchableFields: filterSearchableFields(fields),
      groupedExplode,
      activeViewQuery: activeView?.query ?? null,
    },
  };
};
