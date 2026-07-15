import { AppWorkspace } from "@valentinkolb/cloud/ui";
import BaseSettingsButton from "../sidebar/BaseSettingsButton.island";
import CreateDashboardButton from "../sidebar/CreateDashboardButton.island";
import CreateTableButton from "../sidebar/CreateTableButton.island";
import FormSidebarEntry from "../sidebar/FormSidebarEntry.island";
import SidebarTableMeta from "../sidebar/SidebarTableMeta";
import type { OkWorkspaceState, WorkspaceRecordsRoute, WorkspaceWorkflowsRoute } from "./workspace-state-model";

const urlWithParam = (href: string, key: string, value: string) => {
  const url = new URL(href, "http://grids.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
};

const keepEdit = (href: string, editMode: boolean) => (editMode ? urlWithParam(href, "edit", "true") : href);

const itemClass = (active: boolean, editMode: boolean) => (!active && editMode ? "text-secondary" : undefined);

const SidebarLink = (props: Parameters<typeof AppWorkspace.SidebarItem>[0]) => (
  <AppWorkspace.SidebarItem {...props} navigation="document" />
);

export default function GridsSidebar(props: { state: OkWorkspaceState }) {
  const state = props.state;
  const route = state.route;
  const recordsRoute = route.kind === "records" ? (route as WorkspaceRecordsRoute) : null;
  const workflowsRoute = route.kind === "workflows" ? (route as WorkspaceWorkflowsRoute) : null;
  const renderQueryItem = () =>
    state.canUseQueryWorkspace ? (
      <SidebarLink href={`/app/grids/${state.base.shortId}/query`} active={route.kind === "query"}>
        <AppWorkspace.SidebarItemIcon icon="ti ti-code" />
        <AppWorkspace.SidebarItemLabel>Query</AppWorkspace.SidebarItemLabel>
      </SidebarLink>
    ) : null;

  const renderNavigationSections = () => (
    <>
      {(state.catalog.dashboards.length > 0 || state.canCreateTables) && (
        <AppWorkspace.SidebarSection title="Dashboards">
          {[...state.catalog.dashboards]
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
            .map((dashboard) => {
              const active = route.kind === "dashboard" && route.dashboard.id === dashboard.id;
              return (
                <SidebarLink
                  href={keepEdit(`/app/grids/${state.base.shortId}/dashboard/${dashboard.shortId}`, state.adminModeRequested)}
                  active={active}
                  class={itemClass(active, state.adminModeRequested)}
                  title={dashboard.name}
                >
                  <AppWorkspace.SidebarItemIcon icon={dashboard.icon ?? "ti ti-layout-dashboard"} />
                  <AppWorkspace.SidebarItemLabel>{dashboard.name}</AppWorkspace.SidebarItemLabel>
                  {state.base.defaultDashboardId === dashboard.id && (
                    <AppWorkspace.SidebarItemMeta>
                      <span class="text-[9px] uppercase tracking-wider">default</span>
                    </AppWorkspace.SidebarItemMeta>
                  )}
                </SidebarLink>
              );
            })}
          {state.canCreateTables && <CreateDashboardButton baseId={state.base.id} baseShortId={state.base.shortId} />}
        </AppWorkspace.SidebarSection>
      )}

      <AppWorkspace.SidebarSection title="Tables">
        {state.catalog.tables.length === 0 ? (
          <p class="px-2 py-1 text-xs text-dimmed">
            {state.catalog.sidebarForms.length > 0 || state.catalog.sidebarDocumentTemplates.length > 0
              ? "No table access."
              : "No tables yet."}
          </p>
        ) : (
          state.catalog.tables.map((table) => {
            const active = recordsRoute?.activeTable.id === table.id && recordsRoute.activeView === null;
            return (
              <SidebarLink
                href={keepEdit(`/app/grids/${state.base.shortId}/table/${table.shortId}`, state.adminModeRequested)}
                active={active}
                class={itemClass(active, state.adminModeRequested)}
                title={table.name}
              >
                <AppWorkspace.SidebarItemIcon icon={table.icon ?? "ti ti-table"} />
                <AppWorkspace.SidebarItemLabel>{table.name}</AppWorkspace.SidebarItemLabel>
              </SidebarLink>
            );
          })
        )}
        {state.canCreateTables && <CreateTableButton baseId={state.base.id} baseShortId={state.base.shortId} />}
      </AppWorkspace.SidebarSection>

      <AppWorkspace.SidebarSection title="Views">
        {state.catalog.tables.flatMap((table) =>
          (state.catalog.viewsByTable[table.id] ?? []).map((view) => {
            const active = recordsRoute?.activeTable.id === table.id && recordsRoute.activeView?.id === view.id;
            return (
              <SidebarLink
                href={keepEdit(`/app/grids/${state.base.shortId}/table/${table.shortId}/view/${view.shortId}`, state.adminModeRequested)}
                active={active}
                class={itemClass(active, state.adminModeRequested)}
                title={`${view.name} (table: ${table.name})`}
              >
                <AppWorkspace.SidebarItemIcon icon={view.icon ?? "ti ti-table-spark"} />
                <AppWorkspace.SidebarItemLabel>{view.name}</AppWorkspace.SidebarItemLabel>
                <SidebarTableMeta tableName={table.name} />
              </SidebarLink>
            );
          }),
        )}
      </AppWorkspace.SidebarSection>

      {state.catalog.sidebarForms.length > 0 && (
        <AppWorkspace.SidebarSection title="Forms">
          {state.catalog.sidebarForms.map(({ form, table }) => (
            <FormSidebarEntry
              form={form}
              tableName={table.name}
              fields={state.catalog.fieldsByTable[table.id] ?? []}
              editMode={state.adminModeRequested && state.catalog.tableLevels[table.id] === "admin"}
              dateConfig={state.dateConfig}
            />
          ))}
        </AppWorkspace.SidebarSection>
      )}

      {state.catalog.sidebarDocumentTemplates.length > 0 && (
        <AppWorkspace.SidebarSection title="Documents">
          {state.catalog.sidebarDocumentTemplates.map(({ template, table }) => {
            const active = route.kind === "documentTemplate" && route.template.id === template.id;
            return (
              <SidebarLink
                href={keepEdit(`/app/grids/${state.base.shortId}/document/${table.shortId}/${template.shortId}`, state.adminModeRequested)}
                active={active}
                class={itemClass(active, state.adminModeRequested)}
                title={`${template.name} (table: ${table.name})`}
              >
                <AppWorkspace.SidebarItemIcon icon="ti ti-file-type-pdf" />
                <AppWorkspace.SidebarItemLabel>{template.name}</AppWorkspace.SidebarItemLabel>
                <SidebarTableMeta tableName={table.name} />
              </SidebarLink>
            );
          })}
        </AppWorkspace.SidebarSection>
      )}

      {(state.catalog.workflows.length > 0 || state.canManageBase) && (
        <AppWorkspace.SidebarSection title="Workflows">
          <SidebarLink
            href={keepEdit(`/app/grids/${state.base.shortId}/workflows`, state.adminModeRequested)}
            active={route.kind === "workflows" && !workflowsRoute?.activeWorkflow}
            class={itemClass(route.kind === "workflows" && !workflowsRoute?.activeWorkflow, state.adminModeRequested)}
          >
            <AppWorkspace.SidebarItemIcon icon="ti ti-route" />
            <AppWorkspace.SidebarItemLabel>Overview</AppWorkspace.SidebarItemLabel>
          </SidebarLink>
          {state.catalog.workflows.map((workflow) => {
            const active = workflowsRoute?.activeWorkflow?.id === workflow.id;
            return (
              <SidebarLink
                href={keepEdit(`/app/grids/${state.base.shortId}/workflows/${workflow.shortId}`, state.adminModeRequested)}
                active={active}
                class={itemClass(active, state.adminModeRequested)}
                title={workflow.name}
              >
                <AppWorkspace.SidebarItemIcon icon="ti ti-route" />
                <AppWorkspace.SidebarItemLabel>{workflow.name}</AppWorkspace.SidebarItemLabel>
                {!workflow.enabled && (
                  <AppWorkspace.SidebarItemMeta>
                    <span class="text-[9px] uppercase tracking-wider text-dimmed">off</span>
                  </AppWorkspace.SidebarItemMeta>
                )}
              </SidebarLink>
            );
          })}
        </AppWorkspace.SidebarSection>
      )}
    </>
  );

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader
        title={state.base.name}
        icon="ti ti-table"
        iconStyle="background-color:var(--app-accent)"
        action={state.canManageBase ? <BaseSettingsButton base={state.base} /> : undefined}
      />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems scrollPreserveKey={`grids-sidebar-mobile-${state.base.id}`}>
          {state.canUseEditMode && (
            <SidebarLink href={state.editModeToggleHref}>
              <AppWorkspace.SidebarItemIcon icon={state.adminModeRequested ? "ti ti-check" : "ti ti-tool"} />
              <AppWorkspace.SidebarItemLabel>{state.adminModeRequested ? "Done editing" : "Edit mode"}</AppWorkspace.SidebarItemLabel>
            </SidebarLink>
          )}
          {state.canManageBase && <BaseSettingsButton base={state.base} variant="sidebar" />}
          <SidebarLink href="/app/grids">
            <AppWorkspace.SidebarItemIcon icon="ti ti-layout-grid" />
            <AppWorkspace.SidebarItemLabel>All grids</AppWorkspace.SidebarItemLabel>
          </SidebarLink>
          {renderQueryItem()}
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody
          class="!max-h-[min(40rem,calc(100dvh-14rem))]"
          scrollPreserveKey={`grids-sidebar-mobile-body-${state.base.id}`}
        >
          {renderNavigationSections()}
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarSection>
          <SidebarLink href="/app/grids">
            <AppWorkspace.SidebarItemIcon icon="ti ti-layout-grid" />
            <AppWorkspace.SidebarItemLabel>All grids</AppWorkspace.SidebarItemLabel>
          </SidebarLink>
          {renderQueryItem()}
        </AppWorkspace.SidebarSection>
        <AppWorkspace.SidebarBody scrollPreserveKey="grids-sidebar">{renderNavigationSections()}</AppWorkspace.SidebarBody>
        {state.canUseEditMode && (
          <AppWorkspace.SidebarFooter>
            <SidebarLink href={state.editModeToggleHref} class={state.adminModeRequested ? "grids-sidebar-edit-active" : undefined}>
              <AppWorkspace.SidebarItemIcon icon={state.adminModeRequested ? "ti ti-check" : "ti ti-tool"} />
              <AppWorkspace.SidebarItemLabel>{state.adminModeRequested ? "Done editing" : "Edit mode"}</AppWorkspace.SidebarItemLabel>
            </SidebarLink>
          </AppWorkspace.SidebarFooter>
        )}
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
