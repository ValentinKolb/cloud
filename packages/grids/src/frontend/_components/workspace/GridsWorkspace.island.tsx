import { AppWorkspace, layout, prompts } from "@valentinkolb/cloud/ui";
import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { apiClient } from "../../../api/client";
import AutomationsPage from "../automations/AutomationsPage";
import DashboardLayout from "../dashboard/DashboardLayout";
import DashboardWysiwygEditor from "../dashboard/DashboardWysiwygEditor";
import GridsLayoutHelp from "../help/GridsLayoutHelp";
import { createGridsRecordEventsProvider } from "../records-view/grids-record-events-provider";
import RecordsView from "../records-view/RecordsView";
import BaseSettingsPanel from "../settings/BaseSettingsPanel";
import CreateDashboardButton from "../sidebar/CreateDashboardButton";
import CreateTableButton from "../sidebar/CreateTableButton";
import FormSidebarEntry from "../sidebar/FormSidebarEntry";
import RememberGridsPath from "../sidebar/RememberGridsPath";
import { dashboardRecordTableIds } from "./dashboard-live-dependencies";
import { createGridsMetadataEventsProvider } from "./grids-metadata-events-provider";
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
  active ? "sidebar-item-active" : adminMode ? "text-secondary" : "";

const formOnlyEmptyText = (count: number) =>
  count === 1 ? "You have access to 1 form. Click it in the sidebar to fill it out." : `You have access to ${count} forms. Click one in the sidebar to fill it out.`;

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
  let metadataRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let metadataPendingCursor: string | null = null;
  let metadataRefreshInFlight = false;
  let metadataProvider: ReturnType<typeof createGridsMetadataEventsProvider> | null = null;
  let dashboardRecordRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let dashboardRecordRefreshInFlight = false;
  let dashboardRecordRefreshQueued = false;
  let dashboardRecordProviderKey = "";
  let dashboardRecordProviders = new Map<string, ReturnType<typeof createGridsRecordEventsProvider>>();
  const dashboardRecordPendingCursors = new Map<string, string | null>();

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

  const runMetadataRefresh = async () => {
    if (metadataRefreshInFlight) return;
    metadataRefreshInFlight = true;
    const cursorToApply = metadataPendingCursor;
    let applied = false;
    try {
      applied = await applyWorkspaceHref(currentWorkspaceHref(), { preserveScroll: true });
      if (applied) {
        metadataProvider?.markApplied(cursorToApply);
        if (metadataPendingCursor === cursorToApply) metadataPendingCursor = null;
      }
    } catch (error) {
      // Metadata events are best-effort invalidations. The next event or
      // reconnect will retry from the last applied cursor.
      console.warn("Could not refresh Grids workspace metadata", error);
    } finally {
      metadataRefreshInFlight = false;
      if (metadataPendingCursor && (!applied || metadataPendingCursor !== cursorToApply)) scheduleMetadataRefresh();
    }
  };

  const scheduleMetadataRefresh = () => {
    if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
    metadataRefreshTimer = setTimeout(() => {
      metadataRefreshTimer = null;
      void runMetadataRefresh();
    }, 200);
  };

  const disposeDashboardRecordProviders = () => {
    for (const provider of dashboardRecordProviders.values()) provider.dispose();
    dashboardRecordProviders = new Map();
    dashboardRecordPendingCursors.clear();
    if (dashboardRecordRefreshTimer) {
      clearTimeout(dashboardRecordRefreshTimer);
      dashboardRecordRefreshTimer = null;
    }
  };

  const runDashboardRecordRefresh = async () => {
    if (state().route.kind !== "dashboard") return;
    if (dashboardRecordRefreshInFlight) {
      dashboardRecordRefreshQueued = true;
      return;
    }
    dashboardRecordRefreshInFlight = true;
    dashboardRecordRefreshQueued = false;
    const cursorsToApply = new Map(dashboardRecordPendingCursors);
    let applied = false;
    try {
      applied = await applyWorkspaceHref(currentWorkspaceHref(), { preserveScroll: true });
      if (applied) {
        for (const [tableId, cursor] of cursorsToApply) {
          dashboardRecordProviders.get(tableId)?.markApplied(cursor);
          if (dashboardRecordPendingCursors.get(tableId) === cursor) dashboardRecordPendingCursors.delete(tableId);
        }
      }
    } catch (error) {
      // Dashboard widgets are server-resolved. Record events are only
      // invalidations, so a later event or reconnect can retry safely.
      console.warn("Could not refresh Grids dashboard widgets", error);
    } finally {
      dashboardRecordRefreshInFlight = false;
      const shouldRunAgain = dashboardRecordRefreshQueued || dashboardRecordPendingCursors.size > 0;
      dashboardRecordRefreshQueued = false;
      if (shouldRunAgain) scheduleDashboardRecordRefresh();
    }
  };

  const refreshActiveDashboardRoute = () => {
    if (state().route.kind !== "dashboard") return;
    dashboardRecordRefreshQueued = true;
    scheduleDashboardRecordRefresh();
  };

  const scheduleDashboardRecordRefresh = () => {
    if (dashboardRecordRefreshTimer) clearTimeout(dashboardRecordRefreshTimer);
    dashboardRecordRefreshTimer = setTimeout(() => {
      dashboardRecordRefreshTimer = null;
      void runDashboardRecordRefresh();
    }, 200);
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
    metadataProvider = createGridsMetadataEventsProvider({
      baseId: state().base.id,
      onReady: () => {
        scheduleMetadataRefresh();
      },
      onEvent: (cursor) => {
        metadataPendingCursor = cursor ?? metadataPendingCursor;
        scheduleMetadataRefresh();
      },
      onRevoked: () => {
        void applyWorkspaceHref(currentWorkspaceHref()).catch(() => window.location.reload());
      },
      onFatal: (error) => {
        console.warn("Grids workspace metadata live updates stopped", error);
      },
    });
    metadataProvider.connect();

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
      if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer);
      metadataProvider?.dispose();
      metadataProvider = null;
      disposeDashboardRecordProviders();
    });
  });

  createEffect(() => {
    const tableIds = dashboardRecordTableIds(state());
    const route = state().route;
    const dashboardId = route.kind === "dashboard" ? route.dashboard.id : undefined;
    const key = dashboardId ? `${dashboardId}:${tableIds.join(":")}` : tableIds.join(":");
    if (key === dashboardRecordProviderKey) return;

    disposeDashboardRecordProviders();
    dashboardRecordProviderKey = key;
    if (tableIds.length === 0) return;

    const providers = new Map<string, ReturnType<typeof createGridsRecordEventsProvider>>();
    for (const tableId of tableIds) {
      const provider = createGridsRecordEventsProvider({
        tableId,
        dashboardId,
        onReady: () => {
          scheduleDashboardRecordRefresh();
        },
        onEvent: (_event, cursor) => {
          dashboardRecordPendingCursors.set(tableId, cursor);
          scheduleDashboardRecordRefresh();
        },
        onRevoked: () => {
          void applyWorkspaceHref(currentWorkspaceHref()).catch(() => window.location.reload());
        },
        onFatal: (error) => {
          console.warn("Grids dashboard live updates stopped", error);
        },
      });
      providers.set(tableId, provider);
      provider.connect();
    }
    dashboardRecordProviders = providers;
  });

  const routeKey = () => {
    const s = state();
    const route = s.route;
    if (route.kind === "records") return `records:${route.activeTable.id}:${route.activeView?.id ?? ""}:${s.adminModeRequested}`;
    if (route.kind === "dashboard") return `dashboard:${route.dashboard.id}:${s.adminModeRequested}`;
    if (route.kind === "automations") return `automations:${s.base.id}`;
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
        displayConfig={route.displayConfig}
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
          manualAutomations={route.manualAutomations}
          fieldsByTable={state().catalog.fieldsByTable}
          viewsByTable={state().catalog.viewsByTable}
          formsByTable={state().catalog.formsByTable}
          initialAccessEntries={route.activeDashboardAccessEntries}
          canEditAccess={state().canManageBase}
          widgetData={route.widgetData}
          dateConfig={state().dateConfig}
          onWidgetRecordsChanged={() => void runDashboardRecordRefresh()}
          onDashboardChanged={refreshActiveDashboardRoute}
        />
      ) : (
        <DashboardLayout
          dashboard={route.dashboard}
          widgetData={route.widgetData}
          baseShortId={state().base.shortId}
          dateConfig={state().dateConfig}
          onWidgetRecordsChanged={() => void runDashboardRecordRefresh()}
        />
      )}
    </div>
  );

  const renderAutomations = () => (
    <AutomationsPage
      baseId={state().base.id}
      baseShortId={state().base.shortId}
      tables={state().catalog.tables}
      fieldsByTable={state().catalog.fieldsByTable}
    />
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
            </AppWorkspace.SidebarMobileItems>
            <AppWorkspace.SidebarMobileBody scrollPreserveKey={`grids-sidebar-mobile-body-${state().base.id}`}>
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
                        dateConfig={state().dateConfig}
                      />
                    );
                  })}
                </AppWorkspace.SidebarSection>
              </Show>

              <AppWorkspace.SidebarSection title="Tables">
                {state().catalog.tables.length === 0 ? (
                  <p class="text-xs text-dimmed px-2 py-1">{state().catalog.sidebarForms.length > 0 ? "No table access." : "No tables yet."}</p>
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

              <Show when={state().canManageBase}>
                <AppWorkspace.SidebarSection title="Admin">
                  <AppWorkspace.SidebarItem
                    href={`/app/grids/${state().base.shortId}/automations`}
                    icon="ti ti-bolt"
                    onNavigate={handleNavigate}
                    active={state().route.kind === "automations"}
                  >
                    Automations
                  </AppWorkspace.SidebarItem>
                </AppWorkspace.SidebarSection>
              </Show>
            </AppWorkspace.SidebarMobileBody>
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
                        dateConfig={state().dateConfig}
                      />
                    );
                  })}
                </AppWorkspace.SidebarSection>
              </Show>

              <AppWorkspace.SidebarSection title="Tables">
                {state().catalog.tables.length === 0 ? (
                  <p class="text-xs text-dimmed px-2 py-1">{state().catalog.sidebarForms.length > 0 ? "No table access." : "No tables yet."}</p>
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

              <Show when={state().canManageBase}>
                <AppWorkspace.SidebarSection title="Admin">
                  <AppWorkspace.SidebarItem
                    href={`/app/grids/${state().base.shortId}/automations`}
                    icon="ti ti-bolt"
                    onNavigate={handleNavigate}
                    active={state().route.kind === "automations"}
                  >
                    Automations
                  </AppWorkspace.SidebarItem>
                </AppWorkspace.SidebarSection>
              </Show>
            </AppWorkspace.SidebarBody>

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
                <Match when={route.kind === "automations"}>{renderAutomations()}</Match>
                <Match when={route.kind === "records"}>{renderRecords(route as WorkspaceRecordsRoute)}</Match>
                <Match when={route.kind === "empty"}>
                  <div class="paper p-8 text-center text-sm text-dimmed">
                    <Show
                      when={state().catalog.sidebarForms.length > 0}
                      fallback={
                        state().canCreateTables
                          ? 'No tables yet. Click "New table" in the sidebar.'
                          : "No tables. You don't have write access to create one."
                      }
                    >
                      {formOnlyEmptyText(state().catalog.sidebarForms.length)}
                    </Show>
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
