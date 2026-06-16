import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, v, respond, jsonResponse, getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import * as settings from "@valentinkolb/cloud/services/settings";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { ok, fail, err } from "@valentinkolb/stdlib";
import { gridsService } from "../service";
import { GridRecordSchema, RecordPayloadSchema, ExportBodySchema } from "../contracts";
import { gateAt } from "./permissions";
import { validateRecordQueryForTable } from "../service/query-validation";

const GridFileSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
  fieldId: z.string().uuid(),
  position: z.number().int(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const DEFAULT_MAX_FILE_SIZE_MB = 10;

const getMaxFileSizeBytes = async (): Promise<number> => {
  const mb = await settings.get<number>("grids.max_file_size_mb");
  const resolved = typeof mb === "number" && Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_FILE_SIZE_MB;
  return resolved * 1024 * 1024;
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // GET /by-table/:tableId (list) deleted in Wave 6.1.
  // The unified POST /tables/:id/query (api/tables.ts) supersedes it
  // with the same filter/sort/cursor semantics plus search merging.
  // No frontend callers remained at the time of removal.

  .get(
    "/:tableId/:recordId/files/:fieldId",
    describeRoute({
      tags: ["Grids:File"],
      summary: "List files for a file field on a record",
      responses: {
        200: jsonResponse(z.object({ items: z.array(GridFileSchema) }), "Files"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.file.listForRecordField({ tableId, recordId, fieldId });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return respond(c, ok({ items: result.data }));
    },
  )

  .post(
    "/:tableId/:recordId/files/:fieldId",
    describeRoute({
      tags: ["Grids:File"],
      summary: "Upload a file to a record file field",
      description: `Stores a small file directly in Postgres bytea. Max size is configurable via \`grids.max_file_size_mb\` (default ${DEFAULT_MAX_FILE_SIZE_MB} MB).`,
      responses: {
        200: jsonResponse(GridFileSchema, "Uploaded file metadata"),
        400: jsonResponse(ErrorResponseSchema, "Invalid upload"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        413: jsonResponse(ErrorResponseSchema, "File too large"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return respond(c, fail(err.badInput("Missing 'file' field")));

      const maxBytes = await getMaxFileSizeBytes();
      if (file.size > maxBytes) {
        return c.json({ message: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit` }, 413);
      }

      const user = c.get("user");
      const result = await gridsService.file.upload({
        tableId,
        recordId,
        fieldId,
        filename: file.name || "untitled",
        mimeType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
        userId: user.id,
      });
      return respond(c, () => Promise.resolve(result));
    },
  )

  .get(
    "/:tableId/:recordId/files/:fieldId/:fileId/content",
    describeRoute({
      tags: ["Grids:File"],
      summary: "Download a file field blob",
      responses: {
        200: { description: "File content" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const fileId = c.req.param("fileId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.file.getContent({ tableId, recordId, fieldId, fileId });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      const file = result.data;
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
      const inline = c.req.query("inline") === "true";
      return new Response(new Blob([buffer], { type: file.mimeType }), {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.filename)}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    },
  )

  .delete(
    "/:tableId/:recordId/files/:fieldId/:fileId",
    describeRoute({
      tags: ["Grids:File"],
      summary: "Delete a file field blob",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const fileId = c.req.param("fileId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.file.remove({ tableId, recordId, fieldId, fileId });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.body(null, 204);
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        async () => gridsService.record.create(tableId, c.req.valid("json"), user.id, { dateConfig: await getDateConfig(c) }),
        201,
      );
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
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const record = await gridsService.record.get(tableId, recordId, { dateConfig: await getDateConfig(c) });
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
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const ifMatchHeader = c.req.header("If-Match");
      const ifMatchVersion = ifMatchHeader ? Number(ifMatchHeader) : undefined;
      const user = c.get("user");
      return respond(c, async () =>
        gridsService.record.update(tableId, recordId, c.req.valid("json"), user.id, ifMatchVersion, { dateConfig: await getDateConfig(c) }),
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
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
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
    "/by-table/:tableId/export",
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Export records with configurable fields and relation expansion",
      responses: {
        200: { description: "Export body — Content-Type matches format" },
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
      },
    }),
    v("json", ExportBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const user = c.get("user");
      const body = c.req.valid("json");
      const queryValid = await validateRecordQueryForTable(tableId, body.query);
      if (!queryValid.ok) return c.json({ message: queryValid.error.message }, queryValid.error.status);
      if ((body.query.groupBy?.length ?? 0) > 0) {
        return c.json({ message: "Grouped exports are not supported yet. Clear Group before exporting." }, 400);
      }
      const result = await gridsService.exporter.exportRecords({
        tableId,
        format: body.format,
        query: body.query,
        fields: body.fields,
        csv: body.csv,
        markdown: body.markdown,
        dateConfig: await getDateConfig(c),
        viewer: hasRole(user, "admin") ? undefined : { userId: user.id, userGroups: user.memberofGroupIds },
      });
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);

      return new Response(result.data.body, {
        status: 200,
        headers: {
          "Content-Type": result.data.contentType,
          "Content-Disposition": `attachment; filename="${result.data.filename}"`,
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
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
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
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const items = await gridsService.audit.listByRecord(tableId, recordId, 50);
      return c.json({ items });
    },
  );

export default app;
