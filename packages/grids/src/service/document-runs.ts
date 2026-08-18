import { createHash } from "node:crypto";
import { type DateContext, err, fail, ok, type Result, type ServiceError } from "@k2b/stdlib";
import { GotenbergRenderError, isUniqueViolation, mergePdfs, type RenderHtmlToPdfResult } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { DocumentRun, DocumentTemplate, UpdateDocumentRunMetadataInput } from "../contracts";
import { logAudit } from "./audit";
import { type DocumentRunReadAuthorizer, loadReadableWorkflowRunDocumentScopes, workflowRunDocumentAccessWhere } from "./document-browse";
import { documentNumberFor } from "./document-liquid";
import { type DocumentDbRow, mapDocumentRun } from "./document-mappers";
import { buildDocumentRunRenderData, buildLiveRenderData, renderRunPdf } from "./document-rendering";
import { normalizeDocumentTags, safePdfFilename } from "./document-run-values";
import {
  createRecordSnapshotDraft,
  persistRecordSnapshot,
  type RecordSnapshotDraft,
  type SnapshotRecordAccessResolver,
} from "./document-snapshots";
import { createProtected, getProtectedContent } from "./files";
import { allocateNumber, bindNumberAllocation } from "./number-series";
import type { AuthorizedRecordAccess } from "./record-access";
import { get as getRecord } from "./records";
import type { ExpansionViewer } from "./relation-access";
import { insertWithShortId } from "./short-id";
import type { Table } from "./types";

const WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS = 1_000;
const DOCUMENT_ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_RENDERER_VERSION = "grids-liquid-gotenberg-v1";

export type DocumentPdfRenderer = typeof renderRunPdf;

const sha256Hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

const validatePdfArtifact = (rendered: RenderHtmlToPdfResult): Result<RenderHtmlToPdfResult> => {
  const mimeType = rendered.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== "application/pdf") return fail(err.badInput("Document renderer did not return a PDF."));
  if (rendered.pdf.byteLength === 0) return fail(err.badInput("Document renderer returned an empty PDF."));
  if (rendered.pdf.byteLength > DOCUMENT_ARTIFACT_MAX_BYTES) {
    return fail(err.badInput(`Document PDF exceeds the ${DOCUMENT_ARTIFACT_MAX_BYTES} byte artifact limit.`));
  }
  if (String.fromCharCode(...rendered.pdf.subarray(0, 4)) !== "%PDF") {
    return fail(err.badInput("Document renderer returned invalid PDF bytes."));
  }
  return ok({ pdf: rendered.pdf, contentType: "application/pdf" });
};

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
  recordAccess: AuthorizedRecordAccess;
  resolveRecordAccess: SnapshotRecordAccessResolver;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
  generatedAt?: Date;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
  workflowStepKey?: string | null;
  renderPdf?: DocumentPdfRenderer;
}): Promise<Result<DocumentRun>> => {
  if (!params.template.enabled) return fail(err.badInput("Document template is disabled"));
  if (params.template.tableId !== params.table.id) return fail(err.badInput("Document template does not belong to the table"));
  if (params.workflowRunId && params.workflowStepKey) {
    const [existing] = await sql<DocumentDbRow[]>`
      SELECT *
      FROM grids.document_runs
      WHERE workflow_run_id = ${params.workflowRunId}::uuid
        AND workflow_step_key = ${params.workflowStepKey}
    `;
    if (existing) return ok(mapDocumentRun(existing));
  }

  const record = await getRecord(params.table.id, params.recordId, {
    dateConfig: params.dateConfig,
    recordAccess: params.recordAccess,
    viewer: params.viewer,
  });
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
    resolveRecordAccess: params.resolveRecordAccess,
    viewer: params.viewer,
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
    workflowStepKey: params.workflowStepKey,
    persistSnapshot: true,
    renderPdf: params.renderPdf,
  });
  return created.ok ? ok(created.data.run) : created;
};

type CreateDocumentRunParams = {
  template: DocumentTemplate;
  snapshot: RecordSnapshotDraft;
  renderData: Record<string, unknown>;
  actorId: string | null;
  generatedAt?: Date;
  dateConfig?: DateContext;
  filename?: string | null;
  tags?: string[];
  workflowRunId?: string | null;
  workflowStepKey?: string | null;
  persistSnapshot?: boolean;
  renderPdf?: DocumentPdfRenderer;
};

const createDocumentRunInternal = async (
  params: CreateDocumentRunParams,
): Promise<Result<{ run: DocumentRun; pdf: RenderHtmlToPdfResult | null }>> => {
  const runId = Bun.randomUUIDv7();
  const generatedAt = params.generatedAt ?? new Date();
  const templateSnapshot = {
    id: params.template.shortId,
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
  const templateRevision = sha256Hex(JSON.stringify(templateSnapshot));
  try {
    const created = await insertWithShortId<{ row: DocumentDbRow; pdf: RenderHtmlToPdfResult | null }>(async (shortId) => {
      const allocation = await allocateNumber({
        owner: { kind: "document_template", id: params.template.id },
        now: generatedAt,
        dateConfig: params.dateConfig,
        renderDocument: (value, seriesShortId) => {
          const rendered = documentNumberFor({
            template: params.template,
            runShortId: shortId,
            generatedAt,
            dateConfig: params.dateConfig,
            data: params.renderData,
            series: { id: seriesShortId, value },
          });
          if (!rendered.ok) throw rendered.error;
          return rendered.data;
        },
      });
      const built = await buildDocumentRunRenderData({
        template: params.template,
        renderData: params.renderData,
        runShortId: shortId,
        generatedAt,
        dateConfig: params.dateConfig,
        filename: params.filename,
        tags: params.tags,
        documentNumber: allocation.renderedValue,
        numberSeries: { id: allocation.seriesShortId, value: allocation.value },
      });
      if (!built.ok) throw built.error;
      const candidate = {
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
      const renderedPdf = await (params.renderPdf ?? renderRunPdf)(candidate);
      if (!renderedPdf.ok) throw renderedPdf.error;
      const pdf = validatePdfArtifact(renderedPdf.data);
      if (!pdf.ok) throw pdf.error;
      return sql.begin(async (tx) => {
        if (params.persistSnapshot) {
          const persistedSnapshot = await persistRecordSnapshot(params.snapshot, tx);
          if (!persistedSnapshot.ok) throw persistedSnapshot.error;
        }
        const artifact = await createProtected(
          {
            ownerKind: "document_artifact",
            ownerId: runId,
            baseId: params.snapshot.baseId,
            tableId: params.snapshot.tableId,
            recordId: params.snapshot.recordId,
            userId: params.actorId,
            filename: built.data.filename,
            mimeType: pdf.data.contentType,
            bytes: pdf.data.pdf,
          },
          tx,
        );
        if (!artifact.ok) throw artifact.error;
        const [inserted] = await tx<DocumentDbRow[]>`
          INSERT INTO grids.document_runs (
            id, short_id, template_id, workflow_run_id, workflow_step_key, snapshot_id, base_id, table_id, record_id,
            document_number, filename, tags, template_snapshot, render_data,
            artifact_file_id, artifact_mime_type, artifact_size_bytes, artifact_sha256, renderer_version, template_revision,
            generated_by, generated_at
          )
          VALUES (
            ${runId}::uuid,
            ${shortId},
            ${params.template.id}::uuid,
            ${params.workflowRunId ?? null}::uuid,
            ${params.workflowStepKey ?? null},
            ${params.snapshot.id}::uuid,
            ${params.snapshot.baseId}::uuid,
            ${params.snapshot.tableId}::uuid,
            ${params.snapshot.recordId}::uuid,
            ${built.data.documentNumber},
            ${built.data.filename},
            ${tx.array(built.data.tags, "TEXT")},
            ${templateSnapshot}::jsonb,
            ${built.data.data}::jsonb,
            ${artifact.data.id}::uuid,
            ${artifact.data.mimeType},
            ${artifact.data.sizeBytes},
            ${artifact.data.sha256},
            ${DOCUMENT_RENDERER_VERSION},
            ${templateRevision},
            ${params.actorId}::uuid,
            ${generatedAt}
          )
          RETURNING *
        `;
        if (!inserted) throw new Error("insert returned no row");
        await bindNumberAllocation(tx, allocation.id, { kind: "document_run", id: runId });
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
                artifactSha256: { old: null, new: run.artifact.sha256 },
                artifactSizeBytes: { old: null, new: run.artifact.sizeBytes },
                rendererVersion: { old: null, new: run.artifact.rendererVersion },
              },
            },
            tx,
          );
        }
        return { row: inserted, pdf: pdf.data };
      });
    }, "idx_grids_document_runs_short_id");
    return ok({ run: mapDocumentRun(created.row), pdf: created.pdf });
  } catch (error) {
    if (params.workflowRunId && params.workflowStepKey && isUniqueViolation(error, "idx_grids_document_runs_workflow_step")) {
      const [existing] = await sql<DocumentDbRow[]>`
        SELECT *
        FROM grids.document_runs
        WHERE workflow_run_id = ${params.workflowRunId}::uuid
          AND workflow_step_key = ${params.workflowStepKey}
      `;
      if (existing) return ok({ run: mapDocumentRun(existing), pdf: null });
    }
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
  const created = await createDocumentRunInternal(params);
  return created.ok ? ok(created.data.run) : created;
};

export const createRenderedDocumentRun = async (
  params: CreateDocumentRunParams,
): Promise<Result<{ run: DocumentRun; pdf: RenderHtmlToPdfResult }>> => {
  const created = await createDocumentRunInternal(params);
  if (!created.ok) return created;
  if (created.data.pdf) return ok({ run: created.data.run, pdf: created.data.pdf });
  const stored = await getRunPdf(created.data.run);
  return stored.ok ? ok({ run: created.data.run, pdf: stored.data }) : stored;
};

export const getRunPdf = async (run: DocumentRun): Promise<Result<RenderHtmlToPdfResult>> => {
  const stored = await getProtectedContent({
    fileId: run.artifactFileId,
    ownerKind: "document_artifact",
    ownerId: run.id,
  });
  if (!stored.ok) return fail(err.internal("Stored document artifact is missing."));
  if (
    stored.data.mimeType !== run.artifact.mimeType ||
    stored.data.sizeBytes !== run.artifact.sizeBytes ||
    stored.data.sha256 !== run.artifact.sha256 ||
    sha256Hex(stored.data.bytes) !== run.artifact.sha256
  ) {
    return fail(err.internal("Stored document artifact failed its integrity check."));
  }
  return ok({ pdf: stored.data.bytes, contentType: run.artifact.mimeType });
};

export const getDocumentRun = async (runId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DocumentDbRow[]>`SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid`;
  return row ? mapDocumentRun(row) : null;
};

export const getDocumentRunByShortId = async (shortId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DocumentDbRow[]>`SELECT * FROM grids.document_runs WHERE short_id = ${shortId}`;
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
  canRead: DocumentRunReadAuthorizer,
): Promise<Result<RenderHtmlToPdfResult & { filename: string; documentCount: number }>> => {
  const accessWhere = workflowRunDocumentAccessWhere(await loadReadableWorkflowRunDocumentScopes(workflowRunId, canRead));
  const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
      AND (${accessWhere})
  `;
  const total = count ?? 0;
  if (total === 0) return fail(err.badInput("Workflow run did not generate any documents."));
  if (total > WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS) {
    return fail(err.badInput(`Combined PDF download supports at most ${WORKFLOW_RUN_DOWNLOAD_MAX_DOCUMENTS} documents per workflow run.`));
  }

  const rows = await sql<DocumentDbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE workflow_run_id = ${workflowRunId}::uuid
      AND (${accessWhere})
    ORDER BY generated_at ASC, id ASC
  `;
  const runs = rows.map(mapDocumentRun);
  const rendered: Array<{ pdf: Uint8Array; filename: string }> = [];
  for (const run of runs) {
    const pdf = await getRunPdf(run);
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
