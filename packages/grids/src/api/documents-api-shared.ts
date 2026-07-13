import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { z } from "zod";
import type { DocumentTemplateDraftPreviewSchema } from "../contracts";
import { gridsService } from "../service";
import { pdfResponse } from "./download-response";
import { gateAt } from "./permissions";

export const errorResponse = (c: Context<AuthContext>, message: string, status: number) =>
  c.json({ message }, status === 400 ? 400 : status === 403 ? 403 : status === 404 ? 404 : 500);

export const auditRequestContext = (c: Context<AuthContext>) => ({
  ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || null,
  userAgent: c.req.header("user-agent") ?? null,
});

export const RecordLookupQuerySchema = z.object({
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

export const DocumentRunListQuerySchema = z.object({
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

export const DocumentRunBrowseQuerySchema = DocumentRunListQuerySchema.extend({
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

export const DocumentTemplateSummaryQuerySchema = z.object({
  min: z.enum(["read", "write", "admin"]).optional().default("read"),
});

const UuidStringSchema = z.string().uuid();

const isUuid = (value: string) => UuidStringSchema.safeParse(value).success;

export const uuidParam = (c: Context<AuthContext>, name: string): string | null => {
  const value = c.req.param(name);
  return value && isUuid(value) ? value : null;
};

export const loadTemplateAndTable = async (templateId: string) => {
  if (!isUuid(templateId)) return null;
  const template = await gridsService.document.getTemplate(templateId);
  if (!template) return null;
  const table = await gridsService.table.get(template.tableId);
  if (!table) return null;
  return { template, table };
};

export const gateTemplate = async (
  c: Context<AuthContext>,
  loaded: NonNullable<Awaited<ReturnType<typeof loadTemplateAndTable>>>,
  required: "read" | "write" | "admin",
) => gateAt(c, { baseId: loaded.table.baseId, tableId: loaded.table.id, documentTemplateId: loaded.template.id }, required);

export const snapshotRelatedTableGuard = (c: Context<AuthContext>) => async (target: { baseId: string; tableId: string }) =>
  (await gateAt(c, target, "read")).ok;

export const gateRun = async (
  c: Context<AuthContext>,
  run: NonNullable<Awaited<ReturnType<typeof gridsService.document.getRun>>>,
  required: "read" | "write",
) => {
  const template = run.templateId ? await loadTemplateAndTable(run.templateId) : null;
  return template ? gateTemplate(c, template, required) : gateAt(c, { baseId: run.baseId, tableId: run.tableId }, required);
};

export const gateEnabledTemplateWrite = async (
  c: Context<AuthContext>,
  loaded: NonNullable<Awaited<ReturnType<typeof loadTemplateAndTable>>>,
) => {
  const gate = await gateTemplate(c, loaded, "write");
  if (!gate.ok) return gate;
  if (!loaded.template.enabled && !gridsService.permission.hasAtLeast(gate.data, "admin")) {
    return gateAt(c, { baseId: loaded.table.baseId }, "admin");
  }
  return gate;
};

export const liveRenderData = async (
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

export const draftTemplateFromBody = (
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

export const addDraftDocumentMetadata = async (
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

export const renderDraftDataResponse = async (
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

export const renderDraftPdfResponse = async (
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
