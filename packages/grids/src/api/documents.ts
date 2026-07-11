import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { createDocumentLinkRoutes } from "./document-link-routes";
import { createDocumentRenderRoutes } from "./document-render-routes";
import { createDocumentRunRoutes } from "./document-run-routes";
import { createDocumentSnapshotRoutes } from "./document-snapshot-routes";
import { createDocumentTemplateRoutes } from "./document-template-routes";

export const createDocumentsApi = (deps: { requireAuthenticated?: MiddlewareHandler<AuthContext> } = {}) =>
  new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))

    .route("/", createDocumentTemplateRoutes())

    .route("/", createDocumentRenderRoutes())

    .route("/", createDocumentRunRoutes())

    .route("/", createDocumentLinkRoutes())

    .route("/", createDocumentSnapshotRoutes());

export default createDocumentsApi();
