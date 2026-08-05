import { err, fail, ok } from "@k2b/stdlib";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import * as settings from "@valentinkolb/cloud/services/settings";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { ExportBodySchema, GridRecordSchema, RecordOperationBodySchema, RecordPayloadSchema, RecordUpdateBodySchema } from "../contracts";
import { gridsService } from "../service";
import { validateRecordQueryForTable } from "../service/query-validation";
import { currentActorUserId, currentActorViewer, resolveRecordAccess } from "./permissions";
import { requireUuidParam } from "./route-params";

const RecordImportBodySchema = z.object({
  items: z.array(RecordPayloadSchema).min(1).max(500),
});

const RecordImportResponseSchema = z.object({
  items: z.array(GridRecordSchema),
});

const CombinedAuditQuerySchema = z.object({
  recordId: z.string().uuid().optional(),
  sourceRef: z.string().max(20).optional(),
  action: z.enum(["created", "updated", "deleted", "restored", "imported"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(2_000).optional(),
});

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

  // Record listing is served by the unified table query endpoint so
  // list, search, filter, sort, group, and aggregate reads share one
  // backend contract.

  .get(
    "/:tableId/:recordId/files/:fieldId",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    requireUuidParam("fieldId", "Field"),
    describeRoute({
      tags: ["Grids:File"],
      summary: "List files for a file field on a record",
      responses: {
        200: jsonResponse(z.object({ items: z.array(GridFileSchema) }), "Files"),
        400: jsonResponse(ErrorResponseSchema, "Invalid file field"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Publication changed"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const visibleRecord = await gridsService.record.get(tableId, recordId, { recordAccess: gate.data.recordAccess });
      if (!visibleRecord) return c.json({ message: "Record not found" }, 404);
      const result = await gridsService.file.listForRecordField({ tableId, recordId, fieldId });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return respond(c, ok({ items: result.data }));
    },
  )

  .post(
    "/:tableId/:recordId/files/:fieldId",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    requireUuidParam("fieldId", "Field"),
    describeRoute({
      tags: ["Grids:File"],
      summary: "Upload a file to a record file field",
      description: `Stores a small file directly in Postgres bytea. Max size is configurable via \`grids.max_file_size_mb\` (default ${DEFAULT_MAX_FILE_SIZE_MB} MB).`,
      responses: {
        200: jsonResponse(GridFileSchema, "Uploaded file metadata"),
        400: jsonResponse(ErrorResponseSchema, "Invalid upload"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        413: jsonResponse(ErrorResponseSchema, "File too large"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const visibleRecord = await gridsService.record.get(tableId, recordId, { recordAccess: gate.data.recordAccess });
      if (!visibleRecord) return c.json({ message: "Record not found" }, 404);

      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return respond(c, fail(err.badInput("Missing 'file' field")));

      const maxBytes = await getMaxFileSizeBytes();
      if (file.size > maxBytes) {
        return c.json({ message: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit` }, 413);
      }

      const result = await gridsService.file.upload({
        tableId,
        recordId,
        fieldId,
        filename: file.name || "untitled",
        mimeType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
        userId: currentActorUserId(c),
      });
      return respond(c, () => Promise.resolve(result));
    },
  )

  .get(
    "/:tableId/:recordId/files/:fieldId/:fileId/content",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    requireUuidParam("fieldId", "Field"),
    requireUuidParam("fileId", "File"),
    describeRoute({
      tags: ["Grids:File"],
      summary: "Download a file field blob",
      responses: {
        200: { description: "File content" },
        400: jsonResponse(ErrorResponseSchema, "Invalid file field"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Publication changed"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const fieldId = c.req.param("fieldId")!;
      const fileId = c.req.param("fileId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const visibleRecord = await gridsService.record.get(tableId, recordId, { recordAccess: gate.data.recordAccess });
      if (!visibleRecord) return c.json({ message: "Record not found" }, 404);
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
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    requireUuidParam("fieldId", "Field"),
    requireUuidParam("fileId", "File"),
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
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const visibleRecord = await gridsService.record.get(tableId, recordId, { recordAccess: gate.data.recordAccess });
      if (!visibleRecord) return c.json({ message: "Record not found" }, 404);
      const result = await gridsService.file.remove({ tableId, recordId, fieldId, fileId });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.body(null, 204);
    },
  )

  .post(
    "/by-table/:tableId",
    requireUuidParam("tableId", "Table"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Create a record",
      responses: {
        201: jsonResponse(GridRecordSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Conflict"),
      },
    }),
    v("json", RecordPayloadSchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        async () =>
          gridsService.record.create(tableId, c.req.valid("json"), currentActorUserId(c), {
            dateConfig: await getDateConfig(c),
            viewer: currentActorViewer(c),
            recordAccess: gate.data.recordAccess,
          }),
        201,
      );
    },
  )

  .post(
    "/by-table/:tableId/import",
    requireUuidParam("tableId", "Table"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Import records atomically from JSON payloads",
      description: "Creates all records in one transaction. The body is { items: [recordPayload, ...] }.",
      responses: {
        201: jsonResponse(RecordImportResponseSchema, "Imported records"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Conflict"),
      },
    }),
    v("json", RecordImportBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        async () => {
          const result = await gridsService.record.createMany(tableId, c.req.valid("json").items, currentActorUserId(c), {
            dateConfig: await getDateConfig(c),
            viewer: currentActorViewer(c),
            recordAccess: gate.data.recordAccess,
          });
          return result.ok ? ok({ items: result.data }) : result;
        },
        201,
      );
    },
  )

  .get(
    "/:tableId/:recordId",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Get a record",
      responses: {
        200: jsonResponse(GridRecordSchema, "Record"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v(
      "query",
      z
        .object({
          includeDeleted: z.enum(["true"]).optional(),
          deletedOnly: z.enum(["true"]).optional(),
        })
        .refine((query) => !(query.includeDeleted && query.deletedOnly), "Choose includeDeleted or deletedOnly, not both"),
    ),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const record = await gridsService.record.get(tableId, recordId, {
        dateConfig: await getDateConfig(c),
        viewer: currentActorViewer(c),
        recordAccess: gate.data.recordAccess,
        deleted: c.req.valid("query").deletedOnly ? "only" : c.req.valid("query").includeDeleted ? "include" : "live",
      });
      if (!record) return c.json({ message: "Record not found" }, 404);
      return c.json(record);
    },
  )

  .patch(
    "/:tableId/:recordId",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Update a record (optimistic lock via If-Match: <version>)",
      responses: {
        200: jsonResponse(GridRecordSchema, "Updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input or missing audit answers"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Version conflict"),
      },
    }),
    v("json", RecordUpdateBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const ifMatchHeader = c.req.header("If-Match");
      const ifMatchVersion = ifMatchHeader ? Number(ifMatchHeader) : undefined;
      const body = c.req.valid("json");
      return respond(c, async () =>
        gridsService.record.update(tableId, recordId, body.values, currentActorUserId(c), ifMatchVersion, {
          dateConfig: await getDateConfig(c),
          viewer: currentActorViewer(c),
          audit: body.audit,
          recordAccess: gate.data.recordAccess,
        }),
      );
    },
  )

  .post(
    "/:tableId/:recordId/trash",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Move a record to trash",
      responses: {
        204: { description: "Moved to trash" },
        400: jsonResponse(ErrorResponseSchema, "Invalid input or missing audit answers"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", RecordOperationBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.record.softDelete(
        tableId,
        recordId,
        currentActorUserId(c),
        c.req.valid("json").audit,
        gate.data.recordAccess,
      );
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/by-table/:tableId/export",
    requireUuidParam("tableId", "Table"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Export records with configurable fields and relation expansion",
      responses: {
        200: { description: "Export body — Content-Type matches format" },
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Publication changed"),
      },
    }),
    v("json", ExportBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

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
        viewer: currentActorViewer(c),
        recordAccess: gate.data.recordAccess,
      });
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);

      return new Response(result.data.body, {
        status: 200,
        headers: {
          "Content-Type": result.data.contentType,
          "Content-Disposition": `attachment; filename="${result.data.filename}"`,
        },
      });
    },
  )

  // Grouping and aggregate reads are served by the unified table query
  // endpoint, keeping all record-read semantics in one place.

  .get(
    "/by-table/:tableId/audit",
    requireUuidParam("tableId", "Table"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Browse a Combined table's published record audit",
      description:
        "Returns a cursor-paginated audit feed projected through the active Combined publication. " +
        "Only canonical fields, safe source labels, actors, lifecycle actions, and declared audit answers are returned.",
      responses: {
        200: { description: "Published Combined audit page" },
        400: jsonResponse(ErrorResponseSchema, "Invalid filter"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Publication changed"),
      },
    }),
    v("query", CombinedAuditQuerySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table || table.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.audit.combined.list({
        tableId,
        ...c.req.valid("query"),
        recordAccess: gate.data.recordAccess,
      });
      return respond(c, () => Promise.resolve(result));
    },
  )

  .post(
    "/:tableId/:recordId/restore",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "Restore a soft-deleted record",
      responses: {
        204: { description: "Restored" },
        400: jsonResponse(ErrorResponseSchema, "Invalid input or missing audit answers"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Conflict"),
      },
    }),
    v("json", RecordOperationBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.record.restore(
        tableId,
        recordId,
        currentActorUserId(c),
        c.req.valid("json").audit,
        gate.data.recordAccess,
      );
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .get(
    "/:tableId/:recordId/audit",
    requireUuidParam("tableId", "Table"),
    requireUuidParam("recordId", "Record"),
    describeRoute({
      tags: ["Grids:Record"],
      summary: "List audit entries for a record",
      description:
        "Returns the most-recent 50 entries from grids.audit_log for the record, " +
        "with the actor's display name resolved. Newest first.",
      responses: {
        200: { description: "Audit entries" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const recordId = c.req.param("recordId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await resolveRecordAccess(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const visibleRecord = await gridsService.record.get(tableId, recordId, { recordAccess: gate.data.recordAccess });
      if (!visibleRecord) return c.json({ message: "Record not found" }, 404);
      const items = await gridsService.audit.listByRecord(tableId, recordId, 50);
      return c.json({ items });
    },
  );

export default app;
