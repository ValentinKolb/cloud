import { markdown as markdownRenderer } from "@valentinkolb/cloud/shared";
import { type DateContext, dates, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { ExportFieldSpec, RecordQuery, SearchSpec } from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import { simpleQueryToGqlSource } from "../query-dsl/record-query-source";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { type DslResultCursor, decodeDslResultCursor } from "../query-dsl/result-cursor";
import { type FederatedRevisionScope, verifyRevisionScope } from "./federated-tables";
import { listByTable as listFields } from "./fields";
import { buildTrustedGqlResolverContext } from "./gql-resolver-context";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { list as listRecords } from "./records";
import { loadRelationTargets } from "./relation-targets";
import type { ExpansionViewer } from "./relations";
import { buildRelationLabelCache, relationLabelFields } from "./relations";
import { get as getTable } from "./tables";
import type { Field, GridRecord } from "./types";

type ExportFormatOptions = { markdown: "raw" | "html"; dateConfig?: DateContext };
type RelationExportConfig = NonNullable<ExportFieldSpec["relation"]>;

const EXPORT_PAGE_SIZE = 500;
const EXPORT_CURSOR_FINGERPRINT = "grids-internal-export";
const EXPORT_CURSOR_SIGNING_KEY = "grids-internal-export-cursor";

type ExportPage = { items: GridRecord[]; done: boolean; revisionScope?: FederatedRevisionScope };
type ExportPageReader = () => Promise<Result<ExportPage>>;

const createStoredPageReader = (params: {
  tableId: string;
  query: RecordQuery;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
}): ExportPageReader => {
  let cursor: string | null = null;
  let returned = 0;
  return async () => {
    const remaining = params.query.limit === undefined ? EXPORT_PAGE_SIZE : Math.max(params.query.limit - returned, 0);
    if (remaining === 0) return ok({ items: [], done: true });
    const page = await listRecords({
      tableId: params.tableId,
      cursor,
      limit: Math.min(EXPORT_PAGE_SIZE, remaining),
      includeDeleted: params.query.includeDeleted,
      deletedOnly: params.query.deletedOnly,
      filter: params.query.filter ?? null,
      search: (params.query.search as SearchSpec | undefined) ?? null,
      recordMeta: params.query.recordMeta ?? null,
      sort: params.query.sort ?? [],
      includeRelations: false,
      viewer: params.viewer,
      dateConfig: params.dateConfig,
    });
    if (!page.ok) return fail(page.error);
    returned += page.data.items.length;
    cursor = page.data.nextCursor;
    return ok({
      items: page.data.items,
      done: cursor === null || page.data.items.length === 0 || (params.query.limit !== undefined && returned >= params.query.limit),
    });
  };
};

const createFederatedPageReader = async (params: {
  baseId: string;
  tableId: string;
  query: RecordQuery;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
}): Promise<Result<ExportPageReader>> => {
  const converted = simpleQueryToGqlSource({ tableId: params.tableId, query: params.query });
  if (!converted.ok) return fail(err.badInput(converted.reason));
  const parsed = parseGridsQueryDsl(converted.source);
  if (!parsed.ok) return fail(err.badInput(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; ")));
  const context = await buildTrustedGqlResolverContext({
    baseId: params.baseId,
    currentTableId: params.tableId,
    ast: parsed.ast,
    purpose: "saved-view-render",
  });
  const resolved = resolveDslQueryToQueryPlan(parsed.ast, context);
  if (!resolved.ok) return fail(err.badInput(resolved.diagnostics.map((diagnostic) => diagnostic.message).join("; ")));
  const cursorFingerprint = `${EXPORT_CURSOR_FINGERPRINT}:${params.tableId}`;
  let cursor: DslResultCursor | null = null;
  let finished = false;
  let expectedRevisionScope: FederatedRevisionScope | undefined;
  return ok(async () => {
    if (finished) return ok({ items: [], done: true });
    if (expectedRevisionScope) {
      const current = await verifyRevisionScope(expectedRevisionScope);
      if (!current.ok) return fail(err.conflict("combined table publication changed during export; restart the export"));
    }
    let pageRevisionScope: FederatedRevisionScope = [];
    const preview = await previewDslQuery(resolved.plan, {
      fieldsByTableId: context.fieldsByTableId,
      timeZone: params.dateConfig?.timeZone,
      pageSize: EXPORT_PAGE_SIZE,
      maxRows: EXPORT_PAGE_SIZE,
      cursor,
      cursorFingerprint,
      cursorSigningKey: EXPORT_CURSOR_SIGNING_KEY,
      viewer: params.viewer,
      labelRelationValues: false,
      expectedFederatedRevisionScope: expectedRevisionScope,
      onFederatedRevisionScope: (scope) => {
        pageRevisionScope = scope;
      },
    });
    if (!preview.ok) return fail(preview.error);
    expectedRevisionScope ??= pageRevisionScope;
    if (preview.data.mode !== "rows") return fail(err.badInput("grouped exports are not supported"));
    const items = preview.data.rows.flatMap((row): GridRecord[] => {
      if (!row.recordId || !row.recordMeta) return [];
      return [
        {
          id: row.recordId,
          tableId: params.tableId,
          data: Object.fromEntries(
            preview.data.columns.flatMap((column) => (column.fieldId ? [[column.fieldId, row.values[column.key]]] : [])),
          ),
          ...row.recordMeta,
        },
      ];
    });
    cursor = decodeDslResultCursor(preview.data.page?.nextCursor, EXPORT_CURSOR_SIGNING_KEY);
    finished = cursor === null || items.length === 0;
    return ok({ items, done: finished, revisionScope: expectedRevisionScope });
  });
};

const createExportPageReader = async (params: {
  tableId: string;
  query: RecordQuery;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
}): Promise<Result<ExportPageReader>> => {
  const table = await getTable(params.tableId);
  if (!table) return fail(err.notFound("Table"));
  if (table.kind === "federated") return createFederatedPageReader({ ...params, baseId: table.baseId });
  return ok(createStoredPageReader(params));
};

/**
 * Formats a single cell value as plain text for export. Single-select /
 * select fields project the human label, not the option id, so an exported
 * CSV is readable without consulting the field config.
 *
 * Exported (rather than file-private) so it can be unit-tested in
 * isolation; the CSV path here decides the entire user-visible export
 * fidelity, so the corner cases (booleans, select-options, objects) are
 * worth pinning down independently of the DB-bound `exportRecords`.
 */
export const formatCellForExport = (value: unknown, field: Field, options: ExportFormatOptions = { markdown: "raw" }): string => {
  if (value === null || value === undefined) return "";
  if (field.type === "date") {
    if ((field.config as { includeTime?: boolean } | undefined)?.includeTime) {
      if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return String(value);
      const instant = value instanceof Date ? value.toISOString() : String(value);
      const timeZone = options.dateConfig?.timeZone;
      if (!timeZone) return instant;
      return dates.instantToZonedInput(instant, timeZone).replace("T", " ");
    }
    return String(value).slice(0, 10);
  }
  if (field.type === "longtext" && options.markdown === "html") {
    return markdownRenderer.renderSync(String(value));
  }
  if (field.type === "boolean") return value ? "true" : "false";
  if (field.type === "select" && Array.isArray(value)) {
    const opts = (field.config as { options?: Array<{ id: string; label: string }> }).options ?? [];
    return value.map((id) => opts.find((o) => o.id === id)?.label ?? String(id)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Spreadsheet-safe RFC 4180 cell encoding. A leading apostrophe keeps
 * formula-like user values inert in common spreadsheet applications. */
export const csvQuote = (s: string, delimiter = ","): string => {
  const safe = /^[\t\r ]*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? `'${s}` : s;
  const mustQuote = safe.includes(delimiter) || /[\r\n"]/.test(safe);
  if (mustQuote) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
};

type ExportFormat = "csv" | "json";

type ExportResult = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filename: string;
};

type ExportColumn =
  | { kind: "field"; field: Field; label: string; relation?: RelationExportConfig }
  | { kind: "relationField"; relationField: Field; targetField: Field; label: string };

type RelationContext = {
  labels: Record<string, string>;
  expanded: Record<string, Record<string, unknown>>;
};

const aliveFields = (fields: Field[]): Field[] => fields.filter((f) => !f.deletedAt).sort((a, b) => a.position - b.position);

const relationIds = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
};

const canReadTargetTable = async (targetTableId: string, viewer?: ExpansionViewer): Promise<boolean> => {
  if (!viewer) return true;
  const table = await getTable(targetTableId);
  if (!table) return false;
  const grants = await loadGrantsForUser({
    userId: viewer.userId,
    userGroups: viewer.userGroups,
    serviceAccountId: viewer.serviceAccountId,
    baseId: table.baseId,
    tableId: targetTableId,
  });
  const level = resolveEffectivePermission(grants, { baseId: table.baseId, tableId: targetTableId });
  return hasAtLeast(level, "read");
};

const pickColumns = async (params: {
  tableId: string;
  fields: Field[];
  specs?: ExportFieldSpec[];
  query: RecordQuery;
  viewer?: ExpansionViewer;
}): Promise<Result<{ columns: ExportColumn[]; selected: Array<{ field: Field; spec?: ExportFieldSpec }> }>> => {
  const byId = new Map(params.fields.map((f) => [f.id, f]));
  const requested = params.specs?.length
    ? params.specs
    : params.query.columns
        ?.filter((c): c is Extract<typeof c, { fieldId: string }> => "fieldId" in c)
        .map((c) => ({ fieldId: c.fieldId }) satisfies ExportFieldSpec);

  const rawSelected = requested?.length
    ? requested.map((spec) => ({ field: byId.get(spec.fieldId), spec }))
    : aliveFields(params.fields).map((field) => ({ field, spec: undefined }));

  const missing = rawSelected.find((entry) => !entry.field || entry.field.deletedAt);
  if (missing) return fail(err.badInput("unknown export field"));

  const columns: ExportColumn[] = [];
  const selected: Array<{ field: Field; spec?: ExportFieldSpec }> = [];
  for (const rawEntry of rawSelected as Array<{ field: Field; spec?: ExportFieldSpec }>) {
    let entry = rawEntry;
    const relation = entry.spec?.relation;
    const label = entry.spec?.label?.trim() || entry.field.name;

    if (entry.field.type !== "relation" || relation?.mode !== "fields") {
      columns.push({ kind: "field", field: entry.field, label, relation });
      selected.push(entry);
      continue;
    }

    const targetTableId = (entry.field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) return fail(err.badInput(`relation field "${entry.field.name}" has no target table`));
    if (!(await canReadTargetTable(targetTableId, params.viewer))) {
      columns.push({ kind: "field", field: entry.field, label, relation: { mode: "ids" } });
      continue;
    }

    const targetFields = aliveFields(await listFields(targetTableId));
    const targetById = new Map(targetFields.map((f) => [f.id, f]));
    const ids = relation.fieldIds?.length ? relation.fieldIds : relationLabelFields(targetFields).map((f) => f.id);
    if (ids.length === 0) {
      entry = {
        field: entry.field,
        spec: { ...entry.spec, fieldId: entry.field.id, relation: { mode: "labels" } },
      };
      columns.push({ kind: "field", field: entry.field, label, relation: { mode: "labels" } });
      selected.push(entry);
      continue;
    }
    entry = {
      field: entry.field,
      spec: { ...entry.spec, fieldId: entry.field.id, relation: { mode: "fields", fieldIds: ids } },
    };
    for (const id of ids) {
      const targetField = targetById.get(id);
      if (!targetField) return fail(err.badInput("unknown relation export field"));
      columns.push({
        kind: "relationField",
        relationField: entry.field,
        targetField,
        label: `${label} ${targetField.name}`,
      });
    }
    selected.push(entry);
  }
  return ok({ columns, selected });
};

const buildRelationContext = async (params: {
  records: GridRecord[];
  fields: Field[];
  selected: Array<{ field: Field; spec?: ExportFieldSpec }>;
  viewer?: ExpansionViewer;
}): Promise<RelationContext> => {
  const relationSpecs = params.selected.filter((s) => s.field.type === "relation");
  if (relationSpecs.length === 0 || params.records.length === 0) return { labels: {}, expanded: {} };

  const labelsNeeded = relationSpecs.some((s) => (s.spec?.relation?.mode ?? "ids") === "labels");
  const labels = labelsNeeded ? await buildRelationLabelCache(params.records, params.fields, params.viewer) : {};

  const idsByTargetTable = new Map<string, Set<string>>();
  const fieldsByTargetTable = new Map<string, Set<string>>();

  for (const { field, spec } of relationSpecs) {
    if (spec?.relation?.mode !== "fields") continue;
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) continue;
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const rec of params.records) {
      for (const id of relationIds(rec.data[field.id])) ids.add(id);
    }
    idsByTargetTable.set(targetTableId, ids);
    const wanted = fieldsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const id of spec.relation.fieldIds ?? []) wanted.add(id);
    fieldsByTargetTable.set(targetTableId, wanted);
  }

  const expanded: Record<string, Record<string, unknown>> = {};
  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const fieldIds = [...(fieldsByTargetTable.get(targetTableId) ?? new Set<string>())];
    const targets = await loadRelationTargets(targetTableId, idSet);
    for (const row of targets.records) {
      const subset: Record<string, unknown> = {};
      for (const fieldId of fieldIds) subset[fieldId] = row.data[fieldId] ?? null;
      expanded[row.id] = subset;
    }
  }

  return { labels, expanded };
};

const relationValue = (params: { record: GridRecord; field: Field; mode: "ids" | "labels"; ctx: RelationContext }): string => {
  const ids = relationIds(params.record.data[params.field.id]);
  if (params.mode === "ids") return ids.join(", ");
  return ids.map((id) => params.ctx.labels[id] ?? "Unknown record").join("; ");
};

const relationTargetValue = (params: {
  record: GridRecord;
  relationField: Field;
  targetField: Field;
  ctx: RelationContext;
  options: ExportFormatOptions;
}): string => {
  const ids = relationIds(params.record.data[params.relationField.id]);
  return ids
    .map((id) => formatCellForExport(params.ctx.expanded[id]?.[params.targetField.id], params.targetField, params.options))
    .filter(Boolean)
    .join("; ");
};

const jsonValue = (params: {
  record: GridRecord;
  field: Field;
  relation?: RelationExportConfig;
  ctx: RelationContext;
  options: ExportFormatOptions;
}): unknown => {
  if (params.field.type !== "relation") {
    if (params.field.type === "longtext" && params.options.markdown === "html") {
      return formatCellForExport(params.record.data[params.field.id], params.field, params.options);
    }
    return params.record.data[params.field.id] ?? null;
  }
  const ids = relationIds(params.record.data[params.field.id]);
  const mode = params.relation?.mode ?? "ids";
  if (mode === "labels") return ids.map((id) => params.ctx.labels[id] ?? "Unknown record");
  if (mode !== "fields") return ids;
  const wanted = params.relation?.fieldIds ?? [];
  return ids.map((id) => {
    const data = params.ctx.expanded[id] ?? {};
    const out: Record<string, unknown> = { id };
    for (const fieldId of wanted) out[fieldId] = data[fieldId] ?? null;
    return out;
  });
};

export const exportRecords = async (params: {
  tableId: string;
  format: ExportFormat;
  query?: RecordQuery;
  fields?: ExportFieldSpec[];
  csv?: { delimiter?: string };
  markdown?: "raw" | "html";
  dateConfig?: DateContext;
  /** Optional viewer gates relation-field expansion across target tables. */
  viewer?: ExpansionViewer;
}): Promise<Result<ExportResult>> => {
  const fields = await listFields(params.tableId);
  const query = params.query ?? {};
  const picked = await pickColumns({
    tableId: params.tableId,
    fields,
    specs: params.fields,
    query,
    viewer: params.viewer,
  });
  if (!picked.ok) return fail(picked.error);

  const pageReader = await createExportPageReader({
    tableId: params.tableId,
    query,
    viewer: params.viewer,
    dateConfig: params.dateConfig,
  });
  if (!pageReader.ok) return fail(pageReader.error);
  const options: ExportFormatOptions = { markdown: params.markdown ?? "raw", dateConfig: params.dateConfig };
  const delimiter = params.csv?.delimiter ?? ",";

  const date = new Date().toISOString().slice(0, 10);
  const filename = `grids-export-${date}.${params.format}`;

  const encoder = new TextEncoder();
  const chunks = async function* (): AsyncGenerator<Uint8Array> {
    let firstJsonRecord = true;
    if (params.format === "json") {
      const prefix = {
        exportedAt: new Date().toISOString(),
        tableId: params.tableId,
        fields: picked.data.selected.map(({ field, spec }) => ({
          id: field.id,
          name: spec?.label?.trim() || field.name,
          type: field.type,
          relation: spec?.relation,
        })),
      };
      yield encoder.encode(`${JSON.stringify(prefix).slice(0, -1)},\"records\":[`);
    } else {
      const header = ["id", ...picked.data.columns.map((column) => column.label)]
        .map((value) => csvQuote(value, delimiter))
        .join(delimiter);
      yield encoder.encode(`${header}\r\n`);
    }

    while (true) {
      const page = await pageReader.data();
      if (!page.ok) throw new Error(page.error.message);
      const ctx = await buildRelationContext({
        records: page.data.items,
        fields,
        selected: picked.data.selected,
        viewer: params.viewer,
      });
      if (page.data.revisionScope) {
        const current = await verifyRevisionScope(page.data.revisionScope);
        if (!current.ok) throw new Error("combined table publication changed during export; restart the export");
      }
      for (const record of page.data.items) {
        if (params.format === "json") {
          const out: Record<string, unknown> = { id: record.id };
          for (const { field, spec } of picked.data.selected) {
            out[spec?.label?.trim() || field.name] = jsonValue({
              record,
              field,
              relation: spec?.relation,
              ctx,
              options,
            });
          }
          yield encoder.encode(`${firstJsonRecord ? "" : ","}${JSON.stringify(out)}`);
          firstJsonRecord = false;
        } else {
          const cells = [
            record.id,
            ...picked.data.columns.map((column) => {
              if (column.kind === "relationField") {
                return relationTargetValue({
                  record,
                  relationField: column.relationField,
                  targetField: column.targetField,
                  ctx,
                  options,
                });
              }
              if (column.field.type === "relation") {
                return relationValue({
                  record,
                  field: column.field,
                  mode: column.relation?.mode === "labels" ? "labels" : "ids",
                  ctx,
                });
              }
              return formatCellForExport(record.data[column.field.id], column.field, options);
            }),
          ];
          yield encoder.encode(`${cells.map((cell) => csvQuote(cell, delimiter)).join(delimiter)}\r\n`);
        }
      }
      if (page.data.done) break;
    }
    if (params.format === "json") yield encoder.encode("]}");
  };
  const iterator = chunks();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return ok({ body, contentType: params.format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", filename });
};
