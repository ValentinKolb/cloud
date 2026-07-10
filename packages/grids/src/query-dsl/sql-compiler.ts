import { sql } from "bun";
import { normalizeRefKey } from "../ref-syntax";
import { aggregateOutputKey } from "../service/aggregate-capabilities";
import { compileFormulaPredicateAstToSql, type FormulaSqlFieldResolver, type FormulaSqlType } from "../service/formula-sql-compiler";
import { relationLabelFields } from "../service/relations";
import { compileDirectFieldSearchClause, escapeSearchLikePattern, optionIdsMatchingSearch } from "../service/search";
import { assertSqlIdentifier } from "../service/sql-ident";
import type {
  DslDerivedViewAggregation,
  DslDerivedViewColumn,
  DslDerivedViewGroupBy,
  DslResolvedDerivedRelationJoin,
  DslResolvedSqlQueryPlan,
} from "./resolver";
import { createDslScopedFormulaFieldResolver } from "./scoped-formula";
import { compileDslAggregateQueryPlanToSql } from "./sql-compiler-aggregate";
import {
  aliveFields,
  compileJoinedColumn,
  computedFieldSqlForScope,
  fieldById,
  relationTargetIsReadable,
  sortProjectionForField,
} from "./sql-compiler-fields";
import { joinFragments } from "./sql-compiler-fragments";
import { compileDslGroupedQueryPlanToSql } from "./sql-compiler-grouped";
import {
  aggregateExprForField,
  aggregateKey,
  compileFormulaAggregateColumn,
  formulaAggregateSqlType,
  groupFieldProjection,
  sqlGroupKey,
} from "./sql-compiler-grouping";
import { compileRelationJoin } from "./sql-compiler-joins";
import type { DslSqlCompileOptions, DslSqlGroupCompileResult, DslSqlGroupOutputColumn, DslSqlOutputColumn } from "./sql-compiler-types";

export { dslJoinRecordAlias } from "./sql-compiler-joins";
export { compileDslQueryPlanToSql } from "./sql-compiler-row";
export type { DslSqlAggregateOutputColumn, DslSqlGroupOutputColumn, DslSqlOutputColumn } from "./sql-compiler-types";
export { compileDslAggregateQueryPlanToSql, compileDslGroupedQueryPlanToSql };

const failGroup = (error: string): DslSqlGroupCompileResult => ({ ok: false, error });

const quotedIdentifier = (value: string): unknown => sql.unsafe(`"${assertSqlIdentifier(value)}"`);

const derivedColumnReference = (column: DslDerivedViewColumn, alias = "d"): unknown =>
  sql`${sql.unsafe(`${alias}."${assertSqlIdentifier(column.key)}"`)}`;

export const dslDerivedJoinRecordAlias = (index: number): string => `dj${index}`;
const derivedJoinTableAlias = (index: number): string => `djt${index}`;
const derivedJoinBaseAlias = (index: number): string => `djb${index}`;

const compileDerivedRelationJoin = (
  join: DslResolvedDerivedRelationJoin,
  index: number,
): { ok: true; fragment: unknown; recordAlias: string } | { ok: false; error: string } => {
  if (!join.column.targetTableId) return { ok: false, error: `derived join "${join.alias}" has no target table` };
  if (join.column.targetTableId !== join.tableId) {
    return { ok: false, error: `derived join "${join.alias}" target table does not match derived column "${join.column.label}"` };
  }
  const joinSql = join.mode === "left" ? sql`LEFT JOIN` : sql`JOIN`;
  const recordAlias = dslDerivedJoinRecordAlias(index);
  const tableAlias = derivedJoinTableAlias(index);
  const baseAlias = derivedJoinBaseAlias(index);
  return {
    ok: true,
    recordAlias,
    fragment: sql`
      ${joinSql} grids.records ${sql.unsafe(recordAlias)}
        ON ${sql.unsafe(recordAlias)}.id = (${derivedColumnReference(join.column)})::uuid
       AND ${sql.unsafe(recordAlias)}.table_id = ${join.tableId}::uuid
       AND ${sql.unsafe(recordAlias)}.deleted_at IS NULL
      ${joinSql} grids.tables ${sql.unsafe(tableAlias)}
        ON ${sql.unsafe(tableAlias)}.id = ${sql.unsafe(recordAlias)}.table_id
       AND ${sql.unsafe(tableAlias)}.deleted_at IS NULL
      ${joinSql} grids.bases ${sql.unsafe(baseAlias)}
        ON ${sql.unsafe(baseAlias)}.id = ${sql.unsafe(tableAlias)}.base_id
       AND ${sql.unsafe(baseAlias)}.deleted_at IS NULL
    `,
  };
};

const joinedOutputAsGroupColumn = (column: DslSqlOutputColumn): DslSqlGroupOutputColumn => ({
  kind: "group",
  key: column.key,
  label: column.label,
  fieldId: column.fieldId ?? column.key,
  tableId: column.tableId,
  type: column.type,
  sqlType: column.sqlType,
});

const compileDerivedJoinedSort = (
  sorts: NonNullable<NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>["joinedSort"]>,
  options: DslSqlCompileOptions,
  joinAliases: Map<string, string>,
  readableTableIds?: readonly string[],
): { ok: true; parts: unknown[] } | { ok: false; error: string } => {
  const parts: unknown[] = [];
  for (const sort of sorts) {
    const recordAlias = joinAliases.get(sort.joinAlias);
    if (!recordAlias) return { ok: false, error: `joined sort uses unknown join alias "${sort.joinAlias}"` };
    const fields = aliveFields(options.fieldsByTableId[sort.tableId] ?? []);
    const field = fieldById(fields, sort.fieldId);
    if (!field) return { ok: false, error: `joined sort field ${sort.fieldId} is not available` };
    if (!relationTargetIsReadable(field, readableTableIds)) {
      return { ok: false, error: `relation field "${field.name}" target table is not available` };
    }
    const projection = sortProjectionForField(field, recordAlias, {
      fields,
      timeZone: options.timeZone,
      computedFieldSql: computedFieldSqlForScope(options, sort.joinAlias),
    });
    if (!projection.ok) return projection;
    const dir = sort.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = sort.nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    parts.push(sql`${projection.projection} ${dir} ${nulls}`);
  }
  return { ok: true, parts };
};

const derivedColumnFormulaSqlType = (column: DslDerivedViewColumn): FormulaSqlType =>
  column.sqlType === "json" ? "unknown" : column.sqlType;

const derivedColumnByRef = (columns: DslDerivedViewColumn[], ref: string): DslDerivedViewColumn | string => {
  const key = normalizeRefKey(ref);
  const matches = columns.filter((column) => column.refs.some((candidate) => normalizeRefKey(candidate) === key));
  if (matches.length === 0) return `unknown derived column "${ref}"`;
  if (matches.length > 1) return `ambiguous derived column "${ref}"`;
  return matches[0]!;
};

const createDerivedSqlFieldResolver =
  (
    columns: DslDerivedViewColumn[],
    options?: {
      joinAliases?: Map<string, string>;
      derived?: NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>;
      compileOptions?: DslSqlCompileOptions;
    },
  ): FormulaSqlFieldResolver =>
  (ref) => {
    if (options?.joinAliases && options.derived && options.compileOptions) {
      const scoped = createDslScopedFormulaFieldResolver({
        base: { fields: [], recordAlias: "d" },
        joins: [
          ...(options.derived.joins ?? []).map((join) => ({
            alias: join.alias,
            fields: aliveFields(options.compileOptions!.fieldsByTableId[join.tableId] ?? []),
            recordAlias: options.joinAliases!.get(join.alias) ?? join.alias,
            computedFieldSql: options.compileOptions!.computedFieldSqlByJoinAlias?.get(join.alias),
          })),
          ...(options.derived.relationJoins ?? []).map((join) => ({
            alias: join.alias,
            fields: aliveFields(options.compileOptions!.fieldsByTableId[join.tableId] ?? []),
            recordAlias: options.joinAliases!.get(join.alias) ?? join.alias,
            computedFieldSql: options.compileOptions!.computedFieldSqlByJoinAlias?.get(join.alias),
          })),
        ],
        dateConfig: options.compileOptions.timeZone ? { timeZone: options.compileOptions.timeZone } : undefined,
      })(ref);
      if (scoped) return scoped;
    }
    const column = derivedColumnByRef(columns, ref);
    if (typeof column === "string") return column;
    return { sql: derivedColumnReference(column), type: derivedColumnFormulaSqlType(column) };
  };

const derivedOutputColumn = (column: DslDerivedViewColumn): DslSqlGroupOutputColumn =>
  column.kind === "group"
    ? {
        kind: "group",
        key: column.key,
        label: column.label,
        fieldId: column.fieldId ?? column.key,
        type: column.type,
        sqlType: column.sqlType,
      }
    : {
        kind: "aggregate",
        key: column.key,
        label: column.label,
        fieldId: column.fieldId ?? column.key,
        agg: column.agg ?? "value",
        sqlType: derivedColumnFormulaSqlType(column),
      };

const derivedDefaultOrder = (derived: NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>): unknown[] => {
  const columnsByKey = new Map(derived.columns.map((column) => [column.key, column]));
  const parts: unknown[] = [];

  for (const sort of derived.query.groupSort ?? []) {
    const column = columnsByKey.get(aggregateOutputKey(sort.fieldId, sort.agg));
    if (column) parts.push(sql`${derivedColumnReference(column)} ${sort.direction === "desc" ? sql`DESC` : sql`ASC`} NULLS LAST`);
  }

  for (const [index, group] of (derived.query.groupBy ?? []).entries()) {
    const column = columnsByKey.get(sqlGroupKey(index));
    if (column) parts.push(sql`${derivedColumnReference(column)} ${group.direction === "desc" ? sql`DESC` : sql`ASC`} NULLS LAST`);
  }

  return parts;
};

const compileDerivedRelationSearchClause = (
  column: DslDerivedViewColumn,
  q: string,
  pattern: string,
  options: Pick<DslSqlCompileOptions, "fieldsByTableId">,
  readableTableIds?: readonly string[],
): unknown | null => {
  if (column.type !== "relation" || !column.targetTableId) return null;
  if (readableTableIds && !readableTableIds.includes(column.targetTableId)) return null;

  const fieldClauses = relationLabelFields(aliveFields(options.fieldsByTableId[column.targetTableId] ?? []))
    .map((field) => compileDirectFieldSearchClause(field, "target", q, pattern))
    .filter((clause): clause is NonNullable<typeof clause> => clause !== null);
  if (fieldClauses.length === 0) return null;
  const targetWhere = joinFragments(fieldClauses, sql` OR `);
  const relationId = sql`NULLIF(${derivedColumnReference(column)}::text, '')::uuid`;

  return sql`EXISTS (
    SELECT 1
    FROM grids.records target
    WHERE target.id = ${relationId}
      AND target.table_id = ${column.targetTableId}::uuid
      AND target.deleted_at IS NULL
      AND (${targetWhere})
  )`;
};

const compileDerivedSelectSearchClause = (
  column: DslDerivedViewColumn,
  q: string,
  options: Pick<DslSqlCompileOptions, "fieldsByTableId">,
  sourceTableId: string,
): unknown | null => {
  if (column.type !== "select" || !column.fieldId) return null;
  const field = aliveFields(options.fieldsByTableId[sourceTableId] ?? []).find((candidate) => candidate.id === column.fieldId);
  if (!field) return null;
  const ids = optionIdsMatchingSearch(field, q);
  if (ids.length === 0) return null;
  return sql`(${derivedColumnReference(column)}::text = ANY(${sql.array(ids, "TEXT")}))`;
};

const compileDerivedSearchColumnClause = (
  column: DslDerivedViewColumn,
  q: string,
  pattern: string,
  options: Pick<DslSqlCompileOptions, "fieldsByTableId">,
  sourceTableId: string,
  readableTableIds?: readonly string[],
): unknown | null => {
  const relationClause = compileDerivedRelationSearchClause(column, q, pattern, options, readableTableIds);
  if (relationClause) return relationClause;
  if (column.type === "relation" && column.targetTableId) return null;
  const selectClause = compileDerivedSelectSearchClause(column, q, options, sourceTableId);
  if (selectClause) return selectClause;
  if (column.type === "select") return null;
  return sql`(${derivedColumnReference(column)}::text ILIKE ${pattern} ESCAPE '\\')`;
};

const compileDerivedSearchClause = (
  search: NonNullable<NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>["search"]>,
  options: Pick<DslSqlCompileOptions, "fieldsByTableId">,
  sourceTableId: string,
  readableTableIds?: readonly string[],
): unknown => {
  const q = search.q.trim();
  if (!q) return sql`TRUE`;
  if (search.columns.length === 0) return sql`FALSE`;
  const pattern = `%${escapeSearchLikePattern(q)}%`;
  const clauses = search.columns
    .map((column) => compileDerivedSearchColumnClause(column, q, pattern, options, sourceTableId, readableTableIds))
    .filter((clause): clause is NonNullable<typeof clause> => clause !== null);
  if (clauses.length === 0) return sql`FALSE`;
  return sql`(${joinFragments(clauses, sql` OR `)})`;
};

const compileDerivedSearchCondition = (
  derived: NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>,
  options: Pick<DslSqlCompileOptions, "fieldsByTableId">,
  sourceTableId: string,
  joinedSearchClause?: unknown,
  readableTableIds?: readonly string[],
): unknown | null => {
  const parts: unknown[] = [];
  if (derived.search) parts.push(compileDerivedSearchClause(derived.search, options, sourceTableId, readableTableIds));
  if (joinedSearchClause) parts.push(joinedSearchClause);
  return parts.length > 0 ? sql`(${joinFragments(parts, sql` OR `)})` : null;
};

const derivedGroupExpression = (group: DslDerivedViewGroupBy): unknown => {
  if (group.kind !== "derived") return sql`NULL`;
  const ref = derivedColumnReference(group.column);
  if (!group.granularity) return ref;
  const dateExpr = group.column.sqlType === "datetime" ? sql`${ref} AT TIME ZONE 'UTC'` : sql`${ref}::timestamp`;
  return sql`date_trunc(${group.granularity}, ${dateExpr})::date`;
};

const derivedGroupOutputColumn = (group: DslDerivedViewGroupBy): DslSqlGroupOutputColumn =>
  group.kind === "derived"
    ? {
        kind: "group",
        key: group.key,
        label: group.label,
        fieldId: group.column.fieldId ?? group.column.key,
        type: group.type,
        sqlType: group.sqlType,
      }
    : {
        kind: "group",
        key: group.key,
        label: group.label,
        fieldId: group.fieldId,
        tableId: group.tableId,
        type: group.type,
        sqlType: group.sqlType,
      };

const compileDerivedGroupExpression = (
  group: DslDerivedViewGroupBy,
  index: number,
  options: DslSqlCompileOptions,
  joinAliases: Map<string, string>,
): { ok: true; expr: unknown; joins?: unknown[] } | { ok: false; error: string } => {
  if (group.kind === "derived") return { ok: true, expr: derivedGroupExpression(group) };
  const recordAlias = joinAliases.get(group.joinAlias);
  if (!recordAlias) return { ok: false, error: `group field uses unknown join alias "${group.joinAlias}"` };
  const fields = aliveFields(options.fieldsByTableId[group.tableId] ?? []);
  const field = fieldById(fields, group.fieldId);
  if (!field) return { ok: false, error: `group field ${group.fieldId} is not available` };
  return groupFieldProjection(group, field, recordAlias, options, index);
};

const derivedAggregateOutputColumn = (aggregation: DslDerivedViewAggregation): DslSqlGroupOutputColumn => ({
  kind: "aggregate",
  key: aggregation.key,
  label: aggregation.label,
  fieldId: aggregation.fieldId,
  agg: aggregation.agg,
  sqlType: aggregation.sqlType,
});

const derivedAggregateExpression = (
  aggregation: DslDerivedViewAggregation,
  options: DslSqlCompileOptions,
  joinAliases: Map<string, string>,
): { ok: true; expr: unknown; type: FormulaSqlType } | { ok: false; error: string } => {
  if (aggregation.fieldId === "*") {
    if (aggregation.agg !== "count") return { ok: false, error: `agg "${aggregation.agg}" requires a derived column` };
    return { ok: true, expr: sql`COUNT(*)::bigint`, type: "numeric" };
  }
  if (aggregation.joinAlias) {
    const recordAlias = joinAliases.get(aggregation.joinAlias);
    if (!recordAlias) return { ok: false, error: `aggregate uses unknown join alias "${aggregation.joinAlias}"` };
    const fields = aliveFields(options.fieldsByTableId[aggregation.tableId ?? ""] ?? []);
    const field = fieldById(fields, aggregation.fieldId);
    const compiled = aggregateExprForField(aggregation, field ?? null, recordAlias);
    return compiled.ok ? { ok: true, expr: compiled.expr, type: compiled.sqlType } : compiled;
  }
  const column = aggregation.column;
  if (!column) return { ok: false, error: `aggregate "${aggregation.label}" has no derived column` };
  const value = derivedColumnReference(column);
  const typed = derivedColumnFormulaSqlType(column);

  switch (aggregation.agg) {
    case "count":
      return {
        ok: true,
        expr: sql`COUNT(${value}) FILTER (WHERE ${value} IS NOT NULL AND (${value})::text <> '')::bigint`,
        type: "numeric",
      };
    case "countEmpty":
      return { ok: true, expr: sql`COUNT(*) FILTER (WHERE ${value} IS NULL OR (${value})::text = '')::bigint`, type: "numeric" };
    case "countUnique":
      return {
        ok: true,
        expr: sql`COUNT(DISTINCT ${value}) FILTER (WHERE ${value} IS NOT NULL AND (${value})::text <> '')::bigint`,
        type: "numeric",
      };
    case "sum":
      return { ok: true, expr: sql`SUM((${value})::numeric)`, type: "numeric" };
    case "avg":
      return { ok: true, expr: sql`AVG((${value})::numeric)`, type: "numeric" };
    case "median":
      return { ok: true, expr: sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${value})::numeric)`, type: "numeric" };
    case "min":
    case "earliest":
      return { ok: true, expr: sql`MIN(${value})`, type: typed };
    case "max":
    case "latest":
      return { ok: true, expr: sql`MAX(${value})`, type: typed };
  }
};

const derivedOrderNulls = (nullsFirst: boolean | undefined): unknown => (nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`);

const compileDslDerivedGroupedViewSourcePlanToSql = (
  plan: DslResolvedSqlQueryPlan,
  sourceSql: unknown,
  options: DslSqlCompileOptions,
  joins: { joinAliases: Map<string, string>; joinSql: unknown[] },
): DslSqlGroupCompileResult => {
  const derived = plan.derivedViewSource;
  if (!derived) return failGroup("query is not a derived view source");

  const conditions: unknown[] = [];
  if (derived.where) {
    const compiled = compileFormulaPredicateAstToSql(derived.where.expression, {
      fields: [],
      recordAlias: "d",
      resolveField: createDerivedSqlFieldResolver(derived.columns, { derived, joinAliases: joins.joinAliases, compileOptions: options }),
    });
    if (!compiled.ok) return failGroup(`where: ${compiled.error}`);
    conditions.push(compiled.expression.sql);
  }
  const searchCondition = compileDerivedSearchCondition(derived, options, plan.tableId, options.searchClause, plan.readableTableIds);
  if (searchCondition) conditions.push(searchCondition);
  const where = conditions.length > 0 ? sql`WHERE ${conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`)}` : sql``;

  const groupBy = derived.groupBy ?? [];
  const aggregateRequests = [...(derived.aggregations ?? [])];
  if (groupBy.length > 0 && !aggregateRequests.some((aggregation) => aggregation.key === aggregateOutputKey("*", "count"))) {
    aggregateRequests.unshift({
      key: aggregateOutputKey("*", "count"),
      label: "# records",
      fieldId: "*",
      agg: "count",
      sqlType: "numeric",
    });
  }

  const selectParts: unknown[] = [];
  const groupExprs: unknown[] = [];
  const groupColumns: DslSqlGroupOutputColumn[] = [];
  for (const [index, group] of groupBy.entries()) {
    const compiled = compileDerivedGroupExpression(group, index, options, joins.joinAliases);
    if (!compiled.ok) return failGroup(compiled.error);
    groupExprs.push(compiled.expr);
    selectParts.push(sql`${compiled.expr} AS ${quotedIdentifier(group.key)}`);
    if (compiled.joins) joins.joinSql.push(...compiled.joins);
    groupColumns.push(derivedGroupOutputColumn(group));
  }

  const aggregateColumns: DslSqlGroupOutputColumn[] = [];
  const aggregateExprsByKey = new Map<string, { expr: unknown; type: FormulaSqlType }>();
  for (const aggregation of aggregateRequests) {
    const compiled = derivedAggregateExpression(aggregation, options, joins.joinAliases);
    if (!compiled.ok) return failGroup(compiled.error);
    aggregateExprsByKey.set(aggregation.key, { expr: compiled.expr, type: compiled.type });
    selectParts.push(sql`${compiled.expr} AS ${quotedIdentifier(aggregation.key)}`);
    aggregateColumns.push(derivedAggregateOutputColumn(aggregation));
  }
  for (const aggregation of derived.formulaAggregations ?? []) {
    const compiled = compileFormulaAggregateColumn(
      aggregation,
      [],
      options,
      createDerivedSqlFieldResolver(derived.columns, { derived, joinAliases: joins.joinAliases, compileOptions: options }),
    );
    if (!compiled.ok) return failGroup(compiled.error);
    const type = formulaAggregateSqlType(aggregation);
    aggregateExprsByKey.set(compiled.key, { expr: compiled.expr, type });
    selectParts.push(sql`${compiled.expr} AS ${quotedIdentifier(compiled.key)}`);
    aggregateColumns.push({
      kind: "aggregate",
      key: compiled.key,
      label: aggregation.id,
      fieldId: aggregation.id,
      agg: aggregation.agg,
      sqlType: type,
    });
  }
  if (selectParts.length === 0) return failGroup("derived aggregate query needs aggregate output");

  const having =
    derived.having && aggregateExprsByKey.size > 0
      ? compileFormulaPredicateAstToSql(derived.having.expression, {
          fields: [],
          resolveField: (ref) => {
            const aggregate = derived.having?.aggregateRefs.find((item) => normalizeRefKey(item.ref) === normalizeRefKey(ref));
            if (!aggregate) return null;
            const resolved = aggregateExprsByKey.get(aggregateKey(aggregate));
            return resolved ? { sql: resolved.expr, type: resolved.type } : null;
          },
        })
      : null;
  if (having && !having.ok) return failGroup(`having: ${having.error}`);

  const groupBySql = groupExprs.map((_, index) => sql.unsafe(String(index + 1)));
  const groupByClause = groupBySql.length > 0 ? sql`GROUP BY ${joinFragments(groupBySql, sql`, `)}` : sql``;
  const havingClause = having && having.ok ? sql`HAVING ${having.expression.sql}` : sql``;
  const explicitOrder: unknown[] = [];
  for (const sort of derived.groupSort ?? []) {
    const resolved = aggregateExprsByKey.get(sort.key);
    if (!resolved) return failGroup(`group sort references missing aggregate "${sort.key}"`);
    explicitOrder.push(
      sql`${quotedIdentifier(sort.key)} ${sort.direction === "desc" ? sql`DESC` : sql`ASC`} ${derivedOrderNulls(sort.nullsFirst)}`,
    );
  }
  for (const group of groupBy) {
    const dir = group.direction === "desc" ? sql`DESC` : sql`ASC`;
    explicitOrder.push(sql`${quotedIdentifier(group.key)} ${dir} ${derivedOrderNulls(group.nullsFirst)}`);
  }
  const orderBy = explicitOrder.length > 0 ? sql`ORDER BY ${joinFragments(explicitOrder, sql`, `)}` : sql``;
  const aggregateOnly = groupBy.length === 0;
  const limit = aggregateOnly ? 1 : Math.min(Math.max(options.limit ?? plan.query.limit ?? 100, 1), 1000);
  const offset = aggregateOnly ? 0 : Math.min(Math.max(plan.offset ?? 0, 0), 10_000);

  return {
    ok: true,
    query: {
      sql: sql`
        SELECT ${joinFragments(selectParts, sql`, `)}
        FROM (${sourceSql}) d
        ${joinFragments(joins.joinSql, sql` `)}
        ${where}
        ${groupByClause}
        ${havingClause}
        ${orderBy}
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      columns: [...groupColumns, ...aggregateColumns],
      limit,
      offset,
      cursorable: false,
    },
  };
};

const aggregateResultProjection = (column: DslDerivedViewColumn, sourceAlias = "a"): unknown => {
  const value = sql`${sql.unsafe(sourceAlias)}.result->>${column.key}`;
  switch (derivedColumnFormulaSqlType(column)) {
    case "numeric":
      return sql`grids.try_numeric(${value})`;
    case "boolean":
      return sql`(${value})::boolean`;
    case "date":
      return sql`grids.try_iso_date(${value})`;
    case "datetime":
      return sql`grids.try_timestamptz(${value})`;
    case "text":
      return value;
    case "unknown":
      return sql`${sql.unsafe(sourceAlias)}.result->${column.key}`;
  }
};

export const compileDslDerivedViewSourcePlanToSql = (
  plan: DslResolvedSqlQueryPlan,
  options: DslSqlCompileOptions,
): DslSqlGroupCompileResult => {
  const derived = plan.derivedViewSource;
  if (!derived) return failGroup("query is not a derived view source");

  const sourcePlan: DslResolvedSqlQueryPlan = {
    source: plan.source,
    tableId: plan.tableId,
    query: derived.query,
    readableTableIds: plan.readableTableIds,
  };
  const sourceOptions = { ...options, limit: undefined, searchClause: options.viewSourceSearchClause };
  const sourceCompiled =
    (derived.query.groupBy?.length ?? 0) > 0
      ? compileDslGroupedQueryPlanToSql(sourcePlan, sourceOptions)
      : compileDslAggregateQueryPlanToSql(sourcePlan, sourceOptions);
  if (!sourceCompiled.ok) return failGroup(sourceCompiled.error);
  const sourceSql =
    (derived.query.groupBy?.length ?? 0) > 0
      ? sourceCompiled.query.sql
      : sql`
          SELECT ${joinFragments(
            derived.columns.map((column) => sql`${aggregateResultProjection(column)} AS ${quotedIdentifier(column.key)}`),
            sql`, `,
          )}
          FROM (${sourceCompiled.query.sql}) a
        `;

  const joinAliases = new Map<string, string>();
  const joinSql: unknown[] = [];
  for (const [index, join] of (derived.joins ?? []).entries()) {
    const compiled = compileDerivedRelationJoin(join, index);
    if (!compiled.ok) return failGroup(compiled.error);
    joinAliases.set(join.alias, compiled.recordAlias);
    joinSql.push(compiled.fragment);
  }
  for (const [index, join] of (derived.relationJoins ?? []).entries()) {
    if (join.fromScope === null) return failGroup(`join "${join.alias}" cannot use the derived view source as a record`);
    const compiled = compileRelationJoin(join, index, joinAliases, { joinFanoutLimit: options.joinFanoutLimit });
    if (!compiled.ok) return failGroup(compiled.error);
    joinAliases.set(join.alias, compiled.recordAlias);
    joinSql.push(compiled.fragment);
  }

  if ((derived.groupBy?.length ?? 0) > 0 || (derived.aggregations?.length ?? 0) > 0 || (derived.formulaAggregations?.length ?? 0) > 0) {
    return compileDslDerivedGroupedViewSourcePlanToSql(plan, sourceSql, options, { joinAliases, joinSql });
  }

  const selectFragments: unknown[] = derived.outputColumns.map(
    (column) => sql`${derivedColumnReference(column)} AS ${quotedIdentifier(column.key)}`,
  );
  const columns = derived.outputColumns.map(derivedOutputColumn);
  for (const joinedColumn of derived.joinedColumns ?? []) {
    const recordAlias = joinAliases.get(joinedColumn.joinAlias);
    if (!recordAlias) return failGroup(`joined column uses unknown join alias "${joinedColumn.joinAlias}"`);
    const compiled = compileJoinedColumn({
      joinedColumn,
      fieldsByTableId: options.fieldsByTableId,
      recordAlias,
      index: selectFragments.length,
      timeZone: options.timeZone,
      readableTableIds: plan.readableTableIds,
      computedFieldSql: computedFieldSqlForScope(options, joinedColumn.joinAlias),
    });
    if (!compiled.ok) return failGroup(compiled.error);
    selectFragments.push(compiled.fragment);
    columns.push(joinedOutputAsGroupColumn(compiled.column));
  }
  if (selectFragments.length === 0) return failGroup("derived view source has no output columns");

  const conditions: unknown[] = [];
  if (derived.where) {
    const compiled = compileFormulaPredicateAstToSql(derived.where.expression, {
      fields: [],
      recordAlias: "d",
      resolveField: createDerivedSqlFieldResolver(derived.columns, { derived, joinAliases, compileOptions: options }),
    });
    if (!compiled.ok) return failGroup(`where: ${compiled.error}`);
    conditions.push(compiled.expression.sql);
  }
  const searchCondition = compileDerivedSearchCondition(derived, options, plan.tableId, options.searchClause, plan.readableTableIds);
  if (searchCondition) conditions.push(searchCondition);
  const where = conditions.length > 0 ? sql`WHERE ${conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`)}` : sql``;

  const explicitOrder = derived.sort.map((sort) => {
    const dir = sort.direction === "desc" ? sql`DESC` : sql`ASC`;
    const nulls = sort.nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
    return sql`${derivedColumnReference(sort.column)} ${dir} ${nulls}`;
  });
  const joinedOrder = compileDerivedJoinedSort(derived.joinedSort ?? [], options, joinAliases, plan.readableTableIds);
  if (!joinedOrder.ok) return failGroup(joinedOrder.error);
  const orderParts =
    explicitOrder.length > 0 || joinedOrder.parts.length > 0 ? [...explicitOrder, ...joinedOrder.parts] : derivedDefaultOrder(derived);
  const orderBy = orderParts.length > 0 ? sql`ORDER BY ${joinFragments(orderParts, sql`, `)}` : sql``;
  const limit = Math.min(Math.max(options.limit ?? plan.query.limit ?? 100, 1), 1000);
  const offset = Math.min(Math.max(plan.offset ?? 0, 0), 10_000);

  return {
    ok: true,
    query: {
      sql: sql`
        SELECT ${joinFragments(selectFragments, sql`, `)}
        FROM (${sourceSql}) d
        ${joinFragments(joinSql, sql` `)}
        ${where}
        ${orderBy}
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      columns,
      limit,
      offset,
      cursorable: false,
    },
  };
};
