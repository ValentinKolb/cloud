import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { apiClient } from "../../../api/client";
import DashboardLayout from "../dashboard/DashboardLayout";
import DashboardWysiwygEditor from "../dashboard/DashboardWysiwygEditor.island";
import RecordsView from "../records-view/RecordsView.island";
import BaseSettingsPanel from "../settings/BaseSettingsPanel.island";
import CreateDashboardButton from "../sidebar/CreateDashboardButton.island";
import CreateTableButton from "../sidebar/CreateTableButton.island";
import FormSidebarEntry from "../sidebar/FormSidebarEntry.island";
import GridsLayoutHelp from "../help/GridsLayoutHelp.island";
import RememberGridsPath from "../sidebar/RememberGridsPath.island";
import type { GridsWorkspaceState, WorkspaceDashboardRoute, WorkspaceRecordsRoute } from "./workspace-state";

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

const sidebarStateClass = (active: boolean, adminMode: boolean) =>
  active
    ? adminMode
      ? "bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-200"
      : "sidebar-item-active"
    : adminMode
      ? "text-emerald-700 hover:bg-emerald-50/70 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-200"
      : "";

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

  const applyWorkspaceHref = async (href: string) => {
    const requestId = ++routeRequest;
    const next = await loadWorkspaceState(href);
    if (requestId === routeRequest) setState(next);
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
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  const routeKey = () => {
    const s = state();
    const route = s.route;
    if (route.kind === "records") return `records:${route.activeTable.id}:${route.activeView?.id ?? ""}:${s.adminModeRequested}`;
    if (route.kind === "dashboard") return `dashboard:${route.dashboard.id}:${s.adminModeRequested}`;
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
        activeViewQuery={route.activeViewQuery}
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
          fieldsByTable={state().catalog.fieldsByTable}
          viewsByTable={state().catalog.viewsByTable}
          formsByTable={state().catalog.formsByTable}
          initialAccessEntries={route.activeDashboardAccessEntries}
          canEditAccess={state().canManageBase}
          widgetData={route.widgetData}
        />
      ) : (
        <DashboardLayout dashboard={route.dashboard} widgetData={route.widgetData} baseShortId={state().base.shortId} />
      )}
    </div>
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
            iconStyle="background-color:#3b82f6"
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
              {state().catalog.tables.map((t) => {
                const route = state().route;
                const active = route.kind === "records" && route.activeTable.id === t.id;
                return (
                  <AppWorkspace.SidebarItem
                    href={keepEdit(`/app/grids/${state().base.shortId}/table/${t.shortId}`, state().adminModeRequested)}
                    icon={t.icon ?? "ti ti-table"}
                    onNavigate={handleNavigate}
                    active={active}
                    activeClass={
                      state().adminModeRequested
                        ? "border-emerald-500/35 bg-emerald-50/70 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : undefined
                    }
                    class={state().adminModeRequested && !active ? "text-emerald-700 dark:text-emerald-300" : undefined}
                  >
                    {t.name}
                  </AppWorkspace.SidebarItem>
                );
              })}
            </AppWorkspace.SidebarMobileItems>
          </AppWorkspace.SidebarMobile>

          <AppWorkspace.SidebarDesktop>
            <div class="flex flex-col gap-3">
              <AppWorkspace.SidebarSection title="Actions">
                <AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid" navigation="document">
                  All Grids
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>
            </div>

            <AppWorkspace.SidebarBody scrollPreserveKey="grids-sidebar">
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
                            state().base.defaultDashboardId === d.id ? (
                              <span class="text-[9px] uppercase tracking-wider">default</span>
                            ) : undefined
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
                      />
                    );
                  })}
                </AppWorkspace.SidebarSection>
              </Show>

              <AppWorkspace.SidebarSection title="Tables">
                {state().catalog.tables.length === 0 ? (
                  <p class="text-xs text-dimmed px-2 py-1">No tables yet.</p>
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
                        href={keepEdit(
                          `/app/grids/${state().base.shortId}/table/${t.shortId}/view/${view.shortId}`,
                          state().adminModeRequested,
                        )}
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
            </AppWorkspace.SidebarBody>

            {state().canUseEditMode && (
              <AppWorkspace.SidebarFooter class="pt-2">
                <AppWorkspace.SidebarItem
                  href={state().editModeToggleHref}
                  icon={state().adminModeRequested ? "ti ti-check" : "ti ti-tool"}
                  onNavigate={handleNavigate}
                  class={
                    state().adminModeRequested
                      ? "bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                      : undefined
                  }
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
                <Match when={route.kind === "records"}>{renderRecords(route as WorkspaceRecordsRoute)}</Match>
                <Match when={route.kind === "empty"}>
                  <div class="paper p-8 text-center text-sm text-dimmed">
                    {state().canCreateTables
                      ? 'No tables yet. Click "New table" in the sidebar.'
                      : "No tables. You don't have write access to create one."}
                  </div>
                </Match>
              </Switch>
            )}
          </Show>
        </AppWorkspace.Main>
      </AppWorkspace>
    </>
  );
}
