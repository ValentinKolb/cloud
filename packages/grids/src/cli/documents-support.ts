import type { CliInputFlagValue, CloudCliContext } from "@valentinkolb/cloud/cli";
import { flag } from "@valentinkolb/cloud/cli";
import type {
  Base,
  DocumentLink,
  DocumentRunBrowseResponse,
  DocumentRunSummary,
  DocumentTemplate,
  DocumentTemplateSummary,
  Table,
} from "../contracts";
import { listTables, resolveBaseFromCommand, resolveTable, UUID_RE } from "./resources";
import { applyDefined, exactMatch, queryString, readApi, readJsonInput, readTextInput } from "./runtime";

export const documentTemplateFlag = {
  template: flag.string({ description: "Document template id, short id, or exact name" }),
};

export const DOCUMENT_TEMPLATE_REFERENCE = {
  fields: {
    name: "Template label shown in Grids.",
    source: "GQL source. Use {{ record.id }} in the where clause for per-record templates.",
    html: "Liquid HTML body rendered by Gotenberg.",
    headerHtml: "Optional Liquid HTML header.",
    footerHtml: "Optional Liquid HTML footer.",
    pageCss: "Optional CSS for @page, print layout, and shared document styles.",
    numberTemplate: "Liquid pattern for immutable document.number.",
    filenameTemplate: "Liquid pattern for the generated PDF filename.",
    enabled: "Disabled templates are hidden from normal generation flows.",
  },
  liquidData: [
    "record.id",
    "record.data.<field label or key>",
    "rows",
    "columns",
    "table.name",
    "template.name",
    "document.number",
    "run.shortId",
    "generatedAt",
    "app.name",
    "app.logo",
    "business.legalName",
  ],
  examples: [
    {
      source: 'from table Invoices\nwhere record.id = "{{ record.id }}"\nlimit 1',
      html: "<h1>Invoice {{ document.number }}</h1>\n<p>{{ record.data.Customer }}</p>",
      filenameTemplate: "invoice-{{ document.number }}.pdf",
    },
  ],
};

export const listDocumentTemplates = (
  ctx: CloudCliContext,
  tableId: string,
  options: { full?: boolean; min?: "read" | "write" | "admin" } = {},
): Promise<Array<DocumentTemplate | DocumentTemplateSummary>> =>
  options.full
    ? readApi<DocumentTemplate[]>(ctx, `/documents/templates/by-table/${encodeURIComponent(tableId)}/full`)
    : readApi<DocumentTemplateSummary[]>(
        ctx,
        `/documents/templates/by-table/${encodeURIComponent(tableId)}${queryString({ min: options.min ?? "read" })}`,
      );

const getDocumentTemplateById = (ctx: CloudCliContext, templateId: string): Promise<DocumentTemplate> =>
  readApi<DocumentTemplate>(ctx, `/documents/templates/${encodeURIComponent(templateId)}`);

const assertDocumentTemplateScope = async (ctx: CloudCliContext, base: Base, table: Table | null, template: DocumentTemplate) => {
  if (table) {
    if (template.tableId !== table.id) throw new Error("Document template does not belong to the selected table.");
    return;
  }
  const tables = await listTables(ctx, base.id);
  if (!tables.some((item) => item.id === template.tableId)) throw new Error("Document template does not belong to the selected base.");
};

export const resolveDocumentTemplate = async (
  ctx: CloudCliContext,
  base: Base,
  table: Table | null,
  ref: string,
): Promise<DocumentTemplate> => {
  if (UUID_RE.test(ref)) {
    const template = await getDocumentTemplateById(ctx, ref);
    await assertDocumentTemplateScope(ctx, base, table, template);
    return template;
  }
  if (!table) throw new Error("Resolving a document template by name or short id requires --table.");
  const summary = exactMatch(
    await listDocumentTemplates(ctx, table.id, { full: true }),
    ref,
    [(template) => template.id, (template) => template.shortId, (template) => template.name],
    "document template",
    (template) => `${template.name} (${template.shortId})`,
  );
  return summary as DocumentTemplate;
};

export const documentTemplateRows = (items: Array<DocumentTemplate | DocumentTemplateSummary>) =>
  items.map((template) => ({
    shortId: template.shortId,
    name: template.name,
    enabled: template.enabled ? "yes" : "no",
    updatedAt: template.updatedAt,
    id: template.id,
  }));

export const documentRunRows = (items: DocumentRunSummary[]) =>
  items.map((run) => ({
    shortId: run.shortId,
    number: run.documentNumber,
    filename: run.filename,
    tags: run.tags.join(", "),
    generatedAt: run.generatedAt,
    id: run.id,
  }));

export const documentFolderRows = (items: DocumentRunBrowseResponse["folders"]) =>
  items.map((folder) => ({
    kind: folder.kind,
    label: folder.label,
    count: folder.count,
    path: folder.path.join("/"),
  }));

export const documentLinkRows = (items: DocumentLink[]) =>
  items.map((link) => ({
    id: link.id,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt ?? "-",
    accessCount: link.accessCount,
    comment: link.comment ?? "",
  }));

export const readDraftTemplateBody = async (
  flags: {
    body: CliInputFlagValue;
    record?: string;
    source: CliInputFlagValue;
    html: CliInputFlagValue;
    headerHtml: CliInputFlagValue;
    footerHtml: CliInputFlagValue;
    pageCss: CliInputFlagValue;
    numberTemplate?: string;
    filenameTemplate?: string;
  },
  template: DocumentTemplate | null,
) => {
  const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template draft JSON", false)) ?? {};
  const source = await readTextInput(flags.source, "draft GQL source", false);
  const html = await readTextInput(flags.html, "draft HTML", false);
  const headerHtml = await readTextInput(flags.headerHtml, "draft header HTML", false);
  const footerHtml = await readTextInput(flags.footerHtml, "draft footer HTML", false);
  const pageCss = await readTextInput(flags.pageCss, "draft page CSS", false);
  applyDefined(body, {
    source,
    html,
    headerHtml,
    footerHtml,
    pageCss,
    numberTemplate: flags.numberTemplate,
    filenameTemplate: flags.filenameTemplate,
    recordId: flags.record,
  });
  if (template) {
    applyDefined(body, {
      source: body.source ?? template.source,
      html: body.html ?? template.html,
      headerHtml: body.headerHtml ?? template.headerHtml,
      footerHtml: body.footerHtml ?? template.footerHtml,
      pageCss: body.pageCss ?? template.pageCss,
      numberTemplate: body.numberTemplate ?? template.numberTemplate,
      filenameTemplate: body.filenameTemplate ?? template.filenameTemplate,
    });
  }
  if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
  if (!body.source) throw new Error("Missing draft GQL source. Pass --source, --source-file, --body JSON, or a template argument.");
  if (!body.html) throw new Error("Missing draft HTML. Pass --html, --html-file, --body JSON, or a template argument.");
  return body;
};

export const resolveDocumentTemplateFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  refs: { table?: string; template?: string },
): Promise<{ base: Base; table: Table | null; template: DocumentTemplate }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, refs.table || refs.template ? 0 : 2);
  const table = refs.table
    ? await resolveTable(ctx, base.id, refs.table)
    : rest.length >= 2
      ? await resolveTable(ctx, base.id, rest[0]!)
      : null;
  const templateRef = refs.template ?? (table ? rest[1] : rest[0]);
  if (!templateRef) throw new Error("Missing document template.");
  return { base, table, template: await resolveDocumentTemplate(ctx, base, table, templateRef) };
};
