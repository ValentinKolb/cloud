import { Buffer } from "node:buffer";
import {
  coreSettings,
  type GotenbergConfig,
  type RenderHtmlToPdfResult,
  renderTemplatePdfPreview,
  type TemplatePdfPreviewResult,
} from "@valentinkolb/cloud/services";
import { CLOUD_LOGO_SVG } from "@valentinkolb/cloud/shared";
import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { DocumentProfile, DocumentRun, DocumentTemplate, RecordSnapshot } from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import { get as getBase } from "./bases";
import {
  datePatternContext,
  documentLiquidFilters,
  documentNumberFor,
  renderLiquidText,
  runPatternContext,
  templatePatternContext,
} from "./document-liquid";
import { normalizeDocumentTags, safePdfFilename } from "./document-run-values";
import type { SnapshotRecord } from "./document-snapshots";
import { listByTable as listFields } from "./fields";
import { getContent as getFileContent, listForRecordField } from "./files";
import { buildTrustedGqlResolverContext } from "./gql-resolver-context";
import type { Field, GridRecord, Table } from "./types";
import { ensureRecordScanCode } from "./workflows";

const DEFAULT_FILENAME_TEMPLATE = "{{ document.number }}.pdf";
const SOURCE_MAX_BYTES = 20_000;
const FILENAME_TEMPLATE_MAX_BYTES = 5_000;
const TEMPLATE_PART_MAX_BYTES = 50_000;
const RENDER_MAX_BYTES = 300_000;
const DOCUMENT_QUERY_MAX_ROWS = 10_000;
const DOCUMENT_IMAGE_MAX_BYTES = 2_000_000;
const DOCUMENT_IMAGE_MAX_COUNT = 12;

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
