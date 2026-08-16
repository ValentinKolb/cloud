import type { DateContext } from "@k2b/stdlib";
import { ok, type Result } from "@k2b/stdlib";
import { HTML_TEMPLATE_ERROR, htmlTemplateConfigSchema } from "../field-types/html-template";
import { enrichRecordsWithHtmlTemplates } from "./html-template-fields";
import type { AuthorizedRecordAccess } from "./record-access";
import { list as listRecords } from "./records";
import type { ExpansionViewer } from "./relations";

type HtmlTemplatePreviewResult = {
  ok: boolean;
  diagnostics: Array<{ severity: "error" | "info"; message: string }>;
  rows: Array<{ recordId: string; html: string }>;
};

export const checkHtmlTemplate = async (params: {
  tableId: string;
  fieldId: string;
  template: string;
  css: string;
  dateConfig?: DateContext;
  recordAccess?: AuthorizedRecordAccess;
  viewer?: ExpansionViewer;
}): Promise<Result<HtmlTemplatePreviewResult>> => {
  const config = htmlTemplateConfigSchema.safeParse({ template: params.template, css: params.css });
  if (!config.success) {
    return ok({
      ok: false,
      diagnostics: config.error.issues.map((issue) => ({ severity: "error" as const, message: issue.message })),
      rows: [],
    });
  }
  if (!config.data.template) {
    return ok({
      ok: true,
      diagnostics: [{ severity: "info", message: "Type an HTML template to preview the latest records." }],
      rows: [],
    });
  }

  const listed = await listRecords({
    tableId: params.tableId,
    limit: 5,
    sort: [{ source: "record", key: "createdAt", direction: "desc" }],
    viewer: params.viewer,
    dateConfig: params.dateConfig,
    recordAccess: params.recordAccess,
    htmlTemplateFieldIds: [],
  });
  if (!listed.ok) return listed;
  const current = listed.data.fields.find((field) => field.id === params.fieldId && field.type === "html_template" && !field.deletedAt);
  if (!current) {
    return ok({ ok: false, diagnostics: [{ severity: "error", message: "HTML template field not found." }], rows: [] });
  }
  const fields = listed.data.fields.map((field) => (field.id === current.id ? { ...field, config: config.data } : field));
  await enrichRecordsWithHtmlTemplates(listed.data.items, fields, { dateConfig: params.dateConfig, fieldIds: new Set([current.id]) });
  const rows = listed.data.items.map((record) => ({ recordId: record.shortId, html: String(record.data[current.id] ?? "") }));
  const failed = rows.some((row) => row.html === HTML_TEMPLATE_ERROR);
  return ok({
    ok: !failed,
    diagnostics: failed ? [{ severity: "error", message: "Some preview records could not be rendered." }] : [],
    rows,
  });
};
