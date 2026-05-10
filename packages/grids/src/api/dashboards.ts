import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import {
  DashboardSchema,
  DashboardListSchema,
  CreateDashboardSchema,
  UpdateDashboardSchema,
} from "../contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { gateAt, resolveWithGrants, hasExplicitGrant } from "./permissions";

// =============================================================================
// /api/grids/dashboards
//
// Permission rules mirror /api/grids/views:
//   - Personal dashboard (ownerUserId = caller): caller can do anything.
//   - Shared dashboard (ownerUserId = null): structural — gated to
//     base-admin, just like shared views, since publishing one affects
//     everyone with base-read.
//   - Read access flows through service.dashboard.listForBase, which
//     applies dashboard_access on top of default visibility.
// =============================================================================

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
      const baseId = c.req.param("baseId");
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const list = await gridsService.dashboard.listForBase({
        baseId,
        userId: user.id,
        userGroups: user.memberofGroupIds,
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
      const baseId = c.req.param("baseId");
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const body = c.req.valid("json");
      // Shared dashboards are catalog-level changes (visible to every
      // base-reader), gated to base-admin. Personal dashboards are
      // user scratchpads — any base-reader can save their own.
      const gate = body.shared
        ? await gateAt(c, { baseId }, "admin")
        : await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.dashboard.create(
            {
              baseId,
              name: body.name,
              description: body.description ?? null,
              config: body.config,
              ownerUserId: body.shared ? null : user.id,
            },
            user.id,
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
      const dashboardId = c.req.param("dashboardId");
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);

      // Gate at the dashboard scope (most specific). The Wave 2.1
      // resolver honours dashboard-level deny grants. Failures land as
      // 404 rather than 403 to avoid leaking the resource's existence.
      const user = c.get("user");
      const { level, grants } = await resolveWithGrants(c, {
        baseId: dashboard.baseId,
        dashboardId: dashboard.id,
      });
      if (!gridsService.permission.hasAtLeast(level, "read")) {
        return c.json({ message: "Dashboard not found" }, 404);
      }

      // Personal dashboards: visible to the owner OR via an explicit
      // dashboard-level grant. Inherited base-read alone does NOT make
      // a personal dashboard visible to a non-owner.
      const isAdmin = hasRole(user, "admin");
      const isOwner = dashboard.ownerUserId === user.id;
      const explicitGrant = hasExplicitGrant(grants, isAdmin, "dashboard", dashboard.id);
      if (dashboard.ownerUserId !== null && !isOwner && !explicitGrant) {
        return c.json({ message: "Dashboard not found" }, 404);
      }
      return c.json(dashboard);
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
      const dashboardId = c.req.param("dashboardId");
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      const user = c.get("user");

      // Locked product rule (review Wave 2 decision): dashboard write
      // requires base-admin regardless of ownership. Personal vs
      // shared only affects READ visibility; writing always escalates
      // to base-admin. Owners who lose admin role can still see their
      // personal dashboard but can no longer edit it.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      return respond(c, () =>
        gridsService.dashboard.update(dashboardId, c.req.valid("json"), user.id),
      );
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
      const dashboardId = c.req.param("dashboardId");
      const dashboard = await gridsService.dashboard.get(dashboardId);
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      const user = c.get("user");
      // Same rule as PATCH: dashboard write = base-admin.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.dashboard.remove(dashboardId, user.id);
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
      const dashboardId = c.req.param("dashboardId");
      const dashboard = await gridsService.dashboard.get(dashboardId, { includeDeleted: true });
      if (!dashboard) return c.json({ message: "Dashboard not found" }, 404);
      const user = c.get("user");
      // Restore is a write — base-admin only, regardless of ownership.
      const gate = await gateAt(c, { baseId: dashboard.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.dashboard.restore(dashboardId, user.id));
    },
  );

export default app;
