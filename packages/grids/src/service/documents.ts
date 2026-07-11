import { Buffer } from "node:buffer";
import {
  coreSettings,
  escapeLikePattern,
  type GotenbergConfig,
  GotenbergRenderError,
  isUniqueViolation,
  mergePdfs,
  type RenderHtmlToPdfResult,
  renderTemplatePdfPreview,
  type TemplatePdfPreviewResult,
} from "@valentinkolb/cloud/services";
import { CLOUD_LOGO_SVG } from "@valentinkolb/cloud/shared";
import { type DateContext, err, fail, ok, type Result, type ServiceError } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  DocumentProfile,
  DocumentRun,
  DocumentRunFolder,
  DocumentRunSummaryList,
  DocumentTemplate,
  RecordSnapshot,
  UpdateDocumentRunMetadataInput,
} from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import { logAudit } from "./audit";
import { get as getBase } from "./bases";
import {
  datePatternContext,
  documentLiquidFilters,
  documentNumberFor,
  renderLiquidText,
  runPatternContext,
  templatePatternContext,
} from "./document-liquid";
import { type DocumentDbRow, mapDocumentRun as mapRun, summarizeDocumentRun as summarizeRun } from "./document-mappers";
import { createRecordSnapshot, type SnapshotRecord } from "./document-snapshots";
import { listByTable as listFields } from "./fields";
import { getContent as getFileContent, listForRecordField } from "./files";
import { buildTrustedGqlResolverContext } from "./gql-resolver-context";
import { get as getRecord } from "./records";
import { insertWithShortId } from "./short-id";
import type { Field, GridRecord, Table } from "./types";
import { ensureRecordScanCode } from "./workflows";

export {
  createDocumentLink,
  getDocumentLink,
  listDocumentLinksForRun,
  publicDocumentLinkPath,
  publicDocumentLinkUrl,
  publicDocumentLinkUrlForAppUrl,
  recordDocumentLinkAccess,
  resolveDocumentLinkDownload,
  revokeDocumentLink,
} from "./document-links";
export { documentNumberFor, renderLiquidPlainText, renderLiquidText, validateLiquidRoots, validateLiquidTemplate } from "./document-liquid";
export { summarizeDocumentRun as summarizeRun, summarizeDocumentTemplate as summarizeTemplate } from "./document-mappers";
export { createRecordSnapshot, getSnapshot, listSnapshotsForRecord } from "./document-snapshots";
export {
  createTemplate,
  getTemplate,
  getTemplateByIdOrShortId,
  getTemplateByShortId,
  listTemplatesForTable,
  removeTemplate,
  updateTemplate,
  validateTemplateWrite,
} from "./document-templates";

type DbRow = DocumentDbRow;

type DocumentRunPage = {
  items: DocumentRun[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
};

type DocumentRunBrowsePage = {
  path: string[];
  folders: DocumentRunFolder[];
  items: DocumentRun[];
  total?: number;
  limit?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
};

const DEFAULT_FILENAME_TEMPLATE = "{{ document.number }}.pdf";
const SOURCE_MAX_BYTES = 20_000;
const FILENAME_TEMPLATE_MAX_BYTES = 5_000;
const FILENAME_MAX_CHARS = 255;
const TEMPLATE_PART_MAX_BYTES = 50_000;
const RENDER_MAX_BYTES = 300_000;
const DOCUMENT_QUERY_MAX_ROWS = 10_000;
const DOCUMENT_IMAGE_MAX_BYTES = 2_000_000;
const DOCUMENT_IMAGE_MAX_COUNT = 12;
const WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS = 1_000;

const isServiceError = (error: unknown): error is ServiceError =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  "message" in error &&
  "status" in error &&
  typeof (error as { code?: unknown }).code === "string" &&
  typeof (error as { message?: unknown }).message === "string" &&
  typeof (error as { status?: unknown }).status === "number";

const normalizeDocumentTags = (tags: readonly string[] | null | undefined): string[] =>
  [...new Set((tags ?? []).map((tag) => tag.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 20);

const safePdfFilename = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[/:*?"<>|\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  const withFallback = cleaned || fallback;
  const withExtension = /\.pdf$/i.test(withFallback) ? withFallback : `${withFallback}.pdf`;
  if (withExtension.length <= FILENAME_MAX_CHARS) return withExtension;
  return `${withExtension.slice(0, FILENAME_MAX_CHARS - 4).replace(/\.+$/, "")}.pdf`;
};

type DocumentRunCursor = { generatedAt: string; id: string };

const encodeCursorPart = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const decodeCursorPart = (value: string): string => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
};

const encodeDocumentRunCursor = (run: Pick<DocumentRun, "generatedAt" | "id">): string =>
  encodeCursorPart(JSON.stringify({ generatedAt: run.generatedAt, id: run.id } satisfies DocumentRunCursor));

const decodeDocumentRunCursor = (cursor: string | null | undefined): DocumentRunCursor | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(decodeCursorPart(cursor)) as Partial<DocumentRunCursor>;
    if (typeof parsed.generatedAt !== "string" || typeof parsed.id !== "string") return null;
    return { generatedAt: parsed.generatedAt, id: parsed.id };
  } catch {
    return null;
  }
};

type DocumentTemplateAppData = {
  name: string;
  url: string;
  contactEmail: string | null;
  copyright: string | null;
  timezone: string;
  logoDataUri: string;
};

type DocumentTemplateBusinessData = {
  legalName: string;
  senderLine: string;
  address: string;
  department: string | null;
  contactEmail: string | null;
  phone: string | null;
  url: string | null;
  taxId: string | null;
  registration: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  paymentTerms: string | null;
  footerText: string | null;
};

type DocumentTemplateRecordContext = Pick<GridRecord, "id" | "tableId" | "version" | "data" | "createdAt" | "updatedAt">;
type DocumentTemplateTableContext = Pick<Table, "id" | "shortId" | "name">;
type DocumentTemplateRecordMeta = {
  scan?: {
    code: string;
    qrText: string;
  };
};

type DocumentTemplateImage = {
  fieldId: string;
  fieldName: string;
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

const defaultLogoDataUri = () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CLOUD_LOGO_SVG)}`;

const buildRecordScanMeta = async (params: { baseId: string; tableId: string; recordId: string }): Promise<DocumentTemplateRecordMeta> => {
  const scan = await ensureRecordScanCode({
    baseId: params.baseId,
    tableId: params.tableId,
    recordId: params.recordId,
  });
  return {
    scan: {
      code: scan.code,
      qrText: scan.code,
    },
  };
};

const recordContextWithMeta = <T extends DocumentTemplateRecordContext | SnapshotRecord>(
  record: T,
  meta: DocumentTemplateRecordMeta = {},
): T & { meta: DocumentTemplateRecordMeta } => ({
  ...record,
  meta,
});

const stringValue = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const nullableStringValue = (value: unknown): string | null => stringValue(value) || null;
const publicUrlValue = (value: unknown): string => {
  const url = stringValue(value);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
};

const appDataFromValues = (values: {
  name?: unknown;
  url?: unknown;
  contactEmail?: unknown;
  copyright?: unknown;
  timezone?: unknown;
  logo?: unknown;
}): DocumentTemplateAppData => ({
  name: stringValue(values.name) || "Cloud",
  url: publicUrlValue(values.url),
  contactEmail: nullableStringValue(values.contactEmail),
  copyright: nullableStringValue(values.copyright),
  timezone: stringValue(values.timezone) || "UTC",
  logoDataUri: stringValue(values.logo) || defaultLogoDataUri(),
});

const appDataFromSettingsSnapshot = (settings?: unknown): DocumentTemplateAppData | null => {
  if (!settings || typeof settings !== "object") return null;
  const app = (settings as { app?: unknown }).app;
  if (!app || typeof app !== "object") return null;
  const appSettings = app as Record<string, unknown>;
  return appDataFromValues({
    name: appSettings.name,
    url: appSettings.url,
    contactEmail: appSettings.contact_email,
    copyright: appSettings.copyright,
    timezone: appSettings.timezone,
    logo: appSettings.logo,
  });
};

const defaultTemplateAppData = (): DocumentTemplateAppData => appDataFromValues({});

export const buildTemplateAppData = async (settings?: unknown): Promise<DocumentTemplateAppData> => {
  const snapshotData = appDataFromSettingsSnapshot(settings);
  if (snapshotData) return snapshotData;

  const [name, url, contactEmail, copyright, timezone, logo] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<string>("app.url"),
    coreSettings.get<string>("app.contact_email"),
    coreSettings.get<string>("app.copyright"),
    coreSettings.get<string>("app.timezone"),
    coreSettings.get<string>("app.logo"),
  ]);
  return appDataFromValues({ name, url, contactEmail, copyright, timezone, logo });
};

const documentProfileValue = (profile: DocumentProfile, key: keyof DocumentProfile): string => stringValue(profile[key]);

export const buildTemplateBusinessData = async (
  baseId: string,
  appData: DocumentTemplateAppData = defaultTemplateAppData(),
): Promise<DocumentTemplateBusinessData> => {
  const profile = (await getBase(baseId))?.documentProfile ?? {};
  const legalName = documentProfileValue(profile, "legalName") || appData.name;
  const address = documentProfileValue(profile, "address");
  const senderLine = documentProfileValue(profile, "senderLine") || [legalName, address.replace(/\n/g, " | ")].filter(Boolean).join(" | ");
  return {
    legalName,
    senderLine,
    address,
    department: nullableStringValue(profile.department),
    contactEmail: nullableStringValue(profile.contactEmail) ?? appData.contactEmail,
    phone: nullableStringValue(profile.phone),
    url: nullableStringValue(profile.url) ?? (appData.url || null),
    taxId: nullableStringValue(profile.taxId),
    registration: nullableStringValue(profile.registration),
    bankName: nullableStringValue(profile.bankName),
    iban: nullableStringValue(profile.iban),
    bic: nullableStringValue(profile.bic),
    paymentTerms: nullableStringValue(profile.paymentTerms),
    footerText: nullableStringValue(profile.footerText),
  };
};

const diagnosticsMessage = (diagnostics: Array<{ message: string }>): string =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source";

type DocumentColumn = { key?: unknown; label?: unknown };

export const rowsWithColumnLabels = (columns: unknown[], rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
  const usableColumns = columns.filter(
    (column): column is { key: string; label: string } =>
      typeof (column as DocumentColumn).key === "string" && typeof (column as DocumentColumn).label === "string",
  );
  return rows.map((row) => {
    const next = { ...row };
    for (const column of usableColumns) {
      if (next[column.label] === undefined) next[column.label] = row[column.key];
    }
    return next;
  });
};

const fieldsWithPlanExtras = async (
  fieldsByTableId: Record<string, Field[]>,
  tableId: string,
  plan: Parameters<typeof collectDslPlanExtraFieldTableIds>[0],
): Promise<Record<string, Field[]>> => {
  const missing = collectDslPlanExtraFieldTableIds(plan).filter((extraTableId) => fieldsByTableId[extraTableId] === undefined);
  if (fieldsByTableId[tableId] === undefined) missing.push(tableId);
  if (missing.length === 0) return fieldsByTableId;
  const groups = await Promise.all(
    [...new Set(missing)].map(async (missingTableId) => ({ tableId: missingTableId, fields: await listFields(missingTableId) })),
  );
  return { ...fieldsByTableId, ...Object.fromEntries(groups.map((group) => [group.tableId, group.fields])) };
};

const executeDocumentGqlSource = async (params: {
  baseId: string;
  tableId: string;
  source: string;
  dateConfig?: DateContext;
}): Promise<Result<{ columns: unknown[]; rows: Array<Record<string, unknown>> }>> => {
  const parsed = parseGridsQueryDsl(params.source);
  if (!parsed.ok) return fail(err.badInput(diagnosticsMessage(parsed.diagnostics)));

  const ctx = await buildTrustedGqlResolverContext({
    baseId: params.baseId,
    currentTableId: params.tableId,
    ast: parsed.ast,
    purpose: "document-template-render",
  });
  const resolved = resolveDslQueryToQueryPlan(parsed.ast, ctx);
  if (!resolved.ok) return fail(err.badInput(diagnosticsMessage(resolved.diagnostics)));

  const fieldsByTableId = await fieldsWithPlanExtras(ctx.fieldsByTableId, params.tableId, resolved.plan);
  const preview = await previewDslQuery(resolved.plan, {
    fieldsByTableId,
    timeZone: params.dateConfig?.timeZone,
    maxRows: DOCUMENT_QUERY_MAX_ROWS,
    // Document template read/write gates are checked before rendering. Once a
    // template is allowed, its GQL source is the trusted document data boundary.
    viewer: { userId: null, userGroups: [], isAdmin: true },
  });
  if (!preview.ok) return fail(err.badInput(preview.error.message));

  return ok({
    columns: preview.data.columns,
    rows: rowsWithColumnLabels(
      preview.data.columns,
      preview.data.rows.map((row) => ({
        recordId: row.recordId ?? null,
        tableId: row.tableId ?? null,
        ...row.values,
      })),
    ),
  });
};

export const buildTemplateInputContext = (
  record: DocumentTemplateRecordContext,
  table: DocumentTemplateTableContext,
  appData: DocumentTemplateAppData = defaultTemplateAppData(),
  businessData: DocumentTemplateBusinessData = {
    legalName: appData.name,
    senderLine: appData.name,
    address: "",
    department: null,
    contactEmail: appData.contactEmail,
    phone: null,
    url: appData.url || null,
    taxId: null,
    registration: null,
    bankName: null,
    iban: null,
    bic: null,
    paymentTerms: null,
    footerText: null,
  },
  template: Partial<Pick<DocumentTemplate, "id" | "shortId" | "name">> | null = null,
  generatedAt: Date = new Date(),
  dateConfig?: DateContext,
  recordMeta: DocumentTemplateRecordMeta = {},
): Record<string, unknown> => ({
  record: recordContextWithMeta(
    {
      id: record.id,
      tableId: record.tableId,
      version: record.version,
      data: record.data,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    recordMeta,
  ),
  table: {
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  },
  app: appData,
  business: businessData,
  template: templatePatternContext(template),
  date: datePatternContext(generatedAt, dateConfig),
});

export const buildRenderData = (params: {
  record: DocumentTemplateRecordContext | SnapshotRecord;
  table: DocumentTemplateTableContext;
  columns: unknown[];
  rows: unknown[];
  template?: Partial<Pick<DocumentTemplate, "id" | "shortId" | "name">> | null;
  run?: { id?: string | null; shortId?: string | null } | null;
  images?: DocumentTemplateImage[];
  primaryImage?: DocumentTemplateImage | null;
  recordMeta?: DocumentTemplateRecordMeta;
  app?: DocumentTemplateAppData;
  business?: DocumentTemplateBusinessData;
  documentNumber?: string;
  generatedAt?: string;
  dateConfig?: DateContext;
  snapshot?: RecordSnapshot;
}): Record<string, unknown> => ({
  record: recordContextWithMeta(params.record, params.recordMeta),
  table: params.table,
  query: {
    columns: params.columns,
    rows: params.rows,
  },
  rows: params.rows,
  columns: params.columns,
  template: templatePatternContext(params.template),
  run: runPatternContext(params.run?.id ?? null, params.run?.shortId ?? null),
  date: datePatternContext(params.generatedAt ? new Date(params.generatedAt) : new Date(), params.dateConfig),
  images: params.images ?? [],
  primaryImage: params.primaryImage ?? params.images?.[0] ?? null,
  app: params.app ?? defaultTemplateAppData(),
  business:
    params.business ??
    ({
      legalName: (params.app ?? defaultTemplateAppData()).name,
      senderLine: (params.app ?? defaultTemplateAppData()).name,
      address: "",
      department: null,
      contactEmail: (params.app ?? defaultTemplateAppData()).contactEmail,
      phone: null,
      url: (params.app ?? defaultTemplateAppData()).url || null,
      taxId: null,
      registration: null,
      bankName: null,
      iban: null,
      bic: null,
      paymentTerms: null,
      footerText: null,
    } satisfies DocumentTemplateBusinessData),
  document: {
    number: params.documentNumber ?? null,
    generatedAt: params.generatedAt ?? null,
  },
  snapshot: params.snapshot ?? null,
});

const buildTemplateImages = async (tableId: string, recordId: string, fields: Field[]): Promise<DocumentTemplateImage[]> => {
  const fileFields = fields.filter((field) => field.type === "file" && !field.deletedAt);
  const images: DocumentTemplateImage[] = [];
  for (const field of fileFields) {
    if (images.length >= DOCUMENT_IMAGE_MAX_COUNT) break;
    const listed = await listForRecordField({ tableId, recordId, fieldId: field.id });
    if (!listed.ok) continue;
    for (const file of listed.data) {
      if (images.length >= DOCUMENT_IMAGE_MAX_COUNT) break;
      if (!file.mimeType.startsWith("image/") || file.sizeBytes > DOCUMENT_IMAGE_MAX_BYTES) continue;
      const content = await getFileContent({ tableId, recordId, fieldId: field.id, fileId: file.id });
      if (!content.ok) continue;
      images.push({
        fieldId: field.id,
        fieldName: field.name,
        fileId: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        url: `data:${file.mimeType};base64,${Buffer.from(content.data.bytes).toString("base64")}`,
      });
    }
  }
  return images;
};

export const buildLiveRenderData = async (params: {
  template: Pick<DocumentTemplate, "source"> & Partial<Pick<DocumentTemplate, "id" | "shortId" | "name">>;
  table: Table;
  record: GridRecord;
  app?: DocumentTemplateAppData;
  dateConfig?: DateContext;
  generatedAt?: Date;
}): Promise<Result<{ source: string; columns: unknown[]; rows: Array<Record<string, unknown>>; data: Record<string, unknown> }>> => {
  const appData = params.app ?? (await buildTemplateAppData());
  const businessData = await buildTemplateBusinessData(params.table.baseId, appData);
  const recordMeta = await buildRecordScanMeta({
    baseId: params.table.baseId,
    tableId: params.table.id,
    recordId: params.record.id,
  });
  const source = await renderDocumentSource(
    params.template,
    buildTemplateInputContext(
      params.record,
      params.table,
      appData,
      businessData,
      params.template,
      params.generatedAt,
      params.dateConfig,
      recordMeta,
    ),
  );
  if (!source.ok) return source;

  const executed = await executeDocumentGqlSource({
    baseId: params.table.baseId,
    tableId: params.table.id,
    source: source.data,
    dateConfig: params.dateConfig,
  });
  if (!executed.ok) return executed;
  const fields = await listFields(params.table.id);
  const images = await buildTemplateImages(params.table.id, params.record.id, fields);

  const data = buildRenderData({
    record: params.record,
    table: params.table,
    columns: executed.data.columns,
    rows: executed.data.rows,
    template: params.template,
    images,
    recordMeta,
    app: appData,
    business: businessData,
    generatedAt: params.generatedAt?.toISOString(),
    dateConfig: params.dateConfig,
  });
  return ok({ source: source.data, columns: executed.data.columns, rows: executed.data.rows, data });
};

const injectPageCss = (html: string, pageCss: string | null): string => {
  if (!pageCss?.trim()) return html;
  const style = `<style>\n${pageCss}\n</style>`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${style}\n</head>`)
    : `<!doctype html><html><head>${style}</head><body>${html}</body></html>`;
};

export const createRunForRecord = async (params: {
  template: DocumentTemplate;
  table: Table;
  recordId: string;
  actorId: string | null;
  dateConfig?: DateContext;
  generatedAt?: Date;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
}): Promise<Result<DocumentRun>> => {
  if (!params.template.enabled) return fail(err.badInput("Document template is disabled"));
  if (params.template.tableId !== params.table.id) return fail(err.badInput("Document template does not belong to the table"));

  const record = await getRecord(params.table.id, params.recordId, { dateConfig: params.dateConfig });
  if (!record) return fail(err.notFound("record"));

  const generatedAt = params.generatedAt ?? new Date();
  const rendered = await buildLiveRenderData({
    template: params.template,
    table: params.table,
    record,
    dateConfig: params.dateConfig,
    generatedAt,
  });
  if (!rendered.ok) return rendered;

  const snapshot = await createRecordSnapshot({
    baseId: params.table.baseId,
    tableId: params.table.id,
    recordId: params.recordId,
    actorId: params.actorId,
    dateConfig: params.dateConfig,
  });
  if (!snapshot.ok) return snapshot;

  return createDocumentRun({
    template: params.template,
    snapshot: snapshot.data,
    renderData: { ...rendered.data.data, snapshot: snapshot.data },
    actorId: params.actorId,
    generatedAt,
    dateConfig: params.dateConfig,
    filename: params.filename,
    tags: params.tags,
    workflowRunId: params.workflowRunId,
  });
};

export const renderDocumentHtml = async (
  template: Pick<DocumentTemplate, "html"> & Partial<Pick<DocumentTemplate, "pageCss">>,
  data: Record<string, unknown>,
): Promise<Result<string>> => {
  const html = await renderLiquidText(template.html, data, RENDER_MAX_BYTES);
  if (!html.ok) return html;
  const pageCss = await renderLiquidText(template.pageCss ?? "", data, TEMPLATE_PART_MAX_BYTES);
  if (!pageCss.ok) return pageCss;
  return ok(injectPageCss(html.data, pageCss.data));
};

export const renderDocumentSource = async (
  template: Pick<DocumentTemplate, "source">,
  data: Record<string, unknown>,
): Promise<Result<string>> => renderLiquidText(template.source, data, SOURCE_MAX_BYTES);

export const renderDocumentPdfPreview = async (
  template: Pick<DocumentTemplate, "html"> & Partial<Pick<DocumentTemplate, "headerHtml" | "footerHtml" | "pageCss">>,
  data: Record<string, unknown>,
  filename?: string,
  config?: GotenbergConfig,
): Promise<TemplatePdfPreviewResult> =>
  renderTemplatePdfPreview(
    {
      htmlTemplate: template.html,
      headerHtmlTemplate: template.headerHtml,
      footerHtmlTemplate: template.footerHtml,
      pageCssTemplate: template.pageCss,
      data,
      filters: documentLiquidFilters,
      filename,
    },
    config ? { config } : {},
  );

export const buildDocumentRunRenderData = async (params: {
  template: Partial<Pick<DocumentTemplate, "id" | "shortId" | "name" | "numberTemplate" | "filenameTemplate">>;
  renderData: Record<string, unknown>;
  runId: string;
  runShortId: string;
  generatedAt?: Date;
  dateConfig?: DateContext;
  filename?: string | null;
  tags?: string[];
}): Promise<Result<{ documentNumber: string; filename: string; tags: string[]; data: Record<string, unknown> }>> => {
  const generatedAt = params.generatedAt ?? new Date();
  const documentNumber = documentNumberFor({
    template: params.template,
    runId: params.runId,
    runShortId: params.runShortId,
    generatedAt,
    dateConfig: params.dateConfig,
    data: params.renderData,
  });
  if (!documentNumber.ok) return fail(documentNumber.error);

  const tags = normalizeDocumentTags(params.tags);
  const renderDataBase = {
    ...params.renderData,
    template: templatePatternContext(params.template),
    run: runPatternContext(params.runId, params.runShortId),
    date: datePatternContext(generatedAt, params.dateConfig),
    document: {
      ...((typeof params.renderData.document === "object" && params.renderData.document !== null
        ? params.renderData.document
        : {}) as Record<string, unknown>),
      number: documentNumber.data,
      generatedAt: generatedAt.toISOString(),
    },
  };
  const requestedFilename = params.filename?.trim() ?? "";
  const renderedFilename = requestedFilename
    ? ok(requestedFilename)
    : await renderLiquidText(params.template.filenameTemplate || DEFAULT_FILENAME_TEMPLATE, renderDataBase, FILENAME_TEMPLATE_MAX_BYTES);
  if (!renderedFilename.ok) return fail(renderedFilename.error);

  const filename = safePdfFilename(renderedFilename.data, `${documentNumber.data}.pdf`);
  const data = {
    ...renderDataBase,
    document: {
      ...(renderDataBase.document as Record<string, unknown>),
      filename,
      tags,
    },
  };
  return ok({ documentNumber: documentNumber.data, filename, tags, data });
};

export const createDocumentRun = async (params: {
  template: DocumentTemplate;
  snapshot: RecordSnapshot;
  renderData: Record<string, unknown>;
  actorId: string | null;
  generatedAt?: Date;
  dateConfig?: DateContext;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
}): Promise<Result<DocumentRun>> => {
  const runId = Bun.randomUUIDv7();
  const generatedAt = params.generatedAt ?? new Date();
  const templateSnapshot = {
    id: params.template.id,
    shortId: params.template.shortId,
    name: params.template.name,
    description: params.template.description,
    source: params.template.source,
    html: params.template.html,
    headerHtml: params.template.headerHtml,
    footerHtml: params.template.footerHtml,
    pageCss: params.template.pageCss,
    numberTemplate: params.template.numberTemplate,
    filenameTemplate: params.template.filenameTemplate,
  };
  try {
    const row = await insertWithShortId<DbRow>(async (shortId) => {
      const built = await buildDocumentRunRenderData({
        template: params.template,
        renderData: params.renderData,
        runId,
        runShortId: shortId,
        generatedAt,
        dateConfig: params.dateConfig,
        filename: params.filename,
        tags: params.tags,
      });
      if (!built.ok) throw built.error;
      return sql.begin(async (tx) => {
        const [inserted] = await tx<DbRow[]>`
          INSERT INTO grids.document_runs (
            id, short_id, template_id, workflow_run_id, snapshot_id, base_id, table_id, record_id,
            document_number, filename, tags, template_snapshot, render_data, generated_by, generated_at
          )
          VALUES (
            ${runId}::uuid,
            ${shortId},
            ${params.template.id}::uuid,
            ${params.workflowRunId ?? null}::uuid,
            ${params.snapshot.id}::uuid,
            ${params.snapshot.baseId}::uuid,
            ${params.snapshot.tableId}::uuid,
            ${params.snapshot.recordId}::uuid,
            ${built.data.documentNumber},
            ${built.data.filename},
            ${tx.array(built.data.tags, "TEXT")},
            ${templateSnapshot}::jsonb,
            ${built.data.data}::jsonb,
            ${params.actorId}::uuid,
            ${generatedAt}
          )
          RETURNING *
        `;
        if (!inserted) throw new Error("insert returned no row");
        const run = mapRun(inserted);
        if (!params.workflowRunId) {
          await logAudit(
            {
              baseId: run.baseId,
              tableId: run.tableId,
              recordId: run.recordId,
              userId: params.actorId,
              action: "document.generated",
              diff: {
                documentRunId: { old: null, new: run.id },
                snapshotId: { old: null, new: run.snapshotId },
                templateId: { old: null, new: run.templateId },
                documentNumber: { old: null, new: run.documentNumber },
                filename: { old: null, new: run.filename },
                tags: { old: null, new: run.tags },
              },
            },
            tx,
          );
        }
        return inserted;
      });
    }, "idx_grids_document_runs_short_id");
    return ok(mapRun(row));
  } catch (error) {
    if (isUniqueViolation(error, "idx_grids_document_runs_number")) {
      return fail({
        code: "CONFLICT",
        message: "Document number already exists. Change the number pattern or regenerate.",
        status: 409,
      });
    }
    if (isServiceError(error)) return fail(error);
    throw error;
  }
};

export const listRunsForRecord = async (tableId: string, recordId: string): Promise<DocumentRun[]> => {
  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE table_id = ${tableId}::uuid AND record_id = ${recordId}::uuid
    ORDER BY generated_at DESC, id DESC
  `;
  return rows.map(mapRun);
};

export const listRunsForWorkflowRun = async (
  workflowRunId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<DocumentRunSummaryList> => {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
  `;
  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
    ORDER BY generated_at DESC, id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  const nextOffset = offset + rows.length;
  const total = count ?? 0;
  return {
    items: rows.map((row) => summarizeRun(mapRun(row))),
    total,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
};

const documentRunWhere = (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  year?: number | null;
  month?: number | null;
  timeZone?: string | null;
}) => {
  const timeZone = params.timeZone || "UTC";
  const conditions = [sql`template_id = ${params.templateId}::uuid`];
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    const escape = "\\";
    conditions.push(sql`(
      filename ILIKE ${pattern} ESCAPE ${escape}
      OR document_number ILIKE ${pattern} ESCAPE ${escape}
      OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE ${pattern} ESCAPE ${escape})
    )`);
  }
  const tags = normalizeDocumentTags(params.tags);
  if (tags.length > 0) {
    conditions.push(sql`tags @> ${sql.array(tags, "TEXT")}`);
  }
  if (params.year) {
    conditions.push(sql`EXTRACT(YEAR FROM generated_at AT TIME ZONE ${timeZone})::int = ${params.year}`);
  }
  if (params.month) {
    conditions.push(sql`EXTRACT(MONTH FROM generated_at AT TIME ZONE ${timeZone})::int = ${params.month}`);
  }
  return conditions.reduce((acc, cur) => sql`${acc} AND ${cur}`);
};

export const listRunsForTemplate = async (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  limit?: number;
  offset?: number;
  cursor?: string | null;
  year?: number | null;
  month?: number | null;
  timeZone?: string | null;
}): Promise<DocumentRunPage> => {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const cursor = decodeDocumentRunCursor(params.cursor);
  const baseWhere = documentRunWhere(params);
  const where = cursor ? sql`${baseWhere} AND (generated_at, id) < (${cursor.generatedAt}::timestamptz, ${cursor.id}::uuid)` : baseWhere;
  const [countRow] = await sql<Array<{ total: number | string }>>`
    SELECT COUNT(*)::int AS total
    FROM grids.document_runs
    WHERE ${baseWhere}
  `;
  const rows = await sql<DbRow[]>`
    SELECT *
    FROM grids.document_runs
    WHERE ${where}
    ORDER BY generated_at DESC, id DESC
    LIMIT ${limit + 1}
    OFFSET ${cursor ? 0 : offset}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRun);
  const total = Number(countRow?.total ?? items.length);
  const nextOffset = offset + items.length;
  const last = items.at(-1);
  return {
    items,
    total,
    limit,
    offset: cursor ? 0 : offset,
    hasMore,
    nextOffset: hasMore && !cursor ? nextOffset : null,
    nextCursor: hasMore && last ? encodeDocumentRunCursor(last) : null,
  };
};

const runFolderPath = (path: readonly string[] | null | undefined): string[] =>
  (path ?? [])
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

const monthKey = (month: number): string => String(month).padStart(2, "0");

export const browseRunsForTemplate = async (params: {
  templateId: string;
  q?: string | null;
  tags?: string[];
  path?: string[];
  limit?: number;
  cursor?: string | null;
  timeZone?: string | null;
  mode?: "list" | "folders";
}): Promise<DocumentRunBrowsePage> => {
  const path = runFolderPath(params.path);
  const q = params.q?.trim() ?? "";
  if (params.mode === "list" || q || path.length >= 2) {
    const year = path[0] ? Number(path[0]) : null;
    const month = path[1] ? Number(path[1]) : null;
    const page = await listRunsForTemplate({
      templateId: params.templateId,
      q,
      tags: params.tags,
      limit: params.limit,
      cursor: params.cursor,
      year: Number.isInteger(year) ? year : null,
      month: Number.isInteger(month) ? month : null,
      timeZone: params.timeZone,
    });
    return {
      path,
      folders: [],
      items: page.items,
      total: page.total,
      limit: page.limit,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  const timeZone = params.timeZone || "UTC";
  const where = documentRunWhere({ templateId: params.templateId, tags: params.tags, timeZone });
  if (path.length === 0) {
    const rows = await sql<Array<{ year: number | string; count: number | string }>>`
      SELECT EXTRACT(YEAR FROM generated_at AT TIME ZONE ${timeZone})::int AS year, COUNT(*)::int AS count
      FROM grids.document_runs
      WHERE ${where}
      GROUP BY year
      ORDER BY year DESC
    `;
    return {
      path,
      folders: rows.map((row) => {
        const year = String(row.year);
        return { kind: "year", key: year, label: year, path: [year], count: Number(row.count) };
      }),
      items: [],
    };
  }

  const year = Number(path[0]);
  if (!Number.isInteger(year)) return { path: [], folders: [], items: [] };
  const yearWhere = documentRunWhere({ templateId: params.templateId, tags: params.tags, year, timeZone });
  const rows = await sql<Array<{ month: number | string; count: number | string }>>`
    SELECT EXTRACT(MONTH FROM generated_at AT TIME ZONE ${timeZone})::int AS month, COUNT(*)::int AS count
    FROM grids.document_runs
    WHERE ${yearWhere}
    GROUP BY month
    ORDER BY month DESC
  `;
  return {
    path: [String(year)],
    folders: rows.map((row) => {
      const key = monthKey(Number(row.month));
      return { kind: "month", key, label: key, path: [String(year), key], count: Number(row.count) };
    }),
    items: [],
  };
};

export const getDocumentRun = async (runId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DbRow[]>`SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid`;
  return row ? mapRun(row) : null;
};

export const updateRunMetadata = async (
  runId: string,
  input: UpdateDocumentRunMetadataInput,
  actorId: string | null = null,
): Promise<Result<DocumentRun>> =>
  sql.begin(async (tx) => {
    const [currentRow] = await tx<DbRow[]>`
      SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid FOR UPDATE
    `;
    if (!currentRow) return fail(err.notFound("document run not found"));
    const current = mapRun(currentRow);
    const filename =
      input.filename === undefined ? current.filename : safePdfFilename(input.filename, `${current.documentNumber || current.shortId}.pdf`);
    const tags = input.tags === undefined ? current.tags : normalizeDocumentTags(input.tags);
    const filenameChanged = filename !== current.filename;
    const tagsChanged = tags.length !== current.tags.length || tags.some((tag, index) => tag !== current.tags[index]);
    if (!filenameChanged && !tagsChanged) return ok(current);

    const [row] = await tx<DbRow[]>`
      UPDATE grids.document_runs
      SET filename = ${filename}, tags = ${tx.array(tags, "TEXT")}
      WHERE id = ${runId}::uuid
      RETURNING *
    `;
    if (!row) return fail(err.notFound("document run not found"));
    const updated = mapRun(row);
    await logAudit(
      {
        baseId: updated.baseId,
        tableId: updated.tableId,
        recordId: updated.recordId,
        userId: actorId,
        action: "document.metadata.updated",
        diff: {
          documentRunId: { old: current.id, new: updated.id },
          ...(filenameChanged ? { filename: { old: current.filename, new: updated.filename } } : {}),
          ...(tagsChanged ? { tags: { old: current.tags, new: updated.tags } } : {}),
        },
      },
      tx,
    );
    return ok(updated);
  });

export const renderRunPdf = async (run: DocumentRun): Promise<Result<RenderHtmlToPdfResult>> => {
  const rendered = await renderTemplatePdfPreview({
    htmlTemplate: String(run.templateSnapshot.html ?? ""),
    headerHtmlTemplate: typeof run.templateSnapshot.headerHtml === "string" ? run.templateSnapshot.headerHtml : null,
    footerHtmlTemplate: typeof run.templateSnapshot.footerHtml === "string" ? run.templateSnapshot.footerHtml : null,
    pageCssTemplate: typeof run.templateSnapshot.pageCss === "string" ? run.templateSnapshot.pageCss : null,
    data: run.renderData,
    filters: documentLiquidFilters,
    filename: run.filename.replace(/\.pdf$/i, ".html"),
  });
  if (rendered.ok) return ok(rendered.pdf);
  const message = `${rendered.error.phase}: ${rendered.error.message}`;
  return fail(rendered.error.status === 400 ? err.badInput(message) : err.internal(message));
};

export const renderWorkflowRunPdf = async (
  workflowRunId: string,
): Promise<Result<RenderHtmlToPdfResult & { filename: string; documentCount: number }>> => {
  const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
  `;
  const total = count ?? 0;
  if (total === 0) return fail(err.badInput("Workflow run did not generate any documents."));
  if (total > WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS) {
    return fail(err.badInput(`Combined PDF download supports at most ${WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS} documents per workflow run.`));
  }

  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
    ORDER BY generated_at ASC, id ASC
  `;
  const runs = rows.map(mapRun);
  const rendered: Array<{ pdf: Uint8Array; filename: string }> = [];
  for (const run of runs) {
    const pdf = await renderRunPdf(run);
    if (!pdf.ok) return fail(pdf.error);
    rendered.push({ pdf: pdf.data.pdf, filename: run.filename });
  }

  const filename = `workflow-run-${workflowRunId.slice(0, 8)}.pdf`;
  if (rendered.length === 1) {
    return ok({ pdf: rendered[0]!.pdf, contentType: "application/pdf", filename: rendered[0]!.filename, documentCount: 1 });
  }

  try {
    const merged = await mergePdfs({ files: rendered });
    return ok({ ...merged, filename, documentCount: rendered.length });
  } catch (error) {
    if (error instanceof GotenbergRenderError) {
      return fail(
        error.code === "bad_input" || error.code === "not_configured" ? err.badInput(error.message) : err.internal(error.message),
      );
    }
    throw error;
  }
};
