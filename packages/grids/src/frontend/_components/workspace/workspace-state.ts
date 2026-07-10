import { gridsService } from "../../../service";
import { loadWorkspaceRequest } from "./workspace-request-state";
import { loadWorkspaceRoute } from "./workspace-route-state";
import type { GridsWorkspaceState, LoadWorkspaceParams } from "./workspace-state-model";

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

export const loadGridsWorkspaceState = async (params: LoadWorkspaceParams): Promise<GridsWorkspaceState> => {
  const base = await gridsService.base.getByIdOrShortId(params.baseShortId);
  if (!base) return { kind: "notFound", title: "Not found", message: "Base not found" };
  const request = await loadWorkspaceRequest(params, base);
  if ("kind" in request) return request;
  return loadWorkspaceRoute(request);
};
