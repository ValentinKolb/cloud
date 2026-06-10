import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { DslQueryPreviewColumn, DslQueryPreviewResponse } from "../contracts";
import type { DslSqlAggregateOutputColumn, DslSqlGroupOutputColumn, DslSqlOutputColumn } from "./sql-compiler";
import { compileDslAggregateQueryPlanToSql, compileDslGroupedQueryPlanToSql, compileDslQueryPlanToSql } from "./sql-compiler";
import type { DslResolvedSqlQueryPlan } from "./resolver";
import type { Field } from "../service/types";

type DslQueryPreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;

export type DslQueryPreviewOptions = {
  fieldsByTableId: Record<string, Field[]>;
  timeZone?: string;
  limit?: number;
};

const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_SCAN_ROWS = 5_000;
const MAX_PREVIEW_JOIN_FANOUT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asOptionalUuid = (value: string | undefined): string | undefined => (value && UUID_RE.test(value) ? value : undefined);

const normalizeValue = (value: unknown): unknown => {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
};

const rowValue = (row: Record<string, unknown>, key: string): unknown => normalizeValue(row[key]);

const rowColumns = (columns: DslSqlOutputColumn[]): DslQueryPreviewColumn[] =>
  columns.map((column) => ({
    key: column.key,
    label: column.label,
    ...(asOptionalUuid(column.tableId) ? { tableId: column.tableId } : {}),
    ...(asOptionalUuid(column.fieldId) ? { fieldId: column.fieldId } : {}),
    ...(column.joinAlias ? { joinAlias: column.joinAlias } : {}),
    type: column.type,
    sqlType: column.sqlType,
  }));

const groupColumns = (columns: DslSqlGroupOutputColumn[]): DslQueryPreviewColumn[] =>
  columns.map((column) => ({
    key: column.key,
    label: column.label,
    ...(asOptionalUuid(column.fieldId) ? { fieldId: column.fieldId } : {}),
    type: column.kind === "group" ? column.type : "aggregate",
    sqlType: column.sqlType,
  }));

const aggregateColumns = (columns: DslSqlAggregateOutputColumn[]): DslQueryPreviewColumn[] =>
  columns.map((column) => ({
    key: column.key,
    label: column.label,
    ...(asOptionalUuid(column.fieldId) ? { fieldId: column.fieldId } : {}),
    type: "aggregate",
    sqlType: column.sqlType,
  }));

const isGroupedPlan = (plan: DslResolvedSqlQueryPlan): boolean => (plan.query.groupBy?.length ?? 0) > 0 || Boolean(plan.formulaHaving);

const isAggregateOnlyPlan = (plan: DslResolvedSqlQueryPlan): boolean => {
  const hasAggregations = (plan.query.aggregations?.length ?? 0) > 0 || (plan.formulaAggregations?.length ?? 0) > 0;
  const hasRowShape = (plan.query.columns?.length ?? 0) > 0 || (plan.joinedColumns?.length ?? 0) > 0 || (plan.joins?.length ?? 0) > 0;
  const hasGrouping = (plan.query.groupBy?.length ?? 0) > 0 || Boolean(plan.formulaHaving);
  const hasSort =
    (plan.query.sort?.length ?? 0) > 0 ||
    (plan.sqlSort?.length ?? 0) > 0 ||
    (plan.query.groupSort?.length ?? 0) > 0 ||
    (plan.formulaGroupSort?.length ?? 0) > 0;
  return hasAggregations && !hasRowShape && !hasGrouping && !hasSort;
};

export const resolveDslPreviewLimit = (plan: DslResolvedSqlQueryPlan, requested: number | undefined): number =>
  Math.min(Math.max(requested ?? plan.query.limit ?? 100, 1), MAX_PREVIEW_ROWS);

export const previewDslQuery = async (
  plan: DslResolvedSqlQueryPlan,
  options: DslQueryPreviewOptions,
): Promise<Result<DslQueryPreviewSuccess>> => {
  const limit = resolveDslPreviewLimit(plan, options.limit);
  const fetchLimit = Math.min(limit + 1, MAX_PREVIEW_ROWS + 1);
  const previewBounds = {
    previewBaseLimit: MAX_PREVIEW_SCAN_ROWS,
    joinFanoutLimit: MAX_PREVIEW_JOIN_FANOUT,
  };

  if (isGroupedPlan(plan)) {
    const compiled = compileDslGroupedQueryPlanToSql(plan, { ...options, ...previewBounds, limit: fetchLimit });
    if (!compiled.ok) return fail(err.badInput(compiled.error));

    const rows = await sql<Record<string, unknown>[]>`${compiled.query.sql}`;
    const visible = rows.slice(0, limit);
    const columns = groupColumns(compiled.query.columns);
    return ok({
      ok: true,
      mode: "groups",
      columns,
      rows: visible.map((row) => ({
        values: Object.fromEntries(columns.map((column) => [column.key, rowValue(row, column.key)])),
      })),
      limit,
      truncated: rows.length > limit,
    });
  }

  if (isAggregateOnlyPlan(plan)) {
    const compiled = compileDslAggregateQueryPlanToSql(plan, { ...options, ...previewBounds, limit: 1 });
    if (!compiled.ok) return fail(err.badInput(compiled.error));

    const rows = await sql<{ result: Record<string, unknown> }[]>`${compiled.query.sql}`;
    const columns = aggregateColumns(compiled.query.columns);
    return ok({
      ok: true,
      mode: "groups",
      columns,
      rows: [
        {
          values: Object.fromEntries(columns.map((column) => [column.key, normalizeValue(rows[0]?.result?.[column.key])])),
        },
      ],
      limit: 1,
      truncated: false,
    });
  }

  const compiled = compileDslQueryPlanToSql(plan, { ...options, ...previewBounds, limit: fetchLimit });
  if (!compiled.ok) return fail(err.badInput(compiled.error));

  const rows = await sql<Record<string, unknown>[]>`${compiled.query.sql}`;
  const visible = rows.slice(0, limit);
  const columns = rowColumns(compiled.query.columns);
  return ok({
    ok: true,
    mode: "rows",
    columns,
    rows: visible.map((row) => ({
      ...(typeof row.__record_id === "string" && UUID_RE.test(row.__record_id) ? { recordId: row.__record_id } : {}),
      ...(typeof row.__table_id === "string" && UUID_RE.test(row.__table_id) ? { tableId: row.__table_id } : {}),
      values: Object.fromEntries(columns.map((column) => [column.key, rowValue(row, column.key)])),
    })),
    limit,
    truncated: rows.length > limit,
  });
};
