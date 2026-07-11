import type {
  DocumentLink,
  DocumentRun,
  DocumentRunSummary,
  DocumentTemplate,
  DocumentTemplateSummary,
  RecordSnapshot,
  RecordSnapshotSummary,
} from "../contracts";
import { DEFAULT_DOCUMENT_NUMBER_TEMPLATE } from "./document-liquid";
import { parseJsonbRow } from "./jsonb";

export type DocumentDbRow = Record<string, unknown>;

export const mapDocumentTemplate = (row: DocumentDbRow): DocumentTemplate => ({
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
  numberTemplate: (row.number_template as string | null) ?? DEFAULT_DOCUMENT_NUMBER_TEMPLATE,
  filenameTemplate: (row.filename_template as string | null) ?? "{{ document.number }}.pdf",
  enabled: row.enabled as boolean,
  position: row.position as number,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export const mapRecordSnapshot = (row: DocumentDbRow): RecordSnapshot => ({
  id: row.id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  root: parseJsonbRow<Record<string, unknown>>(row.root, {}),
  graph: parseJsonbRow<Record<string, unknown>>(row.graph, {}),
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});

export const mapRecordSnapshotSummary = (row: DocumentDbRow): RecordSnapshotSummary => ({
  id: row.id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
});

export const mapDocumentRun = (row: DocumentDbRow): DocumentRun => ({
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

export const mapDocumentLink = (row: DocumentDbRow): DocumentLink => ({
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

export const summarizeDocumentTemplate = (template: DocumentTemplate): DocumentTemplateSummary => ({
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

export const summarizeDocumentRun = (run: DocumentRun): DocumentRunSummary => ({
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
