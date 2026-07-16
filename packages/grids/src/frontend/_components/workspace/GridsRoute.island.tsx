import { AppWorkspace, Placeholder } from "@valentinkolb/cloud/ui";
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import DashboardLayout from "../dashboard/DashboardLayout";
import DashboardWysiwygEditor from "../dashboard/DashboardWysiwygEditor";
import DocumentTemplateWorkspace from "../documents/DocumentTemplateWorkspace";
import QueryResultView from "../query/QueryResultView";
import QueryWorkspace from "../query/QueryWorkspace";
import { createGridsRecordEventsProvider } from "../records-view/grids-record-events-provider";
import RecordsView from "../records-view/RecordsView";
import { WorkflowRunDetailPanel } from "../workflows/WorkflowRunDetailPanel";
import WorkflowsPage from "../workflows/WorkflowsPage";
import { workspaceMainClass } from "./workspace-layout";
import type {
  OkWorkspaceState,
  WorkspaceDashboardRoute,
  WorkspaceDocumentTemplateRoute,
  WorkspaceQueryResultViewRoute,
  WorkspaceQueryRoute,
  WorkspaceRecordsRoute,
  WorkspaceWorkflowsRoute,
} from "./workspace-state-model";

const formOnlyEmptyText = (count: number) =>
  count === 1
    ? "You have access to 1 form. Choose it in the sidebar to fill it out."
    : `You have access to ${count} forms. Choose one in the sidebar to fill it out.`;

const limitedAccessEmptyText = (formCount: number, documentCount: number) => {
  const parts = [
    formCount > 0 ? `${formCount} form${formCount === 1 ? "" : "s"}` : "",
    documentCount > 0 ? `${documentCount} document template${documentCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `You have access to ${parts.join(" and ")}. Choose one in the sidebar.`;
};

export default function GridsRoute(props: { state: OkWorkspaceState }) {
  const state = props.state;
  const route = state.route;
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = createSignal(route.kind === "workflows" ? route.selectedRunId : null);

  const updateWorkflowRun = (runId: string | null) => {
    const url = new URL(window.location.href);
    if (runId) url.searchParams.set("run", runId);
    else url.searchParams.delete("run");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    setSelectedWorkflowRunId(runId);
  };

  const reloadRoute = () => window.location.reload();

  onMount(() => {
    if (route.kind === "workflows") {
      const onPopState = () => setSelectedWorkflowRunId(new URL(window.location.href).searchParams.get("run"));
      window.addEventListener("popstate", onPopState);
      onCleanup(() => window.removeEventListener("popstate", onPopState));
    }

    if (route.kind === "dashboard") {
      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      const providers = (route.recordLiveTableIds ?? []).map((tableId) => {
        const provider = createGridsRecordEventsProvider({
          tableId,
          dashboardId: route.dashboard.id,
          initialCursor: state.recordEventCursor,
          onEvent: (_event, cursor) => {
            provider.markApplied(cursor);
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(reloadRoute, 200);
          },
          onRevoked: reloadRoute,
          onFatal: (error) => console.warn("Grids dashboard live updates stopped", error),
        });
        provider.connect();
        return provider;
      });
      onCleanup(() => {
        if (refreshTimer) clearTimeout(refreshTimer);
        for (const provider of providers) provider.dispose();
      });
    }
  });

  if (route.kind === "records") {
    const records = route as WorkspaceRecordsRoute;
    return (
      <RecordsView
        baseId={state.base.id}
        tableId={records.activeTable.id}
        tableName={records.activeTable.name}
        tableDescription={records.activeTable.description ?? null}
        tableIcon={records.activeTable.icon ?? null}
        tableColumns={records.activeTable.columns}
        disableDirectInsert={records.activeTable.disableDirectInsert}
        baseShortId={state.base.shortId}
        tableShortId={records.activeTable.shortId}
        tableShortIds={state.catalog.tableShortIds}
        viewShortId={records.activeView?.shortId ?? null}
        fields={records.fields}
        tables={state.catalog.tables}
        viewsByTable={state.catalog.viewsByTable}
        forms={records.formsForTable}
        canWrite={records.canWriteRecords}
        canManageTable={records.canManageActiveTable}
        trashMode={records.initialState.query.deletedOnly === true}
        initialAdminMode={state.adminModeRequested}
        initialAccessEntries={records.activeTableAccessEntries}
        initialFormAccessEntries={records.activeFormAccessEntries}
        activeView={records.activeView}
        activeViewAccessEntries={records.activeViewAccessEntries}
        canEditActiveView={records.canEditActiveView}
        otherTables={records.otherTables}
        fieldsByTable={state.catalog.fieldsByTable}
        viewMode={records.activeView !== null}
        initialState={records.initialState}
        initialData={records.initialData}
        initialEventCursor={state.recordEventCursor}
        initialSelectedRecord={records.initialSelectedRecord}
        initialSelectedRecordDetail={records.initialSelectedRecordDetail}
        documentTemplates={records.documentTemplates}
        relationLabels={records.relationLabels}
        viewColumns={records.activeViewColumns}
        searchableFields={records.searchableFields}
        groupedExplode={records.groupedExplode}
        activeRecordQuery={records.activeRecordQuery}
        displayConfig={records.displayConfig}
        bulkSelectionLaunchers={records.bulkSelectionLaunchers}
        dateConfig={state.dateConfig}
        workspaceRouteKey={`records:${records.activeTable.id}:${records.activeView?.id ?? ""}:${state.adminModeRequested}`}
      />
    );
  }

  return (
    <AppWorkspace.Content>
      <AppWorkspace.Main class={workspaceMainClass(route.kind)}>
        <Switch>
          <Match when={route.kind === "dashboard"}>
            {(() => {
              const dashboard = route as WorkspaceDashboardRoute;
              return (
                <div class="flex min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`grids-dashboard-${dashboard.dashboard.id}`}>
                  {state.adminModeRequested && dashboard.canEditActiveDashboard ? (
                    <DashboardWysiwygEditor
                      baseShortId={state.base.shortId}
                      initialDashboard={dashboard.dashboard}
                      isBaseDefault={dashboard.isBaseDefault}
                      tables={state.catalog.tables.map((table) => ({ id: table.id, name: table.name, slug: table.shortId }))}
                      dashboards={state.catalog.dashboards}
                      dashboardWorkflows={dashboard.dashboardWorkflows}
                      fieldsByTable={state.catalog.fieldsByTable}
                      viewsByTable={state.catalog.viewsByTable}
                      formsByTable={state.catalog.formsByTable}
                      initialAccessEntries={dashboard.activeDashboardAccessEntries}
                      canEditAccess={state.canManageBase}
                      widgetData={dashboard.widgetData}
                      dateConfig={state.dateConfig}
                      onWidgetRecordsChanged={reloadRoute}
                      onDashboardChanged={reloadRoute}
                    />
                  ) : (
                    <DashboardLayout
                      dashboard={dashboard.dashboard}
                      widgetData={dashboard.widgetData}
                      baseShortId={state.base.shortId}
                      dateConfig={state.dateConfig}
                      onWidgetRecordsChanged={reloadRoute}
                    />
                  )}
                </div>
              );
            })()}
          </Match>
          <Match when={route.kind === "workflows"}>
            {(() => {
              const workflows = route as WorkspaceWorkflowsRoute;
              return (
                <WorkflowsPage
                  baseId={state.base.id}
                  baseShortId={state.base.shortId}
                  tables={state.catalog.tables}
                  workflows={state.catalog.workflows}
                  activeWorkflow={workflows.activeWorkflow}
                  selectedRunId={selectedWorkflowRunId()}
                  canCreateWorkflows={state.canManageBase}
                  canRunActiveWorkflow={workflows.canRunActiveWorkflow}
                  canManageActiveWorkflow={workflows.canManageActiveWorkflow}
                  editMode={state.adminModeRequested}
                  initialOverview={workflows.initialOverview}
                  onWorkflowChanged={reloadRoute}
                  onSelectRun={updateWorkflowRun}
                />
              );
            })()}
          </Match>
          <Match when={route.kind === "query"}>
            {(() => {
              const query = route as WorkspaceQueryRoute;
              return (
                <QueryWorkspace
                  baseId={state.base.id}
                  baseShortId={state.base.shortId}
                  initialQuery={query.initialQuery}
                  initialCursor={query.initialCursor}
                  initialPreview={query.initialPreview}
                  queryPath={query.queryPath}
                  currentSource={query.currentSource}
                  tables={state.catalog.tables}
                  fieldsByTable={state.catalog.fieldsByTable}
                  viewsByTable={state.catalog.viewsByTable}
                />
              );
            })()}
          </Match>
          <Match when={route.kind === "queryResultView"}>
            {(() => {
              const queryResult = route as WorkspaceQueryResultViewRoute;
              return (
                <QueryResultView
                  baseId={state.base.id}
                  baseShortId={state.base.shortId}
                  route={queryResult}
                  tables={
                    state.catalog.tables.some((table) => table.id === queryResult.activeTable.id)
                      ? state.catalog.tables
                      : [...state.catalog.tables, queryResult.activeTable]
                  }
                  fieldsByTable={{
                    ...state.catalog.fieldsByTable,
                    [queryResult.activeTable.id]: queryResult.fields,
                  }}
                  editMode={state.adminModeRequested}
                />
              );
            })()}
          </Match>
          <Match when={route.kind === "documentTemplate"}>
            {(() => {
              const document = route as WorkspaceDocumentTemplateRoute;
              return (
                <DocumentTemplateWorkspace
                  baseId={state.base.id}
                  table={document.table}
                  template={document.template}
                  editableTemplate={document.editableTemplate}
                  canWriteTemplate={document.canWriteTemplate}
                  canManageTemplate={document.canManageTemplate}
                  editMode={state.adminModeRequested}
                  initialRecordId={document.initialRecordId}
                  initialDocumentViewMode={document.initialDocumentViewMode}
                  initialBrowserPage={document.initialBrowserPage}
                  dateConfig={state.dateConfig}
                />
              );
            })()}
          </Match>
          <Match when={route.kind === "empty"}>
            <Placeholder surface="paper">
              <Show
                when={state.catalog.sidebarForms.length > 0 || state.catalog.sidebarDocumentTemplates.length > 0}
                fallback={
                  state.canCreateTables
                    ? 'No tables yet. Choose "New table" in the sidebar.'
                    : "No tables. You don't have write access to create one."
                }
              >
                {state.catalog.sidebarDocumentTemplates.length > 0
                  ? limitedAccessEmptyText(state.catalog.sidebarForms.length, state.catalog.sidebarDocumentTemplates.length)
                  : formOnlyEmptyText(state.catalog.sidebarForms.length)}
              </Show>
            </Placeholder>
          </Match>
        </Switch>
      </AppWorkspace.Main>
      <AppWorkspace.Detail
        id="workflow-run"
        open={Boolean(selectedWorkflowRunId())}
        width="lg"
        viewTransitionName="grids-workflow-run-detail"
      >
        <Show keyed when={selectedWorkflowRunId()}>
          {(runId) => (
            <WorkflowRunDetailPanel
              runId={runId}
              initialDetail={route.kind === "workflows" && route.initialSelectedRun?.run.id === runId ? route.initialSelectedRun : null}
              onClose={() => updateWorkflowRun(null)}
            />
          )}
        </Show>
      </AppWorkspace.Detail>
    </AppWorkspace.Content>
  );
}
