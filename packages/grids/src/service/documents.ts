import { type RenderHtmlToPdfResult, renderHtmlToPdf } from "@valentinkolb/cloud/services";
import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { Liquid } from "liquidjs";
import type { CreateDocumentTemplateInput, DocumentRun, DocumentTemplate, RecordSnapshot, UpdateDocumentTemplateInput } from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import { listByTable as listFields } from "./fields";
import { buildBaseGqlResolverContext } from "./gql-resolver-context";
import { parseJsonbRow } from "./jsonb";
import { get as getRecord } from "./records";
import { insertWithShortId } from "./short-id";
import { get as getTable } from "./tables";
import type { Field, GridRecord, Table } from "./types";

type DbRow = Record<string, unknown>;

const DEFAULT_SOURCE = (tableId: string) => `from table {${tableId}}\nwhere record.id = '{{ record.id }}'\nlimit 1`;
const TEMPLATE_MAX_BYTES = 200_000;
const SOURCE_MAX_BYTES = 20_000;
const RENDER_MAX_BYTES = 300_000;
const SNAPSHOT_MAX_DEPTH = 4;
const SNAPSHOT_MAX_RECORDS = 500;
const DOCUMENT_QUERY_MAX_ROWS = 10_000;

const ALLOWED_TAGS = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "for",
  "break",
  "continue",
  "endfor",
  "case",
  "when",
  "endcase",
  "assign",
  "capture",
  "endcapture",
  "comment",
  "endcomment",
  "raw",
  "endraw",
]);

const TEMPLATE_TAG_RE = /{%-?\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  outputEscape: "escape",
  parseLimit: TEMPLATE_MAX_BYTES,
  renderLimit: RENDER_MAX_BYTES,
  memoryLimit: 2_000_000,
  cache: false,
  dynamicPartials: false,
  root: [],
  layouts: [],
  partials: [],
});

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const validateLiquidTemplate = (source: string): Result<void> => {
  if (byteLength(source) > TEMPLATE_MAX_BYTES) return fail(err.badInput("template is too large"));
  for (const match of source.matchAll(TEMPLATE_TAG_RE)) {
    const tag = match[1]!;
    if (!ALLOWED_TAGS.has(tag)) return fail(err.badInput(`Liquid tag "${tag}" is not allowed`));
  }
  try {
    engine.parse(source);
    return ok();
  } catch (error) {
    return fail(err.badInput(error instanceof Error ? error.message : "invalid Liquid template"));
  }
};

export const renderLiquidText = async (
  template: string,
  data: Record<string, unknown>,
  maxBytes = TEMPLATE_MAX_BYTES,
): Promise<Result<string>> => {
  const valid = validateLiquidTemplate(template);
  if (!valid.ok) return valid;
  try {
    const rendered = await engine.parseAndRender(template, data);
    if (byteLength(rendered) > maxBytes) return fail(err.badInput("rendered template is too large"));
    return ok(rendered);
  } catch (error) {
    return fail(err.badInput(error instanceof Error ? error.message : "template render failed"));
  }
};

export const documentNumberFor = (params: { runId: string; recordId: string; generatedAt?: Date }): string => {
  const date = (params.generatedAt ?? new Date()).toISOString().slice(0, 10).replaceAll("-", "");
  const runSuffix = params.runId.replaceAll("-", "").slice(-12);
  return `GRID-${date}-${params.recordId.slice(0, 8)}-${runSuffix}`.toUpperCase();
};

const mapTemplate = (row: DbRow): DocumentTemplate => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  source: row.source as string,
  html: row.html as string,
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

const mapRun = (row: DbRow): DocumentRun => ({
  id: row.id as string,
  shortId: row.short_id as string,
  templateId: (row.template_id as string | null) ?? null,
  snapshotId: row.snapshot_id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  recordId: row.record_id as string,
  documentNumber: row.document_number as string,
  templateSnapshot: parseJsonbRow<Record<string, unknown>>(row.template_snapshot, {}),
  renderData: parseJsonbRow<Record<string, unknown>>(row.render_data, {}),
  generatedBy: (row.generated_by as string | null) ?? null,
  generatedAt: (row.generated_at as Date).toISOString(),
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
    limit: DOCUMENT_QUERY_MAX_ROWS,
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

const validateTemplateWrite = (input: { source?: string; html?: string }): Result<void> => {
  if (input.source !== undefined && byteLength(input.source) > SOURCE_MAX_BYTES) return fail(err.badInput("GQL source is too large"));
  if (input.html !== undefined) {
    const valid = validateLiquidTemplate(input.html);
    if (!valid.ok) return valid;
  }
  if (input.source !== undefined) {
    const valid = validateLiquidTemplate(input.source);
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

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [inserted] = await sql<DbRow[]>`
      INSERT INTO grids.document_templates (short_id, table_id, name, description, source, html, enabled, position, created_by, updated_by)
      VALUES (
        ${shortId},
        ${tableId}::uuid,
        ${name},
        ${input.description ?? null},
        ${source},
        ${html},
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
  fields: Array<Pick<Field, "id" | "shortId" | "name" | "type" | "config">>;
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
    type: field.type,
    config: field.config,
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

export const buildTemplateInputContext = (record: GridRecord, table: Table): Record<string, unknown> => ({
  record: {
    id: record.id,
    tableId: record.tableId,
    version: record.version,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  },
  table: {
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  },
});

export const buildRenderData = (params: {
  record: GridRecord | SnapshotRecord;
  table: Table | Pick<Table, "id" | "shortId" | "name">;
  columns: unknown[];
  rows: unknown[];
  documentNumber?: string;
  generatedAt?: string;
  snapshot?: RecordSnapshot;
}): Record<string, unknown> => ({
  record: params.record,
  table: params.table,
  query: {
    columns: params.columns,
    rows: params.rows,
  },
  rows: params.rows,
  columns: params.columns,
  document: {
    number: params.documentNumber ?? null,
    generatedAt: params.generatedAt ?? null,
  },
  snapshot: params.snapshot ?? null,
});

export const buildLiveRenderData = async (params: {
  template: DocumentTemplate;
  table: Table;
  record: GridRecord;
  dateConfig?: DateContext;
}): Promise<Result<{ source: string; columns: unknown[]; rows: Array<Record<string, unknown>>; data: Record<string, unknown> }>> => {
  const source = await renderDocumentSource(params.template, buildTemplateInputContext(params.record, params.table));
  if (!source.ok) return source;

  const executed = await executeDocumentGqlSource({
    baseId: params.table.baseId,
    tableId: params.table.id,
    source: source.data,
    dateConfig: params.dateConfig,
  });
  if (!executed.ok) return executed;

  const data = buildRenderData({
    record: params.record,
    table: params.table,
    columns: executed.data.columns,
    rows: executed.data.rows,
  });
  return ok({ source: source.data, columns: executed.data.columns, rows: executed.data.rows, data });
};

export const createRunForRecord = async (params: {
  template: DocumentTemplate;
  table: Table;
  recordId: string;
  actorId: string | null;
  dateConfig?: DateContext;
}): Promise<Result<DocumentRun>> => {
  if (!params.template.enabled) return fail(err.badInput("Document template is disabled"));
  if (params.template.tableId !== params.table.id) return fail(err.badInput("Document template does not belong to the table"));

  const record = await getRecord(params.table.id, params.recordId, { dateConfig: params.dateConfig });
  if (!record) return fail(err.notFound("record"));

  const rendered = await buildLiveRenderData({ template: params.template, table: params.table, record, dateConfig: params.dateConfig });
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
  });
};

export const renderDocumentHtml = async (
  template: Pick<DocumentTemplate, "html">,
  data: Record<string, unknown>,
): Promise<Result<string>> => renderLiquidText(template.html, data, RENDER_MAX_BYTES);

export const renderDocumentSource = async (
  template: Pick<DocumentTemplate, "source">,
  data: Record<string, unknown>,
): Promise<Result<string>> => renderLiquidText(template.source, data, SOURCE_MAX_BYTES);

export const createRun = async (params: {
  template: DocumentTemplate;
  snapshot: RecordSnapshot;
  renderData: Record<string, unknown>;
  actorId: string | null;
  generatedAt?: Date;
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
  };
  const documentNumber = documentNumberFor({ runId, recordId: params.snapshot.recordId, generatedAt });
  const renderData = {
    ...params.renderData,
    document: {
      ...((typeof params.renderData.document === "object" && params.renderData.document !== null
        ? params.renderData.document
        : {}) as Record<string, unknown>),
      number: documentNumber,
      generatedAt: generatedAt.toISOString(),
    },
  };
  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [inserted] = await sql<DbRow[]>`
      INSERT INTO grids.document_runs (
        id, short_id, template_id, snapshot_id, base_id, table_id, record_id,
        document_number, template_snapshot, render_data, generated_by, generated_at
      )
      VALUES (
        ${runId}::uuid,
        ${shortId},
        ${params.template.id}::uuid,
        ${params.snapshot.id}::uuid,
        ${params.snapshot.baseId}::uuid,
        ${params.snapshot.tableId}::uuid,
        ${params.snapshot.recordId}::uuid,
        ${documentNumber},
        ${templateSnapshot}::jsonb,
        ${renderData}::jsonb,
        ${params.actorId}::uuid,
        ${generatedAt}
      )
      RETURNING *
    `;
    if (!inserted) throw new Error("insert returned no row");
    return inserted;
  }, "idx_grids_document_runs_short_id");
  return ok(mapRun(row));
};

export const listRunsForRecord = async (tableId: string, recordId: string): Promise<DocumentRun[]> => {
  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.document_runs
    WHERE table_id = ${tableId}::uuid AND record_id = ${recordId}::uuid
    ORDER BY generated_at DESC
  `;
  return rows.map(mapRun);
};

export const getRun = async (runId: string): Promise<DocumentRun | null> => {
  const [row] = await sql<DbRow[]>`SELECT * FROM grids.document_runs WHERE id = ${runId}::uuid`;
  return row ? mapRun(row) : null;
};

export const renderRunPdf = async (run: DocumentRun): Promise<Result<RenderHtmlToPdfResult>> => {
  const html = await renderLiquidText(String(run.templateSnapshot.html ?? ""), run.renderData, RENDER_MAX_BYTES);
  if (!html.ok) return html;
  try {
    return ok(await renderHtmlToPdf({ html: html.data, filename: `${run.documentNumber}.html` }));
  } catch (error) {
    return fail(err.internal(error instanceof Error ? error.message : "PDF rendering failed"));
  }
};
