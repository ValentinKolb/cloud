import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { DslQueryPreviewColumn, DslQueryPreviewDiagnostic, DslQueryPreviewResponse } from "../contracts";
import { decimalStringToCanonical } from "../formula/numeric";
import { normalizeRefKey } from "../ref-syntax";
import { buildComputedFieldSqlMap } from "../service/computed-projections";
import { storageOf } from "../service/field-storage";
import { buildRelationLabelCacheForIds, type ExpansionViewer } from "../service/relations";
import { compileSearchClause } from "../service/search";
import type { Field } from "../service/types";
import type { DslResolvedSqlQueryPlan } from "./resolver";
import type { DslSqlAggregateOutputColumn, DslSqlGroupOutputColumn, DslSqlOutputColumn } from "./sql-compiler";
import {
  compileDslAggregateQueryPlanToSql,
  compileDslDerivedViewSourcePlanToSql,
  compileDslGroupedQueryPlanToSql,
  compileDslQueryPlanToSql,
  dslDerivedJoinRecordAlias,
  dslJoinRecordAlias,
} from "./sql-compiler";

type DslQueryPreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type DslQueryPreviewRow = DslQueryPreviewSuccess["rows"][number];

export type DslQueryPreviewOptions = {
  fieldsByTableId: Record<string, Field[]>;
  timeZone?: string;
  limit?: number;
  maxRows?: number;
  /** Viewer for `search` over relation fields (target-table read scoping). */
  viewer?: ExpansionViewer;
};

const MAX_PREVIEW_ROWS = 500;
// Relation joins fan out per row; cap how many linked rows a single source row
// expands to in the preview so a query over a record with thousands of links
// can't blow up the preview cardinality. Aggregates/groups are NOT sampled —
// they compute over the full matching set so preview numbers equal the real
// numbers; the statement timeout below bounds runtime instead.
const MAX_PREVIEW_JOIN_FANOUT = 50;
// Hard wall-clock cap for a single preview statement (5s, set via SET LOCAL in
// runPreview). A user can author an arbitrarily expensive query; this keeps one
// slow query from holding a connection. 100k-row aggregates run well under it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATEMENT_TIMEOUT_CODE = "57014";

const asOptionalUuid = (value: string | undefined): string | undefined => (value && UUID_RE.test(value) ? value : undefined);

const normalizeValue = (value: unknown, column?: { sqlType?: string }): unknown => {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && column?.sqlType === "numeric") return decimalStringToCanonical(value) ?? value;
  return value;
};

const rowValue = (row: Record<string, unknown>, column: { key: string; sqlType?: string }): unknown => normalizeValue(row[column.key], column);

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

const groupColumns = (columns: DslSqlGroupOutputColumn[], tableId?: string): DslQueryPreviewColumn[] =>
  columns.map((column) => ({
    key: column.key,
    label: column.label,
    ...(column.kind === "group" && asOptionalUuid(column.tableId ?? tableId) ? { tableId: column.tableId ?? tableId } : {}),
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

const isGroupedPlan = (plan: DslResolvedSqlQueryPlan): boolean =>
  (plan.query.groupBy?.length ?? 0) > 0 ||
  (plan.sqlGroupBy?.length ?? 0) > 0 ||
  ((plan.joins?.length ?? 0) > 0 && ((plan.sqlAggregations?.length ?? 0) > 0 || (plan.formulaAggregations?.length ?? 0) > 0)) ||
  Boolean(plan.formulaHaving);

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

/** True when any group key is a multi-select / relation field, so one record
 *  contributes to several buckets (bucket totals can exceed record count). */
const groupExplodes = (plan: DslResolvedSqlQueryPlan, fieldsByTableId: Record<string, Field[]>): boolean => {
  const groups =
    (plan.sqlGroupBy?.length ?? 0) > 0
      ? (plan.sqlGroupBy ?? []).map((group) => ({ fieldId: group.fieldId, tableId: group.tableId }))
      : (plan.query.groupBy ?? []).map((group) => ({ fieldId: group.fieldId, tableId: plan.tableId }));

  return groups.some((group) => {
    const byId = new Map((fieldsByTableId[group.tableId] ?? []).map((field) => [field.id, field]));
    const field = byId.get(group.fieldId);
    if (!field) return false;
    const kind = storageOf(field).kind;
    return kind === "relationLink" || kind === "jsonbArray";
  });
};

export const resolveDslPreviewLimit = (plan: DslResolvedSqlQueryPlan, requested: number | undefined, maxRows = MAX_PREVIEW_ROWS): number =>
  Math.min(Math.max(requested ?? plan.query.limit ?? 100, 1), maxRows);

const withPlanSpan = (message: string, span: { line: number; column: number; length: number } | undefined): DslQueryPreviewDiagnostic => ({
  ...(span ? { line: span.line, column: span.column, length: span.length } : {}),
  message,
});

const firstSpan = (spans: Array<{ line: number; column: number; length: number }> | undefined) => spans?.[0];

const spanForSelectError = (plan: DslResolvedSqlQueryPlan, message: string) => {
  const match = message.match(/^select "(.+?)":/);
  if (!match) return undefined;
  const key = normalizeRefKey(match[1]!);
  return plan.diagnosticSpans?.select?.find((item) => normalizeRefKey(item.label) === key)?.span;
};

const spanForAggregateError = (plan: DslResolvedSqlQueryPlan, message: string) => {
  const formulaMatch = message.match(/^formula aggregate "(.+?)":/);
  if (formulaMatch) {
    const key = normalizeRefKey(formulaMatch[1]!);
    return plan.diagnosticSpans?.aggregations?.find((item) => normalizeRefKey(item.alias) === key)?.span;
  }
  if (message.startsWith("query has no aggregate output") || message.includes("aggregate")) {
    return plan.diagnosticSpans?.aggregations?.[0]?.span;
  }
  return undefined;
};

const spanForGroupError = (plan: DslResolvedSqlQueryPlan, message: string) => {
  const fieldMatch = message.match(/^field "(.+?)"/);
  if (fieldMatch) {
    const key = normalizeRefKey(fieldMatch[1]!);
    return plan.diagnosticSpans?.groupBy?.find((item) => normalizeRefKey(item.label) === key)?.span;
  }
  if (message.toLowerCase().includes("group")) return plan.diagnosticSpans?.groupBy?.[0]?.span;
  return undefined;
};

export const dslPreviewDiagnosticForCompilerError = (plan: DslResolvedSqlQueryPlan, message: string): DslQueryPreviewDiagnostic => {
  const spans = plan.diagnosticSpans;
  const normalizedMessage = message.toLowerCase();
  const span =
    (normalizedMessage.startsWith("where:") ? spans?.where : undefined) ??
    (normalizedMessage.startsWith("having:") ? spans?.having : undefined) ??
    spanForSelectError(plan, message) ??
    spanForAggregateError(plan, message) ??
    spanForGroupError(plan, message) ??
    (normalizedMessage.includes("sort") || normalizedMessage.includes("order") ? firstSpan(spans?.sort) : undefined) ??
    (normalizedMessage.includes("search") ? spans?.search : undefined) ??
    (normalizedMessage.includes("source") ? spans?.source : undefined);
  return withPlanSpan(message, span);
};

const isTimeout = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && (error as { code?: unknown }).code === STATEMENT_TIMEOUT_CODE) ||
    ("message" in error && String((error as { message?: unknown }).message).includes("statement timeout")));

const relationTargetTableId = (field: Field): string | undefined => {
  if (field.type !== "relation") return undefined;
  const targetTableId = (field.config as { targetTableId?: unknown }).targetTableId;
  return typeof targetTableId === "string" && UUID_RE.test(targetTableId) ? targetTableId : undefined;
};

const relationIdsFromValue = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item));
  return typeof value === "string" && UUID_RE.test(value) ? [value] : [];
};

const labelRelationPreviewValues = async (
  rows: DslQueryPreviewRow[],
  columns: DslQueryPreviewColumn[],
  options: DslQueryPreviewOptions,
): Promise<DslQueryPreviewRow[]> => {
  const relationColumnKeys = new Set<string>();
  const idsByTargetTable = new Map<string, Set<string>>();

  for (const column of columns) {
    if (column.type !== "relation" || !column.tableId || !column.fieldId) continue;
    const field = (options.fieldsByTableId[column.tableId] ?? []).find((candidate) => candidate.id === column.fieldId);
    if (!field) continue;
    const targetTableId = relationTargetTableId(field);
    if (!targetTableId) continue;

    relationColumnKeys.add(column.key);
    const ids = idsByTargetTable.get(targetTableId) ?? new Set<string>();
    for (const row of rows) {
      for (const id of relationIdsFromValue(row.values[column.key])) ids.add(id);
    }
    if (ids.size > 0) idsByTargetTable.set(targetTableId, ids);
  }

  if (idsByTargetTable.size === 0) return rows;
  const labels = await buildRelationLabelCacheForIds(idsByTargetTable, options.viewer);

  return rows.map((row) => {
    let values: Record<string, unknown> | undefined;
    for (const key of relationColumnKeys) {
      const value = row.values[key];
      const ids = relationIdsFromValue(value);
      if (ids.length === 0) continue;
      values ??= { ...row.values };
      values[key] = Array.isArray(value) ? ids.map((id) => labels[id] ?? "Unknown record") : (labels[ids[0]!] ?? "Unknown record");
    }
    return values ? { ...row, values } : row;
  });
};

/** Run one preview statement under a bounded statement_timeout so a pathological
 *  (but valid) query can't hold a connection indefinitely. */
const runPreview = async <T>(query: unknown): Promise<T[]> =>
  sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = 5000`;
    return tx<T[]>`${query}`;
  });

const joinOr = (parts: unknown[]): unknown => parts.slice(1).reduce((acc, part) => sql`${acc} OR ${part}`, parts[0]!);

const compileDslSearchClause = async (
  plan: DslResolvedSqlQueryPlan,
  options: DslQueryPreviewOptions,
): Promise<{ clause: unknown } | undefined> => {
  const clauses: unknown[] = [];
  if (plan.query.search) {
    clauses.push(
      (
        await compileSearchClause({
          search: plan.query.search,
          fields: options.fieldsByTableId[plan.tableId] ?? [],
          viewer: options.viewer,
        })
      ).clause,
    );
  }

  for (const search of plan.sqlSearch ?? []) {
    const joinIndex = (plan.joins ?? []).findIndex((join) => join.alias === search.joinAlias);
    if (joinIndex < 0) return { clause: sql`FALSE` };
    clauses.push(
      (
        await compileSearchClause({
          search: { q: search.q, fieldIds: search.fieldIds },
          fields: options.fieldsByTableId[search.tableId] ?? [],
          alias: dslJoinRecordAlias(joinIndex),
          viewer: options.viewer,
        })
      ).clause,
    );
  }

  const derived = plan.derivedViewSource;
  if (derived) {
    for (const search of derived.joinedSearch ?? []) {
      const derivedJoinIndex = (derived.joins ?? []).findIndex((join) => join.alias === search.joinAlias);
      const relationJoinIndex = (derived.relationJoins ?? []).findIndex((join) => join.alias === search.joinAlias);
      const alias =
        derivedJoinIndex >= 0
          ? dslDerivedJoinRecordAlias(derivedJoinIndex)
          : relationJoinIndex >= 0
            ? dslJoinRecordAlias(relationJoinIndex)
            : null;
      if (!alias) return { clause: sql`FALSE` };
      clauses.push(
        (
          await compileSearchClause({
            search: { q: search.q, fieldIds: search.fieldIds },
            fields: options.fieldsByTableId[search.tableId] ?? [],
            alias,
            viewer: options.viewer,
          })
        ).clause,
      );
    }
  }

  if (clauses.length === 0) return undefined;
  return { clause: sql`(${joinOr(clauses)})` };
};

export const previewDslQuery = async (
  plan: DslResolvedSqlQueryPlan,
  options: DslQueryPreviewOptions,
): Promise<Result<DslQueryPreviewSuccess>> => {
  const maxRows = options.maxRows ?? MAX_PREVIEW_ROWS;
  const limit = resolveDslPreviewLimit(plan, options.limit, maxRows);
  const fetchLimit = Math.min(limit + 1, maxRows + 1);

  try {
    // Full-text search compiles async (relation search batch-reads target
    // labels with the viewer's read scope), so it's built once here and handed
    // to the synchronous SQL compilers as a ready predicate.
    const searchClause = (await compileDslSearchClause(plan, options))?.clause;
    const viewSourceSearch = plan.viewSourceQuery?.search ?? plan.derivedViewSource?.query.search;
    const viewSourceSearchClause = viewSourceSearch
      ? (
          await compileSearchClause({
            search: viewSourceSearch,
            fields: options.fieldsByTableId[plan.tableId] ?? [],
            viewer: options.viewer,
          })
        ).clause
      : undefined;
    // Lookup/rollup SQL (cross-table correlated subqueries) is built once and
    // handed to the compilers so those fields work in select / sort / filter /
    // formulas — same values as the records pipeline.
    const computedFieldSql = await buildComputedFieldSqlMap(options.fieldsByTableId[plan.tableId] ?? []);
    const computedFieldSqlByJoinAlias = new Map<string, Awaited<ReturnType<typeof buildComputedFieldSqlMap>>>();
    for (const [index, join] of (plan.joins ?? []).entries()) {
      const map = await buildComputedFieldSqlMap(options.fieldsByTableId[join.tableId] ?? [], { recordAlias: dslJoinRecordAlias(index) });
      if (map.size > 0) computedFieldSqlByJoinAlias.set(join.alias, map);
    }
    for (const [index, join] of (plan.derivedViewSource?.joins ?? []).entries()) {
      const map = await buildComputedFieldSqlMap(options.fieldsByTableId[join.tableId] ?? [], {
        recordAlias: dslDerivedJoinRecordAlias(index),
      });
      if (map.size > 0) computedFieldSqlByJoinAlias.set(join.alias, map);
    }
    for (const [index, join] of (plan.derivedViewSource?.relationJoins ?? []).entries()) {
      const map = await buildComputedFieldSqlMap(options.fieldsByTableId[join.tableId] ?? [], { recordAlias: dslJoinRecordAlias(index) });
      if (map.size > 0) computedFieldSqlByJoinAlias.set(join.alias, map);
    }
    const compileInputs = {
      searchClause,
      computedFieldSql,
      computedFieldSqlByJoinAlias,
      viewSourceSearchClause,
    };
    const rowPreviewBounds = {
      ...compileInputs,
      joinFanoutLimit: MAX_PREVIEW_JOIN_FANOUT,
    };

    if (plan.derivedViewSource) {
      const compiled = compileDslDerivedViewSourcePlanToSql(plan, { ...options, ...compileInputs, limit: fetchLimit });
      if (!compiled.ok) return fail(err.badInput(compiled.error));

      const rows = await runPreview<Record<string, unknown>>(compiled.query.sql);
      const visible = rows.slice(0, limit);
      const columns = groupColumns(compiled.query.columns, plan.tableId);
      const previewRows = visible.map((row) => ({
        values: Object.fromEntries(columns.map((column) => [column.key, rowValue(row, column)])),
      }));
      return ok({
        ok: true,
        mode: "groups",
        columns,
        rows: await labelRelationPreviewValues(previewRows, columns, options),
        limit,
        truncated: rows.length > limit,
      });
    }

    if (isGroupedPlan(plan)) {
      const compiled = compileDslGroupedQueryPlanToSql(plan, { ...options, ...compileInputs, limit: fetchLimit });
      if (!compiled.ok) return fail(err.badInput(compiled.error));

      const rows = await runPreview<Record<string, unknown>>(compiled.query.sql);
      const visible = rows.slice(0, limit);
      const columns = groupColumns(compiled.query.columns, (plan.joins?.length ?? 0) === 0 ? plan.tableId : undefined);
      const previewRows = visible.map((row) => ({
        values: Object.fromEntries(columns.map((column) => [column.key, rowValue(row, column)])),
      }));
      return ok({
        ok: true,
        mode: "groups",
        columns,
        rows: await labelRelationPreviewValues(previewRows, columns, options),
        limit,
        truncated: rows.length > limit,
        ...(groupExplodes(plan, options.fieldsByTableId) ? { explode: true } : {}),
      });
    }

    if (isAggregateOnlyPlan(plan)) {
      const compiled = compileDslAggregateQueryPlanToSql(plan, { ...options, ...compileInputs, limit: 1 });
      if (!compiled.ok) return fail(err.badInput(compiled.error));

      const rows = await runPreview<{ result: Record<string, unknown> }>(compiled.query.sql);
      const columns = aggregateColumns(compiled.query.columns);
      return ok({
        ok: true,
        mode: "groups",
        columns,
        rows: [
          {
            values: Object.fromEntries(columns.map((column) => [column.key, normalizeValue(rows[0]?.result?.[column.key], column)])),
          },
        ],
        limit: 1,
        truncated: false,
      });
    }

    const compiled = compileDslQueryPlanToSql(plan, { ...options, ...rowPreviewBounds, limit: fetchLimit });
    if (!compiled.ok) return fail(err.badInput(compiled.error));

    const rows = await runPreview<Record<string, unknown>>(compiled.query.sql);
    const visible = rows.slice(0, limit);
    const columns = rowColumns(compiled.query.columns);
    const previewRows = visible.map((row) => ({
      ...(typeof row.__record_id === "string" && UUID_RE.test(row.__record_id) ? { recordId: row.__record_id } : {}),
      ...(typeof row.__table_id === "string" && UUID_RE.test(row.__table_id) ? { tableId: row.__table_id } : {}),
      values: Object.fromEntries(columns.map((column) => [column.key, rowValue(row, column)])),
    }));
    return ok({
      ok: true,
      mode: "rows",
      columns,
      rows: await labelRelationPreviewValues(previewRows, columns, options),
      limit,
      truncated: rows.length > limit,
    });
  } catch (error) {
    if (isTimeout(error)) return fail(err.badInput("This query took too long (over 5s). Add a filter or a smaller limit and try again."));
    throw error;
  }
};
