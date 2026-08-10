import { AppWorkspace } from "@k2b/ui";
import RememberGridsPath from "../sidebar/RememberGridsPath.island";
import GridsRoute from "./GridsRoute.island";
import GridsSidebar from "./GridsSidebar";
import WorkspaceMetadataRefresh from "./WorkspaceMetadataRefresh.island";
import { workspaceRootClass } from "./workspace-layout";
import type { OkWorkspaceState, WorkspaceCatalog } from "./workspace-state-model";

const emptyClientCatalog = (): WorkspaceCatalog => ({
  customApps: [],
  workflows: [],
  workflowLaunchers: [],
  workflowLevels: {},
  tables: [],
  tableLevels: {},
  fieldsByTable: {},
  viewsByTable: {},
  formsByTable: {},
  documentTemplatesByTable: {},
  documentTemplateLevels: {},
  tableShortIds: {},
  sidebarForms: [],
  sidebarDocumentTemplates: [],
});

const routeClientState = (state: OkWorkspaceState): OkWorkspaceState => {
  const catalog = emptyClientCatalog();
  switch (state.route.kind) {
    case "customApp":
      catalog.customApps = state.catalog.customApps;
      catalog.tables = state.catalog.tables;
      catalog.fieldsByTable = state.catalog.fieldsByTable;
      catalog.viewsByTable = state.catalog.viewsByTable;
      catalog.formsByTable = state.catalog.formsByTable;
      catalog.workflows = state.catalog.workflows;
      catalog.workflowLevels = state.catalog.workflowLevels;
      catalog.documentTemplatesByTable = state.catalog.documentTemplatesByTable;
      catalog.documentTemplateLevels = state.catalog.documentTemplateLevels;
      break;
    case "records":
    case "queryResultView":
      catalog.tables = state.catalog.tables;
      catalog.fieldsByTable = state.catalog.fieldsByTable;
      catalog.viewsByTable = state.catalog.viewsByTable;
      catalog.tableShortIds = state.catalog.tableShortIds;
      break;
    case "workflows":
      catalog.tables = state.catalog.tables;
      catalog.workflows = state.catalog.workflows;
      catalog.workflowLevels = Object.fromEntries(
        state.catalog.workflows.map((workflow) => [workflow.id, state.catalog.workflowLevels[workflow.id] ?? "none"]),
      );
      break;
    case "query":
      catalog.tables = state.catalog.tables;
      catalog.fieldsByTable = state.catalog.fieldsByTable;
      catalog.viewsByTable = state.catalog.viewsByTable;
      break;
    case "empty":
      catalog.sidebarForms = state.catalog.sidebarForms;
      catalog.sidebarDocumentTemplates = state.catalog.sidebarDocumentTemplates;
      break;
    case "documentTemplate":
      break;
  }
  return { ...state, catalog };
};

export default function GridsWorkspace(props: { state: OkWorkspaceState }) {
  return (
    <>
      <RememberGridsPath path={props.state.rememberPath} />
      <WorkspaceMetadataRefresh baseId={props.state.base.id} initialCursor={props.state.metadataEventCursor} />
      <AppWorkspace class={workspaceRootClass(props.state.adminModeRequested)}>
        <GridsSidebar state={props.state} />
        <AppWorkspace.Content>
          <GridsRoute state={routeClientState(props.state)} />
        </AppWorkspace.Content>
      </AppWorkspace>
    </>
  );
}
