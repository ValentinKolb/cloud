import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { TableSchema, TableListSchema, CreateTableSchema, UpdateTableSchema } from "../contracts";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // List tables of a base.
  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "List tables in a base",
      responses: {
        200: jsonResponse(TableListSchema, "Tables"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const tables = await gridsService.table.listByBase(baseId);
      return c.json(tables);
    },
  )

  // Create table under a base.
  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Create a table",
      responses: {
        201: jsonResponse(TableSchema, "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateTableSchema),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(
        c,
        () => gridsService.table.create({ baseId, name: body.name, description: body.description ?? null }, user.id),
        201,
      );
    },
  )

  .get(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Get table",
      responses: {
        200: jsonResponse(TableSchema, "Table"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(table);
    },
  )

  .patch(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Update table",
      responses: { 200: jsonResponse(TableSchema, "Updated") },
    }),
    v("json", UpdateTableSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.table.update(tableId, c.req.valid("json"), user.id));
    },
  )

  .delete(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Delete table",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.table.remove(tableId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
