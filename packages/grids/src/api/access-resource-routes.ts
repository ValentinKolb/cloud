import { AccessEntrySchema, ErrorResponseSchema, GrantAccessSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  type AccessResourceType,
  grantAccess,
  listBaseAccess,
  listDashboardAccess,
  listDocumentTemplateAccess,
  listFormAccess,
  listTableAccess,
  listViewAccess,
  listWorkflowAccess,
  resolveResourceBinding,
  validateAccessPermission,
} from "../service/access";
import { get as getTable } from "../service/tables";
import { get as getWorkflow } from "../service/workflows";
import { currentActorUserId, gateAt } from "./permissions";

const AccessListSchema = z.array(AccessEntrySchema);
const CreatedAccessSchema = z.object({ accessId: z.string().uuid() });

type AccessRouteConfig = {
  resourceType: AccessResourceType;
  path: string;
  param: string;
  label: string;
  grantSummary: string;
  grantError: string;
  resolveBaseId: (resourceId: string) => Promise<string | null>;
  list: (resourceId: string) => ReturnType<typeof listBaseAccess>;
};

type AccessRouteDeps = { gate: typeof gateAt; actorId: typeof currentActorUserId };
const defaultDeps: AccessRouteDeps = { gate: gateAt, actorId: currentActorUserId };

const resolveRegisteredResource = async (resourceType: Exclude<AccessResourceType, "base" | "table" | "workflow">, resourceId: string) => {
  const binding = await resolveResourceBinding(resourceType, resourceId, {
    includeDeleted: resourceType === "documentTemplate" ? false : undefined,
  });
  return binding?.baseId ?? null;
};

const ACCESS_ROUTE_CONFIGS = {
  base: {
    resourceType: "base",
    path: "/by-base/:baseId",
    param: "baseId",
    label: "Base",
    grantSummary: "Grant access on a base",
    grantError: "Invalid base permission",
    resolveBaseId: async (baseId) => baseId,
    list: listBaseAccess,
  },
  table: {
    resourceType: "table",
    path: "/by-table/:tableId",
    param: "tableId",
    label: "Table",
    grantSummary: "Grant access on a table (only 'read' / 'write' / 'none' accepted)",
    grantError: "Table only accepts level 'read' / 'write' / 'none'",
    resolveBaseId: async (tableId) => (await getTable(tableId))?.baseId ?? null,
    list: listTableAccess,
  },
  view: {
    resourceType: "view",
    path: "/by-view/:viewId",
    param: "viewId",
    label: "View",
    grantSummary: "Grant access on a view (only 'read' / 'admin' / 'none' accepted)",
    grantError: "View only accepts level 'read', 'admin', or 'none'",
    resolveBaseId: (viewId) => resolveRegisteredResource("view", viewId),
    list: listViewAccess,
  },
  form: {
    resourceType: "form",
    path: "/by-form/:formId",
    param: "formId",
    label: "Form",
    grantSummary: "Grant write access on a form (only 'write' / 'none' accepted)",
    grantError: "Form only accepts level 'write' or 'none'",
    resolveBaseId: (formId) => resolveRegisteredResource("form", formId),
    list: listFormAccess,
  },
  documentTemplate: {
    resourceType: "documentTemplate",
    path: "/by-document-template/:templateId",
    param: "templateId",
    label: "Document template",
    grantSummary: "Grant access on a document template (read / write / admin / none)",
    grantError: "Document template only accepts level 'read', 'write', 'admin', or 'none'",
    resolveBaseId: (templateId) => resolveRegisteredResource("documentTemplate", templateId),
    list: listDocumentTemplateAccess,
  },
  dashboard: {
    resourceType: "dashboard",
    path: "/by-dashboard/:dashboardId",
    param: "dashboardId",
    label: "Dashboard",
    grantSummary: "Grant read access on a dashboard (only 'read' / 'none' accepted)",
    grantError: "Dashboard only accepts level 'read' or 'none'",
    resolveBaseId: (dashboardId) => resolveRegisteredResource("dashboard", dashboardId),
    list: listDashboardAccess,
  },
  workflow: {
    resourceType: "workflow",
    path: "/by-workflow/:workflowId",
    param: "workflowId",
    label: "Workflow",
    grantSummary: "Grant access on a workflow (read / write / admin / none)",
    grantError: "Workflow only accepts level 'read', 'write', 'admin', or 'none'",
    resolveBaseId: async (workflowId) => (await getWorkflow(workflowId))?.baseId ?? null,
    list: listWorkflowAccess,
  },
} as const satisfies Record<AccessResourceType, AccessRouteConfig>;

const resourceId = (params: Record<string, string>, config: AccessRouteConfig): string => params[config.param]!;

const listDescription = (config: AccessRouteConfig) =>
  describeRoute({
    tags: ["Grids:Access"],
    summary: `List ACL entries for a ${config.label.toLowerCase()}`,
    responses: {
      200: jsonResponse(AccessListSchema, "Entries"),
      403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      404: jsonResponse(ErrorResponseSchema, `${config.label} not found`),
    },
  });

const grantDescription = (config: AccessRouteConfig) =>
  describeRoute({
    tags: ["Grids:Access"],
    summary: config.grantSummary,
    responses: {
      201: jsonResponse(CreatedAccessSchema, "Created"),
      400: jsonResponse(ErrorResponseSchema, config.grantError),
      403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      404: jsonResponse(ErrorResponseSchema, `${config.label} not found`),
    },
  });

const listResourceAccess = async (c: Context<AuthContext>, config: AccessRouteConfig, deps: AccessRouteDeps) => {
  const id = resourceId(c.req.param(), config);
  const baseId = await config.resolveBaseId(id);
  if (!baseId) return c.json({ message: `${config.label} not found` }, 404);
  const gate = await deps.gate(c, { baseId }, "admin");
  if (!gate.ok) return respond(c, () => Promise.resolve(gate));
  return c.json(await config.list(id));
};

const grantResourceAccess = async (
  c: Context<AuthContext>,
  config: AccessRouteConfig,
  body: z.infer<typeof GrantAccessSchema>,
  deps: AccessRouteDeps,
) => {
  const id = resourceId(c.req.param(), config);
  const baseId = await config.resolveBaseId(id);
  if (!baseId) return c.json({ message: `${config.label} not found` }, 404);
  const validationError = validateAccessPermission(config.resourceType, body.permission);
  if (validationError) return c.json({ message: validationError }, 400);
  const gate = await deps.gate(c, { baseId }, "admin");
  if (!gate.ok) return respond(c, () => Promise.resolve(gate));
  return respond(
    c,
    () =>
      grantAccess({
        resourceType: config.resourceType,
        resourceId: id,
        actorId: deps.actorId(c),
        ...body,
      }),
    201,
  );
};

export const createAccessResourceRoutes = (deps: AccessRouteDeps = defaultDeps) =>
  new Hono<AuthContext>()
    .get("/by-base/:baseId", listDescription(ACCESS_ROUTE_CONFIGS.base), (c) => listResourceAccess(c, ACCESS_ROUTE_CONFIGS.base, deps))
    .post("/by-base/:baseId", grantDescription(ACCESS_ROUTE_CONFIGS.base), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.base, c.req.valid("json"), deps),
    )
    .get("/by-table/:tableId", listDescription(ACCESS_ROUTE_CONFIGS.table), (c) => listResourceAccess(c, ACCESS_ROUTE_CONFIGS.table, deps))
    .post("/by-table/:tableId", grantDescription(ACCESS_ROUTE_CONFIGS.table), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.table, c.req.valid("json"), deps),
    )
    .get("/by-view/:viewId", listDescription(ACCESS_ROUTE_CONFIGS.view), (c) => listResourceAccess(c, ACCESS_ROUTE_CONFIGS.view, deps))
    .post("/by-view/:viewId", grantDescription(ACCESS_ROUTE_CONFIGS.view), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.view, c.req.valid("json"), deps),
    )
    .get("/by-form/:formId", listDescription(ACCESS_ROUTE_CONFIGS.form), (c) => listResourceAccess(c, ACCESS_ROUTE_CONFIGS.form, deps))
    .post("/by-form/:formId", grantDescription(ACCESS_ROUTE_CONFIGS.form), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.form, c.req.valid("json"), deps),
    )
    .get("/by-document-template/:templateId", listDescription(ACCESS_ROUTE_CONFIGS.documentTemplate), (c) =>
      listResourceAccess(c, ACCESS_ROUTE_CONFIGS.documentTemplate, deps),
    )
    .post("/by-document-template/:templateId", grantDescription(ACCESS_ROUTE_CONFIGS.documentTemplate), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.documentTemplate, c.req.valid("json"), deps),
    )
    .get("/by-dashboard/:dashboardId", listDescription(ACCESS_ROUTE_CONFIGS.dashboard), (c) =>
      listResourceAccess(c, ACCESS_ROUTE_CONFIGS.dashboard, deps),
    )
    .post("/by-dashboard/:dashboardId", grantDescription(ACCESS_ROUTE_CONFIGS.dashboard), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.dashboard, c.req.valid("json"), deps),
    )
    .get("/by-workflow/:workflowId", listDescription(ACCESS_ROUTE_CONFIGS.workflow), (c) =>
      listResourceAccess(c, ACCESS_ROUTE_CONFIGS.workflow, deps),
    )
    .post("/by-workflow/:workflowId", grantDescription(ACCESS_ROUTE_CONFIGS.workflow), v("json", GrantAccessSchema), (c) =>
      grantResourceAccess(c, ACCESS_ROUTE_CONFIGS.workflow, c.req.valid("json"), deps),
    );

export const accessResourceRoutes = createAccessResourceRoutes();
