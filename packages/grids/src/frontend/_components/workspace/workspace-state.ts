import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { DocumentTemplate, DocumentTemplateSummary } from "../../../contracts";
import type { Base, Dashboard, Form, Table } from "../../../service";
import { gridsService } from "../../../service";
import { resolveWidgetData } from "../../../service/dashboard-widget-data";
import { loadRecordsState } from "./workspace-records-state";
import { documentTemplateLevelForUser, resolveBaseLevel, viewLevelForUser, workflowLevelForUser } from "./workspace-state-access";
import { buildChrome, buildViewer, okState } from "./workspace-state-helpers";
import type {
  AuthUser,
  GridsWorkspaceState,
  LoadWorkspaceParams,
  OkWorkspaceState,
  WorkspaceCatalog,
  WorkspaceCommon,
} from "./workspace-state-model";

export type {
  GridsWorkspaceRoute,
  GridsWorkspaceState,
  WorkspaceCatalog,
  WorkspaceDashboardRoute,
  WorkspaceDocumentTemplateRoute,
  WorkspaceEmptyRoute,
  WorkspaceGroupBucket,
  WorkspaceQueryRoute,
  WorkspaceRecordsRoute,
  WorkspaceWorkflowsRoute,
} from "./workspace-state-model";

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

const loadDocumentTemplateAccessEntriesByTable = async (
  templatesByTable: Record<string, Array<Pick<DocumentTemplateSummary, "id">>>,
  templateLevels: Record<string, "none" | "read" | "write" | "admin">,
) => {
  const entriesByTable: Record<string, Record<string, AccessEntry[]>> = {};
  await Promise.all(
    Object.entries(templatesByTable).map(async ([tableId, templates]) => {
      const entries: Record<string, AccessEntry[]> = {};
      await Promise.all(
        templates
          .filter((template) => gridsService.permission.hasAtLeast(templateLevels[template.id] ?? "none", "admin"))
          .map(async (template) => {
            entries[template.id] = await gridsService.access.listForDocumentTemplate(template.id);
          }),
      );
      entriesByTable[tableId] = entries;
    }),
  );
  return entriesByTable;
};

const loadCatalog = async (baseId: string, user: AuthUser): Promise<WorkspaceCatalog> => {
  const catalogRaw = await gridsService.base.catalog({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  const tables = catalogRaw.tables;
  const formTables = catalogRaw.formTables ?? [];
  const documentTemplateTables = catalogRaw.documentTemplateTables ?? [];
  const tableById = Object.fromEntries([...tables, ...formTables, ...documentTemplateTables].map((t) => [t.id, t]));
  const sidebarForms: Array<{ form: Form; table: Table }> = [];
  for (const { form, tableId } of catalogRaw.sidebarForms) {
    const table = tableById[tableId];
    if (table) sidebarForms.push({ form, table });
  }
  sidebarForms.sort((a, b) => a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }));
  const documentTemplatesByTable = Object.fromEntries(
    Object.entries(catalogRaw.documentTemplatesByTable ?? {}).map(([tableId, templates]) => [
      tableId,
      templates.map(gridsService.document.summarizeTemplate),
    ]),
  );
  const sidebarDocumentTemplates: Array<{ template: DocumentTemplateSummary; table: Table }> = [];
  for (const { template, tableId } of catalogRaw.sidebarDocumentTemplates ?? []) {
    const table = tableById[tableId];
    if (table) sidebarDocumentTemplates.push({ template: gridsService.document.summarizeTemplate(template), table });
  }
  sidebarDocumentTemplates.sort((a, b) => a.template.name.localeCompare(b.template.name, undefined, { sensitivity: "base" }));

  const formAccessEntriesByTable = await loadFormAccessEntriesByTable(tables, catalogRaw.tableLevels, catalogRaw.formsByTable);
  const documentTemplateAccessEntriesByTable = await loadDocumentTemplateAccessEntriesByTable(
    documentTemplatesByTable,
    catalogRaw.documentTemplateLevels ?? {},
  );
  const allWorkflows = gridsService.workflow?.listForBase ? await gridsService.workflow.listForBase(baseId) : [];
  const workflowLevels = Object.fromEntries(
    await Promise.all(allWorkflows.map(async (workflow) => [workflow.id, await workflowLevelForUser(user, baseId, workflow.id)] as const)),
  );
  const workflows = allWorkflows
    .filter((workflow) => gridsService.permission.hasAtLeast(workflowLevels[workflow.id] ?? "none", "read"))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    dashboards: catalogRaw.dashboards,
    workflows,
    workflowLevels,
    tables,
    tableLevels: catalogRaw.tableLevels,
    fieldsByTable: catalogRaw.fieldsByTable,
    viewsByTable: catalogRaw.viewsByTable,
    formsByTable: catalogRaw.formsByTable,
    formAccessEntriesByTable,
    documentTemplatesByTable,
    documentTemplateLevels: catalogRaw.documentTemplateLevels ?? {},
    documentTemplateAccessEntriesByTable,
    tableShortIds: Object.fromEntries([...tables, ...formTables, ...documentTemplateTables].map((t) => [t.id, t.shortId])),
    sidebarForms,
    sidebarDocumentTemplates,
  };
};

const canUseEditModeForCatalog = (catalog: WorkspaceCatalog, user: AuthUser, canManageBase: boolean, canCreateTables: boolean) =>
  canCreateTables ||
  catalog.tables.some((t) => gridsService.permission.hasAtLeast(catalog.tableLevels[t.id] ?? "none", "admin")) ||
  Object.values(catalog.documentTemplateLevels).some((level) => gridsService.permission.hasAtLeast(level, "admin")) ||
  catalog.dashboards.some((d) => d.ownerUserId === user.id || (d.ownerUserId === null && canManageBase)) ||
  Object.values(catalog.workflowLevels).some((level) => gridsService.permission.hasAtLeast(level, "admin"));

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
  const dashboardWorkflows =
    common.canManageBase && common.chrome.adminModeRequested
      ? (await gridsService.workflow.listForBase(common.base.id)).filter((workflow) =>
          Boolean(workflow.compiled.triggers.dashboardButton),
        )
      : [];

  return okState(common, {
    kind: "dashboard",
    dashboard,
    widgetData,
    recordLiveTableIds: await gridsService.dashboard.sourceTableIds(dashboard),
    activeDashboardAccessEntries: canEditActiveDashboard ? await gridsService.access.listForDashboard(dashboard.id) : [],
    canEditActiveDashboard,
    isBaseDefault: common.base.defaultDashboardId === dashboard.id,
    dashboardWorkflows,
  });
};

const loadDocumentTemplateState = async (
  common: WorkspaceCommon,
  table: Table,
  template: DocumentTemplate,
): Promise<OkWorkspaceState | Extract<GridsWorkspaceState, { kind: "accessDenied" }>> => {
  const level = await documentTemplateLevelForUser(common.params.user, common.base.id, table.id, template.id);
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this document template" };
  }
  const canWriteTemplate = gridsService.permission.hasAtLeast(level, "write");
  const canManageTemplate = gridsService.permission.hasAtLeast(level, "admin");
  return okState(
    common,
    {
      kind: "documentTemplate",
      table,
      template: gridsService.document.summarizeTemplate(template),
      editableTemplate: canManageTemplate ? template : null,
      canWriteTemplate,
      canManageTemplate,
      activeTemplateAccessEntries: canManageTemplate ? await gridsService.access.listForDocumentTemplate(template.id) : [],
      initialRecordId: common.chrome.url.searchParams.get("record"),
      initialDocumentViewMode: common.params.initialDocumentViewMode ?? "list",
    },
    [...common.chrome.titleBase, { title: "Documents" }, { title: template.name }],
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
  const hasDocumentTemplateOnlyAccess = catalog.sidebarDocumentTemplates.length > 0;
  const requestedDocumentTable =
    params.activeDocumentTableSlug && params.activeDocumentTemplateSlug
      ? await gridsService.table.getByIdOrShortId(baseId, params.activeDocumentTableSlug)
      : null;
  const requestedDocumentTemplate =
    requestedDocumentTable && params.activeDocumentTemplateSlug
      ? await gridsService.document.getTemplateByIdOrShortId(requestedDocumentTable.id, params.activeDocumentTemplateSlug)
      : null;
  const requestedWorkflow = params.activeWorkflowSlug
    ? await gridsService.workflow.getByIdOrShortId(baseId, params.activeWorkflowSlug)
    : null;
  const requestedWorkflowLevel = requestedWorkflow ? await workflowLevelForUser(params.user, baseId, requestedWorkflow.id) : "none";
  const hasDocumentTemplateRouteAccess = requestedDocumentTemplate
    ? gridsService.permission.hasAtLeast(
        await documentTemplateLevelForUser(params.user, baseId, requestedDocumentTemplate.tableId, requestedDocumentTemplate.id),
        "read",
      )
    : false;
  const hasWorkflowRouteAccess = requestedWorkflow ? gridsService.permission.hasAtLeast(requestedWorkflowLevel, "read") : false;
  const requestedViewTable =
    params.activeTableSlug && params.activeViewSlug ? await gridsService.table.getByIdOrShortId(baseId, params.activeTableSlug) : null;
  const requestedView =
    requestedViewTable && params.activeViewSlug
      ? await gridsService.view.getByIdOrShortId(requestedViewTable.id, params.activeViewSlug)
      : null;
  const hasViewRouteAccess = requestedView
    ? gridsService.permission.hasAtLeast(await viewLevelForUser(params.user, baseId, requestedView.tableId, requestedView.id), "read")
    : false;
  if (
    !hasBaseRead &&
    !hasFormOnlyAccess &&
    !hasViewRouteAccess &&
    !hasDocumentTemplateOnlyAccess &&
    !hasDocumentTemplateRouteAccess &&
    !hasWorkflowRouteAccess &&
    catalog.workflows.length === 0
  ) {
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
  const workflowWorkspaceRequested = chrome.url.pathname.includes("/workflows");
  const activeDashboard =
    queryWorkspaceRequested || workflowWorkspaceRequested ? null : await resolveActiveDashboard(params, base, catalog.dashboards);
  const renderDashboard = activeDashboard ? (catalog.dashboards.find((d) => d.id === activeDashboard.id) ?? null) : null;
  const activeTableFromSlug =
    requestedViewTable ?? (params.activeTableSlug ? await gridsService.table.getByIdOrShortId(baseId, params.activeTableSlug) : null);
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
  if (workflowWorkspaceRequested) {
    if (params.activeWorkflowSlug && !requestedWorkflow) {
      return { kind: "notFound", title: "Not found", message: "Workflow not found" };
    }
    const activeWorkflow = requestedWorkflow ? (catalog.workflows.find((workflow) => workflow.id === requestedWorkflow.id) ?? null) : null;
    if (params.activeWorkflowSlug && !activeWorkflow) {
      return { kind: "accessDenied", title: "Access denied", message: "No access to this workflow" };
    }
    if (!hasBaseRead && catalog.workflows.length === 0) {
      return { kind: "accessDenied", title: "Access denied", message: "No access to workflows" };
    }
    const activeWorkflowLevel = activeWorkflow ? (catalog.workflowLevels[activeWorkflow.id] ?? "none") : "none";
    return okState(
      common,
      {
        kind: "workflows",
        activeWorkflow,
        canRunActiveWorkflow: gridsService.permission.hasAtLeast(activeWorkflowLevel, "write"),
        canManageActiveWorkflow: gridsService.permission.hasAtLeast(activeWorkflowLevel, "admin"),
        selectedRunId: chrome.url.searchParams.get("run"),
      },
      [
        ...chrome.titleBase,
        { title: "Workflows", href: `/app/grids/${base.shortId}/workflows` },
        ...(activeWorkflow ? [{ title: activeWorkflow.name }] : []),
      ],
    );
  }

  if (params.activeDocumentTableSlug && params.activeDocumentTemplateSlug) {
    if (!requestedDocumentTable || !requestedDocumentTemplate) {
      return { kind: "notFound", title: "Not found", message: "Document template not found" };
    }
    return loadDocumentTemplateState(common, requestedDocumentTable, requestedDocumentTemplate);
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
