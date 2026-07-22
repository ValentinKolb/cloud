import type { HelpDocumentManifest } from "@valentinkolb/cloud/shared";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import GridsLayoutHelpRegistrar from "../help/GridsLayoutHelpRegistrar.island";
import RememberGridsPath from "../sidebar/RememberGridsPath.island";
import GridsRoute from "./GridsRoute.island";
import GridsSidebar from "./GridsSidebar";
import WorkspaceMetadataRefresh from "./WorkspaceMetadataRefresh.island";
import { workspaceRootClass } from "./workspace-layout";
import type { OkWorkspaceState, WorkspaceCatalog } from "./workspace-state-model";

const emptyClientCatalog = (): WorkspaceCatalog => ({
  dashboards: [],
  workflows: [],
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
    case "records":
    case "queryResultView":
      catalog.tables = state.catalog.tables;
      catalog.fieldsByTable = state.catalog.fieldsByTable;
      catalog.viewsByTable = state.catalog.viewsByTable;
      catalog.tableShortIds = state.catalog.tableShortIds;
      break;
    case "dashboard":
      catalog.dashboards = state.catalog.dashboards;
      catalog.tables = state.catalog.tables;
      catalog.fieldsByTable = state.catalog.fieldsByTable;
      catalog.viewsByTable = state.catalog.viewsByTable;
      catalog.formsByTable = state.catalog.formsByTable;
      break;
    case "workflows":
      catalog.tables = state.catalog.tables;
      catalog.workflows = state.catalog.workflows;
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

export default function GridsWorkspace(props: { state: OkWorkspaceState; helpDocuments: readonly HelpDocumentManifest[] }) {
  return (
    <>
      <RememberGridsPath path={props.state.rememberPath} />
      <WorkspaceMetadataRefresh baseId={props.state.base.id} initialCursor={props.state.metadataEventCursor} />
      <AppWorkspace class={workspaceRootClass(props.state.adminModeRequested)}>
        <GridsLayoutHelpRegistrar documents={props.helpDocuments} />
        <GridsSidebar state={props.state} />
        <AppWorkspace.Content>
          <GridsRoute state={routeClientState(props.state)} />
        </AppWorkspace.Content>
      </AppWorkspace>
    </>
  );
}
