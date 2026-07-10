import { sql } from "bun";
import type { RecordQuery } from "../contracts";
import { compileFilter, renderClause } from "../service/filter-compiler";
import type { FormulaSqlExpression } from "../service/formula-sql-compiler";
import { compileRecordMetaFilter } from "../service/record-metadata";
import { compileSort } from "../service/sort-compiler";
import type { Field } from "../service/types";
import type { DslOutputColumn, DslResolvedSqlQueryPlan, DslResolvedSqlSort } from "./resolver";
import {
  aliveFields,
  compileBaseFieldColumn,
  compileFormulaColumn,
  compileJoinedColumn,
  computedFieldSqlForScope,
  fieldById,
  isImplicitlySelectableField,
  relationTargetIsReadable,
  sortProjectionForField,
} from "./sql-compiler-fields";
import { joinFragments } from "./sql-compiler-fragments";
import { compileRelationJoin } from "./sql-compiler-joins";
import { compileViewSourceRecordScope, recordDeletedCondition, scopedFormulaResolverForPlan } from "./sql-compiler-scope";
import type { DslSqlCompiledQuery, DslSqlCompileOptions, DslSqlCompileResult, DslSqlOutputColumn } from "./sql-compiler-types";
import { compileWherePredicate } from "./sql-compiler-where";

type RecordQueryColumn = NonNullable<RecordQuery["columns"]>[number];
type RecordQueryComputedColumn = Extract<RecordQueryColumn, { kind: "computed" }>;

const ok = (query: DslSqlCompiledQuery): DslSqlCompileResult => ({ ok: true, query });
const fail = (error: string): DslSqlCompileResult => ({ ok: false, error });

const isComputedColumn = (column: RecordQueryColumn): column is RecordQueryComputedColumn =>
  (column as { kind?: unknown }).kind === "computed";

const outputColumnsForPlan = (plan: DslResolvedSqlQueryPlan, baseFields: Field[]): DslOutputColumn[] => {
  if (plan.outputColumns && plan.outputColumns.length > 0) return plan.outputColumns;
  const baseColumns: NonNullable<RecordQuery["columns"]> = plan.query.columns?.length
    ? plan.query.columns
    : baseFields
        .filter((field) => isImplicitlySelectableField(field) && relationTargetIsReadable(field, plan.readableTableIds))
        .map((field) => ({ fieldId: field.id }));
  return [
    ...baseColumns.map((column) => {
      if (isComputedColumn(column)) {
        return {
          kind: "computed",
          id: column.id,
          label: column.label,
          expression: column.expression,
        } satisfies DslOutputColumn;
      }
      return {
        kind: "field",
        fieldId: column.fieldId,
        ...(column.label ? { label: column.label } : {}),
      } satisfies DslOutputColumn;
    }),
    ...(plan.joinedColumns ?? []).map((joined) => ({ kind: "joined" as const, ...joined })),
  ];
};

const compileSqlSort = (
  sorts: DslResolvedSqlSort[],
  fields: Field[],
  columns: DslSqlOutputColumn[],
  options: {
    fieldsByTableId: Record<string, Field[]>;
    joinAliases: Map<string, string>;
    timeZone?: string;
    readableTableIds?: readonly string[];
    computedFieldSql?: Map<string, FormulaSqlExpression>;
    computedFieldSqlByJoinAlias?: Map<string, Map<string, FormulaSqlExpression>>;
  },
): { ok: true; orderBy: unknown } | { ok: false; error: string } => {
  if (sorts.length === 0) return { ok: true, orderBy: sql`r.id ASC` };

  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const computedColumnsByLabel = new Map(columns.filter((column) => column.type === "formula").map((column) => [column.label, column]));
  const joinedColumnsByLabel = new Map(columns.filter((column) => column.joinAlias).map((column) => [column.label, column]));
  const orderParts: unknown[] = [];

  for (const sort of sorts) {
    const dir = sort.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = sort.nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    if (sort.kind === "computed") {
      const column = computedColumnsByLabel.get(sort.alias);
      if (!column) return { ok: false, error: `computed sort alias "${sort.alias}" is not selected` };
      orderParts.push(sql`${sql.unsafe(column.key)} ${dir} ${nulls}`);
      continue;
    }
    if (sort.kind === "joined") {
      const column = joinedColumnsByLabel.get(sort.alias);
      if (!column) return { ok: false, error: `joined sort alias "${sort.alias}" is not selected` };
      orderParts.push(sql`${sql.unsafe(column.key)} ${dir} ${nulls}`);
      continue;
    }
    if (sort.kind === "joinedField") {
      const recordAlias = options.joinAliases.get(sort.joinAlias);
      if (!recordAlias) return { ok: false, error: `joined sort uses unknown join alias "${sort.joinAlias}"` };
      const joinedFields = aliveFields(options.fieldsByTableId[sort.tableId] ?? []);
      const field = fieldById(joinedFields, sort.fieldId);
      if (!field) return { ok: false, error: `joined sort field ${sort.fieldId} is not available` };
      if (!relationTargetIsReadable(field, options.readableTableIds)) {
        return { ok: false, error: `relation field "${field.name}" target table is not available` };
      }
      const projection = sortProjectionForField(field, recordAlias, {
        fields: joinedFields,
        timeZone: options.timeZone,
        computedFieldSql: computedFieldSqlForScope(options, sort.joinAlias),
      });
      if (!projection.ok) return projection;
      orderParts.push(sql`${projection.projection} ${dir} ${nulls}`);
      continue;
    }
    const field = fieldsById.get(sort.fieldId);
    if (!field) return { ok: false, error: "unknown sort field" };
    if (field.deletedAt) return { ok: false, error: `sort field "${field.name}" is deleted` };
    if (!relationTargetIsReadable(field, options.readableTableIds)) {
      return { ok: false, error: `relation field "${field.name}" target table is not available` };
    }
    const projection = sortProjectionForField(field, "r", {
      fields,
      timeZone: options.timeZone,
      computedFieldSql: options.computedFieldSql,
    });
    if (!projection.ok) return projection;
    orderParts.push(sql`${projection.projection} ${dir} ${nulls}`);
  }

  const idDir = sorts[0]?.direction === "desc" ? sql`DESC` : sql`ASC`;
  orderParts.push(sql`r.id ${idDir}`);
  return { ok: true, orderBy: joinFragments(orderParts, sql`, `) };
};

export const compileDslQueryPlanToSql = (plan: DslResolvedSqlQueryPlan, options: DslSqlCompileOptions): DslSqlCompileResult => {
  if (
    (plan.query.groupBy?.length ?? 0) > 0 ||
    (plan.query.aggregations?.length ?? 0) > 0 ||
    plan.formulaAggregations ||
    plan.formulaHaving
  ) {
    return fail("grouped DSL query execution is not compiled by the row-query compiler yet");
  }

  const baseFields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const filter = compileFilter(plan.query.filter ?? null, baseFields, { timeZone: options.timeZone });
  if (!filter.ok) return fail(`filter: ${filter.error}`);

  const joinAliases = new Map<string, string>();
  const joinSql: unknown[] = [];
  for (const [index, join] of (plan.joins ?? []).entries()) {
    const compiled = compileRelationJoin(join, index, joinAliases, { joinFanoutLimit: options.joinFanoutLimit });
    if (!compiled.ok) return fail(compiled.error);
    joinAliases.set(join.alias, compiled.recordAlias);
    joinSql.push(compiled.fragment);
  }
  const resolveFormulaField = scopedFormulaResolverForPlan(plan, baseFields, joinAliases, options);

  const selectFragments: unknown[] = [sql`r.id::text AS __record_id`, sql`r.table_id::text AS __table_id`];
  const columns: DslSqlOutputColumn[] = [];
  const outputColumns = outputColumnsForPlan(plan, baseFields);
  let index = 0;

  for (const column of outputColumns) {
    if (column.kind === "computed") {
      const compiled = compileFormulaColumn({
        expression: column.expression,
        label: column.label,
        fields: baseFields,
        recordAlias: "r",
        index,
        timeZone: options.timeZone,
        computedFieldSql: options.computedFieldSql,
        resolveField: resolveFormulaField,
      });
      if (!compiled.ok) return fail(`select "${column.label}": ${compiled.error}`);
      selectFragments.push(compiled.fragment);
      columns.push(compiled.column);
      index += 1;
      continue;
    }
    if (column.kind === "joined") {
      const recordAlias = joinAliases.get(column.joinAlias);
      if (!recordAlias) return fail(`joined column uses unknown join alias "${column.joinAlias}"`);
      const compiled = compileJoinedColumn({
        joinedColumn: column,
        fieldsByTableId: options.fieldsByTableId,
        recordAlias,
        index,
        timeZone: options.timeZone,
        readableTableIds: plan.readableTableIds,
        computedFieldSql: computedFieldSqlForScope(options, column.joinAlias),
      });
      if (!compiled.ok) return fail(compiled.error);
      selectFragments.push(compiled.fragment);
      columns.push(compiled.column);
      index += 1;
      continue;
    }
    const field = fieldById(baseFields, column.fieldId);
    if (!field) return fail(`field ${column.fieldId} is not available`);
    const compiled = compileBaseFieldColumn({
      field,
      fields: baseFields,
      label: column.label,
      recordAlias: "r",
      index,
      tableId: plan.tableId,
      timeZone: options.timeZone,
      readableTableIds: plan.readableTableIds,
      computedFieldSql: options.computedFieldSql,
      resolveField: resolveFormulaField,
    });
    if (!compiled.ok) return fail(compiled.error);
    selectFragments.push(compiled.fragment);
    columns.push(compiled.column);
    index += 1;
  }

  const sqlSort = plan.sqlSort ?? [];
  const sort =
    sqlSort.length > 0
      ? compileSqlSort(sqlSort, baseFields, columns, {
          fieldsByTableId: options.fieldsByTableId,
          joinAliases,
          timeZone: options.timeZone,
          readableTableIds: plan.readableTableIds,
          computedFieldSql: options.computedFieldSql,
          computedFieldSqlByJoinAlias: options.computedFieldSqlByJoinAlias,
        })
      : compileSort(plan.query.sort ?? [], baseFields, null);
  if (!sort.ok) return fail(`sort: ${sort.error}`);
  const orderBy = "result" in sort ? sort.result.orderBy : sort.orderBy;

  const conditions: unknown[] = [
    sql`r.table_id = ${plan.tableId}::uuid`,
    recordDeletedCondition(plan),
    renderClause(filter.clause),
    compileRecordMetaFilter(plan.query.recordMeta ?? null),
  ];
  const viewScope = compileViewSourceRecordScope(plan, baseFields, options);
  if (!viewScope.ok) return fail(viewScope.error);
  if (viewScope.condition) conditions.push(viewScope.condition);
  if (plan.wherePredicate) {
    const compiled = compileWherePredicate(plan.wherePredicate, baseFields, {
      timeZone: options.timeZone,
      computedFieldSql: options.computedFieldSql,
      resolveField: resolveFormulaField,
    });
    if (!compiled.ok) return fail(`where: ${compiled.error}`);
    conditions.push(compiled.sql);
  }
  if (options.searchClause) conditions.push(options.searchClause);
  const where = conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);
  const limit = Math.min(Math.max(options.limit ?? plan.query.limit ?? 100, 1), 10_000);
  const offset = Math.min(Math.max(plan.offset ?? 0, 0), 10_000);

  return ok({
    sql: sql`
      SELECT ${joinFragments(selectFragments, sql`, `)}
      FROM grids.records r
      JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      ${joinFragments(joinSql, sql` `)}
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    columns,
    joinAliases: Object.fromEntries(joinAliases),
    limit,
    offset,
  });
};
