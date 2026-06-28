import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema, hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { z } from "zod";
import { BaseSchema, BaseListSchema, CreateBaseSchema, UpdateBaseSchema, TableSchema, FieldSchema, DashboardSchema } from "../contracts";
import { gateAt } from "./permissions";

const TrashResponseSchema = z.object({
  tables: z.array(TableSchema),
  fields: z.array(FieldSchema),
  dashboards: z.array(DashboardSchema),
  // Forms are returned as opaque records — the FormSchema isn't
  // exported from contracts.ts (it lives in api/forms.ts since the
  // public-facing shape strips fields the trash UI doesn't need).
  // The trash list cares about id / name / table_id / deleted_at.
  forms: z.array(z.unknown()),
});

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "List bases the user can access",
      responses: { 200: jsonResponse(BaseListSchema, "Bases") },
    }),
    v(
      "query",
      z.object({
        q: z.string().optional().default(""),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
        offset: z.coerce.number().int().min(0).optional().default(0),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const { q, limit, offset } = c.req.valid("query");
      const result = await gridsService.base.listVisible({
        userId: user.id,
        userGroups: user.memberofGroupIds,
        isAdmin: hasRole(user, "admin"),
        query: q,
        limit,
        offset,
      });
      return c.json({ ...result, limit, offset });
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
      return respond(c, () => gridsService.base.create({ name: body.name, description: body.description ?? null }, user.id), 201);
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
      const baseId = c.req.param("baseId")!;
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
      const baseId = c.req.param("baseId")!;
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
      summary: "Delete a base (soft-delete; restorable for 30 days)",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.base.remove(baseId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:baseId/restore",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "Restore a soft-deleted base",
      responses: {
        200: jsonResponse(BaseSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.base.restore(baseId, user.id));
    },
  )

  .get(
    "/:baseId/trash",
    describeRoute({
      tags: ["Grids:Base"],
      summary: "List soft-deleted resources for a base (tables, fields, dashboards, forms)",
      description:
        "Returns trashed tables, fields, dashboards, and forms grouped by resource type. " +
        "Fields/forms whose parent table is itself trashed are excluded — they restore alongside the table.",
      responses: {
        200: jsonResponse(TrashResponseSchema, "Trashed resources"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      // Trash management is a structural / recovery action — base-admin only.
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const [tables, fields, dashboards, forms] = await Promise.all([
        gridsService.table.listTrashedByBase(baseId),
        gridsService.field.listTrashedByBase(baseId),
        gridsService.dashboard.listTrashedByBase(baseId),
        // Forms is keyed by tableId, but listTrashedByBase joins
        // through tables for us. Returns full Form objects; the UI
        // only needs id / name / tableId / deletedAt though.
        gridsService.form.listTrashedByBase(baseId),
      ]);
      return c.json({ tables, fields, dashboards, forms });
    },
  );

export default app;
