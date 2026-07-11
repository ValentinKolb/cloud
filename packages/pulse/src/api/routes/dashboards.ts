import { jsonResponse, respond, respondMessage, v, type AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { pulseService } from "../../service";
import {
  CreateDashboardSchema,
  DashboardDslCompileResultSchema,
  DashboardDslCompileSchema,
  DashboardSchema,
  UpdateDashboardSchema,
} from "../schemas";
import { requireUuidParam } from "../shared";

const routes = new Hono<AuthContext>()
  .get(
    "/bases/:baseId/dashboards",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse dashboards for a base",
      responses: { 200: jsonResponse(z.array(DashboardSchema), "Pulse dashboards") },
    }),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.dashboard.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/dashboards",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse dashboard",
      responses: { 201: jsonResponse(DashboardSchema, "Created Pulse dashboard") },
    }),
    v("json", CreateDashboardSchema),
    async (c) =>
      respond(
        c,
        (() => {
          const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
          if (!baseId.ok) return baseId.result;
          return pulseService.dashboard.create({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") });
        })(),
        201,
      ),
  )
  .patch(
    "/dashboards/:dashboardId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update a Pulse dashboard",
      responses: { 200: jsonResponse(DashboardSchema, "Updated Pulse dashboard") },
    }),
    v("json", UpdateDashboardSchema),
    async (c) => {
      const dashboardId = requireUuidParam(c.req.param("dashboardId"), "dashboard ID");
      if (!dashboardId.ok) return respond(c, dashboardId.result);
      return respond(c, pulseService.dashboard.update({ dashboardId: dashboardId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .delete("/dashboards/:dashboardId", async (c) => {
    const dashboardId = requireUuidParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respondMessage(c, pulseService.dashboard.remove({ dashboardId: dashboardId.value, user: c.get("user") }), "Dashboard removed");
  })
  .post("/dashboards/:dashboardId/public-token", async (c) => {
    const dashboardId = requireUuidParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respond(c, pulseService.dashboard.enablePublic({ dashboardId: dashboardId.value, user: c.get("user") }));
  })
  .delete("/dashboards/:dashboardId/public-token", async (c) => {
    const dashboardId = requireUuidParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respond(c, pulseService.dashboard.disablePublic({ dashboardId: dashboardId.value, user: c.get("user") }));
  })
  .post(
    "/dashboard-dsl/compile",
    describeRoute({
      tags: ["Pulse"],
      summary: "Compile a Pulse dashboard DSL document without saving it",
      responses: { 200: jsonResponse(DashboardDslCompileResultSchema, "Dashboard DSL diagnostics and config") },
    }),
    v("json", DashboardDslCompileSchema),
    async (c) => respond(c, pulseService.dashboard.compileDsl({ ...c.req.valid("json"), user: c.get("user") })),
  );

export default routes;
