import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { gridsService } from "../service";
import {
  addDraftDocumentMetadata,
  draftTemplateFromBody,
  errorResponse,
  gateEnabledTemplateWrite,
  gateTemplate,
  liveRenderData,
  loadTemplateAndTable,
  PublicDocumentPreviewResponseSchema,
  PublicDocumentRecordBodySchema,
  PublicDocumentTemplateDraftPreviewSchema,
  projectDocumentPreviewData,
  renderDraftDataResponse,
  renderDraftPdfResponse,
  resolveDocumentRecordId,
  snapshotRecordAccessResolver,
} from "./documents-api-shared";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, currentActorViewer, gateAt } from "./permissions";
import { resolvePublicIdParam } from "./route-params";

export const createDocumentRenderRoutes = () =>
  new Hono<AuthContext>()
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
      v("json", PublicDocumentTemplateDraftPreviewSchema),
      async (c) => {
        const tableId = await resolvePublicIdParam(c, "tableId", "table");
        if (!tableId) return c.json({ message: "Table not found", phase: "data" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found", phase: "data" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const recordId = await resolveDocumentRecordId(body.recordId);
        if (!recordId) return c.json({ message: "Record not found", phase: "data" }, 404);
        return renderDraftPdfResponse(c, { template: draftTemplateFromBody(body), tableId, recordId });
      },
    )

    .post(
      "/templates/by-table/:tableId/preview-data-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render draft document template data for one preview record",
        responses: {
          200: jsonResponse(PublicDocumentPreviewResponseSchema, "Draft document preview data"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", PublicDocumentTemplateDraftPreviewSchema),
      async (c) => {
        const tableId = await resolvePublicIdParam(c, "tableId", "table");
        if (!tableId) return c.json({ message: "Table not found", phase: "data" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found", phase: "data" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const recordId = await resolveDocumentRecordId(body.recordId);
        if (!recordId) return c.json({ message: "Record not found", phase: "data" }, 404);
        return renderDraftDataResponse(c, { template: draftTemplateFromBody(body), tableId, recordId });
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
      v("json", PublicDocumentTemplateDraftPreviewSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found", phase: "data" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const recordId = await resolveDocumentRecordId(body.recordId);
        if (!recordId) return c.json({ message: "Record not found", phase: "data" }, 404);
        return renderDraftPdfResponse(c, {
          template: draftTemplateFromBody(body, loaded.template),
          tableId: loaded.table.id,
          recordId,
        });
      },
    )

    .post(
      "/templates/:templateId/preview-data-draft",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Render draft document template data using template admin access",
        responses: {
          200: jsonResponse(PublicDocumentPreviewResponseSchema, "Draft document preview data"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", PublicDocumentTemplateDraftPreviewSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found", phase: "data" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const recordId = await resolveDocumentRecordId(body.recordId);
        if (!recordId) return c.json({ message: "Record not found", phase: "data" }, 404);
        return renderDraftDataResponse(c, {
          template: draftTemplateFromBody(body, loaded.template),
          tableId: loaded.table.id,
          recordId,
        });
      },
    )

    .post(
      "/templates/:templateId/preview",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Preview a document template for one record",
        responses: {
          200: jsonResponse(PublicDocumentPreviewResponseSchema, "Rendered HTML preview"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", PublicDocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const recordId = await resolveDocumentRecordId(c.req.valid("json").recordId);
        if (!recordId) return c.json({ message: "Record not found" }, 404);
        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId,
          generatedAt,
          dateConfig,
        });
        if (!rendered.ok) return errorResponse(c, rendered.message, rendered.status);
        const data = await addDraftDocumentMetadata(c, { template: loaded.template, data: rendered.data, generatedAt, dateConfig });
        if (!data.ok) return data.response;
        const html = await gridsService.document.renderHtml(loaded.template, data.data);
        if (!html.ok) return c.json({ message: html.error.message }, html.error.status);
        return c.json({ html: html.data, source: rendered.source, data: await projectDocumentPreviewData(data.data) });
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
      v("json", PublicDocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateEnabledTemplateWrite(c, loaded);
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const recordId = await resolveDocumentRecordId(c.req.valid("json").recordId);
        if (!recordId) return c.json({ message: "Record not found" }, 404);
        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId,
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
      v("json", PublicDocumentRecordBodySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        if (!loaded.template.enabled) return c.json({ message: "Document template is disabled" }, 400);
        const gate = await gateTemplate(c, loaded, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const recordId = await resolveDocumentRecordId(body.recordId);
        if (!recordId) return c.json({ message: "Record not found" }, 404);
        const generatedAt = new Date();
        const dateConfig = await getDateConfig(c);
        const rendered = await liveRenderData(c, {
          template: loaded.template,
          tableId: loaded.table.id,
          recordId,
          generatedAt,
          dateConfig,
        });
        if (!rendered.ok) return errorResponse(c, rendered.message, rendered.status);
        const snapshot = await gridsService.document.createRecordSnapshotDraft({
          baseId: loaded.table.baseId,
          tableId: loaded.table.id,
          recordId,
          actorId: currentActorUserId(c),
          resolveRecordAccess: snapshotRecordAccessResolver(c),
          viewer: currentActorViewer(c),
          dateConfig,
        });
        if (!snapshot.ok) return c.json({ message: snapshot.error.message }, snapshot.error.status);
        const created = await gridsService.document.createRenderedRun({
          template: loaded.template,
          snapshot: snapshot.data,
          renderData: { ...rendered.data, snapshot: snapshot.data },
          actorId: currentActorUserId(c),
          generatedAt,
          dateConfig,
          filename: body.filename,
          tags: body.tags,
          persistSnapshot: true,
        });
        if (!created.ok) return c.json({ message: created.error.message }, created.error.status);
        return pdfResponse(created.data.pdf.pdf, created.data.run.filename, {
          "X-Grids-Document-Run-Id": created.data.run.shortId,
          "X-Grids-Document-Number": created.data.run.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(created.data.run.filename),
        });
      },
    );
