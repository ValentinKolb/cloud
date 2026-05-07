import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause, type FilterTree } from "./filter-compiler";
import { compileSort, type SortSpec } from "./sort-compiler";
import { parseJsonbRow } from "./jsonb";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

/** Hard cap on rows per export call so a single request can't blow up
 *  memory or saturate the connection. Power users do iterative exports
 *  for now; true streaming via cursor lands in a polish phase. */
const MAX_EXPORT_ROWS = 10_000;

const fetchAllForExport = async (params: {
  tableId: string;
  filter: FilterTree | null;
  sort: SortSpec[];
}): Promise<Result<{ items: GridRecord[]; truncated: boolean }>> => {
  const fields = await listFields(params.tableId);

  const filterCompiled = compileFilter(params.filter, fields);
  if (!filterCompiled.ok) return fail(err.badInput(`filter: ${filterCompiled.error}`));
  const filterClause = renderClause(filterCompiled.clause);

  const sortCompiled = compileSort(params.sort, fields, null);
  if (!sortCompiled.ok) return fail(err.badInput(`sort: ${sortCompiled.error}`));
  const { orderBy } = sortCompiled.result;

  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.records
    WHERE table_id = ${params.tableId}::uuid
      AND deleted_at IS NULL
      AND ${filterClause}
    ORDER BY ${orderBy}
    LIMIT ${MAX_EXPORT_ROWS + 1}
  `;
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const slice = rows.slice(0, MAX_EXPORT_ROWS);
  return ok({
    items: slice.map((r) => ({
      id: r.id as string,
      tableId: r.table_id as string,
      data: parseJsonbRow<Record<string, unknown>>(r.data, {}),
      version: r.version as number,
      deletedAt: r.deleted_at ? (r.deleted_at as Date).toISOString() : null,
      createdBy: (r.created_by as string | null) ?? null,
      updatedBy: (r.updated_by as string | null) ?? null,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    })),
    truncated,
  });
};

/**
 * Formats a single cell value as plain text for export. Single-select /
 * multi-select project the human label, not the option id, so an exported
 * CSV is readable without consulting the field config.
 *
 * Exported (rather than file-private) so it can be unit-tested in
 * isolation; the CSV path here decides the entire user-visible export
 * fidelity, so the corner cases (booleans, select-options, objects) are
 * worth pinning down independently of the DB-bound `exportRecords`.
 */
export const formatCellForExport = (value: unknown, field: Field): string => {
  if (value === null || value === undefined) return "";
  if (field.type === "boolean") return value ? "true" : "false";
  if (field.type === "single-select") {
    const opts = (field.config as { options?: Array<{ id: string; label: string }> }).options ?? [];
    return opts.find((o) => o.id === value)?.label ?? String(value);
  }
  if (field.type === "multi-select" && Array.isArray(value)) {
    const opts = (field.config as { options?: Array<{ id: string; label: string }> }).options ?? [];
    return value.map((id) => opts.find((o) => o.id === id)?.label ?? String(id)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** RFC 4180 CSV quoting — wraps in double-quotes when the cell contains
 *  a delimiter, newline, or quote, and doubles internal quotes. Exported
 *  alongside `formatCellForExport` for unit testing. */
export const csvQuote = (s: string): string => {
  if (/[,\r\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export type ExportFormat = "csv" | "json";

export type ExportResult = {
  body: string;
  contentType: string;
  filename: string;
  truncated: boolean;
};

export const exportRecords = async (params: {
  tableId: string;
  format: ExportFormat;
  filter?: FilterTree | null;
  sort?: SortSpec[];
  /** Optional restrict-to-these-fields. Defaults to every active field
   *  that's user-readable; system fields (created_at/updated_at/etc.)
   *  are included as their record metadata, not data keys. */
  visibleFieldIds?: string[];
}): Promise<Result<ExportResult>> => {
  const fields = await listFields(params.tableId);
  const visibleFields = params.visibleFieldIds
    ? fields.filter((f) => !f.deletedAt && params.visibleFieldIds!.includes(f.id))
    : fields.filter((f) => !f.deletedAt);

  const fetched = await fetchAllForExport({
    tableId: params.tableId,
    filter: params.filter ?? null,
    sort: params.sort ?? [],
  });
  if (!fetched.ok) return fail(fetched.error);
  const { items, truncated } = fetched.data;

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
        fields: visibleFields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        records: items.map((rec) => {
          const out: Record<string, unknown> = { id: rec.id };
          for (const f of visibleFields) {
            out[f.name] = rec.data[f.id] ?? null;
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
  const header = ["id", ...visibleFields.map((f) => f.name)].map(csvQuote).join(",");
  const lines: string[] = [header];
  for (const rec of items) {
    const cells = [rec.id, ...visibleFields.map((f) => formatCellForExport(rec.data[f.id], f))];
    lines.push(cells.map(csvQuote).join(","));
  }
  return ok({
    body: `${lines.join("\r\n")}\r\n`,
    contentType: "text/csv; charset=utf-8",
    filename,
    truncated,
  });
};
