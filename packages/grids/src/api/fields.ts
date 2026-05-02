import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  FieldSchema,
  FieldListSchema,
  CreateFieldSchema,
  UpdateFieldSchema,
  ReorderFieldsSchema,
  FieldDependentsResponseSchema,
} from "../contracts";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "List fields of a table",
      responses: { 200: jsonResponse(FieldListSchema, "Fields") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const fields = await gridsService.field.listByTable(tableId);
      return c.json(fields);
    },
  )

  .post(
    "/by-table/:tableId/reorder",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "Reorder fields of a table",
      description:
        "Sets each field's `position` to its index in the supplied id list. " +
        "Ids that don't belong to the table are silently skipped.",
      responses: { 204: { description: "Reordered" } },
    }),
    v("json", ReorderFieldsSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const { fieldIds } = c.req.valid("json");
      const result = await gridsService.field.reorder(tableId, fieldIds, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "Create a field",
      responses: {
        201: jsonResponse(FieldSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("json", CreateFieldSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(c, () => gridsService.field.create({ tableId, ...body }, user.id), 201);
    },
  )

  .get(
    "/:fieldId/dependents",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "Pre-flight: where is this field referenced?",
      responses: { 200: jsonResponse(FieldDependentsResponseSchema, "Dependents") },
    }),
    async (c) => {
      const fieldId = c.req.param("fieldId");
      const field = await gridsService.field.get(fieldId);
      if (!field) return c.json({ message: "Field not found" }, 404);
      const table = await gridsService.table.get(field.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: field.tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const deps = await gridsService.fieldDependents.get(fieldId);
      return c.json({ dependents: deps, hasBlocking: gridsService.fieldDependents.hasBlocking(deps) });
    },
  )

  .patch(
    "/:fieldId",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "Update field metadata",
      responses: { 200: jsonResponse(FieldSchema, "Updated") },
    }),
    v("json", UpdateFieldSchema),
    async (c) => {
      const fieldId = c.req.param("fieldId");
      const field = await gridsService.field.get(fieldId);
      if (!field) return c.json({ message: "Field not found" }, 404);
      const table = await gridsService.table.get(field.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: field.tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.field.update(fieldId, c.req.valid("json"), user.id));
    },
  )

  .delete(
    "/:fieldId",
    describeRoute({
      tags: ["Grids:Field"],
      summary: "Soft-delete a field (rejects if blocking dependents exist)",
      responses: {
        204: { description: "Deleted" },
        409: jsonResponse(ErrorResponseSchema, "Blocking dependents exist"),
      },
    }),
    async (c) => {
      const fieldId = c.req.param("fieldId");
      const field = await gridsService.field.get(fieldId);
      if (!field) return c.json({ message: "Field not found" }, 404);
      const table = await gridsService.table.get(field.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: field.tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const deps = await gridsService.fieldDependents.get(fieldId);
      if (gridsService.fieldDependents.hasBlocking(deps)) {
        return c.json(
          {
            message: "Field has blocking dependents — remove them before deleting",
            dependents: deps.filter((d) => d.blocking),
          },
          409,
        );
      }
      const user = c.get("user");
      const result = await gridsService.field.softDelete(fieldId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
