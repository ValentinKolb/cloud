import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateDocumentLinkResponseSchema,
  CreateDocumentLinkSchema,
  CreateDocumentTemplateSchema,
  CreateRecordSnapshotResponseSchema,
  DocumentLinkListResponseSchema,
  DocumentLinkSchema,
  DocumentPreviewResponseSchema,
  DocumentRecordBodySchema,
  DocumentRunBrowseResponseSchema,
  DocumentRunSummaryListSchema,
  DocumentRunSummarySchema,
  DocumentTemplateDraftPreviewSchema,
  DocumentTemplateListSchema,
  DocumentTemplateSchema,
  DocumentTemplateSummaryListSchema,
  RecordSnapshotListResponseSchema,
  RecordSnapshotSchema,
  RelationLookupResponseSchema,
  UpdateDocumentRunMetadataSchema,
  UpdateDocumentTemplateSchema,
} from "../contracts";
import { gridsService } from "../service";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { currentActorUserId, gateAt } from "./permissions";

const errorResponse = (c: Context<AuthContext>, message: string, status: number) =>
  c.json({ message }, status === 400 ? 400 : status === 403 ? 403 : status === 404 ? 404 : 500);

const auditRequestContext = (c: Context<AuthContext>) => ({
  ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || null,
  userAgent: c.req.header("user-agent") ?? null,
});

const RecordLookupQuerySchema = z.object({
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
});

const DocumentRunListQuerySchema = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  offset: z.coerce.number().int().min(0).optional().default(0),
  cursor: z.string().optional().default(""),
  tags: z
    .string()
    .optional()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    ),
});

const DocumentRunBrowseQuerySchema = DocumentRunListQuerySchema.extend({
  mode: z.enum(["list", "folders"]).optional().default("list"),
  path: z
    .string()
    .optional()
    .default("")
    .transform((s) =>
      s
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
});

const DocumentTemplateSummaryQuerySchema = z.object({
  min: z.enum(["read", "write", "admin"]).optional().default("read"),
});

const UuidStringSchema = z.string().uuid();

const isUuid = (value: string) => UuidStringSchema.safeParse(value).success;

const uuidParam = (c: Context<AuthContext>, name: string): string | null => {
  const value = c.req.param(name);
  return value && isUuid(value) ? value : null;
};

const loadTemplateAndTable = async (templateId: string) => {
  if (!isUuid(templateId)) return null;
  const template = await gridsService.document.getTemplate(templateId);
  if (!template) return null;
  const table = await gridsService.table.get(template.tableId);
  if (!table) return null;
  return { template, table };
};

const gateTemplate = async (
  c: Context<AuthContext>,
  loaded: NonNullable<Awaited<ReturnType<typeof loadTemplateAndTable>>>,
  required: "read" | "write" | "admin",
) => gateAt(c, { baseId: loaded.table.baseId, tableId: loaded.table.id, documentTemplateId: loaded.template.id }, required);

const gateRun = async (
  c: Context<AuthContext>,
  run: NonNullable<Awaited<ReturnType<typeof gridsService.document.getRun>>>,
  required: "read" | "write",
) => {
  const template = run.templateId ? await loadTemplateAndTable(run.templateId) : null;
  return template ? gateTemplate(c, template, required) : gateAt(c, { baseId: run.baseId, tableId: run.tableId }, required);
};

const gateEnabledTemplateWrite = async (c: Context<AuthContext>, loaded: NonNullable<Awaited<ReturnType<typeof loadTemplateAndTable>>>) => {
  const gate = await gateTemplate(c, loaded, "write");
  if (!gate.ok) return gate;
  if (!loaded.template.enabled && !gridsService.permission.hasAtLeast(gate.data, "admin")) {
    return gateAt(c, { baseId: loaded.table.baseId }, "admin");
  }
  return gate;
};

const liveRenderData = async (
  c: Context<AuthContext>,
  params: {
    template: Pick<NonNullable<Awaited<ReturnType<typeof gridsService.document.getTemplate>>>, "source"> &
      Partial<Pick<NonNullable<Awaited<ReturnType<typeof gridsService.document.getTemplate>>>, "id" | "shortId" | "name">>;
    tableId: string;
    recordId: string;
    generatedAt?: Date;
    dateConfig?: Awaited<ReturnType<typeof getDateConfig>>;
  },
) => {
  const table = await gridsService.table.get(params.tableId);
  if (!table) return { ok: false as const, status: 404, phase: "data" as const, message: "Table not found" };
  const dateConfig = params.dateConfig ?? (await getDateConfig(c));
  const record = await gridsService.record.get(params.tableId, params.recordId, { dateConfig });
  if (!record) return { ok: false as const, status: 404, phase: "data" as const, message: "Record not found" };

  const rendered = await gridsService.document.buildLiveRenderData({
    template: params.template,
    table,
    record,
    app: await gridsService.document.buildTemplateAppData(),
    dateConfig,
    generatedAt: params.generatedAt,
  });
  if (!rendered.ok) return { ok: false as const, status: rendered.error.status, phase: "source" as const, message: rendered.error.message };
  return {
    ok: true as const,
    table,
    record,
    source: rendered.data.source,
    columns: rendered.data.columns,
    rows: rendered.data.rows,
    data: rendered.data.data,
  };
};

const draftTemplateFromBody = (
  body: z.infer<typeof DocumentTemplateDraftPreviewSchema>,
  base?: Partial<NonNullable<Awaited<ReturnType<typeof gridsService.document.getTemplate>>>>,
) => ({
  id: base?.id,
  shortId: base?.shortId,
  name: base?.name,
  source: body.source,
  html: body.html,
  headerHtml: body.headerHtml ?? null,
  footerHtml: body.footerHtml ?? null,
  pageCss: body.pageCss ?? null,
  numberTemplate: body.numberTemplate ?? base?.numberTemplate,
  filenameTemplate: body.filenameTemplate ?? base?.filenameTemplate,
});

const addDraftDocumentMetadata = async (
  c: Context<AuthContext>,
  params: {
    template: ReturnType<typeof draftTemplateFromBody>;
    data: Record<string, unknown>;
    generatedAt: Date;
    dateConfig: Awaited<ReturnType<typeof getDateConfig>>;
  },
) => {
  const built = await gridsService.document.buildDocumentRunRenderData({
    template: params.template,
    renderData: params.data,
    runId: "draft",
    runShortId: "draft",
    generatedAt: params.generatedAt,
    dateConfig: params.dateConfig,
  });
  if (!built.ok) return { ok: false as const, response: c.json({ message: built.error.message, phase: "document" }, built.error.status) };
  return { ok: true as const, data: built.data.data };
};

const renderDraftDataResponse = async (
  c: Context<AuthContext>,
  params: {
    template: ReturnType<typeof draftTemplateFromBody>;
    tableId: string;
    recordId: string;
  },
) => {
  const generatedAt = new Date();
  const dateConfig = await getDateConfig(c);
  const rendered = await liveRenderData(c, { ...params, generatedAt, dateConfig });
  if (!rendered.ok) return c.json({ message: rendered.message, phase: rendered.phase }, rendered.status === 400 ? 400 : 404);
  const data = await addDraftDocumentMetadata(c, { template: params.template, data: rendered.data, generatedAt, dateConfig });
  if (!data.ok) return data.response;
  const html = await gridsService.document.renderHtml(params.template, data.data);
  if (!html.ok) return c.json({ message: html.error.message, phase: "html" }, html.error.status);
  return c.json({ html: html.data, source: rendered.source, data: data.data });
};

const renderDraftPdfResponse = async (
  c: Context<AuthContext>,
  params: {
    template: ReturnType<typeof draftTemplateFromBody>;
    tableId: string;
    recordId: string;
  },
) => {
  const generatedAt = new Date();
  const dateConfig = await getDateConfig(c);
  const rendered = await liveRenderData(c, { ...params, generatedAt, dateConfig });
  if (!rendered.ok) return c.json({ message: rendered.message, phase: rendered.phase }, rendered.status === 400 ? 400 : 404);
  const data = await addDraftDocumentMetadata(c, { template: params.template, data: rendered.data, generatedAt, dateConfig });
  if (!data.ok) return data.response;

  const pdf = await gridsService.document.renderPdfPreview(params.template, data.data, "preview.html");
  if (!pdf.ok) {
    return c.json(
      { message: pdf.error.message, phase: pdf.error.phase, code: pdf.error.code },
      pdf.error.status === 400 ? 400 : pdf.error.status === 502 ? 502 : 500,
    );
  }
  return pdfResponse(pdf.pdf.pdf, "preview.pdf", {}, "inline");
};

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
        const template = run.templateId ? await loadTemplateAndTable(run.templateId) : null;
        const gate = template
          ? await gateTemplate(c, template, "write")
          : await gateAt(c, { baseId: run.baseId, tableId: run.tableId }, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const updated = await gridsService.document.updateRunMetadata(run.id, c.req.valid("json"));
        if (!updated.ok) return c.json({ message: updated.error.message }, updated.error.status);
        return c.json(gridsService.document.summarizeRun(updated.data));
      },
    )

    .get(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List expiring public links for a generated document",
        responses: {
          200: jsonResponse(DocumentLinkListResponseSchema, "Document links"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json({ items: await gridsService.document.listDocumentLinksForRun(run.id) });
      },
    )

    .post(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create an expiring public link for a generated document",
        responses: {
          201: jsonResponse(CreateDocumentLinkResponseSchema, "Created document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDocumentLinkSchema),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const created = await gridsService.document.createDocumentLink({
          run,
          input: c.req.valid("json"),
          actorId: currentActorUserId(c),
          ...auditRequestContext(c),
        });
        if (!created.ok) return c.json({ message: created.error.message }, created.error.status);
        return c.json({ link: created.data.link, url: await gridsService.document.publicDocumentLinkUrl(created.data.token) }, 201);
      },
    )

    .post(
      "/links/:linkId/revoke",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Revoke an expiring public document link",
        responses: {
          200: jsonResponse(DocumentLinkSchema, "Revoked document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const linkId = uuidParam(c, "linkId");
        if (!linkId) return c.json({ message: "Document link not found" }, 404);
        const link = await gridsService.document.getDocumentLink(linkId);
        if (!link) return c.json({ message: "Document link not found" }, 404);
        const run = await gridsService.document.getRun(link.documentRunId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const userId = currentActorUserId(c);
        const canRevoke = link.createdBy === userId || gridsService.permission.hasAtLeast(gate.data, "write");
        if (!canRevoke) return c.json({ message: "Only the creator or a document editor can revoke this link." }, 403);

        const revoked = await gridsService.document.revokeDocumentLink({
          linkId: link.id,
          actorId: userId,
          ...auditRequestContext(c),
        });
        if (!revoked.ok) return c.json({ message: revoked.error.message }, revoked.error.status);
        return c.json(revoked.data);
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
        const template = run.templateId ? await loadTemplateAndTable(run.templateId) : null;
        const gate = template
          ? await gateTemplate(c, template, "read")
          : await gateAt(c, { baseId: run.baseId, tableId: run.tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const pdf = await gridsService.document.renderRunPdf(run);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, run.filename, {
          "X-Grids-Document-Run-Id": run.id,
          "X-Grids-Document-Number": run.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(run.filename),
        });
      },
    )

    .get(
      "/snapshots/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List standalone record snapshots for a record",
        responses: {
          200: jsonResponse(RecordSnapshotListResponseSchema, "Record snapshots"),
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
        return c.json({ items: await gridsService.document.listSnapshotsForRecord(tableId, recordId) });
      },
    )

    .post(
      "/snapshots/by-record/:tableId/:recordId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create a standalone recursive record snapshot",
        responses: {
          200: jsonResponse(CreateRecordSnapshotResponseSchema, "Record snapshot"),
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
        const snapshot = await gridsService.document.createRecordSnapshot({
          baseId: table.baseId,
          tableId,
          recordId,
          actorId: currentActorUserId(c),
          dateConfig: await getDateConfig(c),
        });
        if (!snapshot.ok) return c.json({ message: snapshot.error.message }, snapshot.error.status);
        return c.json({ snapshot: snapshot.data });
      },
    )

    .get(
      "/snapshots/:snapshotId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Get a record snapshot",
        responses: {
          200: jsonResponse(RecordSnapshotSchema, "Record snapshot"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const snapshotId = uuidParam(c, "snapshotId");
        if (!snapshotId) return c.json({ message: "Record snapshot not found" }, 404);
        const snapshot = await gridsService.document.getSnapshot(snapshotId);
        if (!snapshot) return c.json({ message: "Record snapshot not found" }, 404);
        const gate = await gateAt(c, { baseId: snapshot.baseId, tableId: snapshot.tableId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(snapshot);
      },
    );

export default createDocumentsApi();
