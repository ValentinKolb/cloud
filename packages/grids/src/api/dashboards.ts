import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateDashboardSchema,
  type Dashboard,
  DashboardListSchema,
  DashboardSchema,
  UpdateDashboardSchema,
  WidgetSchema,
  WorkflowRunSchema,
} from "../contracts";
import { gridsService } from "../service";
import { resolveWidgetData } from "../service/dashboard-widget-data";
import { currentActorUser, currentActorUserId, currentActorViewer, gateAt, hasExplicitGrant, resolveWithGrants } from "./permissions";

// =============================================================================
// /api/grids/dashboards
//
// Permission rules (locked Wave 2 product decision — diverges from views):
//   - WRITE (POST/PATCH/DELETE/RESTORE) requires base-admin, regardless
//     of ownership. Owners who lose admin role keep read access on
//     their personal dashboard but cannot edit/delete it.
//   - READ visibility follows the view-style "default-shared, grant
//     overrides" rule: shared dashboards visible to base-readers,
//     personal dashboards to owner-or-explicit-grant. The direct GET
//     handler enforces this; listForBase mirrors it in SQL.
// =============================================================================

const canReadDashboardForRequest = async (c: Context<AuthContext>, dashboard: Dashboard): Promise<boolean> => {
  const viewer = currentActorViewer(c);
  const { level, grants } = await resolveWithGrants(c, {
    baseId: dashboard.baseId,
    dashboardId: dashboard.id,
  });
  if (!gridsService.permission.hasAtLeast(level, "read")) return false;

  const isOwner = dashboard.ownerUserId === viewer.userId;
  const explicitGrant = hasExplicitGrant(grants, "dashboard", dashboard.id);
  if (dashboard.ownerUserId !== null && !isOwner && !explicitGrant) return false;
  return true;
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "List dashboards visible on a base",
      responses: { 200: jsonResponse(DashboardListSchema, "Dashboards") },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const list = await gridsService.dashboard.listForBase({
        baseId,
        ...currentActorViewer(c),
      });
      return c.json(list);
    },
  )

  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Create a dashboard (shared or personal)",
      responses: {
        201: jsonResponse(DashboardSchema, "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateDashboardSchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const body = c.req.valid("json");
      // Locked product rule: dashboard write requires base-admin
      // regardless of ownership — same as PATCH/DELETE/RESTORE. A
      // table-reader cannot create a personal dashboard they couldn't
      // later edit anyway. Read access still has the usual personal-vs-
      // shared visibility (see direct GET).
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = currentActorUser(c);
      if (!body.shared && !user) return c.json({ message: "Sign in to create a personal dashboard." }, 403);
      return respond(
        c,
        () =>
          gridsService.dashboard.create(
            {
              baseId,
              name: body.name,
              description: body.description ?? null,
              icon: body.icon ?? null,
              config: body.config,
              ownerUserId: body.shared ? null : (user?.id ?? null),
            },
            currentActorUserId(c),
          ),
        201,
      );
    },
  )

  .get(
    "/:dashboardId",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Get a single dashboard",
      responses: {
        200: jsonResponse(DashboardSchema, "Dashboard"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);

      // Gate at the dashboard scope (most specific). The Wave 2.1
      // resolver honours dashboard-level deny grants. Failures land as
      // 404 rather than 403 to avoid leaking the resource's existence.
      if (!(await canReadDashboardForRequest(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);
      return c.json(dashboard);
    },
  )

  .post(
    "/:dashboardId/widgets/resolve",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Resolve one dashboard widget",
      responses: {
        200: { description: "Resolved widget data" },
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", WidgetSchema),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);

      const writeGate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!writeGate.ok) return respond(c, () => Promise.resolve(writeGate));

      if (!(await canReadDashboardForRequest(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);

      const viewer = currentActorViewer(c);
      const data = await resolveWidgetData(c.req.valid("json"), viewer, {
        dateConfig: await getDateConfig(c),
      });
      return c.json(data);
    },
  )

  .post(
    "/:dashboardId/widgets/:widgetId/run",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Run a dashboard workflow button",
      responses: {
        200: jsonResponse(WorkflowRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const widgetId = c.req.param("widgetId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      if (!(await canReadDashboardForRequest(c, dashboard))) return c.json({ message: "Dashboard not found" }, 404);

      const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === widgetId);
      if (!widget || widget.kind !== "workflow-button") return c.json({ message: "Widget not found" }, 404);

      const workflow = await gridsService.workflow.get(widget.workflowId);
      if (!workflow || workflow.baseId !== dashboard.baseId) return c.json({ message: "Workflow not found" }, 404);
      if (!workflow.compiled.triggers.dashboardButton) return c.json({ message: "Workflow has no dashboard button trigger" }, 400);
      if (!workflow.enabled) return c.json({ message: "Workflow is disabled" }, 400);
      const workflowGate = await gateAt(c, { baseId: workflow.baseId, workflowId: workflow.id }, "write");
      if (!workflowGate.ok) return respond(c, () => Promise.resolve(workflowGate));

      const viewer = currentActorViewer(c);
      return respond(c, () =>
        gridsService.workflow.execute({
          workflowId: workflow.id,
          triggerKind: "dashboardButton",
          actorUserId: viewer.userId,
          actorGroupIds: viewer.userGroups,
          serviceAccountId: viewer.serviceAccountId,
          triggerInput: {
            dashboardId: dashboard.id,
            dashboardWidgetId: widget.id,
          },
        }),
      );
    },
  )

  .patch(
    "/:dashboardId",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Update a dashboard",
      responses: {
        200: jsonResponse(DashboardSchema, "Updated"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", UpdateDashboardSchema),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      const body = c.req.valid("json");
      if (body.shared === false && !currentActorUser(c)) return c.json({ message: "Sign in to make this dashboard personal." }, 403);

      // Locked product rule (review Wave 2 decision): dashboard write
      // requires base-admin regardless of ownership. Personal vs
      // shared only affects READ visibility; writing always escalates
      // to base-admin. Owners who lose admin role can still see their
      // personal dashboard but can no longer edit it.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      return respond(c, () => gridsService.dashboard.update(dashboardId, body, currentActorUserId(c)));
    },
  )

  .delete(
    "/:dashboardId",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Delete a dashboard",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      // Same rule as PATCH: dashboard write = base-admin.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.dashboard.remove(dashboardId, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:dashboardId/restore",
    describeRoute({
      tags: ["Grids:Dashboard"],
      summary: "Restore a soft-deleted dashboard",
      responses: {
        200: jsonResponse(DashboardSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const dashboard = await gridsService.dashboard.get(dashboardId, { includeDeleted: true });
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      // Restore is a write — base-admin only, regardless of ownership.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.dashboard.restore(dashboardId, currentActorUserId(c)));
    },
  );

export default app;
