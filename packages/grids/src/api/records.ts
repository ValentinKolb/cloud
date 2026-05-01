import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  GridRecordSchema,
  RecordPayloadSchema,
  RecordListQuerySchema,
  RecordListResponseSchema,
  AggregateBodySchema,
  AggregateResponseSchema,
} from "../contracts";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "List records of a table (keyset paginated)",
      responses: {
        200: jsonResponse(RecordListResponseSchema, "Records page"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("query", RecordListQuerySchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const query = c.req.valid("query");
      return respond(c, () =>
        gridsService.record.list({
          tableId,
          cursor: query.cursor ?? null,
          limit: query.limit,
          includeDeleted: query.includeDeleted,
          filter: query.filter ?? null,
          sort: query.sort,
        }),
      );
    },
  )

  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Create a record",
      responses: {
        201: jsonResponse(GridRecordSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("json", RecordPayloadSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.record.create(tableId, c.req.valid("json"), user.id), 201);
    },
  )

  .get(
    "/:tableId/:recordId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Get a record",
      responses: {
        200: jsonResponse(GridRecordSchema, "Record"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const recordId = c.req.param("recordId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const record = await gridsService.record.get(tableId, recordId);
      if (!record) return c.json({ message: "Record not found" }, 404);
      return c.json(record);
    },
  )

  .patch(
    "/:tableId/:recordId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Update a record (optimistic lock via If-Match: <version>)",
      responses: {
        200: jsonResponse(GridRecordSchema, "Updated"),
        409: jsonResponse(ErrorResponseSchema, "Version conflict"),
      },
    }),
    v("json", RecordPayloadSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const recordId = c.req.param("recordId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const ifMatchHeader = c.req.header("If-Match");
      const ifMatchVersion = ifMatchHeader ? Number(ifMatchHeader) : undefined;
      const user = c.get("user");
      return respond(c, () =>
        gridsService.record.update(tableId, recordId, c.req.valid("json"), user.id, ifMatchVersion),
      );
    },
  )

  .delete(
    "/:tableId/:recordId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Soft-delete a record",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const recordId = c.req.param("recordId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.record.softDelete(tableId, recordId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/aggregate/:tableId",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Compute footer aggregates over a (filtered) table",
      responses: {
        200: jsonResponse(AggregateResponseSchema, "Aggregate values keyed by <fieldId>__<agg>"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("json", AggregateBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const body = c.req.valid("json");
      const result = await gridsService.record.aggregate({
        tableId,
        filter: body.filter ?? null,
        requests: body.requests,
      });
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.json({ results: result.data });
    },
  )

  .post(
    "/:tableId/:recordId/restore",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Restore a soft-deleted record",
      responses: { 204: { description: "Restored" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const recordId = c.req.param("recordId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.record.restore(tableId, recordId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
