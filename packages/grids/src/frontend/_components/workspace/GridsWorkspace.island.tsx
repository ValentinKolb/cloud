import { AppWorkspace, layout, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { apiClient } from "../../../api/client";
import DashboardLayout from "../dashboard/DashboardLayout";
import DashboardWysiwygEditor from "../dashboard/DashboardWysiwygEditor";
import DocumentTemplateWorkspace from "../documents/DocumentTemplateWorkspace";
import GridsLayoutHelp from "../help/GridsLayoutHelp";
import QueryWorkspace from "../query/QueryWorkspace";
import RecordsView from "../records-view/RecordsView";
import BaseSettingsPanel from "../settings/BaseSettingsPanel";
import CreateDashboardButton from "../sidebar/CreateDashboardButton";
import CreateTableButton from "../sidebar/CreateTableButton";
import FormSidebarEntry from "../sidebar/FormSidebarEntry";
import RememberGridsPath from "../sidebar/RememberGridsPath";
import { WorkflowRunDetailPanel } from "../workflows/WorkflowRunDetailPanel";
import WorkflowsPage from "../workflows/WorkflowsPage";
import { useWorkspaceLiveUpdates } from "./workspace-live-updates";
import type {
  GridsWorkspaceState,
  WorkspaceDashboardRoute,
  WorkspaceDocumentTemplateRoute,
  WorkspaceQueryRoute,
  WorkspaceRecordsRoute,
  WorkspaceWorkflowsRoute,
} from "./workspace-state";

type Props = {
  initialState: Extract<GridsWorkspaceState, { kind: "ok" }>;
};

const permissionRank = { none: 0, read: 1, write: 2, admin: 3 } as const;

const hasAtLeast = (level: keyof typeof permissionRank, required: keyof typeof permissionRank) =>
  permissionRank[level] >= permissionRank[required];

const urlWithParam = (href: string, key: string, value: string) => {
  const url = new URL(href, "http://grids.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
};

const keepEdit = (href: string, adminMode: boolean) => (adminMode ? urlWithParam(href, "edit", "true") : href);

const sidebarStateClass = (active: boolean, adminMode: boolean) => (active ? "sidebar-item-active" : adminMode ? "text-secondary" : "");

const formOnlyEmptyText = (count: number) =>
  count === 1
    ? "You have access to 1 form. Click it in the sidebar to fill it out."
    : `You have access to ${count} forms. Click one in the sidebar to fill it out.`;

const limitedAccessEmptyText = (formCount: number, documentCount: number) => {
  const parts = [
    formCount > 0 ? `${formCount} form${formCount === 1 ? "" : "s"}` : "",
    documentCount > 0 ? `${documentCount} document template${documentCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `You have access to ${parts.join(" and ")}. Choose one in the sidebar.`;
};

const captureScrollPreserve = () =>
  new Map(
    Array.from(document.querySelectorAll("[data-scroll-preserve]"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => [element.dataset.scrollPreserve ?? "", element.scrollTop] as const)
      .filter(([key]) => key.length > 0),
  );

const restoreScrollPreserve = (snapshot: Map<string, number> | null) => {
  if (!snapshot) return;
  requestAnimationFrame(() => {
    for (const [key, scrollTop] of snapshot) {
      const element = document.querySelector(`[data-scroll-preserve="${CSS.escape(key)}"]`);
      if (element instanceof HTMLElement) element.scrollTop = scrollTop;
    }
  });
};

export default function GridsWorkspace(props: Props) {
  const [state, setState] = createSignal(props.initialState);
  const [settingsDialogOpen, setSettingsDialogOpen] = createSignal(false);
  let routeRequest = 0;

  const loadWorkspaceState = async (href: string) => {
    const res = await apiClient.workspace.route.$get({ query: { href } });
    if (!res.ok) throw new Error("Could not load route");
    const next = await res.json();
    if (next.kind !== "ok") throw new Error("Could not load route");
    return next;
  };

  const applyWorkspaceHref = async (href: string, options?: { preserveScroll?: boolean }): Promise<boolean> => {
    const requestId = ++routeRequest;
    const scrollSnapshot = options?.preserveScroll ? captureScrollPreserve() : null;
    const next = await loadWorkspaceState(href);
    if (requestId !== routeRequest) return false;
    setState(next);
    layout.update({ breadcrumbs: next.title, title: next.title.at(-1)?.title });
    restoreScrollPreserve(scrollSnapshot);
    return true;
  };

  const currentWorkspaceHref = () => `${window.location.pathname}${window.location.search}`;

  const { refreshDashboardRecords, refreshActiveDashboardRoute } = useWorkspaceLiveUpdates({
    state,
    applyWorkspaceHref,
    currentWorkspaceHref,
  });

  const workflowRunDetailId = () => {
    const route = state().route;
    return route.kind === "workflows" ? route.selectedRunId : null;
  };

  const selectWorkflowRun = async (runId: string | null) => {
    const url = new URL(currentWorkspaceHref(), "http://grids.local");
    if (runId) url.searchParams.set("run", runId);
    else url.searchParams.delete("run");
    const nextHref = `${url.pathname}${url.search}`;
    const applied = await applyWorkspaceHref(nextHref, { preserveScroll: true });
    if (applied) window.history.pushState(null, "", nextHref);
  };

  const canHandleUrl = (url: URL) => url.origin === window.location.origin && url.pathname.startsWith("/app/grids/");

  const handleNavigate = async (nav: Parameters<NonNullable<Parameters<typeof AppWorkspace.SidebarItem>[0]["onNavigate"]>>[0]) => {
    if (!canHandleUrl(nav.url)) return nav.fallback();
    try {
      await applyWorkspaceHref(`${nav.url.pathname}${nav.url.search}`);
      nav.push(undefined, { scroll: "top" });
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not open route");
      nav.fallback();
    }
  };

  const openSettingsDialog = async () => {
    if (settingsDialogOpen()) return;
    try {
      const [accessRes, dashboardsRes] = await Promise.all([
        apiClient.access["by-base"][":baseId"].$get({ param: { baseId: state().base.id } }),
        apiClient.dashboards["by-base"][":baseId"].$get({ param: { baseId: state().base.id } }),
      ]);
      if (!accessRes.ok || !dashboardsRes.ok) throw new Error("Could not load settings");
      const [accessEntries, dashboards] = await Promise.all([accessRes.json(), dashboardsRes.json()]);
      setSettingsDialogOpen(true);
      await prompts.dialog<void>(
        (close) => (
          <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
            <BaseSettingsPanel base={state().base} accessEntries={accessEntries} dashboards={dashboards} onClose={() => close()} />
          </div>
        ),
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not open settings");
    } finally {
      setSettingsDialogOpen(false);
    }
  };

  onMount(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      if (!canHandleUrl(url)) {
        window.location.assign(`${url.pathname}${url.search}`);
        return;
      }
      void applyWorkspaceHref(`${url.pathname}${url.search}`).catch(() => window.location.assign(`${url.pathname}${url.search}`));
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => {
      window.removeEventListener("popstate", onPopState);
    });
  });

  const routeKey = () => {
    const s = state();
    const route = s.route;
    if (route.kind === "records") return `records:${route.activeTable.id}:${route.activeView?.id ?? ""}:${s.adminModeRequested}`;
    if (route.kind === "dashboard") return `dashboard:${route.dashboard.id}:${s.adminModeRequested}`;
    if (route.kind === "workflows")
      return `workflows:${s.base.id}:${route.activeWorkflow?.id ?? ""}:${route.selectedRunId ?? ""}:${s.adminModeRequested}`;
    if (route.kind === "query") return `query:${s.base.id}:${route.queryPath}`;
    if (route.kind === "documentTemplate") return `document:${route.template.id}:${route.initialRecordId ?? ""}:${s.adminModeRequested}`;
    return `${route.kind}:${s.adminModeRequested}`;
  };

  const renderRecords = (route: WorkspaceRecordsRoute) => (
    <div class="flex-1 min-h-0 flex flex-col" data-route-key={routeKey()}>
      <RecordsView
        baseId={state().base.id}
        tableId={route.activeTable.id}
        tableName={route.activeTable.name}
        tableDescription={route.activeTable.description ?? null}
        tableIcon={route.activeTable.icon ?? null}
        tableColumns={route.activeTable.columns}
        disableDirectInsert={route.activeTable.disableDirectInsert}
        baseShortId={state().base.shortId}
        tableShortId={route.activeTable.shortId}
        tableShortIds={state().catalog.tableShortIds}
        viewShortId={route.activeView?.shortId ?? null}
        fields={route.fields}
        tables={state().catalog.tables}
        viewsByTable={state().catalog.viewsByTable}
        forms={route.formsForTable}
        canWrite={route.canWriteRecords}
        canManageTable={route.canManageActiveTable}
        trashMode={route.initialState.query.deletedOnly === true}
        initialAdminMode={state().adminModeRequested}
        initialAccessEntries={route.activeTableAccessEntries}
        initialFormAccessEntries={route.activeFormAccessEntries}
        activeView={route.activeView}
        activeViewAccessEntries={route.activeViewAccessEntries}
        canEditActiveView={route.canEditActiveView}
        otherTables={route.otherTables}
        fieldsByTable={state().catalog.fieldsByTable}
        viewMode={route.activeView !== null}
        initialState={route.initialState}
        initialData={route.initialData}
        initialSelectedRecord={route.initialSelectedRecord}
        relationLabels={route.relationLabels}
        viewColumns={route.activeViewColumns}
        searchableFields={route.searchableFields}
        groupedExplode={route.groupedExplode}
        activeRecordQuery={route.activeRecordQuery}
        displayConfig={route.displayConfig}
        bulkSelectionWorkflows={route.bulkSelectionWorkflows}
        dateConfig={state().dateConfig}
      />
    </div>
  );

  const renderDashboard = (route: WorkspaceDashboardRoute) => (
    <div class="flex-1 min-h-0 overflow-y-auto" data-route-key={routeKey()} data-scroll-preserve={`grids-main-${routeKey()}`}>
      {state().adminModeRequested && route.canEditActiveDashboard ? (
        <DashboardWysiwygEditor
          baseShortId={state().base.shortId}
          initialDashboard={route.dashboard}
          isBaseDefault={route.isBaseDefault}
          tables={state().catalog.tables.map((t) => ({ id: t.id, name: t.name, slug: t.shortId }))}
          dashboards={state().catalog.dashboards}
          dashboardWorkflows={route.dashboardWorkflows}
          fieldsByTable={state().catalog.fieldsByTable}
          viewsByTable={state().catalog.viewsByTable}
          formsByTable={state().catalog.formsByTable}
          initialAccessEntries={route.activeDashboardAccessEntries}
          canEditAccess={state().canManageBase}
          widgetData={route.widgetData}
          dateConfig={state().dateConfig}
          onWidgetRecordsChanged={() => void refreshDashboardRecords()}
          onDashboardChanged={refreshActiveDashboardRoute}
        />
      ) : (
        <DashboardLayout
          dashboard={route.dashboard}
          widgetData={route.widgetData}
          baseShortId={state().base.shortId}
          dateConfig={state().dateConfig}
          onWidgetRecordsChanged={() => void refreshDashboardRecords()}
        />
      )}
    </div>
  );

  const renderWorkflows = (route: WorkspaceWorkflowsRoute) => (
    <WorkflowsPage
      baseId={state().base.id}
      baseShortId={state().base.shortId}
      tables={state().catalog.tables}
      workflows={state().catalog.workflows}
      activeWorkflow={route.activeWorkflow}
      selectedRunId={route.selectedRunId}
      canCreateWorkflows={state().canManageBase}
      canRunActiveWorkflow={route.canRunActiveWorkflow}
      canManageActiveWorkflow={route.canManageActiveWorkflow}
      editMode={state().adminModeRequested}
      onWorkflowChanged={() => void applyWorkspaceHref(currentWorkspaceHref(), { preserveScroll: true })}
      onSelectRun={(runId) => void selectWorkflowRun(runId)}
    />
  );

  const renderQueryWorkspace = (route: WorkspaceQueryRoute) => (
    <QueryWorkspace
      baseId={state().base.id}
      baseShortId={state().base.shortId}
      initialQuery={route.initialQuery}
      initialPreview={route.initialPreview}
      queryPath={route.queryPath}
      currentSource={route.currentSource}
      tables={state().catalog.tables}
      fieldsByTable={state().catalog.fieldsByTable}
      viewsByTable={state().catalog.viewsByTable}
    />
  );

  const renderDocumentTemplateWorkspace = (route: WorkspaceDocumentTemplateRoute) => (
    <DocumentTemplateWorkspace
      baseId={state().base.id}
      table={route.table}
      template={route.template}
      editableTemplate={route.editableTemplate}
      canWriteTemplate={route.canWriteTemplate}
      canManageTemplate={route.canManageTemplate}
      editMode={state().adminModeRequested}
      initialRecordId={route.initialRecordId}
      initialDocumentViewMode={route.initialDocumentViewMode}
      dateConfig={state().dateConfig}
    />
  );

  const isUnsavedQueryRoute = () => {
    const route = state().route;
    return route.kind === "query";
  };

  const renderWorkflowSidebarSection = () => (
    <Show when={state().catalog.workflows.length > 0 || state().canManageBase}>
      <AppWorkspace.SidebarSection title="Workflows">
        <AppWorkspace.SidebarItem
          href={keepEdit(`/app/grids/${state().base.shortId}/workflows`, state().adminModeRequested)}
          icon="ti ti-route"
          onNavigate={handleNavigate}
          active={state().route.kind === "workflows" && !(state().route as WorkspaceWorkflowsRoute).activeWorkflow}
          activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
          class={state().route.kind === "workflows" ? undefined : sidebarStateClass(false, state().adminModeRequested)}
        >
          Overview
        </AppWorkspace.SidebarItem>
        {state().catalog.workflows.map((workflow) => {
          const route = state().route;
          const active = route.kind === "workflows" && route.activeWorkflow?.id === workflow.id;
          return (
            <AppWorkspace.SidebarItem
              href={keepEdit(`/app/grids/${state().base.shortId}/workflows/${workflow.shortId}`, state().adminModeRequested)}
              icon="ti ti-route"
              onNavigate={handleNavigate}
              active={active}
              activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
              class={!active ? sidebarStateClass(false, state().adminModeRequested) : undefined}
              meta={workflow.enabled ? undefined : <span class="text-[9px] uppercase tracking-wider text-dimmed">off</span>}
            >
              {workflow.name}
            </AppWorkspace.SidebarItem>
          );
        })}
      </AppWorkspace.SidebarSection>
    </Show>
  );

  const renderQuerySidebarItem = () =>
    state().canUseQueryWorkspace ? (
      <AppWorkspace.SidebarItem
        href={`/app/grids/${state().base.shortId}/query`}
        icon="ti ti-code"
        onNavigate={handleNavigate}
        active={isUnsavedQueryRoute()}
      >
        Query
      </AppWorkspace.SidebarItem>
    ) : null;

  const renderWorkspaceNavigationSections = () => (
    <>
      <Show when={state().catalog.dashboards.length > 0 || state().canCreateTables}>
        <AppWorkspace.SidebarSection title="Dashboards">
          {[...state().catalog.dashboards]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
            .map((d) => {
              const route = state().route;
              const active = route.kind === "dashboard" && route.dashboard.id === d.id;
              return (
                <AppWorkspace.SidebarItem
                  href={keepEdit(`/app/grids/${state().base.shortId}/dashboard/${d.shortId}`, state().adminModeRequested)}
                  icon={d.icon ?? "ti ti-layout-dashboard"}
                  onNavigate={handleNavigate}
                  active={active}
                  activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
                  class={!active ? sidebarStateClass(false, state().adminModeRequested) : undefined}
                  meta={
                    state().base.defaultDashboardId === d.id ? <span class="text-[9px] uppercase tracking-wider">default</span> : undefined
                  }
                >
                  {d.name}
                </AppWorkspace.SidebarItem>
              );
            })}
          {state().canCreateTables && <CreateDashboardButton baseId={state().base.id} baseShortId={state().base.shortId} />}
        </AppWorkspace.SidebarSection>
      </Show>

      <Show when={state().catalog.sidebarForms.length > 0}>
        <AppWorkspace.SidebarSection title="Forms">
          {state().catalog.sidebarForms.map(({ form, table }) => {
            const canEditForm = hasAtLeast(state().catalog.tableLevels[table.id] ?? "none", "admin");
            return (
              <FormSidebarEntry
                form={form}
                fields={state().catalog.fieldsByTable[table.id] ?? []}
                editMode={state().adminModeRequested && canEditForm}
                initialAccessEntries={state().catalog.formAccessEntriesByTable[table.id]?.[form.id] ?? []}
                dateConfig={state().dateConfig}
              />
            );
          })}
        </AppWorkspace.SidebarSection>
      </Show>

      <Show when={state().catalog.sidebarDocumentTemplates.length > 0}>
        <AppWorkspace.SidebarSection title="Documents">
          {state().catalog.sidebarDocumentTemplates.map(({ template, table }) => {
            const route = state().route;
            const active = route.kind === "documentTemplate" && route.template.id === template.id;
            return (
              <AppWorkspace.SidebarItem
                href={keepEdit(
                  `/app/grids/${state().base.shortId}/document/${table.shortId}/${template.shortId}`,
                  state().adminModeRequested,
                )}
                icon="ti ti-file-type-pdf"
                onNavigate={handleNavigate}
                active={active}
                activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
                class={!active ? sidebarStateClass(false, state().adminModeRequested) : undefined}
                meta={<span class="truncate text-[9px] uppercase tracking-wider">{table.name}</span>}
              >
                {template.name}
              </AppWorkspace.SidebarItem>
            );
          })}
        </AppWorkspace.SidebarSection>
      </Show>

      {renderWorkflowSidebarSection()}

      <AppWorkspace.SidebarSection title="Tables">
        {state().catalog.tables.length === 0 ? (
          <p class="text-xs text-dimmed px-2 py-1">
            {state().catalog.sidebarForms.length > 0 || state().catalog.sidebarDocumentTemplates.length > 0
              ? "No table access."
              : "No tables yet."}
          </p>
        ) : (
          state().catalog.tables.map((t) => {
            const route = state().route;
            const active = route.kind === "records" && route.activeTable.id === t.id && route.activeView === null;
            return (
              <AppWorkspace.SidebarItem
                href={keepEdit(`/app/grids/${state().base.shortId}/table/${t.shortId}`, state().adminModeRequested)}
                icon={t.icon ?? "ti ti-table"}
                onNavigate={handleNavigate}
                active={active}
                activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
                class={!active ? sidebarStateClass(false, state().adminModeRequested) : undefined}
              >
                {t.name}
              </AppWorkspace.SidebarItem>
            );
          })
        )}
        {state().canCreateTables && <CreateTableButton baseId={state().base.id} baseShortId={state().base.shortId} />}
      </AppWorkspace.SidebarSection>

      <AppWorkspace.SidebarSection title="Views">
        {state().catalog.tables.flatMap((t) =>
          (state().catalog.viewsByTable[t.id] ?? []).map((view) => {
            const route = state().route;
            const active = route.kind === "records" && route.activeTable.id === t.id && route.activeView?.id === view.id;
            return (
              <AppWorkspace.SidebarItem
                href={keepEdit(`/app/grids/${state().base.shortId}/table/${t.shortId}/view/${view.shortId}`, state().adminModeRequested)}
                icon={view.icon ?? "ti ti-table-spark"}
                onNavigate={handleNavigate}
                active={active}
                activeClass={state().adminModeRequested ? sidebarStateClass(true, true) : undefined}
                class={!active ? sidebarStateClass(false, state().adminModeRequested) : undefined}
              >
                {view.name}
              </AppWorkspace.SidebarItem>
            );
          }),
        )}
      </AppWorkspace.SidebarSection>
    </>
  );

  return (
    <>
      <RememberGridsPath path={state().rememberPath} />
      <AppWorkspace class="flex-1 min-h-0">
        <GridsLayoutHelp />
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarHeader
            title={state().base.name}
            icon="ti ti-table"
            iconStyle="background-color:var(--app-accent)"
            action={
              state().canManageBase ? (
                <button
                  type="button"
                  onClick={() => void openSettingsDialog()}
                  class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
                  title="Settings"
                  aria-label={`Settings for ${state().base.name}`}
                >
                  <i class="ti ti-settings text-xs" />
                </button>
              ) : undefined
            }
          />
          <AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarMobileItems scrollPreserveKey={`grids-sidebar-mobile-${state().base.id}`}>
              {state().canUseEditMode && (
                <AppWorkspace.SidebarItem
                  href={state().editModeToggleHref}
                  icon={state().adminModeRequested ? "ti ti-check" : "ti ti-tool"}
                  onNavigate={handleNavigate}
                >
                  {state().adminModeRequested ? "Done editing" : "Edit mode"}
                </AppWorkspace.SidebarItem>
              )}
              {state().canManageBase && (
                <AppWorkspace.SidebarItem onClick={() => void openSettingsDialog()} icon="ti ti-settings">
                  Settings
                </AppWorkspace.SidebarItem>
              )}
              <AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid" navigation="document">
                All grids
              </AppWorkspace.SidebarItem>
              {renderQuerySidebarItem()}
            </AppWorkspace.SidebarMobileItems>
            <AppWorkspace.SidebarMobileBody scrollPreserveKey={`grids-sidebar-mobile-body-${state().base.id}`}>
              {renderWorkspaceNavigationSections()}
            </AppWorkspace.SidebarMobileBody>
          </AppWorkspace.SidebarMobile>

          <AppWorkspace.SidebarDesktop>
            <div class="flex flex-col gap-3">
              <AppWorkspace.SidebarSection title="Actions">
                <AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid" navigation="document">
                  All Grids
                </AppWorkspace.SidebarItem>
                {renderQuerySidebarItem()}
              </AppWorkspace.SidebarSection>
            </div>

            <AppWorkspace.SidebarBody scrollPreserveKey="grids-sidebar">{renderWorkspaceNavigationSections()}</AppWorkspace.SidebarBody>

            {state().canUseEditMode && (
              <AppWorkspace.SidebarFooter class="pt-2">
                <AppWorkspace.SidebarItem
                  href={state().editModeToggleHref}
                  icon={state().adminModeRequested ? "ti ti-check" : "ti ti-tool"}
                  onNavigate={handleNavigate}
                  class={state().adminModeRequested ? "grids-sidebar-edit-active" : undefined}
                >
                  {state().adminModeRequested ? "Done editing" : "Edit mode"}
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarFooter>
            )}
          </AppWorkspace.SidebarDesktop>
        </AppWorkspace.Sidebar>

        <AppWorkspace.Main>
          <Show keyed when={state().route}>
            {(route) => (
              <Switch>
                <Match when={route.kind === "dashboard"}>{renderDashboard(route as WorkspaceDashboardRoute)}</Match>
                <Match when={route.kind === "workflows"}>{renderWorkflows(route as WorkspaceWorkflowsRoute)}</Match>
                <Match when={route.kind === "query"}>{renderQueryWorkspace(route as WorkspaceQueryRoute)}</Match>
                <Match when={route.kind === "documentTemplate"}>
                  {renderDocumentTemplateWorkspace(route as WorkspaceDocumentTemplateRoute)}
                </Match>
                <Match when={route.kind === "records"}>{renderRecords(route as WorkspaceRecordsRoute)}</Match>
                <Match when={route.kind === "empty"}>
                  <Placeholder surface="paper">
                    <Show
                      when={state().catalog.sidebarForms.length > 0 || state().catalog.sidebarDocumentTemplates.length > 0}
                      fallback={
                        state().canCreateTables
                          ? 'No tables yet. Click "New table" in the sidebar.'
                          : "No tables. You don't have write access to create one."
                      }
                    >
                      {state().catalog.sidebarDocumentTemplates.length > 0
                        ? limitedAccessEmptyText(state().catalog.sidebarForms.length, state().catalog.sidebarDocumentTemplates.length)
                        : formOnlyEmptyText(state().catalog.sidebarForms.length)}
                    </Show>
                  </Placeholder>
                </Match>
              </Switch>
            )}
          </Show>
        </AppWorkspace.Main>
        <AppWorkspace.Detail
          open={Boolean(workflowRunDetailId())}
          width="lg"
          class="detail-stack"
          viewTransitionName="grids-workflow-run-detail"
        >
          <Show keyed when={workflowRunDetailId()}>
            {(runId) => <WorkflowRunDetailPanel runId={runId} onClose={() => void selectWorkflowRun(null)} />}
          </Show>
        </AppWorkspace.Detail>
      </AppWorkspace>
    </>
  );
}
