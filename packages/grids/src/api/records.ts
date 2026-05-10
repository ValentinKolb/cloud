import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  GridRecordSchema,
  RecordPayloadSchema,
  FilterTreeSchema,
  SortSpecSchema,
} from "../contracts";
import { gateAt } from "./permissions";

/**
 * Query-param schema for `GET /records/by-table/:tableId/export`. Adds
 * up-front validation so a malformed `filter` / `sort` / `fields` returns
 * a clean 400 instead of being parsed deep inside the service layer
 * (chunk 7 important). Format is restricted to csv|json; filter and
 * sort go through the same FilterTreeSchema / SortSpecSchema as the
 * unified query endpoint; fields is a comma-separated UUID list.
 */
const ExportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
  filter: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s) return null;
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "filter is not valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(FilterTreeSchema.nullable()),
  sort: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s) return [];
      try {
        const parsed = JSON.parse(s);
        if (!Array.isArray(parsed)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sort must be a JSON array" });
          return z.NEVER;
        }
        return parsed as unknown[];
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sort is not valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.array(SortSpecSchema)),
  fields: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((p) => p.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid())),
});

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // GET /by-table/:tableId (list) deleted in Wave 6.1.
  // The unified POST /tables/:id/query (api/tables.ts) supersedes it
  // with the same filter/sort/cursor semantics plus search merging.
  // No frontend callers remained at the time of removal.

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

  // Note: prefixed with `/by-table/` so the route doesn't clash with
  // the catch-all `/:tableId/:recordId` GET handler above.
  .get(
    "/by-table/:tableId/export",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Export records as CSV or JSON (view-aware)",
      responses: {
        200: { description: "Export body — Content-Type matches format" },
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("query", ExportQuerySchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { format, filter, sort, fields } = c.req.valid("query");
      const result = await gridsService.exporter.exportRecords({
        tableId,
        format,
        filter,
        sort,
        visibleFieldIds: fields.length > 0 ? fields : undefined,
      });
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);

      return new Response(result.data.body, {
        status: 200,
        headers: {
          "Content-Type": result.data.contentType,
          "Content-Disposition": `attachment; filename="${result.data.filename}"`,
          // Tell the client we hit the cap so the UI can warn the user.
          "X-Truncated": result.data.truncated ? "1" : "0",
        },
      });
    },
  )

  // POST /aggregate/:tableId and POST /group/:tableId deleted in Wave
  // 6.1. The unified POST /tables/:id/query (api/tables.ts) handles
  // both group and footer-aggregate dispatch. No frontend callers
  // remained at the time of removal.

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
  )

  .get(
    "/:tableId/:recordId/audit",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "List audit entries for a record",
      description:
        "Returns the most-recent 50 entries from grids.audit_log for the record, " +
        "with the actor's display name resolved. Newest first.",
      responses: { 200: { description: "Audit entries" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const recordId = c.req.param("recordId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const items = await gridsService.audit.listByRecord(tableId, recordId, 50);
      return c.json({ items });
    },
  );

export default app;
