import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  ComputedColumnSpec,
  AggregationSpec,
  FilterTree,
  GroupBySpec,
  GroupSortSpec,
  SearchSpec,
  StatSource,
  ViewQuery,
} from "../contracts";
import { collectFieldRefs, parseFormula } from "../formula/parser";
import { normalizeRefKey } from "../ref-syntax";
import { compileAggregates } from "./aggregate-compiler";
import { listByTable } from "./fields";
import { compileFilter } from "./filter-compiler";
import { compileGroupQuery, type GroupAggregationSpec } from "./group-compiler";
import { filterSearchableFields } from "./search";
import { compileSort } from "./sort-compiler";
import type { Field } from "./types";

type QueryParts = {
  filter?: FilterTree;
  search?: SearchSpec;
  sort?: ViewQuery["sort"];
  groupBy?: GroupBySpec[];
  groupSort?: GroupSortSpec[];
  aggregations?: AggregationSpec[];
  columns?: ViewQuery["columns"];
};

const unknownField = (): Result<void> =>
  fail(err.badInput("query references a field that no longer exists"));

const fieldById = (fields: Field[]): Map<string, Field> =>
  new Map(fields.filter((f) => !f.deletedAt).map((f) => [f.id, f]));

const fieldRefs = (fields: Field[]): Set<string> => {
  const refs = new Set<string>();
  for (const field of fields.filter((f) => !f.deletedAt)) {
    refs.add(field.id);
    refs.add(normalizeRefKey(field.shortId));
    refs.add(normalizeRefKey(field.name));
  }
  return refs;
};

const validateFieldRefs = (ids: string[], fields: Field[]): Result<void> => {
  const byId = fieldById(fields);
  for (const id of ids) {
    if (!byId.has(id)) return unknownField();
  }
  return ok();
};

const validateComputedColumns = (columns: ComputedColumnSpec[], fields: Field[]): Result<void> => {
  if (columns.length === 0) return ok();
  const refs = fieldRefs(fields);
  for (const column of columns) {
    const parsed = parseFormula(column.expression);
    if (!parsed.ok) return fail(err.badInput(`computed column "${column.label}": ${parsed.error}`));
    for (const ref of collectFieldRefs(parsed.ast)) {
      if (!refs.has(ref) && !refs.has(normalizeRefKey(ref))) return unknownField();
    }
  }
  return ok();
};

const validateSearch = (search: SearchSpec | undefined, fields: Field[]): Result<void> => {
  if (!search?.fieldIds || search.fieldIds.length === 0) return ok();
  const searchable = new Set(filterSearchableFields(fields).map((f) => f.id));
  for (const id of search.fieldIds) {
    if (!fieldById(fields).has(id)) return unknownField();
    if (!searchable.has(id)) {
      const field = fields.find((f) => f.id === id);
      return fail(err.badInput(`field "${field?.name ?? "Unknown field"}" is not searchable`));
    }
  }
  return ok();
};

const validateScalarAggregations = (
  aggregations: AggregationSpec[] | undefined,
  fields: Field[],
): Result<void> => {
  if (!aggregations || aggregations.length === 0) return ok();
  const compiled = compileAggregates(
    aggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
    fields,
  );
  return compiled.ok ? ok() : fail(err.badInput(compiled.error));
};

const validateGroupedQuery = (params: {
  tableId: string;
  fields: Field[];
  filter?: FilterTree;
  groupBy: GroupBySpec[];
  groupSort?: GroupSortSpec[];
  aggregations?: AggregationSpec[];
}): Result<void> => {
  const compiled = compileGroupQuery({
    tableId: params.tableId,
    fields: params.fields,
    filter: params.filter ?? null,
    groupBy: params.groupBy,
    groupSort: params.groupSort,
    aggregations: (params.aggregations ?? []) as GroupAggregationSpec[],
  });
  return compiled.ok ? ok() : fail(err.badInput(compiled.error));
};

const validatePartsForFields = (tableId: string, parts: QueryParts, fields: Field[]): Result<void> => {
  const filter = compileFilter(parts.filter ?? null, fields);
  if (!filter.ok) return fail(err.badInput(`filter: ${filter.error}`));

  const search = validateSearch(parts.search, fields);
  if (!search.ok) return search;

  const sort = compileSort(parts.sort ?? [], fields, null);
  if (!sort.ok) return fail(err.badInput(`sort: ${sort.error}`));

  if (parts.columns) {
    const fieldColumns = parts.columns.filter((c): c is Extract<typeof c, { fieldId: string }> => "fieldId" in c);
    const cols = validateFieldRefs(fieldColumns.map((c) => c.fieldId), fields);
    if (!cols.ok) return cols;
    const computed = validateComputedColumns(
      parts.columns.filter((c): c is ComputedColumnSpec => "kind" in c && c.kind === "computed"),
      fields,
    );
    if (!computed.ok) return computed;
  }

  const groupBy = parts.groupBy ?? [];
  const groupSort = parts.groupSort ?? [];
  if (groupBy.length === 0) {
    if (groupSort.length > 0) {
      return fail(err.badInput("groupSort requires groupBy"));
    }
    return validateScalarAggregations(parts.aggregations, fields);
  }

  return validateGroupedQuery({
    tableId,
    fields,
    filter: parts.filter,
    groupBy,
    groupSort,
    aggregations: parts.aggregations,
  });
};

export const validateViewQueryForTable = async (
  tableId: string,
  query: ViewQuery,
): Promise<Result<void>> => {
  const fields = await listByTable(tableId);
  return validatePartsForFields(tableId, query, fields);
};

export const validateStatSourceForTable = async (
  tableId: string,
  source: StatSource,
): Promise<Result<void>> => {
  const fields = await listByTable(tableId);
  const base = validatePartsForFields(tableId, {
    filter: source.filter,
    aggregations: source.aggregations,
  }, fields);
  if (!base.ok) return base;

  if (source.trend) {
    const trendField = fields.find((f) => f.id === source.trend?.fieldId && !f.deletedAt);
    if (!trendField) return unknownField();
    if (trendField.type !== "date") {
      return fail(err.badInput(`trend field "${trendField.name}" must be a date field`));
    }
    const agg = source.aggregations[0];
    if (agg) {
      const trend = compileGroupQuery({
        tableId,
        fields,
        filter: source.filter ?? null,
        groupBy: [{ fieldId: source.trend.fieldId, granularity: source.trend.granularity }],
        aggregations: [{ fieldId: agg.fieldId, agg: agg.agg } as GroupAggregationSpec],
      });
      if (!trend.ok) return fail(err.badInput(`trend: ${trend.error}`));
    }
  }

  return ok();
};

export const tableBelongsToBase = async (tableId: string, baseId: string): Promise<boolean> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.tables t
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE t.id = ${tableId}::uuid
        AND t.base_id = ${baseId}::uuid
        AND t.deleted_at IS NULL
    ) AS exists
  `;
  return Boolean(row?.exists);
};
