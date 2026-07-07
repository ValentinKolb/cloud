import { AccessEntrySchema, ErrorResponseSchema, GrantAccessSchema, PermissionLevelSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { gridsService } from "../service";
import { validateAccessLevelForResource } from "./access";

const ScopedAccessEntrySchema = AccessEntrySchema.extend({
  resourceType: z.enum(["base", "table", "view", "form", "documentTemplate", "dashboard", "workflow"]),
  resourceId: z.string().uuid(),
  resourceName: z.string(),
  tableId: z.string().uuid().nullable(),
  tableName: z.string().nullable(),
});
const ScopedAccessListSchema = z.array(ScopedAccessEntrySchema);
const UpdateLevelSchema = z.object({ permission: PermissionLevelSchema });

export const createAdminApi = (deps: { requireAdmin?: MiddlewareHandler<AuthContext> } = {}) => {
  const requireAdmin = deps.requireAdmin ?? auth.requireRole("admin");

  return new Hono<AuthContext>()
    .use(requireAdmin)

    .get(
      "/bases/:baseId/access",
      describeRoute({
        tags: ["Grids:Admin"],
        summary: "List base and child ACL entries as platform admin",
        responses: {
          200: jsonResponse(ScopedAccessListSchema, "Entries"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        return c.json(await gridsService.access.listForBaseTree(baseId));
      },
    )

    .post(
      "/bases/:baseId/access",
      describeRoute({
        tags: ["Grids:Admin"],
        summary: "Grant base access as platform admin",
        responses: {
          201: jsonResponse(AccessEntrySchema, "Created"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", GrantAccessSchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        const user = c.get("user");
        const result = await gridsService.access.grant({
          resourceType: "base",
          resourceId: baseId,
          actorId: user.id,
          ...c.req.valid("json"),
        });
        if (!result.ok) return respond(c, () => Promise.resolve(result));
        const created = (await gridsService.access.listForBase(baseId)).find((entry) => entry.id === result.data.accessId);
        if (!created) return c.json({ message: "Created access entry not found" }, 500);
        return c.json(created, 201);
      },
    )

    .patch(
      "/bases/:baseId/access/:accessId",
      describeRoute({
        tags: ["Grids:Admin"],
        summary: "Update base access as platform admin",
        responses: {
          204: { description: "OK" },
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", UpdateLevelSchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const accessId = c.req.param("accessId")!;
        const binding = await gridsService.access.resolveBinding(accessId);
        if (!binding || binding.baseId !== baseId) {
          return c.json({ message: "Access entry not found" }, 404);
        }
        const user = c.get("user");
        const permission = c.req.valid("json").permission;
        const validationError = validateAccessLevelForResource(binding.resourceType, permission);
        if (validationError) return c.json({ message: validationError }, 400);
        const result = await gridsService.access.updateLevel(accessId, permission, user.id);
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .delete(
      "/bases/:baseId/access/:accessId",
      describeRoute({
        tags: ["Grids:Admin"],
        summary: "Revoke base access as platform admin",
        responses: {
          204: { description: "Revoked" },
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const accessId = c.req.param("accessId")!;
        const binding = await gridsService.access.resolveBinding(accessId);
        if (!binding || binding.baseId !== baseId) {
          return c.json({ message: "Access entry not found" }, 404);
        }
        const user = c.get("user");
        const result = await gridsService.access.revoke(accessId, user.id);
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .delete(
      "/bases/:baseId",
      describeRoute({
        tags: ["Grids:Admin"],
        summary: "Delete a base as platform admin",
        responses: {
          204: { description: "Deleted" },
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        const user = c.get("user");
        const result = await gridsService.base.remove(baseId, user.id);
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    );
};

export default createAdminApi();
