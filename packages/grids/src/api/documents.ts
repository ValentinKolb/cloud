import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateDocumentTemplateSchema,
  DocumentPreviewResponseSchema,
  DocumentRecordBodySchema,
  DocumentTemplateDraftPreviewSchema,
  DocumentTemplateListSchema,
  DocumentTemplateSchema,
  DocumentTemplateSummaryListSchema,
  RelationLookupResponseSchema,
  UpdateDocumentTemplateSchema,
} from "../contracts";
import { gridsService } from "../service";
import { createDocumentLinkRoutes } from "./document-link-routes";
import { createDocumentRunRoutes } from "./document-run-routes";
import { createDocumentSnapshotRoutes } from "./document-snapshot-routes";
import {
  addDraftDocumentMetadata,
  DocumentTemplateSummaryQuerySchema,
  draftTemplateFromBody,
  errorResponse,
  gateEnabledTemplateWrite,
  gateTemplate,
  liveRenderData,
  loadTemplateAndTable,
  RecordLookupQuerySchema,
  renderDraftDataResponse,
  renderDraftPdfResponse,
  uuidParam,
} from "./documents-api-shared";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, gateAt } from "./permissions";

export const createDocumentsApi = (deps: { requireAuthenticated?: MiddlewareHandler<AuthContext> } = {}) =>
  new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))

    .get(
      "/templates/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List document templates for a table",
        responses: {
          200: jsonResponse(DocumentTemplateSummaryListSchema, "Document templates"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", DocumentTemplateSummaryQuerySchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const tableGate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
        const templates = await gridsService.document.listTemplatesForTable(tableId);
        const required = c.req.valid("query").min;
        const visible = [];
        for (const template of templates) {
          if (!template.enabled) continue;
          const templateGate = await gateTemplate(c, { template, table }, required);
          if (templateGate.ok) visible.push(gridsService.document.summarizeTemplate(template));
        }
        if (!tableGate.ok && visible.length === 0) return respond(c, () => Promise.resolve(tableGate));
        return c.json(visible);
      },
    )

    .get(
      "/templates/by-table/:tableId/full",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List full document templates for table admins",
        responses: {
          200: jsonResponse(DocumentTemplateListSchema, "Document templates"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(await gridsService.document.listTemplatesForTable(tableId));
      },
    )

    .post(
      "/templates/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create a document template",
        responses: {
          201: jsonResponse(DocumentTemplateSchema, "Created document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDocumentTemplateSchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => gridsService.document.createTemplate(tableId, c.req.valid("json"), currentActorUserId(c)), 201);
      },
    )

    .post(
      "/templates/by-table/:tableId/preview-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render a draft document template PDF preview",
        responses: {
          200: { description: "Draft PDF preview" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentTemplateDraftPreviewSchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found", phase: "data" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found", phase: "data" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        return renderDraftPdfResponse(c, { template: draftTemplateFromBody(body), tableId, recordId: body.recordId });
      },
    )

    .post(
      "/templates/by-table/:tableId/preview-data-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render draft document template data for one preview record",
        responses: {
          200: jsonResponse(DocumentPreviewResponseSchema, "Draft document preview data"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentTemplateDraftPreviewSchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found", phase: "data" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found", phase: "data" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        return renderDraftDataResponse(c, { template: draftTemplateFromBody(body), tableId, recordId: body.recordId });
      },
    )

    .post(
      "/templates/:templateId/preview-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render a draft document template PDF preview using template admin access",
        responses: {
          200: { description: "Draft PDF preview" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentTemplateDraftPreviewSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found", phase: "data" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        return renderDraftPdfResponse(c, {
          template: draftTemplateFromBody(body, loaded.template),
          tableId: loaded.table.id,
          recordId: body.recordId,
        });
      },
    )

    .post(
      "/templates/:templateId/preview-data-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render draft document template data using template admin access",
        responses: {
          200: jsonResponse(DocumentPreviewResponseSchema, "Draft document preview data"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentTemplateDraftPreviewSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found", phase: "data" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        return renderDraftDataResponse(c, {
          template: draftTemplateFromBody(body, loaded.template),
          tableId: loaded.table.id,
          recordId: body.recordId,
        });
      },
    )

    .get(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Get a document template",
        responses: {
          200: jsonResponse(DocumentTemplateSchema, "Document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(loaded.template);
      },
    )

    .patch(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Update a document template",
        responses: {
          200: jsonResponse(DocumentTemplateSchema, "Updated document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", UpdateDocumentTemplateSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => gridsService.document.updateTemplate(loaded.template.id, c.req.valid("json"), currentActorUserId(c)));
      },
    )

    .delete(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Delete a document template",
        responses: {
          204: { description: "Deleted" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.document.removeTemplate(loaded.template.id, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .get(
      "/templates/:templateId/records/lookup",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Search records for a document template",
        responses: {
          200: jsonResponse(RelationLookupResponseSchema, "Lookup results"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", RecordLookupQuerySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateEnabledTemplateWrite(c, loaded);
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const { q, limit, excludeIds } = c.req.valid("query");
        return c.json(await gridsService.relations.lookup({ targetTableId: loaded.table.id, q, limit, excludeIds }));
      },
    )

    .post(
      "/templates/:templateId/preview",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Preview a document template for one record",
        responses: {
          200: jsonResponse(DocumentPreviewResponseSchema, "Rendered HTML preview"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId: c.req.valid("json").recordId,
          generatedAt,
          dateConfig,
        });
        if (!rendered.ok) return errorResponse(c, rendered.message, rendered.status);
        const data = await addDraftDocumentMetadata(c, { template: loaded.template, data: rendered.data, generatedAt, dateConfig });
        if (!data.ok) return data.response;
        const html = await gridsService.document.renderHtml(loaded.template, data.data);
        if (!html.ok) return c.json({ message: html.error.message }, html.error.status);
        return c.json({ html: html.data, source: rendered.source, data: data.data });
      },
    )

    .post(
      "/templates/:templateId/preview-pdf",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render a saved document template PDF preview",
        responses: {
          200: { description: "PDF preview" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateEnabledTemplateWrite(c, loaded);
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId: c.req.valid("json").recordId,
          generatedAt,
          dateConfig,
        });
        if (!rendered.ok) return errorResponse(c, rendered.message, rendered.status);
        const data = await addDraftDocumentMetadata(c, { template: loaded.template, data: rendered.data, generatedAt, dateConfig });
        if (!data.ok) return data.response;
        const pdf = await gridsService.document.renderPdfPreview(loaded.template, data.data, `${loaded.template.shortId}-preview.html`);
        if (!pdf.ok) {
          return c.json(
            { message: pdf.error.message, phase: pdf.error.phase, code: pdf.error.code },
            pdf.error.status === 400 ? 400 : pdf.error.status === 502 ? 502 : 500,
          );
        }
        return pdfResponse(pdf.pdf.pdf, `${loaded.template.name}.pdf`, {}, "inline");
      },
    )

    .post(
      "/templates/:templateId/generate",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Generate a PDF for one record and store a document run",
        responses: {
          200: { description: "Generated PDF" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        if (!loaded.template.enabled) return c.json({ message: "Document template is disabled" }, 400);
        const gate = await gateTemplate(c, loaded, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId: body.recordId,
          generatedAt,
          dateConfig,
        });
        if (!rendered.ok) return errorResponse(c, rendered.message, rendered.status);
        const snapshot = await gridsService.document.createRecordSnapshot({
          baseId: loaded.table.baseId,
          tableId: loaded.table.id,
          recordId: body.recordId,
          actorId: currentActorUserId(c),
          dateConfig,
        });
        if (!snapshot.ok) return c.json({ message: snapshot.error.message }, snapshot.error.status);
        const run = await gridsService.document.createRun({
          template: loaded.template,
          snapshot: snapshot.data,
          renderData: { ...rendered.data, snapshot: snapshot.data },
          actorId: currentActorUserId(c),
          generatedAt,
          dateConfig,
          filename: body.filename,
          tags: body.tags,
        });
        if (!run.ok) return c.json({ message: run.error.message }, run.error.status);
        const pdf = await gridsService.document.renderRunPdf(run.data);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, run.data.filename, {
          "X-Grids-Document-Run-Id": run.data.id,
          "X-Grids-Document-Number": run.data.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(run.data.filename),
        });
      },
    )

    .route("/", createDocumentRunRoutes())

    .route("/", createDocumentLinkRoutes())

    .route("/", createDocumentSnapshotRoutes());

export default createDocumentsApi();
