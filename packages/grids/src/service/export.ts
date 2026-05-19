import { markdown as markdownRenderer } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { ExportFieldSpec, SearchSpec, ViewQuery } from "../contracts";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { list as listRecords } from "./records";
import type { ExpansionViewer } from "./relations";
import { buildRelationLabelCache, relationLabelFields } from "./relations";
import { get as getTable } from "./tables";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;
type ExportFormatOptions = { markdown: "raw" | "html" };
type RelationExportConfig = NonNullable<ExportFieldSpec["relation"]>;

/** Hard cap on rows per export call so a single request can't blow up
 *  memory or saturate the connection. Power users do iterative exports
 *  for now; true streaming via cursor lands in a polish phase. */
const MAX_EXPORT_ROWS = 10_000;

const fetchAllForExport = async (params: {
  tableId: string;
  query: ViewQuery;
  viewer?: ExpansionViewer;
}): Promise<Result<{ items: GridRecord[]; truncated: boolean }>> => {
  const limit = Math.min(params.query.limit ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS);
  const items: GridRecord[] = [];
  let cursor: string | null = null;

  while (items.length < limit) {
    const page = await listRecords({
      tableId: params.tableId,
      cursor,
      limit: Math.min(500, limit - items.length),
      includeDeleted: params.query.includeDeleted,
      deletedOnly: params.query.deletedOnly,
      filter: params.query.filter ?? null,
      search: (params.query.search as SearchSpec | undefined) ?? null,
      sort: params.query.sort ?? [],
      includeRelations: false,
      viewer: params.viewer,
    });
    if (!page.ok) return fail(page.error);
    items.push(...page.data.items);
    cursor = page.data.nextCursor;
    if (!cursor || page.data.items.length === 0) break;
  }

  return ok({
    items,
    truncated: (params.query.limit ?? MAX_EXPORT_ROWS) >= MAX_EXPORT_ROWS && cursor !== null,
  });
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

/** RFC 4180 CSV quoting — wraps in double-quotes when the cell contains
 *  a delimiter, newline, or quote, and doubles internal quotes. Exported
 *  alongside `formatCellForExport` for unit testing. */
export const csvQuote = (s: string, delimiter = ","): string => {
  const mustQuote = s.includes(delimiter) || /[\r\n"]/.test(s);
  if (mustQuote) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export type ExportFormat = "csv" | "json";

export type ExportResult = {
  body: string;
  contentType: string;
  filename: string;
  truncated: boolean;
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
  query: ViewQuery;
  viewer?: ExpansionViewer;
}): Promise<Result<{ columns: ExportColumn[]; selected: Array<{ field: Field; spec?: ExportFieldSpec }> }>> => {
  const byId = new Map(params.fields.map((f) => [f.id, f]));
  const requested = params.specs?.length
    ? params.specs
    : params.query.columns?.map((c) => ({ fieldId: c.fieldId }) satisfies ExportFieldSpec);

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
  const labels = labelsNeeded ? await buildRelationLabelCache(params.records, params.fields) : {};

  const idsByTargetTable = new Map<string, Set<string>>();
  const fieldsByTargetTable = new Map<string, Set<string>>();

  for (const { field, spec } of relationSpecs) {
    if (spec?.relation?.mode !== "fields") continue;
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId || !(await canReadTargetTable(targetTableId, params.viewer))) continue;
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
    let fieldIds = [...(fieldsByTargetTable.get(targetTableId) ?? new Set<string>())];
    if (fieldIds.length === 0) {
      fieldIds = relationLabelFields(await listFields(targetTableId)).map((f) => f.id);
    }
    const ids = sql.array([...idSet], "UUID");
    const rows = await sql<DbRow[]>`
      SELECT id, data
      FROM grids.records
      WHERE table_id = ${targetTableId}::uuid
        AND id = ANY(${ids})
        AND deleted_at IS NULL
    `;
    for (const row of rows) {
      const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
      const subset: Record<string, unknown> = {};
      for (const fieldId of fieldIds) subset[fieldId] = data[fieldId] ?? null;
      expanded[row.id as string] = subset;
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
  query?: ViewQuery;
  fields?: ExportFieldSpec[];
  csv?: { delimiter?: string };
  markdown?: "raw" | "html";
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

  const fetched = await fetchAllForExport({
    tableId: params.tableId,
    query,
    viewer: params.viewer,
  });
  if (!fetched.ok) return fail(fetched.error);
  const { items, truncated } = fetched.data;
  const ctx = await buildRelationContext({
    records: items,
    fields,
    selected: picked.data.selected,
    viewer: params.viewer,
  });
  const options: ExportFormatOptions = { markdown: params.markdown ?? "raw" };
  const delimiter = params.csv?.delimiter ?? ",";

  const date = new Date().toISOString().slice(0, 10);
  const filename = `grids-export-${date}.${params.format}`;

  if (params.format === "json") {
    // One JSON document with field metadata + rows. Field names rather
    // than ids in the row keys for human-readability.
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        tableId: params.tableId,
        truncated,
        fields: picked.data.selected.map(({ field, spec }) => ({
          id: field.id,
          name: spec?.label?.trim() || field.name,
          type: field.type,
          relation: spec?.relation,
        })),
        records: items.map((rec) => {
          const out: Record<string, unknown> = { id: rec.id };
          for (const { field, spec } of picked.data.selected) {
            out[spec?.label?.trim() || field.name] = jsonValue({
              record: rec,
              field,
              relation: spec?.relation,
              ctx,
              options,
            });
          }
          return out;
        }),
      },
      null,
      2,
    );
    return ok({ body, contentType: "application/json; charset=utf-8", filename, truncated });
  }

  // CSV
  const header = ["id", ...picked.data.columns.map((c) => c.label)].map((s) => csvQuote(s, delimiter)).join(delimiter);
  const lines: string[] = [header];
  for (const rec of items) {
    const cells = [
      rec.id,
      ...picked.data.columns.map((col) => {
        if (col.kind === "relationField") {
          return relationTargetValue({
            record: rec,
            relationField: col.relationField,
            targetField: col.targetField,
            ctx,
            options,
          });
        }
        if (col.field.type === "relation") {
          return relationValue({
            record: rec,
            field: col.field,
            mode: col.relation?.mode === "labels" ? "labels" : "ids",
            ctx,
          });
        }
        return formatCellForExport(rec.data[col.field.id], col.field, options);
      }),
    ];
    lines.push(cells.map((cell) => csvQuote(cell, delimiter)).join(delimiter));
  }
  return ok({
    body: `${lines.join("\r\n")}\r\n`,
    contentType: "text/csv; charset=utf-8",
    filename,
    truncated,
  });
};
