import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema, hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  BaseSchema,
  BaseListSchema,
  CreateBaseSchema,
  UpdateBaseSchema,
} from "../contracts";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "List bases the user can access",
      responses: { 200: jsonResponse(BaseListSchema, "Bases") },
    }),
    async (c) => {
      const user = c.get("user");
      const all = await gridsService.base.list();
      // Platform admins see every base. Non-admins see only those they have
      // at least read on. Without this admin bypass, ops staff couldn't list
      // bases for recovery / troubleshooting.
      if (hasRole(user, "admin")) return c.json(all);
      const visible = await Promise.all(
        all.map(async (b) => {
          const grants = await gridsService.permission.loadGrants({
            userId: user.id,
            userGroups: user.memberofGroupIds,
            baseId: b.id,
          });
          const level = gridsService.permission.resolve(grants, { baseId: b.id });
          return gridsService.permission.hasAtLeast(level, "read") ? b : null;
        }),
      );
      return c.json(visible.filter((b): b is NonNullable<typeof b> => b !== null));
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "Create a base",
      responses: {
        201: jsonResponse(BaseSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("json", CreateBaseSchema),
    async (c) => {
      const user = c.get("user");
      // Anyone authenticated can create a base; they become its admin via
      // the auto-grant in the service (added in Phase 1C ACL UI). For now,
      // creator owns the base implicitly via created_by.
      const body = c.req.valid("json");
      return respond(
        c,
        () => gridsService.base.create({ name: body.name, description: body.description ?? null }, user.id),
        201,
      );
    },
  )

  .get(
    "/:baseId",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "Get a base",
      responses: {
        200: jsonResponse(BaseSchema, "Base"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const base = await gridsService.base.get(baseId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      return c.json(base);
    },
  )

  .patch(
    "/:baseId",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "Update base metadata",
      responses: {
        200: jsonResponse(BaseSchema, "Updated"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", UpdateBaseSchema),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(c, () => gridsService.base.update(baseId, body, user.id));
    },
  )

  .delete(
    "/:baseId",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "Delete a base",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.base.remove(baseId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
