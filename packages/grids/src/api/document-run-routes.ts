import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  DocumentRunBrowseResponseSchema,
  DocumentRunSummaryListSchema,
  DocumentRunSummarySchema,
  UpdateDocumentRunMetadataSchema,
} from "../contracts";
import { gridsService } from "../service";
import {
  DocumentRunBrowseQuerySchema,
  DocumentRunListQuerySchema,
  gateRun,
  gateTemplate,
  loadTemplateAndTable,
  uuidParam,
} from "./documents-api-shared";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, gateAt } from "./permissions";

export const createDocumentRunRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/runs/by-template/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List generated document runs for a template",
        responses: {
          200: jsonResponse(DocumentRunSummaryListSchema, "Document runs"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", DocumentRunListQuerySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const query = c.req.valid("query");
        const page = await gridsService.document.listRunsForTemplate({
          templateId: loaded.template.id,
          q: query.q,
          tags: query.tags,
          limit: query.limit,
          offset: query.offset,
          cursor: query.cursor || null,
        });
        return c.json({
          items: page.items.map(gridsService.document.summarizeRun),
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
          nextCursor: page.nextCursor,
        });
      },
    )

    .get(
      "/runs/by-template/:templateId/browse",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Browse generated document runs as list items or year/month folders",
        responses: {
          200: jsonResponse(DocumentRunBrowseResponseSchema, "Document run browser page"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", DocumentRunBrowseQuerySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const query = c.req.valid("query");
        const page = await gridsService.document.browseRunsForTemplate({
          templateId: loaded.template.id,
          q: query.q,
          tags: query.tags,
          limit: query.limit,
          cursor: query.cursor || null,
          path: query.path,
          mode: query.mode,
          timeZone: (await getDateConfig(c)).timeZone,
        });
        return c.json({
          path: page.path,
          folders: page.folders,
          items: page.items.map(gridsService.document.summarizeRun),
          total: page.total,
          limit: page.limit,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        });
      },
    )

    .get(
      "/runs/by-template/:templateId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List generated document runs for a template and record",
        responses: {
          200: jsonResponse(DocumentRunSummaryListSchema, "Document runs"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const recordId = uuidParam(c, "recordId");
        if (!recordId) return c.json({ message: "Record not found" }, 404);
        const gate = await gateTemplate(c, loaded, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const runs = await gridsService.document.listRunsForRecord(loaded.table.id, recordId);
        return c.json({ items: runs.filter((run) => run.templateId === loaded.template.id).map(gridsService.document.summarizeRun) });
      },
    )

    .get(
      "/runs/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List generated document runs for a record",
        responses: {
          200: jsonResponse(DocumentRunSummaryListSchema, "Document runs"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        const recordId = uuidParam(c, "recordId");
        if (!tableId || !recordId) return c.json({ message: "Record not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json({
          items: (await gridsService.document.listRunsForRecord(tableId, recordId)).map(gridsService.document.summarizeRun),
        });
      },
    )

    .patch(
      "/runs/:runId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Update generated document metadata",
        responses: {
          200: jsonResponse(DocumentRunSummarySchema, "Updated document run"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", UpdateDocumentRunMetadataSchema),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const updated = await gridsService.document.updateRunMetadata(run.id, c.req.valid("json"), currentActorUserId(c));
        if (!updated.ok) return c.json({ message: updated.error.message }, updated.error.status);
        return c.json(gridsService.document.summarizeRun(updated.data));
      },
    )

    .get(
      "/runs/:runId/download",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Redownload a generated document PDF from stored snapshot data",
        responses: {
          200: { description: "Generated PDF" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const pdf = await gridsService.document.renderRunPdf(run);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, run.filename, {
          "X-Grids-Document-Run-Id": run.id,
          "X-Grids-Document-Number": run.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(run.filename),
        });
      },
    );
