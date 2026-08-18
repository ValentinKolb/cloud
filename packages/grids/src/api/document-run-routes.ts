import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { UpdateDocumentRunMetadataSchema } from "../contracts";
import { gridsService } from "../service";
import {
  DocumentRunBrowseQuerySchema,
  DocumentRunListQuerySchema,
  gateRun,
  gateTemplate,
  loadTemplateAndTable,
  PublicDocumentRunBrowseResponseSchema,
  PublicDocumentRunSummaryListSchema,
  PublicDocumentRunSummarySchema,
  projectDocumentRunSummaries,
} from "./documents-api-shared";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, gateAt } from "./permissions";
import { resolvePublicIdParam } from "./route-params";

export const createDocumentRunRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/runs/by-template/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List generated document runs for a template",
        responses: {
          200: jsonResponse(PublicDocumentRunSummaryListSchema, "Document runs"),
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
          items: await projectDocumentRunSummaries(page.items.map(gridsService.document.summarizeRun)),
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
          200: jsonResponse(PublicDocumentRunBrowseResponseSchema, "Document run browser page"),
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
          items: await projectDocumentRunSummaries(page.items.map(gridsService.document.summarizeRun)),
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
          200: jsonResponse(PublicDocumentRunSummaryListSchema, "Document runs"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const recordId = await resolvePublicIdParam(c, "recordId", "record");
        if (!recordId) return c.json({ message: "Record not found" }, 404);
        const gate = await gateTemplate(c, loaded, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const runs = await gridsService.document.listRunsForRecord(loaded.table.id, recordId);
        return c.json({
          items: await projectDocumentRunSummaries(
            runs.filter((run) => run.templateId === loaded.template.id).map(gridsService.document.summarizeRun),
          ),
        });
      },
    )

    .get(
      "/runs/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List generated document runs for a record",
        responses: {
          200: jsonResponse(PublicDocumentRunSummaryListSchema, "Document runs"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = await resolvePublicIdParam(c, "tableId", "table");
        const recordId = await resolvePublicIdParam(c, "recordId", "record");
        if (!tableId || !recordId) return c.json({ message: "Record not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const runs = await gridsService.document.listRunsForRecord(tableId, recordId);
        const accessByTemplate = new Map<string | null, boolean>();
        const sampleRunByTemplate = new Map(runs.map((run) => [run.templateId, run]));
        await Promise.all(
          [...sampleRunByTemplate].map(async ([templateId, run]) => {
            accessByTemplate.set(templateId, (await gateRun(c, run, "read")).ok);
          }),
        );
        return c.json({
          items: await projectDocumentRunSummaries(
            runs.filter((run) => accessByTemplate.get(run.templateId)).map(gridsService.document.summarizeRun),
          ),
        });
      },
    )

    .patch(
      "/runs/:runId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Update generated document metadata",
        responses: {
          200: jsonResponse(PublicDocumentRunSummarySchema, "Updated document run"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", UpdateDocumentRunMetadataSchema),
      async (c) => {
        const runId = await resolvePublicIdParam(c, "runId", "documentRun");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const updated = await gridsService.document.updateRunMetadata(run.id, c.req.valid("json"), currentActorUserId(c));
        if (!updated.ok) return c.json({ message: updated.error.message }, updated.error.status);
        return c.json((await projectDocumentRunSummaries([gridsService.document.summarizeRun(updated.data)]))[0]!);
      },
    )

    .get(
      "/runs/:runId/download",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Download the stored document artifact",
        responses: {
          200: { description: "Generated PDF" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const runId = await resolvePublicIdParam(c, "runId", "documentRun");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const pdf = await gridsService.document.getRunPdf(run);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, run.filename, {
          "X-Grids-Document-Run-Id": run.shortId,
          "X-Grids-Document-Number": run.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(run.filename),
          "X-Grids-Document-Artifact": "stored",
        });
      },
    );
