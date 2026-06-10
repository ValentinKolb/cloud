import { sql } from "bun";
import type { ViewQuery } from "../contracts";
import { compileAggregates } from "../service/aggregate-compiler";
import { compileFilter, renderClause } from "../service/filter-compiler";
import { storageOf } from "../service/field-storage";
import {
  compileFormulaAstToSql,
  compileFormulaPredicateAstToSql,
  compileFormulaSourceToSql,
  type FormulaSqlType,
} from "../service/formula-sql-compiler";
import { compileGroupQuery, type GroupAggregationSpec, type GroupBucket, type GroupHavingRef } from "../service/group-compiler";
import { compileSort } from "../service/sort-compiler";
import type { Field } from "../service/types";
import type {
  DslFormulaAggregation,
  DslJoinedColumn,
  DslResolvedRelationJoin,
  DslResolvedSqlQueryPlan,
  DslResolvedSqlSort,
} from "./resolver";

export type DslSqlOutputColumn = {
  key: string;
  label: string;
  tableId: string;
  fieldId?: string;
  joinAlias?: string;
  type: string;
  sqlType: FormulaSqlType | "json";
};

export type DslSqlCompileOptions = {
  fieldsByTableId: Record<string, Field[]>;
  timeZone?: string;
  limit?: number;
  previewBaseLimit?: number;
  joinFanoutLimit?: number;
};

export type DslSqlCompiledQuery = {
  sql: unknown;
  columns: DslSqlOutputColumn[];
  joinAliases: Record<string, string>;
  limit: number;
  offset: number;
};

export type DslSqlCompileResult = { ok: true; query: DslSqlCompiledQuery } | { ok: false; error: string };

export type DslSqlGroupOutputColumn =
  | {
      kind: "group";
      key: string;
      label: string;
      fieldId: string;
      type: string;
      sqlType: DslSqlOutputColumn["sqlType"];
    }
  | {
      kind: "aggregate";
      key: string;
      label: string;
      fieldId: string | "*";
      agg: string;
      sqlType: FormulaSqlType;
    };

export type DslSqlCompiledGroupQuery = {
  sql: unknown;
  columns: DslSqlGroupOutputColumn[];
  limit: number;
  offset: number;
  cursorable: boolean;
};

export type DslSqlGroupCompileResult = { ok: true; query: DslSqlCompiledGroupQuery } | { ok: false; error: string };

export type DslSqlAggregateOutputColumn = {
  key: string;
  label: string;
  fieldId: string | "*";
  agg: string;
  sqlType: FormulaSqlType;
};

export type DslSqlCompiledAggregateQuery = {
  sql: unknown;
  columns: DslSqlAggregateOutputColumn[];
  limit: 1;
  offset: 0;
};

export type DslSqlAggregateCompileResult = { ok: true; query: DslSqlCompiledAggregateQuery } | { ok: false; error: string };

type ViewQueryColumn = NonNullable<ViewQuery["columns"]>[number];
type ViewQueryComputedColumn = Extract<ViewQueryColumn, { kind: "computed" }>;
type ViewQueryFieldColumn = Exclude<ViewQueryColumn, ViewQueryComputedColumn>;
type GroupAggKind = GroupAggregationSpec["agg"];
type GroupFieldAggregation = Extract<GroupAggregationSpec, { fieldId: string | "*" }>;

const ok = (query: DslSqlCompiledQuery): DslSqlCompileResult => ({ ok: true, query });
const fail = (error: string): DslSqlCompileResult => ({ ok: false, error });
const failGroup = (error: string): DslSqlGroupCompileResult => ({ ok: false, error });
const failAggregate = (error: string): DslSqlAggregateCompileResult => ({ ok: false, error });

const aliveFields = (fields: Field[]): Field[] => fields.filter((field) => !field.deletedAt).sort((a, b) => a.position - b.position);

const outputTypeFor = (field: Field): DslSqlOutputColumn["sqlType"] => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "numeric") return "numeric";
  if (descriptor.kind === "boolean") return "boolean";
  if (descriptor.kind === "date") return (field.config as { includeTime?: boolean }).includeTime ? "datetime" : "date";
  if (descriptor.kind === "datetime" || descriptor.kind === "system") return "datetime";
  if (descriptor.kind === "json" || descriptor.kind === "jsonbArray" || descriptor.kind === "relationLink") return "json";
  return "text";
};

const compileFormulaFieldProjection = (params: {
  field: Field;
  fields: Field[];
  recordAlias: string;
  timeZone?: string;
}): { ok: true; projection: unknown; sqlType: FormulaSqlType } | { ok: false; error: string } => {
  const expression = (params.field.config as { expression?: unknown }).expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return { ok: false, error: `formula field "${params.field.name}" has no expression` };
  }
  const compiled = compileFormulaSourceToSql(expression, {
    fields: params.fields,
    recordAlias: params.recordAlias,
    dateConfig: params.timeZone ? { timeZone: params.timeZone } : undefined,
  });
  if (!compiled.ok) return { ok: false, error: `formula field "${params.field.name}": ${compiled.error}` };
  return { ok: true, projection: compiled.expression.sql, sqlType: compiled.expression.type };
};

const fieldById = (fields: Field[], fieldId: string): Field | null =>
  fields.find((field) => field.id === fieldId && !field.deletedAt) ?? null;

const safeColumnAlias = (index: number): string => `q_col_${index}`;
const groupKey = (index: number): string => `gk_${index}`;
const isFormulaGroupAggregation = (aggregation: GroupAggregationSpec): aggregation is Extract<GroupAggregationSpec, { kind: "formula" }> =>
  "kind" in aggregation && aggregation.kind === "formula";
const aggregateKeyFromParts = (fieldId: string | "*", agg: string): string => `${fieldId}__${agg}`;
const aggregateKey = (aggregation: GroupAggregationSpec): string =>
  aggregateKeyFromParts(isFormulaGroupAggregation(aggregation) ? aggregation.id : aggregation.fieldId, aggregation.agg);
const GROUP_AGGS: ReadonlySet<GroupAggKind> = new Set(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);
const isGroupAggKind = (agg: string): agg is GroupAggKind => GROUP_AGGS.has(agg as GroupAggKind);
const numericAggs: ReadonlySet<GroupAggKind> = new Set(["count", "countEmpty", "countUnique", "sum", "avg"]);

const isComputedColumn = (column: ViewQueryColumn): column is ViewQueryComputedColumn => (column as { kind?: unknown }).kind === "computed";

const isFieldColumn = (column: ViewQueryColumn): column is ViewQueryFieldColumn => !isComputedColumn(column);

const isImplicitlySelectableField = (field: Field): boolean => {
  const kind = storageOf(field).kind;
  return (kind !== "computed" || field.type === "formula") && kind !== "unknown";
};

const relationTargetTableId = (field: Field): string | null => {
  if (field.type !== "relation") return null;
  return (field.config as { targetTableId?: string }).targetTableId ?? null;
};

const relationTargetIsReadable = (field: Field, readableTableIds?: readonly string[]): boolean => {
  const targetTableId = relationTargetTableId(field);
  if (!targetTableId || !readableTableIds) return true;
  return readableTableIds.includes(targetTableId);
};

const aggregateSqlType = (aggregation: GroupAggregationSpec, fieldsById: Map<string, Field>): FormulaSqlType => {
  if (numericAggs.has(aggregation.agg)) return "numeric";
  if (isFormulaGroupAggregation(aggregation)) return (aggregation as DslFormulaAggregation).sqlType;
  if (aggregation.fieldId === "*") return "numeric";
  const field = fieldsById.get(aggregation.fieldId);
  if (!field) return "unknown";
  const type = outputTypeFor(field);
  return type === "json" ? "unknown" : type;
};

const formulaAggregateSqlType = (aggregation: DslFormulaAggregation): FormulaSqlType => {
  if (aggregation.agg === "count" || aggregation.agg === "countEmpty" || aggregation.agg === "countUnique") return "numeric";
  if (aggregation.agg === "sum" || aggregation.agg === "avg") return "numeric";
  return aggregation.sqlType;
};

const viewAggregateSqlType = (
  aggregation: NonNullable<ViewQuery["aggregations"]>[number],
  fieldsById: Map<string, Field>,
): FormulaSqlType => {
  if (aggregation.agg === "count" || aggregation.agg === "countEmpty" || aggregation.agg === "countUnique") return "numeric";
  if (aggregation.fieldId === "*") return "numeric";
  const field = fieldsById.get(aggregation.fieldId);
  if (!field) return "unknown";
  if (aggregation.agg === "sum" || aggregation.agg === "avg" || aggregation.agg === "median") return "numeric";
  if (aggregation.agg === "earliest" || aggregation.agg === "latest") return field.type === "date" ? "date" : "unknown";
  const type = outputTypeFor(field);
  return type === "json" ? "unknown" : type;
};

const fieldProjection = (
  field: Field,
  recordAlias: string,
  options?: { fields?: Field[]; timeZone?: string; readableTableIds?: readonly string[] },
): { ok: true; projection: unknown; sqlType?: FormulaSqlType } | { ok: false; error: string } => {
  if (field.type === "formula") {
    return compileFormulaFieldProjection({
      field,
      fields: options?.fields ?? [field],
      recordAlias,
      timeZone: options?.timeZone,
    });
  }
  if (!relationTargetIsReadable(field, options?.readableTableIds)) {
    return { ok: false, error: `relation field "${field.name}" target table is not available` };
  }
  const descriptor = storageOf(field);
  const projected = descriptor.project(field, recordAlias);
  if (projected) return { ok: true, projection: projected };
  if (descriptor.kind === "relationLink") {
    return {
      ok: true,
      projection: sql`(
        SELECT COALESCE(jsonb_agg(rl.to_record_id::text ORDER BY rl.position), '[]'::jsonb)
        FROM grids.record_links rl
        WHERE rl.from_record_id = ${sql.unsafe(recordAlias)}.id
          AND rl.from_field_id = ${field.id}::uuid
      )`,
    };
  }
  if (descriptor.kind === "json" || descriptor.kind === "jsonbArray") {
    return { ok: true, projection: sql`${sql.unsafe(recordAlias)}.data->${field.id}` };
  }
  return { ok: false, error: `field "${field.name}" (type "${field.type}") cannot be selected by the SQL query DSL yet` };
};

const compileBaseFieldColumn = (params: {
  field: Field;
  fields: Field[];
  label?: string;
  recordAlias: string;
  index: number;
  tableId: string;
  timeZone?: string;
  readableTableIds?: readonly string[];
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const projection = fieldProjection(params.field, params.recordAlias, {
    fields: params.fields,
    timeZone: params.timeZone,
    readableTableIds: params.readableTableIds,
  });
  if (!projection.ok) return projection;
  const key = safeColumnAlias(params.index);
  return {
    ok: true,
    fragment: sql`${projection.projection} AS ${sql.unsafe(key)}`,
    column: {
      key,
      label: params.label ?? params.field.name,
      tableId: params.tableId,
      fieldId: params.field.id,
      type: params.field.type,
      sqlType: projection.sqlType ?? outputTypeFor(params.field),
    },
  };
};

const compileFormulaColumn = (params: {
  expression: string;
  label: string;
  fields: Field[];
  recordAlias: string;
  index: number;
  timeZone?: string;
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const compiled = compileFormulaSourceToSql(params.expression, {
    fields: params.fields,
    recordAlias: params.recordAlias,
    dateConfig: params.timeZone ? { timeZone: params.timeZone } : undefined,
  });
  if (!compiled.ok) return { ok: false, error: compiled.error };
  const key = safeColumnAlias(params.index);
  return {
    ok: true,
    fragment: sql`${compiled.expression.sql} AS ${sql.unsafe(key)}`,
    column: {
      key,
      label: params.label,
      tableId: "",
      type: "formula",
      sqlType: compiled.expression.type,
    },
  };
};

const compileJoinedColumn = (params: {
  joinedColumn: DslJoinedColumn;
  fieldsByTableId: Record<string, Field[]>;
  recordAlias: string;
  index: number;
  timeZone?: string;
  readableTableIds?: readonly string[];
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const fields = aliveFields(params.fieldsByTableId[params.joinedColumn.tableId] ?? []);
  const field = fieldById(fields, params.joinedColumn.fieldId);
  if (!field) return { ok: false, error: `joined field ${params.joinedColumn.fieldId} is not available` };
  const projection = fieldProjection(field, params.recordAlias, {
    fields,
    timeZone: params.timeZone,
    readableTableIds: params.readableTableIds,
  });
  if (!projection.ok) return projection;
  const key = safeColumnAlias(params.index);
  return {
    ok: true,
    fragment: sql`${projection.projection} AS ${sql.unsafe(key)}`,
    column: {
      key,
      label: params.joinedColumn.label ?? `${params.joinedColumn.joinAlias}.${field.name}`,
      tableId: params.joinedColumn.tableId,
      fieldId: field.id,
      joinAlias: params.joinedColumn.joinAlias,
      type: field.type,
      sqlType: projection.sqlType ?? outputTypeFor(field),
    },
  };
};

const sortProjectionForField = (
  field: Field,
  recordAlias = "r",
  options?: { fields?: Field[]; timeZone?: string },
): { ok: true; projection: unknown } | { ok: false; error: string } => {
  if (field.type === "formula") {
    const projection = compileFormulaFieldProjection({
      field,
      fields: options?.fields ?? [field],
      recordAlias,
      timeZone: options?.timeZone,
    });
    if (!projection.ok) return projection;
    return { ok: true, projection: projection.projection };
  }
  const descriptor = storageOf(field);
  if (!descriptor.sortable) return { ok: false, error: `field "${field.name}" (type "${field.type}") is not sortable` };
  const projection = descriptor.project(field, recordAlias);
  if (!projection) return { ok: false, error: `field "${field.name}" (type "${field.type}") is not sortable` };
  return { ok: true, projection };
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
  },
): { ok: true; orderBy: unknown } | { ok: false; error: string } => {
  if (sorts.length === 0) return { ok: true, orderBy: sql`r.id ASC` };

  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const computedColumnsByLabel = new Map(columns.filter((column) => column.type === "formula").map((column) => [column.label, column]));
  const joinedColumnsByLabel = new Map(columns.filter((column) => column.joinAlias).map((column) => [column.label, column]));
  const orderParts: unknown[] = [];

  for (const sort of sorts) {
    const dir = sort.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = sort.direction === "asc" ? sql`NULLS FIRST` : sql`NULLS LAST`;
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
      const projection = sortProjectionForField(field, recordAlias, { fields: joinedFields, timeZone: options.timeZone });
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
    const projection = sortProjectionForField(field, "r", { fields, timeZone: options.timeZone });
    if (!projection.ok) return projection;
    orderParts.push(sql`${projection.projection} ${dir} ${nulls}`);
  }

  const idDir = sorts[0]?.direction === "desc" ? sql`DESC` : sql`ASC`;
  orderParts.push(sql`r.id ${idDir}`);
  return { ok: true, orderBy: joinFragments(orderParts, sql`, `) };
};

const joinRecordAlias = (index: number): string => `jq${index}`;
const joinLinkAlias = (index: number): string => `jql${index}`;
const boundedPositiveInt = (value: number | undefined, fallback: number, max: number): number =>
  Math.min(Math.max(value ?? fallback, 1), max);

const compileRelationJoin = (
  join: DslResolvedRelationJoin,
  index: number,
  joinAliases: Map<string, string>,
  options: Pick<DslSqlCompileOptions, "joinFanoutLimit"> = {},
): { ok: true; fragment: unknown; recordAlias: string } | { ok: false; error: string } => {
  const fromAlias = join.fromScope ? joinAliases.get(join.fromScope) : "r";
  if (!fromAlias) return { ok: false, error: `join "${join.alias}" depends on unknown join alias "${join.fromScope}"` };

  const linkAlias = joinLinkAlias(index);
  const recordAlias = joinRecordAlias(index);
  const joinSql = join.mode === "left" ? sql`LEFT JOIN` : sql`JOIN`;
  const fanoutLimit = options.joinFanoutLimit ? boundedPositiveInt(options.joinFanoutLimit, 50, 500) : null;
  const linkJoin = fanoutLimit
    ? sql`
      ${joinSql} LATERAL (
        SELECT _dsl_link.to_record_id
        FROM grids.record_links _dsl_link
        WHERE _dsl_link.from_record_id = ${sql.unsafe(fromAlias)}.id
          AND _dsl_link.from_field_id = ${join.relationFieldId}::uuid
        ORDER BY _dsl_link.to_record_id
        LIMIT ${fanoutLimit}
      ) ${sql.unsafe(linkAlias)} ON TRUE
    `
    : sql`
      ${joinSql} grids.record_links ${sql.unsafe(linkAlias)}
        ON ${sql.unsafe(linkAlias)}.from_record_id = ${sql.unsafe(fromAlias)}.id
       AND ${sql.unsafe(linkAlias)}.from_field_id = ${join.relationFieldId}::uuid
    `;

  return {
    ok: true,
    recordAlias,
    fragment: sql`
      ${linkJoin}
      ${joinSql} grids.records ${sql.unsafe(recordAlias)}
        ON ${sql.unsafe(recordAlias)}.id = ${sql.unsafe(linkAlias)}.to_record_id
       AND ${sql.unsafe(recordAlias)}.table_id = ${join.tableId}::uuid
       AND ${sql.unsafe(recordAlias)}.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM grids.tables ${sql.unsafe(`${recordAlias}_t`)}
         JOIN grids.bases ${sql.unsafe(`${recordAlias}_b`)}
           ON ${sql.unsafe(`${recordAlias}_b`)}.id = ${sql.unsafe(`${recordAlias}_t`)}.base_id
          AND ${sql.unsafe(`${recordAlias}_b`)}.deleted_at IS NULL
         WHERE ${sql.unsafe(`${recordAlias}_t`)}.id = ${sql.unsafe(recordAlias)}.table_id
           AND ${sql.unsafe(`${recordAlias}_t`)}.deleted_at IS NULL
       )
    `,
  };
};

const joinFragments = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
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

  const selectFragments: unknown[] = [sql`r.id::text AS __record_id`, sql`r.table_id::text AS __table_id`];
  const columns: DslSqlOutputColumn[] = [];
  const baseColumns: NonNullable<ViewQuery["columns"]> = plan.query.columns?.length
    ? plan.query.columns
    : baseFields
        .filter((field) => isImplicitlySelectableField(field) && relationTargetIsReadable(field, plan.readableTableIds))
        .map((field) => ({ fieldId: field.id }));
  let index = 0;

  for (const column of baseColumns) {
    if (isComputedColumn(column)) {
      const compiled = compileFormulaColumn({
        expression: column.expression,
        label: column.label,
        fields: baseFields,
        recordAlias: "r",
        index,
        timeZone: options.timeZone,
      });
      if (!compiled.ok) return fail(`select "${column.label}": ${compiled.error}`);
      selectFragments.push(compiled.fragment);
      columns.push(compiled.column);
      index += 1;
      continue;
    }
    if (!isFieldColumn(column)) return fail("unsupported select column");
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
    });
    if (!compiled.ok) return fail(compiled.error);
    selectFragments.push(compiled.fragment);
    columns.push(compiled.column);
    index += 1;
  }

  for (const joined of plan.joinedColumns ?? []) {
    const recordAlias = joinAliases.get(joined.joinAlias);
    if (!recordAlias) return fail(`joined column uses unknown join alias "${joined.joinAlias}"`);
    const compiled = compileJoinedColumn({
      joinedColumn: joined,
      fieldsByTableId: options.fieldsByTableId,
      recordAlias,
      index,
      timeZone: options.timeZone,
      readableTableIds: plan.readableTableIds,
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
        })
      : compileSort(plan.query.sort ?? [], baseFields, null);
  if (!sort.ok) return fail(`sort: ${sort.error}`);
  const orderBy = "result" in sort ? sort.result.orderBy : sort.orderBy;

  const conditions: unknown[] = [sql`r.table_id = ${plan.tableId}::uuid`, sql`r.deleted_at IS NULL`, renderClause(filter.clause)];
  if (plan.formulaWhere) {
    const compiled = compileFormulaPredicateAstToSql(plan.formulaWhere.expression, {
      fields: baseFields,
      recordAlias: "r",
      dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
    });
    if (!compiled.ok) return fail(`where formula: ${compiled.error}`);
    conditions.push(compiled.expression.sql);
  }
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

const hasGroupedShape = (plan: DslResolvedSqlQueryPlan): boolean =>
  (plan.query.groupBy?.length ?? 0) > 0 ||
  (plan.query.aggregations?.length ?? 0) > 0 ||
  (plan.formulaAggregations?.length ?? 0) > 0 ||
  Boolean(plan.formulaHaving);

const compileGroupExtraWhere = (
  plan: DslResolvedSqlQueryPlan,
  fields: Field[],
  options: DslSqlCompileOptions,
): { ok: true; where?: unknown } | { ok: false; error: string } => {
  if (!plan.formulaWhere) return { ok: true };
  const compiled = compileFormulaPredicateAstToSql(plan.formulaWhere.expression, {
    fields,
    recordAlias: "r",
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
  });
  if (!compiled.ok) return { ok: false, error: `where formula: ${compiled.error}` };
  return { ok: true, where: compiled.expression.sql };
};

const compileFormulaAggregateColumn = (
  aggregation: DslFormulaAggregation,
  fields: Field[],
  options: DslSqlCompileOptions,
): { ok: true; key: string; expr: unknown } | { ok: false; error: string } => {
  const compiled = compileFormulaAstToSql(aggregation.expression, {
    fields,
    recordAlias: "r",
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
  });
  if (!compiled.ok) return { ok: false, error: `formula aggregate "${aggregation.id}": ${compiled.error}` };
  const expression = compiled.expression.sql;
  const key = aggregateKey(aggregation);

  switch (aggregation.agg) {
    case "count":
      return {
        ok: true,
        key,
        expr: sql`COUNT(${expression}) FILTER (WHERE ${expression} IS NOT NULL AND (${expression})::text <> '')`,
      };
    case "countEmpty":
      return { ok: true, key, expr: sql`COUNT(*) FILTER (WHERE ${expression} IS NULL OR (${expression})::text = '')` };
    case "countUnique":
      return {
        ok: true,
        key,
        expr: sql`COUNT(DISTINCT ${expression}) FILTER (WHERE ${expression} IS NOT NULL AND (${expression})::text <> '')`,
      };
    case "sum":
      return { ok: true, key, expr: sql`SUM((${expression})::numeric)` };
    case "avg":
      return { ok: true, key, expr: sql`AVG((${expression})::numeric)` };
    case "min":
      return { ok: true, key, expr: sql`MIN(${expression})` };
    case "max":
      return { ok: true, key, expr: sql`MAX(${expression})` };
  }
};

const groupColumnsFor = (
  plan: DslResolvedSqlQueryPlan,
  fields: Field[],
  aggregations: GroupAggregationSpec[],
): DslSqlGroupOutputColumn[] => {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const groups = (plan.query.groupBy ?? []).map((group, index): DslSqlGroupOutputColumn => {
    const field = fieldsById.get(group.fieldId);
    return {
      kind: "group",
      key: groupKey(index),
      label: group.label ?? field?.name ?? group.fieldId,
      fieldId: group.fieldId,
      type: field?.type ?? "unknown",
      sqlType: field ? outputTypeFor(field) : "json",
    };
  });
  const aggregateLabels = new Map<string, string>();
  for (const aggregation of plan.query.aggregations ?? []) {
    aggregateLabels.set(
      aggregateKeyFromParts(aggregation.fieldId, aggregation.agg),
      aggregation.label ?? `${aggregation.agg} ${aggregation.fieldId}`,
    );
  }
  for (const aggregation of plan.formulaAggregations ?? []) {
    aggregateLabels.set(aggregateKey(aggregation), aggregation.id);
  }
  const aggregateColumns = aggregations.map(
    (aggregation): DslSqlGroupOutputColumn => ({
      kind: "aggregate",
      key: aggregateKey(aggregation),
      label: aggregateLabels.get(aggregateKey(aggregation)) ?? aggregateKey(aggregation),
      fieldId: isFormulaGroupAggregation(aggregation) ? aggregation.id : aggregation.fieldId,
      agg: aggregation.agg,
      sqlType: aggregateSqlType(aggregation, fieldsById),
    }),
  );
  return [...groups, ...aggregateColumns];
};

const toGroupAggregations = (
  plan: DslResolvedSqlQueryPlan,
): { ok: true; aggregations: GroupAggregationSpec[] } | { ok: false; error: string } => {
  const aggregations: GroupAggregationSpec[] = [];
  for (const aggregation of plan.query.aggregations ?? []) {
    if (!isGroupAggKind(aggregation.agg)) return { ok: false, error: `group aggregate "${aggregation.agg}" is not supported` };
    aggregations.push({ fieldId: aggregation.fieldId, agg: aggregation.agg } satisfies GroupFieldAggregation);
  }
  aggregations.push(...((plan.formulaAggregations ?? []) as DslFormulaAggregation[]));
  return { ok: true, aggregations };
};

export const compileDslGroupedQueryPlanToSql = (plan: DslResolvedSqlQueryPlan, options: DslSqlCompileOptions): DslSqlGroupCompileResult => {
  if (!hasGroupedShape(plan)) return failGroup("query is not grouped");
  if ((plan.joins?.length ?? 0) > 0 || (plan.joinedColumns?.length ?? 0) > 0) {
    return failGroup("grouped DSL queries with relation joins are not compiled yet");
  }
  if ((plan.query.columns?.length ?? 0) > 0) {
    return failGroup("grouped DSL queries use group and aggregate output, not select columns");
  }
  const groupBy = plan.query.groupBy ?? [];
  if (groupBy.length === 0) return failGroup("grouped DSL query needs at least one group field");

  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const extraWhere = compileGroupExtraWhere(plan, fields, options);
  if (!extraWhere.ok) return failGroup(extraWhere.error);

  const aggregations = toGroupAggregations(plan);
  if (!aggregations.ok) return failGroup(aggregations.error);
  const compiled = compileGroupQuery({
    tableId: plan.tableId,
    fields,
    groupBy,
    aggregations: aggregations.aggregations,
    groupSort: [...(plan.query.groupSort ?? []), ...(plan.formulaGroupSort ?? [])],
    having: plan.formulaHaving?.expression,
    havingRefs: plan.formulaHaving?.aggregateRefs as GroupHavingRef[] | undefined,
    filter: plan.query.filter ?? null,
    extraWhere: extraWhere.where,
    limit: options.limit ?? plan.query.limit,
    offset: plan.offset,
    timeZone: options.timeZone,
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
    baseRecordLimit: options.previewBaseLimit,
  });
  if (!compiled.ok) return failGroup(compiled.error);

  return {
    ok: true,
    query: {
      sql: compiled.query,
      columns: groupColumnsFor(plan, fields, aggregations.aggregations),
      limit: Math.min(Math.max(options.limit ?? plan.query.limit ?? 100, 1), 1000),
      offset: Math.min(Math.max(plan.offset ?? 0, 0), 10_000),
      cursorable: compiled.cursorable,
    },
  };
};

export const compileDslAggregateQueryPlanToSql = (
  plan: DslResolvedSqlQueryPlan,
  options: DslSqlCompileOptions,
): DslSqlAggregateCompileResult => {
  const aggregations = plan.query.aggregations ?? [];
  const formulaAggregations = plan.formulaAggregations ?? [];
  if (aggregations.length === 0 && formulaAggregations.length === 0) return failAggregate("query has no aggregate output");
  if ((plan.query.groupBy?.length ?? 0) > 0 || plan.formulaHaving) {
    return failAggregate("grouped DSL query execution belongs to the grouped compiler");
  }
  if ((plan.query.columns?.length ?? 0) > 0 || (plan.joinedColumns?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries cannot select row columns");
  }
  if ((plan.joins?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries with relation joins are not compiled yet");
  }
  if ((plan.query.sort?.length ?? 0) > 0 || (plan.sqlSort?.length ?? 0) > 0 || (plan.query.groupSort?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries cannot sort");
  }

  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const filter = compileFilter(plan.query.filter ?? null, fields, { timeZone: options.timeZone });
  if (!filter.ok) return failAggregate(`filter: ${filter.error}`);
  const aggregateCompiled = compileAggregates(aggregations, fields);
  if (!aggregateCompiled.ok) return failAggregate(`aggregate: ${aggregateCompiled.error}`);
  const extraWhere = compileGroupExtraWhere(plan, fields, options);
  if (!extraWhere.ok) return failAggregate(extraWhere.error);
  const formulaColumns: Array<{ key: string; expr: unknown }> = [];
  for (const aggregation of formulaAggregations) {
    const compiled = compileFormulaAggregateColumn(aggregation, fields, options);
    if (!compiled.ok) return failAggregate(compiled.error);
    formulaColumns.push(compiled);
  }
  const allAggregateColumns = [...aggregateCompiled.columns, ...formulaColumns];
  const jsonPairs = allAggregateColumns.map((column) => sql`${column.key}::text, ${column.expr}`);
  if (jsonPairs.length === 0) return failAggregate("query has no aggregate output");
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const columns: DslSqlAggregateOutputColumn[] = aggregations.map(
    (aggregation): DslSqlAggregateOutputColumn => ({
      key: `${aggregation.fieldId}__${aggregation.agg}`,
      label: aggregation.label ?? `${aggregation.agg} ${aggregation.fieldId}`,
      fieldId: aggregation.fieldId,
      agg: aggregation.agg,
      sqlType: viewAggregateSqlType(aggregation, fieldsById),
    }),
  );
  for (const aggregation of formulaAggregations) {
    columns.push({
      key: aggregateKey(aggregation),
      label: aggregation.id,
      fieldId: aggregation.id,
      agg: aggregation.agg,
      sqlType: formulaAggregateSqlType(aggregation),
    });
  }

  const where = sql`r.table_id = ${plan.tableId}::uuid
    AND r.deleted_at IS NULL
    AND ${renderClause(filter.clause)}
    AND ${extraWhere.where ?? sql`TRUE`}`;
  const source = options.previewBaseLimit
    ? sql`(
        SELECT r.*
        FROM grids.records r
        WHERE ${where}
        ORDER BY r.id ASC
        LIMIT ${boundedPositiveInt(options.previewBaseLimit, 5000, 50_000)}
      ) r`
    : sql`grids.records r`;
  const outerWhere = options.previewBaseLimit ? sql`TRUE` : where;

  return {
    ok: true,
    query: {
      sql: sql`
        SELECT jsonb_build_object(${joinFragments(jsonPairs, sql`, `)}) AS result
        FROM ${source}
        JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE ${outerWhere}
      `,
      columns,
      limit: 1,
      offset: 0,
    },
  };
};
