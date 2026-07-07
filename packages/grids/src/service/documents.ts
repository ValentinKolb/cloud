import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
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
import {
  CLOUD_LOGO_SVG,
  type LiquidTemplateFilter,
  renderLiquidTemplate,
  validateLiquidTemplate as validateSharedLiquidTemplate,
} from "@valentinkolb/cloud/shared";
import { type DateContext, dates, err, fail, ok, type Result, type ServiceError } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type BarcodeFormat, BarcodeRenderError, barcodeDataUrl } from "../barcode-rendering";
import type {
  CreateDocumentLinkInput,
  CreateDocumentTemplateInput,
  DocumentLink,
  DocumentLinkTtl,
  DocumentProfile,
  DocumentRun,
  DocumentRunFolder,
  DocumentRunSummary,
  DocumentRunSummaryList,
  DocumentTemplate,
  DocumentTemplateSummary,
  RecordSnapshot,
  RecordSnapshotSummary,
  UpdateDocumentRunMetadataInput,
  UpdateDocumentTemplateInput,
} from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import { get as getBase } from "./bases";
import { logAudit } from "./audit";
import { listByTable as listFields } from "./fields";
import { getContent as getFileContent, listForRecordField } from "./files";
import { buildBaseGqlResolverContext } from "./gql-resolver-context";
import { parseJsonbRow } from "./jsonb";
import { get as getRecord } from "./records";
import { insertWithShortId } from "./short-id";
import { get as getTable } from "./tables";
import type { Field, GridRecord, Table } from "./types";
import { ensureRecordScanCode } from "./workflows";

type DbRow = Record<string, unknown>;

export type DocumentRunPage = {
  items: DocumentRun[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
};

export type DocumentRunBrowsePage = {
  path: string[];
  folders: DocumentRunFolder[];
  items: DocumentRun[];
  total?: number;
  limit?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
};

const DEFAULT_SOURCE = (tableId: string) => `from table {${tableId}}\nwhere record.id = '{{ record.id }}'\nlimit 1`;
const DEFAULT_NUMBER_TEMPLATE = "{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}";
const DEFAULT_FILENAME_TEMPLATE = "{{ document.number }}.pdf";
const TEMPLATE_MAX_BYTES = 200_000;
const SOURCE_MAX_BYTES = 20_000;
const FILENAME_TEMPLATE_MAX_BYTES = 5_000;
const FILENAME_MAX_CHARS = 255;
const TEMPLATE_PART_MAX_BYTES = 50_000;
const RENDER_MAX_BYTES = 300_000;
const SNAPSHOT_MAX_DEPTH = 4;
const SNAPSHOT_MAX_RECORDS = 500;
const DOCUMENT_QUERY_MAX_ROWS = 10_000;
const DOCUMENT_IMAGE_MAX_BYTES = 2_000_000;
const DOCUMENT_IMAGE_MAX_COUNT = 12;
const WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS = 1_000;
const DOCUMENT_LINK_TOKEN_PREFIX = "gdl_";
const DOCUMENT_LINK_TOKEN_BYTES = 32;
const DOCUMENT_LINK_TTL_MS: Record<DocumentLinkTtl, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const DOCUMENT_TEMPLATE_ROOTS = new Set([
  "record",
  "table",
  "rows",
  "columns",
  "query",
  "document",
  "snapshot",
  "app",
  "business",
  "images",
  "primaryImage",
  "template",
  "run",
  "date",
]);
const DOCUMENT_SOURCE_ROOTS = new Set(["record", "table", "app", "business", "template", "date"]);
const DOCUMENT_NUMBER_ROOTS = new Set(["record", "table", "template", "run", "date", "app", "business"]);
const LIQUID_KEYWORDS = new Set([
  "and",
  "or",
  "not",
  "contains",
  "in",
  "true",
  "false",
  "nil",
  "null",
  "blank",
  "empty",
  "reversed",
  "continue",
]);
const LIQUID_TAGS_WITHOUT_EXPRESSIONS = new Set([
  "else",
  "endif",
  "endunless",
  "endfor",
  "endcase",
  "endcapture",
  "endcomment",
  "endraw",
  "break",
  "continue",
]);

const stripLiquidStringLiterals = (value: string): string =>
  value.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, (match) => " ".repeat(match.length));

const stripLiquidCommentBlocks = (value: string): string => value.replace(/{%-?\s*(comment|raw)\s*-?%}[\s\S]*?{%-?\s*end\1\s*-?%}/g, "");

const collectLiquidExpressionRoots = (expression: string): string[] => {
  const sanitized = stripLiquidStringLiterals(expression.replace(/\|\s*[A-Za-z_][A-Za-z0-9_]*/g, ""));
  const roots: string[] = [];
  for (const match of sanitized.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const name = match[0];
    const index = match.index ?? 0;
    const before = sanitized[index - 1] ?? "";
    const after = sanitized[index + name.length] ?? "";
    if (before === "." || after === ":" || LIQUID_KEYWORDS.has(name)) continue;
    roots.push(name);
  }
  return roots;
};

const liquidLocals = (frames: readonly (readonly string[])[]): Set<string> => {
  const locals = new Set<string>();
  for (const frame of frames) {
    for (const local of frame) locals.add(local);
  }
  return locals;
};

const addLiquidLocal = (frames: string[][], local: string): void => {
  frames[frames.length - 1]?.push(local);
};

const liquidExpressions = function* (source: string): Generator<{ expression: string; locals: ReadonlySet<string> }> {
  const cleanSource = stripLiquidCommentBlocks(source);
  const frames: string[][] = [[]];
  for (const match of cleanSource.matchAll(/{{-?\s*([\s\S]*?)\s*-?}}|{%-?\s*([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?)\s*-?%}/g)) {
    const outputExpression = match[1];
    if (outputExpression !== undefined) {
      yield { expression: outputExpression, locals: liquidLocals(frames) };
      continue;
    }
    const tag = match[2]!;
    if (tag === "endfor") {
      if (frames.length > 1) frames.pop();
      continue;
    }
    if (LIQUID_TAGS_WITHOUT_EXPRESSIONS.has(tag) || tag === "comment" || tag === "raw") continue;
    const body = match[3] ?? "";
    if (tag === "for") {
      const forMatch = body.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/);
      if (forMatch) {
        yield { expression: forMatch[2]!, locals: liquidLocals(frames) };
        frames.push([forMatch[1]!, "forloop"]);
      }
      continue;
    }
    if (tag === "assign") {
      const localMatch = body.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      const assignMatch = body.match(/=\s*([\s\S]+)$/);
      if (assignMatch) yield { expression: assignMatch[1]!, locals: liquidLocals(frames) };
      if (localMatch) addLiquidLocal(frames, localMatch[1]!);
      continue;
    }
    if (tag === "capture") {
      const captureMatch = body.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (captureMatch) addLiquidLocal(frames, captureMatch[1]!);
      continue;
    }
    yield { expression: body, locals: liquidLocals(frames) };
  }
};

export const validateLiquidRoots = (source: string, roots: ReadonlySet<string>, label: string): Result<void> => {
  for (const { expression, locals } of liquidExpressions(source)) {
    for (const root of collectLiquidExpressionRoots(expression)) {
      if (roots.has(root) || locals.has(root)) continue;
      return fail(err.badInput(`${label} uses unknown Liquid variable "${root}"`));
    }
  }
  return ok();
};

const datePatternContext = (date: Date, dateConfig?: DateContext) => {
  const iso = date.toISOString();
  const dateOnly = dates.formatDateKey(date, dateConfig);
  return {
    iso,
    date: dateOnly,
    yyyy: dateOnly.slice(0, 4),
    year: dateOnly.slice(0, 4),
    month: dateOnly.slice(5, 7),
    day: dateOnly.slice(8, 10),
    yyyyMMdd: dateOnly.replaceAll("-", ""),
  };
};

const templatePatternContext = (template: Partial<Pick<DocumentTemplate, "id" | "shortId" | "name">> | null | undefined) => ({
  id: template?.id ?? null,
  shortId: template?.shortId ?? "draft",
  name: template?.name ?? "Draft template",
});

const runPatternContext = (runId: string | null | undefined, shortId: string | null | undefined) => ({
  id: runId ?? null,
  shortId: shortId ?? "draft",
});

const safeDocumentNumber = (value: string): string =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[/:*?"<>|\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

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

export type DocumentTemplateAppData = {
  name: string;
  url: string;
  contactEmail: string | null;
  copyright: string | null;
  timezone: string;
  logoDataUri: string;
};

export type DocumentTemplateBusinessData = {
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
    url: string | null;
    qrUrl: string | null;
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

const appUrlForPath = (appData: DocumentTemplateAppData, path: string): string | null => {
  if (!appData.url) return null;
  return `${appData.url.replace(/\/+$/, "")}${path}`;
};

const buildRecordScanMeta = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  appData: DocumentTemplateAppData;
}): Promise<DocumentTemplateRecordMeta> => {
  const scan = await ensureRecordScanCode({
    baseId: params.baseId,
    tableId: params.tableId,
    recordId: params.recordId,
  });
  const url = appUrlForPath(params.appData, `/app/grids/scan?code=${encodeURIComponent(scan.code)}`);
  return {
    scan: {
      code: scan.code,
      url,
      qrUrl: url,
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

export const defaultTemplateAppData = (): DocumentTemplateAppData => appDataFromValues({});

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

const barcodeDataUrlFilter: LiquidTemplateFilter = (value, bcid = "code128", showText = false) => {
  if (typeof bcid !== "string") throw new Error("barcode_data_url requires a barcode type");
  if (showText !== true && showText !== false && showText !== undefined && showText !== null) {
    throw new Error("barcode_data_url show text flag must be a boolean");
  }

  const format: BarcodeFormat = { kind: "barcode", bcid, showText: showText === true };
  try {
    return barcodeDataUrl(value, format);
  } catch (error) {
    if (error instanceof BarcodeRenderError) throw new Error(error.message);
    throw error;
  }
};

const documentLiquidFilters: Record<string, LiquidTemplateFilter> = {
  barcode_data_url: barcodeDataUrlFilter,
};

export const validateLiquidTemplate = (source: string): Result<void> => {
  if (byteLength(source) > TEMPLATE_MAX_BYTES) return fail(err.badInput("template is too large"));
  const valid = validateSharedLiquidTemplate(source, { filters: documentLiquidFilters });
  return valid.ok ? ok() : fail(err.badInput(valid.error));
};

const validateDocumentLiquidTemplate = (
  source: string,
  label: string,
  roots: ReadonlySet<string> = DOCUMENT_TEMPLATE_ROOTS,
): Result<void> => {
  const valid = validateLiquidTemplate(source);
  if (!valid.ok) return valid;
  return validateLiquidRoots(source, roots, label);
};

export const renderLiquidText = async (
  template: string,
  data: Record<string, unknown>,
  maxBytes = TEMPLATE_MAX_BYTES,
): Promise<Result<string>> => {
  const valid = validateLiquidTemplate(template);
  if (!valid.ok) return valid;
  try {
    const rendered = renderLiquidTemplate(template, data, { filters: documentLiquidFilters });
    if (byteLength(rendered) > maxBytes) return fail(err.badInput("rendered template is too large"));
    return ok(rendered);
  } catch (error) {
    return fail(err.badInput(error instanceof Error ? error.message : "template render failed"));
  }
};

export const renderLiquidPlainText = async (
  template: string,
  data: Record<string, unknown>,
  maxBytes = TEMPLATE_MAX_BYTES,
): Promise<Result<string>> => {
  const valid = validateLiquidTemplate(template);
  if (!valid.ok) return valid;
  try {
    const rendered = renderLiquidTemplate(template, data, { filters: documentLiquidFilters, escapeOutput: false });
    if (byteLength(rendered) > maxBytes) return fail(err.badInput("rendered template is too large"));
    return ok(rendered);
  } catch (error) {
    return fail(err.badInput(error instanceof Error ? error.message : "template render failed"));
  }
};

export const documentNumberFor = (params: {
  template: Partial<Pick<DocumentTemplate, "id" | "shortId" | "name" | "numberTemplate">>;
  runId: string;
  runShortId: string;
  generatedAt?: Date;
  dateConfig?: DateContext;
  data?: Record<string, unknown>;
}): Result<string> => {
  const template = params.template.numberTemplate?.trim() || DEFAULT_NUMBER_TEMPLATE;
  const valid = validateDocumentLiquidTemplate(template, "document number pattern", DOCUMENT_NUMBER_ROOTS);
  if (!valid.ok) return valid;
  try {
    const rendered = renderLiquidTemplate(
      template,
      {
        ...(params.data ?? {}),
        template: templatePatternContext(params.template),
        run: runPatternContext(params.runId, params.runShortId),
        date: datePatternContext(params.generatedAt ?? new Date(), params.dateConfig),
      },
      { filters: documentLiquidFilters },
    );
    const number = safeDocumentNumber(rendered);
    return number ? ok(number) : fail(err.badInput("document number pattern rendered an empty number"));
  } catch (error) {
    return fail(err.badInput(error instanceof Error ? error.message : "document number pattern render failed"));
  }
};

const mapTemplate = (row: DbRow): DocumentTemplate => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  source: row.source as string,
  html: row.html as string,
  headerHtml: (row.header_html as string | null) ?? null,
  footerHtml: (row.footer_html as string | null) ?? null,
  pageCss: (row.page_css as string | null) ?? null,
  numberTemplate: (row.number_template as string | null) ?? DEFAULT_NUMBER_TEMPLATE,
  filenameTemplate: (row.filename_template as string | null) ?? DEFAULT_FILENAME_TEMPLATE,
  enabled: row.enabled as boolean,
  position: row.position as number,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const mapSnapshot = (row: DbRow): RecordSnapshot => ({
  id: row.id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  root: parseJsonbRow<Record<string, unknown>>(row.root, {}),
  graph: parseJsonbRow<Record<string, unknown>>(row.graph, {}),
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});

const mapSnapshotSummary = (row: DbRow): RecordSnapshotSummary => ({
  id: row.id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});

const mapRun = (row: DbRow): DocumentRun => ({
  id: row.id as string,
  shortId: row.short_id as string,
  templateId: (row.template_id as string | null) ?? null,
  workflowRunId: (row.workflow_run_id as string | null) ?? null,
  snapshotId: row.snapshot_id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  documentNumber: row.document_number as string,
  filename: (row.filename as string | null) ?? `${row.document_number as string}.pdf`,
  tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  templateSnapshot: parseJsonbRow<Record<string, unknown>>(row.template_snapshot, {}),
  renderData: parseJsonbRow<Record<string, unknown>>(row.render_data, {}),
  generatedBy: (row.generated_by as string | null) ?? null,
  generatedAt: (row.generated_at as Date).toISOString(),
});

const mapDocumentLink = (row: DbRow): DocumentLink => ({
  id: row.id as string,
  documentRunId: row.document_run_id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  comment: (row.comment as string | null) ?? null,
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  expiresAt: (row.expires_at as Date).toISOString(),
  revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
  revokedBy: (row.revoked_by as string | null) ?? null,
  lastAccessedAt: row.last_accessed_at ? (row.last_accessed_at as Date).toISOString() : null,
  accessCount: Number(row.access_count ?? 0),
});

const generateDocumentLinkToken = (): string => `${DOCUMENT_LINK_TOKEN_PREFIX}${randomBytes(DOCUMENT_LINK_TOKEN_BYTES).toString("base64url")}`;

const hashDocumentLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const normalizeDocumentLinkToken = (token: string): string | null => {
  const normalized = token.trim();
  if (!normalized.startsWith(DOCUMENT_LINK_TOKEN_PREFIX)) return null;
  if (normalized.length < DOCUMENT_LINK_TOKEN_PREFIX.length + 32 || normalized.length > 160) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized.slice(DOCUMENT_LINK_TOKEN_PREFIX.length))) return null;
  return normalized;
};

const normalizeDocumentLinkComment = (comment: string | null | undefined): string | null => {
  const normalized = comment?.trim() ?? "";
  return normalized ? normalized.slice(0, 500) : null;
};

const documentLinkExpiresAt = (expiresIn: DocumentLinkTtl): Date => new Date(Date.now() + DOCUMENT_LINK_TTL_MS[expiresIn]);

export const publicDocumentLinkPath = (token: string): string => `/share/grids/documents/${encodeURIComponent(token)}`;

export const summarizeTemplate = (template: DocumentTemplate): DocumentTemplateSummary => ({
  id: template.id,
  shortId: template.shortId,
  tableId: template.tableId,
  name: template.name,
  description: template.description,
  enabled: template.enabled,
  position: template.position,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

export const summarizeRun = (run: DocumentRun): DocumentRunSummary => ({
  id: run.id,
  shortId: run.shortId,
  templateId: run.templateId,
  workflowRunId: run.workflowRunId,
  snapshotId: run.snapshotId,
  baseId: run.baseId,
  tableId: run.tableId,
  recordId: run.recordId,
  documentNumber: run.documentNumber,
  filename: run.filename,
  tags: run.tags,
  generatedBy: run.generatedBy,
  generatedAt: run.generatedAt,
});

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

  const ctx = await buildBaseGqlResolverContext({ baseId: params.baseId, currentTableId: params.tableId, ast: parsed.ast });
  const resolved = resolveDslQueryToQueryPlan(parsed.ast, ctx);
  if (!resolved.ok) return fail(err.badInput(diagnosticsMessage(resolved.diagnostics)));

  const fieldsByTableId = await fieldsWithPlanExtras(ctx.fieldsByTableId, params.tableId, resolved.plan);
  const preview = await previewDslQuery(resolved.plan, {
    fieldsByTableId,
    timeZone: params.dateConfig?.timeZone,
    maxRows: DOCUMENT_QUERY_MAX_ROWS,
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

export const listTemplatesForTable = async (tableId: string): Promise<DocumentTemplate[]> => {
  const rows = await sql<DbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.table_id = ${tableId}::uuid AND dt.deleted_at IS NULL
    ORDER BY dt.position, dt.created_at
  `;
  return rows.map(mapTemplate);
};

export const getTemplate = async (templateId: string): Promise<DocumentTemplate | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.id = ${templateId}::uuid AND dt.deleted_at IS NULL
  `;
  return row ? mapTemplate(row) : null;
};

export const getTemplateByShortId = async (tableId: string, shortId: string): Promise<DocumentTemplate | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.table_id = ${tableId}::uuid
      AND dt.short_id = ${shortId}
      AND dt.deleted_at IS NULL
  `;
  return row ? mapTemplate(row) : null;
};

export const getTemplateByIdOrShortId = async (tableId: string, idOrSlug: string): Promise<DocumentTemplate | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const template = await getTemplate(idOrSlug);
    return template && template.tableId === tableId ? template : null;
  }
  return getTemplateByShortId(tableId, idOrSlug);
};

export const validateTemplateWrite = (input: {
  source?: string;
  html?: string;
  headerHtml?: string | null;
  footerHtml?: string | null;
  pageCss?: string | null;
  numberTemplate?: string | null;
  filenameTemplate?: string | null;
}): Result<void> => {
  if (input.source !== undefined && byteLength(input.source) > SOURCE_MAX_BYTES) return fail(err.badInput("GQL source is too large"));
  if (input.html !== undefined) {
    const valid = validateDocumentLiquidTemplate(input.html, "HTML template");
    if (!valid.ok) return valid;
  }
  for (const [label, value] of [
    ["header HTML", input.headerHtml],
    ["footer HTML", input.footerHtml],
    ["page CSS", input.pageCss],
  ] as const) {
    if (value === undefined || value === null || value === "") continue;
    if (byteLength(value) > TEMPLATE_PART_MAX_BYTES) return fail(err.badInput(`${label} is too large`));
    const valid = validateDocumentLiquidTemplate(value, label);
    if (!valid.ok) return valid;
  }
  if (input.source !== undefined) {
    const valid = validateDocumentLiquidTemplate(input.source, "GQL source", DOCUMENT_SOURCE_ROOTS);
    if (!valid.ok) return valid;
  }
  if (input.numberTemplate !== undefined && input.numberTemplate !== null) {
    if (byteLength(input.numberTemplate) > FILENAME_TEMPLATE_MAX_BYTES) return fail(err.badInput("document number pattern is too large"));
    const valid = validateDocumentLiquidTemplate(input.numberTemplate, "document number pattern", DOCUMENT_NUMBER_ROOTS);
    if (!valid.ok) return valid;
  }
  if (input.filenameTemplate !== undefined && input.filenameTemplate !== null) {
    if (byteLength(input.filenameTemplate) > FILENAME_TEMPLATE_MAX_BYTES) return fail(err.badInput("filename template is too large"));
    const valid = validateDocumentLiquidTemplate(input.filenameTemplate, "filename template");
    if (!valid.ok) return valid;
  }
  return ok();
};

export const createTemplate = async (
  tableId: string,
  input: CreateDocumentTemplateInput,
  actorId: string | null,
): Promise<Result<DocumentTemplate>> => {
  const table = await getTable(tableId);
  if (!table) return fail(err.notFound("Table"));
  const valid = validateTemplateWrite(input);
  if (!valid.ok) return valid;

  const name = input.name.trim();
  if (!name) return fail(err.badInput("name required"));
  const source = input.source.trim() || DEFAULT_SOURCE(tableId);
  const html = input.html.trim();
  const headerHtml = input.headerHtml?.trim() || null;
  const footerHtml = input.footerHtml?.trim() || null;
  const pageCss = input.pageCss?.trim() || null;
  const numberTemplate = input.numberTemplate?.trim() || DEFAULT_NUMBER_TEMPLATE;
  const filenameTemplate = input.filenameTemplate?.trim() || DEFAULT_FILENAME_TEMPLATE;

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [inserted] = await sql<DbRow[]>`
      INSERT INTO grids.document_templates (
        short_id, table_id, name, description, source, html, header_html, footer_html, page_css, number_template, filename_template,
        enabled, position, created_by, updated_by
      )
      VALUES (
        ${shortId},
        ${tableId}::uuid,
        ${name},
        ${input.description ?? null},
        ${source},
        ${html},
        ${headerHtml},
        ${footerHtml},
        ${pageCss},
        ${numberTemplate},
        ${filenameTemplate},
        ${input.enabled ?? true},
        COALESCE((SELECT MAX(position) + 1 FROM grids.document_templates WHERE table_id = ${tableId}::uuid), 0),
        ${actorId}::uuid,
        ${actorId}::uuid
      )
      RETURNING *
    `;
    if (!inserted) throw new Error("insert returned no row");
    return inserted;
  }, "idx_grids_document_templates_short_id");
  return ok(mapTemplate(row));
};

export const updateTemplate = async (
  templateId: string,
  input: UpdateDocumentTemplateInput,
  actorId: string | null,
): Promise<Result<DocumentTemplate>> => {
  const existing = await getTemplate(templateId);
  if (!existing) return fail(err.notFound("Document template"));
  const valid = validateTemplateWrite(input);
  if (!valid.ok) return valid;

  const [row] = await sql<DbRow[]>`
    UPDATE grids.document_templates
    SET
      name = COALESCE(${input.name?.trim() || null}, name),
      description = ${input.description === undefined ? sql`description` : input.description},
      source = COALESCE(${input.source?.trim() || null}, source),
      html = COALESCE(${input.html?.trim() || null}, html),
      header_html = ${input.headerHtml === undefined ? sql`header_html` : input.headerHtml?.trim() || null},
      footer_html = ${input.footerHtml === undefined ? sql`footer_html` : input.footerHtml?.trim() || null},
      page_css = ${input.pageCss === undefined ? sql`page_css` : input.pageCss?.trim() || null},
      number_template = COALESCE(${input.numberTemplate?.trim() || null}, number_template),
      filename_template = COALESCE(${input.filenameTemplate?.trim() || null}, filename_template),
      enabled = COALESCE(${input.enabled ?? null}, enabled),
      position = COALESCE(${input.position ?? null}, position),
      updated_by = ${actorId}::uuid,
      updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
    RETURNING *
  `;
  return row ? ok(mapTemplate(row)) : fail(err.notFound("Document template"));
};

export const removeTemplate = async (templateId: string, actorId: string | null): Promise<Result<void>> => {
  const [row] = await sql<DbRow[]>`
    UPDATE grids.document_templates
    SET deleted_at = now(), updated_by = ${actorId}::uuid, updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  return row ? ok() : fail(err.notFound("Document template"));
};

type SnapshotRecord = {
  id: string;
  table: Pick<Table, "id" | "shortId" | "name">;
  fields: Array<
    Pick<
      Field,
      | "id"
      | "shortId"
      | "name"
      | "description"
      | "icon"
      | "type"
      | "config"
      | "position"
      | "required"
      | "presentable"
      | "hideInTable"
      | "defaultValue"
      | "indexed"
      | "uniqueConstraint"
      | "deletedAt"
      | "createdAt"
      | "updatedAt"
    >
  >;
  data: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const relationIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
};

const snapshotRecord = (table: Table, fields: Field[], record: GridRecord): SnapshotRecord => ({
  id: record.id,
  table: { id: table.id, shortId: table.shortId, name: table.name },
  fields: fields.map((field) => ({
    id: field.id,
    shortId: field.shortId,
    name: field.name,
    description: field.description,
    icon: field.icon,
    type: field.type,
    config: field.config,
    position: field.position,
    required: field.required,
    presentable: field.presentable,
    hideInTable: field.hideInTable,
    defaultValue: field.defaultValue,
    indexed: field.indexed,
    uniqueConstraint: field.uniqueConstraint,
    deletedAt: field.deletedAt,
    createdAt: field.createdAt,
    updatedAt: field.updatedAt,
  })),
  data: record.data,
  version: record.version,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  deletedAt: record.deletedAt,
});

const buildRecordSnapshotGraph = async (
  tableId: string,
  recordId: string,
  options: { dateConfig?: DateContext; maxDepth?: number; maxRecords?: number } = {},
): Promise<Result<{ root: SnapshotRecord; graph: { rootId: string; records: Record<string, SnapshotRecord> } }>> => {
  const maxDepth = options.maxDepth ?? SNAPSHOT_MAX_DEPTH;
  const maxRecords = options.maxRecords ?? SNAPSHOT_MAX_RECORDS;
  const records: Record<string, SnapshotRecord> = {};
  const seen = new Set<string>();

  const visit = async (currentTableId: string, currentRecordId: string, depth: number): Promise<Result<SnapshotRecord>> => {
    if (seen.size >= maxRecords) return fail(err.badInput(`snapshot exceeds ${maxRecords} records`));
    const key = `${currentTableId}:${currentRecordId}`;
    const existing = records[key];
    if (existing) return ok(existing);
    seen.add(key);

    const table = await getTable(currentTableId);
    if (!table) return fail(err.notFound("Table"));
    const fields = await listFields(currentTableId);
    const record = await getRecord(currentTableId, currentRecordId, { dateConfig: options.dateConfig });
    if (!record) return fail(err.notFound("Record"));
    const captured = snapshotRecord(table, fields, record);
    records[key] = captured;

    if (depth < maxDepth) {
      for (const field of fields) {
        if (field.type !== "relation") continue;
        const targetTableId = typeof field.config.targetTableId === "string" ? field.config.targetTableId : null;
        if (!targetTableId) continue;
        for (const targetRecordId of relationIds(record.data[field.id])) {
          const nested = await visit(targetTableId, targetRecordId, depth + 1);
          if (!nested.ok) return nested;
        }
      }
    }
    return ok(captured);
  };

  const root = await visit(tableId, recordId, 0);
  if (!root.ok) return root;
  return ok({ root: root.data, graph: { rootId: `${tableId}:${recordId}`, records } });
};

export const createRecordSnapshot = async (params: {
  baseId: string;
  tableId: string;
  recordId: string;
  actorId: string | null;
  dateConfig?: DateContext;
}): Promise<Result<RecordSnapshot>> => {
  const graph = await buildRecordSnapshotGraph(params.tableId, params.recordId, { dateConfig: params.dateConfig });
  if (!graph.ok) return graph;

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.record_snapshots (base_id, table_id, record_id, root, graph, created_by)
    VALUES (${params.baseId}::uuid, ${params.tableId}::uuid, ${params.recordId}::uuid, ${graph.data.root}::jsonb, ${graph.data.graph}::jsonb, ${params.actorId}::uuid)
    RETURNING *
  `;
  return row ? ok(mapSnapshot(row)) : fail(err.internal("Could not create record snapshot"));
};

export const getSnapshot = async (snapshotId: string): Promise<RecordSnapshot | null> => {
  const [row] = await sql<DbRow[]>`SELECT * FROM grids.record_snapshots WHERE id = ${snapshotId}::uuid`;
  return row ? mapSnapshot(row) : null;
};

export const listSnapshotsForRecord = async (tableId: string, recordId: string): Promise<RecordSnapshotSummary[]> => {
  const rows = await sql<DbRow[]>`
    SELECT snapshot.id, snapshot.base_id, snapshot.table_id, snapshot.record_id, snapshot.created_by, snapshot.created_at
    FROM grids.record_snapshots snapshot
    WHERE snapshot.table_id = ${tableId}::uuid
      AND snapshot.record_id = ${recordId}::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM grids.document_runs run
        WHERE run.snapshot_id = snapshot.id
      )
    ORDER BY snapshot.created_at DESC
  `;
  return rows.map(mapSnapshotSummary);
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
    appData,
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

  return createRun({
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

export const createRun = async (params: {
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
      const [inserted] = await sql<DbRow[]>`
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
          ${sql.array(built.data.tags, "TEXT")},
          ${templateSnapshot}::jsonb,
          ${built.data.data}::jsonb,
          ${params.actorId}::uuid,
          ${generatedAt}
        )
        RETURNING *
      `;
      if (!inserted) throw new Error("insert returned no row");
      return inserted;
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

export const getRun = async (runId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DbRow[]>`SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid`;
  return row ? mapRun(row) : null;
};

export const updateRunMetadata = async (runId: string, input: UpdateDocumentRunMetadataInput): Promise<Result<DocumentRun>> => {
  const current = await getRun(runId);
  if (!current) return fail(err.notFound("document run not found"));
  const filename =
    input.filename === undefined ? current.filename : safePdfFilename(input.filename, `${current.documentNumber || current.shortId}.pdf`);
  const tags = input.tags === undefined ? current.tags : normalizeDocumentTags(input.tags);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.document_runs
    SET filename = ${filename}, tags = ${sql.array(tags, "TEXT")}
    WHERE id = ${runId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.notFound("document run not found"));
  return ok(mapRun(row));
};

export const listDocumentLinksForRun = async (documentRunId: string): Promise<DocumentLink[]> => {
  const rows = await sql<DbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE document_run_id = ${documentRunId}::uuid
    ORDER BY created_at DESC, id DESC
  `;
  return rows.map(mapDocumentLink);
};

export const getDocumentLink = async (linkId: string): Promise<DocumentLink | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE id = ${linkId}::uuid
  `;
  return row ? mapDocumentLink(row) : null;
};

export const createDocumentLink = async (params: {
  run: DocumentRun;
  input: CreateDocumentLinkInput;
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<Result<{ link: DocumentLink; token: string }>> => {
  const token = generateDocumentLinkToken();
  const expiresAt = documentLinkExpiresAt(params.input.expiresIn);
  const comment = normalizeDocumentLinkComment(params.input.comment);
  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.document_links (
      document_run_id, base_id, table_id, record_id, token_hash, comment, created_by, expires_at
    )
    VALUES (
      ${params.run.id}::uuid,
      ${params.run.baseId}::uuid,
      ${params.run.tableId}::uuid,
      ${params.run.recordId}::uuid,
      ${hashDocumentLinkToken(token)},
      ${comment},
      ${params.actorId}::uuid,
      ${expiresAt}
    )
    RETURNING *
  `;
  if (!row) return fail(err.internal("Could not create document link"));
  const link = mapDocumentLink(row);
  await logAudit({
    baseId: params.run.baseId,
    tableId: params.run.tableId,
    recordId: params.run.recordId,
    userId: params.actorId,
    action: "document_link.created",
    ip: params.ip,
    userAgent: params.userAgent,
    diff: {
      documentRunId: { old: null, new: params.run.id },
      documentLinkId: { old: null, new: link.id },
      expiresAt: { old: null, new: link.expiresAt },
      comment: { old: null, new: link.comment },
    },
  });
  return ok({ link, token });
};

export const revokeDocumentLink = async (params: {
  linkId: string;
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<Result<DocumentLink>> => {
  const [row] = await sql<DbRow[]>`
    UPDATE grids.document_links
    SET revoked_at = now(), revoked_by = ${params.actorId}::uuid
    WHERE id = ${params.linkId}::uuid AND revoked_at IS NULL
    RETURNING *
  `;
  if (!row) {
    const existing = await getDocumentLink(params.linkId);
    return existing ? ok(existing) : fail(err.notFound("Document link"));
  }
  const link = mapDocumentLink(row);
  await logAudit({
    baseId: link.baseId,
    tableId: link.tableId,
    recordId: link.recordId,
    userId: params.actorId,
    action: "document_link.revoked",
    ip: params.ip,
    userAgent: params.userAgent,
    diff: {
      documentRunId: { old: link.documentRunId, new: link.documentRunId },
      documentLinkId: { old: link.id, new: link.id },
      revokedAt: { old: null, new: link.revokedAt },
    },
  });
  return ok(link);
};

export const resolveDocumentLinkDownload = async (
  token: string,
): Promise<Result<{ link: DocumentLink; run: DocumentRun }>> => {
  const normalizedToken = normalizeDocumentLinkToken(token);
  if (!normalizedToken) return fail(err.notFound("Document link"));

  const [row] = await sql<DbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE token_hash = ${hashDocumentLinkToken(normalizedToken)}
      AND revoked_at IS NULL
      AND expires_at > now()
  `;
  if (!row) return fail(err.notFound("Document link"));
  const link = mapDocumentLink(row);
  const run = await getRun(link.documentRunId);
  if (!run) return fail(err.notFound("Document run"));
  return ok({ link, run });
};

export const recordDocumentLinkAccess = async (
  linkId: string,
  audit: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Result<DocumentLink>> => {
  const [row] = await sql<DbRow[]>`
    UPDATE grids.document_links
    SET access_count = access_count + 1, last_accessed_at = now()
    WHERE id = ${linkId}::uuid
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING *
  `;
  if (!row) return fail(err.notFound("Document link"));
  const link = mapDocumentLink(row);

  await logAudit({
    baseId: link.baseId,
    tableId: link.tableId,
    recordId: link.recordId,
    userId: null,
    action: "document_link.accessed",
    ip: audit.ip,
    userAgent: audit.userAgent,
    diff: {
      documentRunId: { old: link.documentRunId, new: link.documentRunId },
      documentLinkId: { old: link.id, new: link.id },
      accessCount: { old: link.accessCount - 1, new: link.accessCount },
    },
  });
  return ok(link);
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
