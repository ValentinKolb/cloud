import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { gridsService } from "../service";
import { createWorkflowCatalogRoutes } from "./workflow-catalog-routes";
import { createWorkflowRunRoutes } from "./workflow-run-routes";
import { createWorkflowTriggerRoutes } from "./workflow-trigger-routes";

export { permissionedWorkflowCatalog } from "./workflow-api-shared";

export const createWorkflowsApi = (
  deps: { requireAuthenticated?: MiddlewareHandler<AuthContext>; workflowTriggerRuntime?: typeof gridsService.workflowTriggerRuntime } = {},
) => {
  const workflowTriggerRuntime = deps.workflowTriggerRuntime ?? gridsService.workflowTriggerRuntime;
  return new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .route("/", createWorkflowCatalogRoutes(workflowTriggerRuntime))
    .route("/", createWorkflowRunRoutes())
    .route("/", createWorkflowTriggerRoutes(workflowTriggerRuntime));
};

export default createWorkflowsApi();
