import { GotenbergRenderError, isUniqueViolation, mergePdfs, type RenderHtmlToPdfResult } from "@valentinkolb/cloud/services";
import { type DateContext, err, fail, ok, type Result, type ServiceError } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { DocumentRun, DocumentTemplate, RecordSnapshot, UpdateDocumentRunMetadataInput } from "../contracts";
import { logAudit } from "./audit";
import { type DocumentDbRow, mapDocumentRun } from "./document-mappers";
import { buildDocumentRunRenderData, buildLiveRenderData, renderRunPdf } from "./document-rendering";
import { normalizeDocumentTags, safePdfFilename } from "./document-run-values";
import { createRecordSnapshotDraft, persistRecordSnapshot, type SnapshotRelatedTableGuard } from "./document-snapshots";
import { get as getRecord } from "./records";
import { insertWithShortId } from "./short-id";
import type { Table } from "./types";

const WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS = 1_000;

export type DocumentPdfRenderer = (run: DocumentRun) => Promise<Result<RenderHtmlToPdfResult>>;

const isServiceError = (error: unknown): error is ServiceError =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  "message" in error &&
  "status" in error &&
  typeof (error as { code?: unknown }).code === "string" &&
  typeof (error as { message?: unknown }).message === "string" &&
  typeof (error as { status?: unknown }).status === "number";

export const createRunForRecord = async (params: {
  template: DocumentTemplate;
  table: Table;
  recordId: string;
  actorId: string | null;
  canReadRelatedTable: SnapshotRelatedTableGuard;
  dateConfig?: DateContext;
  generatedAt?: Date;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
  renderPdf?: DocumentPdfRenderer;
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

  const snapshot = await createRecordSnapshotDraft({
    baseId: params.table.baseId,
    tableId: params.table.id,
    recordId: params.recordId,
    actorId: params.actorId,
    canReadRelatedTable: params.canReadRelatedTable,
    dateConfig: params.dateConfig,
  });
  if (!snapshot.ok) return snapshot;

  const created = await createRenderedDocumentRun({
    template: params.template,
    snapshot: snapshot.data,
    renderData: { ...rendered.data.data, snapshot: snapshot.data },
    actorId: params.actorId,
    generatedAt,
    dateConfig: params.dateConfig,
    filename: params.filename,
    tags: params.tags,
    workflowRunId: params.workflowRunId,
    persistSnapshot: true,
    renderPdf: params.renderPdf,
  });
  return created.ok ? ok(created.data.run) : created;
};

type CreateDocumentRunParams = {
  template: DocumentTemplate;
  snapshot: RecordSnapshot;
  renderData: Record<string, unknown>;
  actorId: string | null;
  generatedAt?: Date;
  dateConfig?: DateContext;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
  persistSnapshot?: boolean;
  renderPdf?: DocumentPdfRenderer;
};

const createDocumentRunInternal = async (
  params: CreateDocumentRunParams,
  renderBeforePersist: boolean,
): Promise<Result<{ run: DocumentRun; pdf: RenderHtmlToPdfResult | null }>> => {
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
    const created = await insertWithShortId<{ row: DocumentDbRow; pdf: RenderHtmlToPdfResult | null }>(async (shortId) => {
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
      const candidate: DocumentRun = {
        id: runId,
        shortId,
        templateId: params.template.id,
        workflowRunId: params.workflowRunId ?? null,
        snapshotId: params.snapshot.id,
        baseId: params.snapshot.baseId,
        tableId: params.snapshot.tableId,
        recordId: params.snapshot.recordId,
        documentNumber: built.data.documentNumber,
        filename: built.data.filename,
        tags: built.data.tags,
        templateSnapshot,
        renderData: built.data.data,
        generatedBy: params.actorId,
        generatedAt: generatedAt.toISOString(),
      };
      const pdf = renderBeforePersist ? await (params.renderPdf ?? renderRunPdf)(candidate) : null;
      if (pdf && !pdf.ok) throw pdf.error;
      return sql.begin(async (tx) => {
        if (params.persistSnapshot) {
          const persistedSnapshot = await persistRecordSnapshot(params.snapshot, tx);
          if (!persistedSnapshot.ok) throw persistedSnapshot.error;
        }
        const [inserted] = await tx<DocumentDbRow[]>`
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
        const run = mapDocumentRun(inserted);
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
        return { row: inserted, pdf: pdf?.data ?? null };
      });
    }, "idx_grids_document_runs_short_id");
    return ok({ run: mapDocumentRun(created.row), pdf: created.pdf });
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

export const createDocumentRun = async (params: CreateDocumentRunParams): Promise<Result<DocumentRun>> => {
  const created = await createDocumentRunInternal(params, false);
  return created.ok ? ok(created.data.run) : created;
};

export const createRenderedDocumentRun = async (
  params: CreateDocumentRunParams,
): Promise<Result<{ run: DocumentRun; pdf: RenderHtmlToPdfResult }>> => {
  const created = await createDocumentRunInternal(params, true);
  if (!created.ok) return created;
  if (!created.data.pdf) return fail(err.internal("Document PDF was not rendered"));
  return ok({ run: created.data.run, pdf: created.data.pdf });
};

export const getDocumentRun = async (runId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DocumentDbRow[]>`SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid`;
  return row ? mapDocumentRun(row) : null;
};

export const updateRunMetadata = async (
  runId: string,
  input: UpdateDocumentRunMetadataInput,
  actorId: string | null = null,
): Promise<Result<DocumentRun>> =>
  sql.begin(async (tx) => {
    const [currentRow] = await tx<DocumentDbRow[]>`
      SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid FOR UPDATE
    `;
    if (!currentRow) return fail(err.notFound("document run not found"));
    const current = mapDocumentRun(currentRow);
    const filename =
      input.filename === undefined ? current.filename : safePdfFilename(input.filename, `${current.documentNumber || current.shortId}.pdf`);
    const tags = input.tags === undefined ? current.tags : normalizeDocumentTags(input.tags);
    const filenameChanged = filename !== current.filename;
    const tagsChanged = tags.length !== current.tags.length || tags.some((tag, index) => tag !== current.tags[index]);
    if (!filenameChanged && !tagsChanged) return ok(current);

    const [row] = await tx<DocumentDbRow[]>`
      UPDATE grids.document_runs
      SET filename = ${filename}, tags = ${tx.array(tags, "TEXT")}
      WHERE id = ${runId}::uuid
      RETURNING *
    `;
    if (!row) return fail(err.notFound("document run not found"));
    const updated = mapDocumentRun(row);
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

  const rows = await sql<DocumentDbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
    ORDER BY generated_at ASC, id ASC
  `;
  const runs = rows.map(mapDocumentRun);
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
