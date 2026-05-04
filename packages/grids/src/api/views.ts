import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import {
  ViewSchema,
  ViewListSchema,
  CreateViewSchema,
  UpdateViewSchema,
} from "../contracts";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "List views visible on a table",
      responses: { 200: jsonResponse(ViewListSchema, "Views") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const list = await gridsService.view.listForTable({
        tableId,
        userId: user.id,
        userGroups: user.memberofGroupIds,
      });
      return c.json(list);
    },
  )

  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Create a view (shared or personal)",
      responses: {
        201: jsonResponse(ViewSchema, "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateViewSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      // Personal views require only read; shared views require write so a
      // table-reader can't pollute the shared view list.
      const body = c.req.valid("json");
      const requiredLevel = body.shared ? "write" : "read";
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, requiredLevel);
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () => gridsService.view.create(
          {
            tableId,
            name: body.name,
            query: body.query,
            ownerUserId: body.shared ? null : user.id,
          },
          user.id,
        ),
        201,
      );
    },
  )

  .get(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Get a single view",
      responses: {
        200: jsonResponse(ViewSchema, "View"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: view.tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      // Personal views: only the owner can read
      const user = c.get("user");
      if (view.ownerUserId !== null && view.ownerUserId !== user.id) {
        return c.json({ message: "View not found" }, 404);
      }
      return c.json(view);
    },
  )

  .patch(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Update a view",
      responses: {
        200: jsonResponse(ViewSchema, "Updated"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", UpdateViewSchema),
    async (c) => {
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      // Personal view: only the owner can edit. Shared view: requires
      // table-write.
      const user = c.get("user");
      const isOwner = view.ownerUserId === user.id;
      const requiredLevel = view.ownerUserId === null ? "write" : "read";
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, requiredLevel);
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (view.ownerUserId !== null && !isOwner) {
        return c.json({ message: "Only the owner can edit a personal view" }, 403);
      }
      return respond(c, () => gridsService.view.update(viewId, c.req.valid("json"), user.id));
    },
  )

  .delete(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Delete a view",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const user = c.get("user");
      const isOwner = view.ownerUserId === user.id;
      const requiredLevel = view.ownerUserId === null ? "write" : "read";
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, requiredLevel);
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (view.ownerUserId !== null && !isOwner) {
        return c.json({ message: "Only the owner can delete a personal view" }, 403);
      }
      const result = await gridsService.view.remove(viewId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:viewId/restore",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Restore a soft-deleted view",
      responses: {
        200: jsonResponse(ViewSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId, { includeDeleted: true });
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const user = c.get("user");
      const isOwner = view.ownerUserId === user.id;
      const requiredLevel = view.ownerUserId === null ? "write" : "read";
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, requiredLevel);
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (view.ownerUserId !== null && !isOwner) {
        return c.json({ message: "Only the owner can restore a personal view" }, 403);
      }
      return respond(c, () => gridsService.view.restore(viewId, user.id));
    },
  );

export default app;
