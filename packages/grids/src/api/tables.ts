import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateTableSchema,
  RecordActorListResponseSchema,
  RecordMetaUserKeySchema,
  RelationLookupResponseSchema,
  TableListSchema,
  TableSchema,
  UpdateTableSchema,
} from "../contracts";
import { gridsService } from "../service";
import { currentActorUserId, gateAt } from "./permissions";
import { tableQueryRoutes } from "./table-query-routes";

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
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const tables = await gridsService.table.listByBase(baseId);
      const visible = [];
      for (const table of tables) {
        const tableGate = await gateAt(c, { baseId, tableId: table.id }, "read");
        if (tableGate.ok) visible.push(table);
      }
      return c.json(visible);
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
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const body = c.req.valid("json");
      return respond(
        c,
        () =>
          gridsService.table.create(
            {
              baseId,
              name: body.name,
              description: body.description ?? null,
              icon: body.icon ?? null,
              columns: body.columns,
              displayConfig: body.displayConfig,
            },
            currentActorUserId(c),
          ),
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
      const tableId = c.req.param("tableId")!;
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.table.update(tableId, c.req.valid("json"), currentActorUserId(c)));
    },
  )

  .delete(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Delete table (soft-delete; restorable for 30 days)",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.table.remove(tableId, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:tableId/restore",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Restore a soft-deleted table",
      responses: {
        200: jsonResponse(TableSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId, { includeDeleted: true });
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.table.restore(tableId, currentActorUserId(c)));
    },
  )

  .route("/", tableQueryRoutes)

  .get(
    "/:tableId/record-actors",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Search users available for record metadata filters",
      responses: {
        200: jsonResponse(RecordActorListResponseSchema, "Record actors"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Table not found"),
      },
    }),
    v(
      "query",
      z.object({
        kind: z
          .union([RecordMetaUserKeySchema, z.literal("any")])
          .optional()
          .default("any"),
        q: z.string().optional().default(""),
        ids: z
          .string()
          .optional()
          .default("")
          .transform((s) =>
            s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          )
          .pipe(z.array(z.string().uuid()).max(50)),
        limit: z.coerce.number().int().min(1).max(50).optional().default(12),
      }),
    ),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { kind, q, ids, limit } = c.req.valid("query");
      const items = await gridsService.record.listActors({ tableId, kind, q, ids, limit });
      return c.json({ items });
    },
  )

  // Relation-picker search. Returns up to N records of the target table,
  // pre-labelled, so the client doesn't need to know about `presentable`.
  // Permission: needs `read` on the target table — same as listing it.
  .get(
    "/:tableId/lookup",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Search records of this table for the relation picker",
      responses: {
        200: jsonResponse(RelationLookupResponseSchema, "Lookup results"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Table not found"),
      },
    }),
    // Zod coerces and validates lookup params up front so invalid
    // limits and UUID lists surface as clean 400s.
    v(
      "query",
      z.object({
        q: z.string().optional().default(""),
        limit: z.coerce.number().int().min(1).max(50).optional().default(10),
        excludeIds: z
          .string()
          .optional()
          .default("")
          .transform((s) =>
            s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          )
          .pipe(z.array(z.string().uuid())),
      }),
    ),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { q, limit, excludeIds } = c.req.valid("query");

      const result = await gridsService.relations.lookup({
        targetTableId: tableId,
        q,
        limit,
        excludeIds,
      });
      return c.json(result);
    },
  );

export default app;
