import { sql } from "bun";
import type { RecordQuery } from "../contracts";
import { normalizeRefKey } from "../ref-syntax";
import {
  aggregateOutputKey,
  aggregateOutputKeyFor,
  aggregateSqlTypeForField,
  aggregateSqlTypeForFormula,
  isAggregateKind,
  isFieldAggregatable,
  isFormulaAggregatable,
} from "../service/aggregate-capabilities";
import { compileAggregates } from "../service/aggregate-compiler";
import { groupSqlTypeForField, outputSqlTypeForField, storageOf } from "../service/field-storage";
import { compileFilter, renderClause } from "../service/filter-compiler";
import {
  compileFormulaAstToSql,
  compileFormulaPredicateAstToSql,
  compileFormulaSourceToSql,
  type FormulaSqlExpression,
  type FormulaSqlFieldResolver,
  type FormulaSqlType,
} from "../service/formula-sql-compiler";
import { compileGroupQuery, type GroupAggregationSpec, type GroupHavingRef } from "../service/group-compiler";
import { compileRecordMetaFilter, recordMetaRequiresDeletedRows } from "../service/record-metadata";
import { relationLabelFields } from "../service/relations";
import { compileDirectFieldSearchClause, escapeSearchLikePattern, optionIdsMatchingSearch } from "../service/search";
import { compileSort } from "../service/sort-compiler";
import { assertSqlIdentifier } from "../service/sql-ident";
import type { Field } from "../service/types";
import type {
  DslDerivedViewAggregation,
  DslDerivedViewColumn,
  DslDerivedViewGroupBy,
  DslFormulaAggregation,
  DslJoinedColumn,
  DslOutputColumn,
  DslResolvedDerivedRelationJoin,
  DslResolvedRelationJoin,
  DslResolvedSqlAggregation,
  DslResolvedSqlGroupBy,
  DslResolvedSqlQueryPlan,
  DslResolvedSqlSort,
  DslWherePredicate,
} from "./resolver";
import { createDslScopedFormulaFieldResolver } from "./scoped-formula";

// ── where predicate → SQL ────────────────────────────────────────────
// A DslWherePredicate mixes typed-filter leaves (compiled by the shared
// filter-compiler) and boolean formula leaves (compiled by the formula
// compiler). Both execute fully in SQL; this folds them into one
// boolean fragment combined with AND / OR / NOT.
const compileWherePredicate = (
  node: DslWherePredicate,
  fields: Field[],
  options: { timeZone?: string; computedFieldSql?: Map<string, FormulaSqlExpression>; resolveField?: FormulaSqlFieldResolver },
): { ok: true; sql: unknown } | { ok: false; error: string } => {
  switch (node.kind) {
    case "and":
    case "or": {
      const parts: unknown[] = [];
      for (const part of node.parts) {
        const compiled = compileWherePredicate(part, fields, options);
        if (!compiled.ok) return compiled;
        parts.push(sql`(${compiled.sql})`);
      }
      if (parts.length === 0) return { ok: true, sql: node.kind === "and" ? sql`TRUE` : sql`FALSE` };
      const separator = node.kind === "and" ? sql` AND ` : sql` OR `;
      return { ok: true, sql: joinFragments(parts, separator) };
    }
    case "not": {
      const compiled = compileWherePredicate(node.part, fields, options);
      if (!compiled.ok) return compiled;
      return { ok: true, sql: sql`(NOT (${compiled.sql}))` };
    }
    case "filter":
    case "tree": {
      const tree = node.kind === "tree" ? node.tree : node.leaf;
      const compiled = compileFilter(tree, fields, { timeZone: options.timeZone });
      if (!compiled.ok) return { ok: false, error: compiled.error };
      return { ok: true, sql: renderClause(compiled.clause) };
    }
    case "recordMeta":
      return { ok: true, sql: compileRecordMetaFilter(node.meta) };
    case "formula": {
      const compiled = compileFormulaPredicateAstToSql(node.expression, {
        fields,
        recordAlias: "r",
        dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
        computedFieldSql: options.computedFieldSql,
        resolveField: options.resolveField,
      });
      if (!compiled.ok) return { ok: false, error: compiled.error };
      return { ok: true, sql: compiled.expression.sql };
    }
  }
};

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
  joinFanoutLimit?: number;
  /** Pre-compiled full-text search predicate (built async by the caller via
   *  `compileSearchClause` since relation search needs viewer + a round-trip). */
  searchClause?: unknown;
  /** Pre-built SQL for lookup/rollup fields (by field id), so they can be
   *  selected, sorted, filtered, and used inside formulas. Built async by the
   *  caller (cross-table correlated subqueries). */
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  /** Pre-built lookup/rollup SQL for joined table scopes, keyed by GQL join alias. */
  computedFieldSqlByJoinAlias?: Map<string, Map<string, FormulaSqlExpression>>;
  /** Pre-compiled search predicate for the saved view used as source. */
  viewSourceSearchClause?: unknown;
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
      tableId?: string;
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

type RecordQueryColumn = NonNullable<RecordQuery["columns"]>[number];
type RecordQueryComputedColumn = Extract<RecordQueryColumn, { kind: "computed" }>;
type GroupAggKind = GroupAggregationSpec["agg"];
type GroupFieldAggregation = Extract<GroupAggregationSpec, { fieldId: string | "*" }>;

const ok = (query: DslSqlCompiledQuery): DslSqlCompileResult => ({ ok: true, query });
const fail = (error: string): DslSqlCompileResult => ({ ok: false, error });
const failGroup = (error: string): DslSqlGroupCompileResult => ({ ok: false, error });
const failAggregate = (error: string): DslSqlAggregateCompileResult => ({ ok: false, error });

const aliveFields = (fields: Field[]): Field[] => fields.filter((field) => !field.deletedAt).sort((a, b) => a.position - b.position);

const outputTypeFor = (field: Field): DslSqlOutputColumn["sqlType"] => {
  return outputSqlTypeForField(field);
};

const compileFormulaFieldProjection = (params: {
  field: Field;
  fields: Field[];
  recordAlias: string;
  timeZone?: string;
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  resolveField?: FormulaSqlFieldResolver;
}): { ok: true; projection: unknown; sqlType: FormulaSqlType } | { ok: false; error: string } => {
  const expression = (params.field.config as { expression?: unknown }).expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return { ok: false, error: `formula field "${params.field.name}" has no expression` };
  }
  const compiled = compileFormulaSourceToSql(expression, {
    fields: params.fields,
    recordAlias: params.recordAlias,
    dateConfig: params.timeZone ? { timeZone: params.timeZone } : undefined,
    computedFieldSql: params.computedFieldSql,
    resolveField: params.resolveField,
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
const aggregateKey = (aggregation: GroupAggregationSpec): string => aggregateOutputKeyFor(aggregation);
const isGroupAggKind = (agg: string): agg is GroupAggKind => isAggregateKind(agg);

const isComputedColumn = (column: RecordQueryColumn): column is RecordQueryComputedColumn => (column as { kind?: unknown }).kind === "computed";

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

const isImplicitlySelectableField = (field: Field): boolean => {
  const kind = storageOf(field).kind;
  if (kind === "unknown") return false;
  // Computed kinds: formula / lookup / rollup are projectable; file is not.
  if (kind === "computed") return field.type === "formula" || field.type === "lookup" || field.type === "rollup";
  return true;
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

const computedFieldSqlForScope = (
  options: Pick<DslSqlCompileOptions, "computedFieldSql" | "computedFieldSqlByJoinAlias">,
  joinAlias?: string,
): Map<string, FormulaSqlExpression> | undefined =>
  joinAlias ? options.computedFieldSqlByJoinAlias?.get(joinAlias) : options.computedFieldSql;

const aggregateSqlType = (aggregation: GroupAggregationSpec, fieldsById: Map<string, Field>): FormulaSqlType => {
  if (isFormulaGroupAggregation(aggregation)) {
    const formulaAggregation = aggregation as DslFormulaAggregation;
    return aggregateSqlTypeForFormula(formulaAggregation.sqlType, formulaAggregation.agg);
  }
  if (aggregation.fieldId === "*") return aggregateSqlTypeForField(null, aggregation.agg, true);
  const field = fieldsById.get(aggregation.fieldId);
  return aggregateSqlTypeForField(field ?? null, aggregation.agg, false);
};

const formulaAggregateSqlType = (aggregation: DslFormulaAggregation): FormulaSqlType => {
  return aggregateSqlTypeForFormula(aggregation.sqlType, aggregation.agg);
};

const viewAggregateSqlType = (
  aggregation: NonNullable<RecordQuery["aggregations"]>[number],
  fieldsById: Map<string, Field>,
): FormulaSqlType => {
  if (aggregation.fieldId === "*") return aggregateSqlTypeForField(null, aggregation.agg, true);
  const field = fieldsById.get(aggregation.fieldId);
  return aggregateSqlTypeForField(field ?? null, aggregation.agg, false);
};

const fieldProjection = (
  field: Field,
  recordAlias: string,
  options?: {
    fields?: Field[];
    timeZone?: string;
    readableTableIds?: readonly string[];
    computedFieldSql?: Map<string, FormulaSqlExpression>;
    resolveField?: FormulaSqlFieldResolver;
  },
): { ok: true; projection: unknown; sqlType?: FormulaSqlType } | { ok: false; error: string } => {
  if (field.type === "formula") {
    return compileFormulaFieldProjection({
      field,
      fields: options?.fields ?? [field],
      recordAlias,
      timeZone: options?.timeZone,
      computedFieldSql: options?.computedFieldSql,
      resolveField: options?.resolveField,
    });
  }
  // Lookup/rollup project to their pre-built correlated subquery (over alias `r`).
  if (field.type === "lookup" || field.type === "rollup") {
    const computed = options?.computedFieldSql?.get(field.id);
    if (computed) return { ok: true, projection: computed.sql, sqlType: computed.type };
    return { ok: false, error: `field "${field.name}" (type "${field.type}") is not available in this query` };
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
  return { ok: false, error: `field "${field.name}" (type "${field.type}") cannot be selected by GQL yet` };
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
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  resolveField?: FormulaSqlFieldResolver;
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const projection = fieldProjection(params.field, params.recordAlias, {
    fields: params.fields,
    timeZone: params.timeZone,
    readableTableIds: params.readableTableIds,
    computedFieldSql: params.computedFieldSql,
    resolveField: params.resolveField,
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
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  resolveField?: FormulaSqlFieldResolver;
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const compiled = compileFormulaSourceToSql(params.expression, {
    fields: params.fields,
    recordAlias: params.recordAlias,
    dateConfig: params.timeZone ? { timeZone: params.timeZone } : undefined,
    computedFieldSql: params.computedFieldSql,
    resolveField: params.resolveField,
    scopedRefs: Boolean(params.resolveField),
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
  computedFieldSql?: Map<string, FormulaSqlExpression>;
}): { ok: true; fragment: unknown; column: DslSqlOutputColumn } | { ok: false; error: string } => {
  const fields = aliveFields(params.fieldsByTableId[params.joinedColumn.tableId] ?? []);
  const field = fieldById(fields, params.joinedColumn.fieldId);
  if (!field) return { ok: false, error: `joined field ${params.joinedColumn.fieldId} is not available` };
  const projection = fieldProjection(field, params.recordAlias, {
    fields,
    timeZone: params.timeZone,
    readableTableIds: params.readableTableIds,
    computedFieldSql: params.computedFieldSql,
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
  options?: { fields?: Field[]; timeZone?: string; computedFieldSql?: Map<string, FormulaSqlExpression> },
): { ok: true; projection: unknown } | { ok: false; error: string } => {
  if (field.type === "formula") {
    const projection = compileFormulaFieldProjection({
      field,
      fields: options?.fields ?? [field],
      recordAlias,
      timeZone: options?.timeZone,
      computedFieldSql: options?.computedFieldSql,
    });
    if (!projection.ok) return projection;
    return { ok: true, projection: projection.projection };
  }
  if (field.type === "lookup" || field.type === "rollup") {
    const computed = options?.computedFieldSql?.get(field.id);
    if (computed) return { ok: true, projection: computed.sql };
    return { ok: false, error: `field "${field.name}" (type "${field.type}") is not available for sorting` };
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
    // Defaults to NULLS LAST (matching the saved-view sort-compiler) unless the
    // query opted into `nulls first` via the sort modifier.
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

export const dslJoinRecordAlias = (index: number): string => `jq${index}`;
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
  const recordAlias = dslJoinRecordAlias(index);
  const joinSql = join.mode === "left" ? sql`LEFT JOIN` : sql`JOIN`;
  const fanoutLimit = options.joinFanoutLimit ? boundedPositiveInt(options.joinFanoutLimit, 50, 500) : null;
  const linkSourceColumn = join.direction === "reverse" ? "from_record_id" : "to_record_id";
  const linkMatchColumn = join.direction === "reverse" ? "to_record_id" : "from_record_id";
  const linkJoin = fanoutLimit
    ? sql`
      ${joinSql} LATERAL (
        SELECT ${sql.unsafe(`_dsl_link.${linkSourceColumn}`)}
        FROM grids.record_links _dsl_link
        WHERE ${sql.unsafe(`_dsl_link.${linkMatchColumn}`)} = ${sql.unsafe(fromAlias)}.id
          AND _dsl_link.from_field_id = ${join.relationFieldId}::uuid
        ORDER BY ${sql.unsafe(`_dsl_link.${linkSourceColumn}`)}
        LIMIT ${fanoutLimit}
      ) ${sql.unsafe(linkAlias)} ON TRUE
    `
    : sql`
      ${joinSql} grids.record_links ${sql.unsafe(linkAlias)}
        ON ${sql.unsafe(`${linkAlias}.${linkMatchColumn}`)} = ${sql.unsafe(fromAlias)}.id
       AND ${sql.unsafe(linkAlias)}.from_field_id = ${join.relationFieldId}::uuid
    `;

  return {
    ok: true,
    recordAlias,
    fragment: sql`
      ${linkJoin}
      ${joinSql} grids.records ${sql.unsafe(recordAlias)}
        ON ${sql.unsafe(recordAlias)}.id = ${sql.unsafe(`${linkAlias}.${linkSourceColumn}`)}
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

const scopedFormulaResolverForPlan = (
  plan: DslResolvedSqlQueryPlan,
  baseFields: Field[],
  joinAliases: Map<string, string>,
  options: DslSqlCompileOptions,
): FormulaSqlFieldResolver =>
  createDslScopedFormulaFieldResolver({
    base: {
      ...(plan.sourceAlias ? { alias: plan.sourceAlias } : {}),
      fields: baseFields,
      recordAlias: "r",
      computedFieldSql: options.computedFieldSql,
    },
    joins: (plan.joins ?? []).map((join) => ({
      alias: join.alias,
      fields: aliveFields(options.fieldsByTableId[join.tableId] ?? []),
      recordAlias: joinAliases.get(join.alias) ?? join.alias,
      computedFieldSql: options.computedFieldSqlByJoinAlias?.get(join.alias),
    })),
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
  });

const joinFragments = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
};

/** Soft-delete predicate on the base record alias `r`: live-only by default,
 *  trash-only for `deleted only`, both for `include deleted`. Parent-table /
 *  base liveness JOINs are unaffected — a trashed table/base still hides its
 *  records, even in the trash view. */
const recordDeletedCondition = (plan: DslResolvedSqlQueryPlan): unknown =>
  plan.query.deletedOnly ? sql`r.deleted_at IS NOT NULL` : plan.query.includeDeleted ? sql`TRUE` : sql`r.deleted_at IS NULL`;

const queryDeletedCondition = (query: RecordQuery): unknown =>
  query.deletedOnly || recordMetaRequiresDeletedRows(query.recordMeta)
    ? sql`r.deleted_at IS NOT NULL`
    : query.includeDeleted
      ? sql`TRUE`
      : sql`r.deleted_at IS NULL`;

const compileViewSourceRecordScope = (
  plan: DslResolvedSqlQueryPlan,
  fields: Field[],
  options: Pick<DslSqlCompileOptions, "timeZone" | "viewSourceSearchClause">,
): { ok: true; condition?: unknown } | { ok: false; error: string } => {
  const source = plan.viewSourceQuery;
  if (!source) return { ok: true };
  const filter = compileFilter(source.filter ?? null, fields, { timeZone: options.timeZone });
  if (!filter.ok) return { ok: false, error: `view source filter: ${filter.error}` };
  const sort = compileSort(source.sort ?? [], fields, null);
  if (!sort.ok) return { ok: false, error: `view source sort: ${sort.error}` };
  if (source.search && options.viewSourceSearchClause === undefined) {
    return { ok: false, error: "view source search was not compiled" };
  }
  const orderBy = sort.result.orderBy;
  const limit = Math.min(Math.max(source.limit ?? 10_000, 1), 10_000);
  const conditions = [
    sql`r.table_id = ${plan.tableId}::uuid`,
    queryDeletedCondition(source),
    renderClause(filter.clause),
    options.viewSourceSearchClause ?? sql`TRUE`,
    compileRecordMetaFilter(source.recordMeta ?? null),
  ];
  const where = conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);
  return {
    ok: true,
    condition: sql`r.id IN (
      SELECT r.id
      FROM grids.records r
      JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    )`,
  };
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

  const conditions: unknown[] = [sql`r.table_id = ${plan.tableId}::uuid`, recordDeletedCondition(plan), renderClause(filter.clause)];
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

const hasGroupedShape = (plan: DslResolvedSqlQueryPlan): boolean =>
  (plan.query.groupBy?.length ?? 0) > 0 ||
  (plan.sqlGroupBy?.length ?? 0) > 0 ||
  (plan.query.aggregations?.length ?? 0) > 0 ||
  (plan.sqlAggregations?.length ?? 0) > 0 ||
  (plan.formulaAggregations?.length ?? 0) > 0 ||
  Boolean(plan.formulaHaving);

const compileGroupExtraWhere = (
  plan: DslResolvedSqlQueryPlan,
  fields: Field[],
  options: DslSqlCompileOptions,
  resolveField?: FormulaSqlFieldResolver,
): { ok: true; where?: unknown } | { ok: false; error: string } => {
  const parts: unknown[] = [];
  const viewScope = compileViewSourceRecordScope(plan, fields, options);
  if (!viewScope.ok) return viewScope;
  if (viewScope.condition) parts.push(viewScope.condition);
  if (plan.wherePredicate) {
    const compiled = compileWherePredicate(plan.wherePredicate, fields, {
      timeZone: options.timeZone,
      computedFieldSql: options.computedFieldSql,
      resolveField,
    });
    if (!compiled.ok) return { ok: false, error: `where: ${compiled.error}` };
    parts.push(compiled.sql);
  }
  if (parts.length === 0) return { ok: true };
  return { ok: true, where: parts.reduce((acc, part) => sql`${acc} AND ${part}`) };
};

const compileFormulaAggregateColumn = (
  aggregation: DslFormulaAggregation,
  fields: Field[],
  options: DslSqlCompileOptions,
  resolveField?: FormulaSqlFieldResolver,
): { ok: true; key: string; expr: unknown } | { ok: false; error: string } => {
  const compiled = compileFormulaAstToSql(aggregation.expression, {
    fields,
    recordAlias: "r",
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
    computedFieldSql: options.computedFieldSql,
    resolveField,
  });
  if (!compiled.ok) return { ok: false, error: `formula aggregate "${aggregation.id}": ${compiled.error}` };
  if (!isFormulaAggregatable(compiled.expression.type, aggregation.agg)) {
    return {
      ok: false,
      error: `formula aggregate "${aggregation.id}": agg "${aggregation.agg}" not compatible with SQL type "${compiled.expression.type}"`,
    };
  }
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
    case "median":
      return { ok: true, key, expr: sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${expression})::numeric)` };
    case "min":
    case "earliest":
      return { ok: true, key, expr: sql`MIN(${expression})` };
    case "max":
    case "latest":
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
      tableId: plan.tableId,
      type: field?.type ?? "unknown",
      sqlType: field ? groupSqlTypeForField(field) : "json",
    };
  });
  const aggregateLabels = new Map<string, string>();
  for (const aggregation of plan.query.aggregations ?? []) {
    aggregateLabels.set(
      aggregateOutputKey(aggregation.fieldId, aggregation.agg),
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

const sqlGroupKey = (index: number): string => groupKey(index);

const groupFieldProjection = (
  group: DslResolvedSqlGroupBy,
  field: Field,
  recordAlias: string,
  options: DslSqlCompileOptions,
  index: number,
): { ok: true; expr: unknown; sqlType: DslSqlOutputColumn["sqlType"]; joins?: unknown[] } | { ok: false; error: string } => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "relationLink") {
    const alias = `jg_rl_${index}`;
    return {
      ok: true,
      expr: sql`${sql.unsafe(alias)}.to_record_id::text`,
      sqlType: "text",
      joins: [
        sql`JOIN grids.record_links ${sql.unsafe(alias)}
          ON ${sql.unsafe(alias)}.from_record_id = ${sql.unsafe(recordAlias)}.id
         AND ${sql.unsafe(alias)}.from_field_id = ${field.id}::uuid`,
      ],
    };
  }
  if (descriptor.kind === "jsonbArray") {
    const alias = `jg_ms_${index}`;
    return {
      ok: true,
      expr: sql`${sql.unsafe(alias)}.value`,
      sqlType: "text",
      joins: [
        sql`CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(${sql.unsafe(recordAlias)}.data->${field.id}) = 'array'
            THEN ${sql.unsafe(recordAlias)}.data->${field.id}
            ELSE '[]'::jsonb
          END
        ) AS ${sql.unsafe(alias)}(value)`,
      ],
    };
  }
  if (field.type === "date" && group.granularity) {
    const expr = (field.config as { includeTime?: boolean }).includeTime
      ? sql`grids.try_timestamptz(${sql.unsafe(recordAlias)}.data->>${field.id}) AT TIME ZONE ${options.timeZone ?? "UTC"}`
      : sql`grids.try_iso_date(${sql.unsafe(recordAlias)}.data->>${field.id})::timestamp`;
    return { ok: true, expr: sql`date_trunc(${group.granularity}, ${expr})::date`, sqlType: "date" };
  }
  const projection = fieldProjection(field, recordAlias, {
    fields: aliveFields(options.fieldsByTableId[group.tableId] ?? []),
    timeZone: options.timeZone,
    readableTableIds: [],
    computedFieldSql: computedFieldSqlForScope(options, group.joinAlias),
  });
  if (!projection.ok) return projection;
  return { ok: true, expr: projection.projection, sqlType: projection.sqlType ?? outputTypeFor(field) };
};

const aggregateExprForField = (
  aggregation: DslResolvedSqlAggregation,
  field: Field | null,
  recordAlias: string,
): { ok: true; expr: unknown; sqlType: FormulaSqlType } | { ok: false; error: string } => {
  if (aggregation.fieldId === "*") {
    if (aggregation.agg !== "count") return { ok: false, error: `agg "${aggregation.agg}" requires a field; only count works on "*"` };
    return { ok: true, expr: sql`COUNT(*)::bigint`, sqlType: "numeric" };
  }
  if (!field) return { ok: false, error: "unknown aggregate field" };
  if (!isFieldAggregatable(field, aggregation.agg)) {
    return { ok: false, error: `agg "${aggregation.agg}" not compatible with field type "${field.type}"` };
  }
  const descriptor = storageOf(field);
  const typedProjection = descriptor.project(field, recordAlias);
  const rawValue = descriptor.kind === "system" ? typedProjection : sql`${sql.unsafe(recordAlias)}.data->>${field.id}`;
  const isSystem = descriptor.kind === "system";
  const sqlType = aggregateSqlTypeForField(field, aggregation.agg, false);

  switch (aggregation.agg) {
    case "count":
      return {
        ok: true,
        expr: isSystem
          ? sql`COUNT(${rawValue}) FILTER (WHERE ${rawValue} IS NOT NULL)::bigint`
          : sql`COUNT(${rawValue}) FILTER (WHERE ${rawValue} IS NOT NULL AND ${rawValue} <> '')::bigint`,
        sqlType: "numeric",
      };
    case "countEmpty":
      return {
        ok: true,
        expr: isSystem
          ? sql`COUNT(*) FILTER (WHERE ${rawValue} IS NULL)::bigint`
          : sql`COUNT(*) FILTER (WHERE ${rawValue} IS NULL OR ${rawValue} = '')::bigint`,
        sqlType: "numeric",
      };
    case "countUnique":
      return {
        ok: true,
        expr: isSystem
          ? sql`COUNT(DISTINCT ${rawValue}) FILTER (WHERE ${rawValue} IS NOT NULL)::bigint`
          : sql`COUNT(DISTINCT ${rawValue}) FILTER (WHERE ${rawValue} IS NOT NULL AND ${rawValue} <> '')::bigint`,
        sqlType: "numeric",
      };
    case "sum":
      if (!typedProjection) return { ok: false, error: `field "${field.name}" cannot be aggregated` };
      return { ok: true, expr: sql`SUM(${typedProjection})`, sqlType: "numeric" };
    case "avg":
      if (!typedProjection) return { ok: false, error: `field "${field.name}" cannot be aggregated` };
      return { ok: true, expr: sql`AVG(${typedProjection})`, sqlType: "numeric" };
    case "median":
      if (!typedProjection) return { ok: false, error: `field "${field.name}" cannot be aggregated` };
      return { ok: true, expr: sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${typedProjection})`, sqlType: "numeric" };
    case "min":
    case "max": {
      if (!typedProjection) return { ok: false, error: `field "${field.name}" cannot be aggregated` };
      const fn = aggregation.agg === "min" ? sql`MIN` : sql`MAX`;
      return { ok: true, expr: sql`${fn}(${typedProjection})`, sqlType };
    }
    case "earliest":
    case "latest": {
      if (!typedProjection) return { ok: false, error: `field "${field.name}" cannot be aggregated` };
      const fn = aggregation.agg === "earliest" ? sql`MIN` : sql`MAX`;
      return { ok: true, expr: sql`${fn}(${typedProjection})`, sqlType };
    }
  }
};

const sqlGroupOrderPart = (group: DslResolvedSqlGroupBy, index: number): unknown => {
  const dir = group.direction === "desc" ? sql`DESC` : sql`ASC`;
  const nulls = group.nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
  return sql`${sql.unsafe(String(index + 1))} ${dir} ${nulls}`;
};

const sqlGroupAggregateOrderPart = (sort: NonNullable<DslResolvedSqlQueryPlan["sqlGroupSort"]>[number]): unknown => {
  const dir = sort.direction === "asc" ? sql`ASC` : sql`DESC`;
  const nulls = sort.nullsFirst ? sql`NULLS FIRST` : sql`NULLS LAST`;
  return sql`${sql.unsafe(`"${aggregateOutputKey(sort.fieldId, sort.agg)}"`)} ${dir} ${nulls}`;
};

const compileJoinedGroupedQueryPlanToSql = (plan: DslResolvedSqlQueryPlan, options: DslSqlCompileOptions): DslSqlGroupCompileResult => {
  if ((plan.query.columns?.length ?? 0) > 0 || (plan.outputColumns?.length ?? 0) > 0 || (plan.joinedColumns?.length ?? 0) > 0) {
    return failGroup("grouped DSL queries use group and aggregate output, not select columns");
  }

  const groupBy = plan.sqlGroupBy ?? [];
  const aggregations = plan.sqlAggregations ?? [];
  const formulaAggregations = plan.formulaAggregations ?? [];
  if (groupBy.length === 0 && aggregations.length === 0 && formulaAggregations.length === 0) {
    return failGroup("grouped DSL query needs at least one group field or aggregate");
  }
  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const filter = compileFilter(plan.query.filter ?? null, fields, { timeZone: options.timeZone });
  if (!filter.ok) return failGroup(`filter: ${filter.error}`);

  const joinAliases = new Map<string, string>();
  const joinSql: unknown[] = [];
  for (const [index, join] of (plan.joins ?? []).entries()) {
    const compiled = compileRelationJoin(join, index, joinAliases, { joinFanoutLimit: options.joinFanoutLimit });
    if (!compiled.ok) return failGroup(compiled.error);
    joinAliases.set(join.alias, compiled.recordAlias);
    joinSql.push(compiled.fragment);
  }
  const resolveFormulaField = scopedFormulaResolverForPlan(plan, fields, joinAliases, options);

  const selectParts: unknown[] = [];
  const groupColumns: DslSqlGroupOutputColumn[] = [];
  const groupExprs: unknown[] = [];
  for (const [index, group] of groupBy.entries()) {
    const tableFields = aliveFields(options.fieldsByTableId[group.tableId] ?? []);
    const field = fieldById(tableFields, group.fieldId);
    if (!field) return failGroup(`group field ${group.fieldId} is not available`);
    const recordAlias = group.joinAlias ? joinAliases.get(group.joinAlias) : "r";
    if (!recordAlias) return failGroup(`group field uses unknown join alias "${group.joinAlias}"`);
    const projected = groupFieldProjection(group, field, recordAlias, options, index);
    if (!projected.ok) return failGroup(projected.error);
    const key = sqlGroupKey(index);
    groupExprs.push(projected.expr);
    selectParts.push(sql`${projected.expr} AS ${sql.unsafe(key)}`);
    if (projected.joins) joinSql.push(...projected.joins);
    groupColumns.push({
      kind: "group",
      key,
      label: field.name,
      fieldId: field.id,
      tableId: group.tableId,
      type: field.type,
      sqlType: projected.sqlType,
    });
  }

  const aggregateColumns: DslSqlGroupOutputColumn[] = [];
  const aggregateExprsByKey = new Map<string, { expr: unknown; type: FormulaSqlType }>();
  for (const aggregation of aggregations) {
    const tableFields = aggregation.fieldId === "*" ? [] : aliveFields(options.fieldsByTableId[aggregation.tableId ?? plan.tableId] ?? []);
    const field = aggregation.fieldId === "*" ? null : fieldById(tableFields, aggregation.fieldId);
    const recordAlias = aggregation.joinAlias ? joinAliases.get(aggregation.joinAlias) : "r";
    if (!recordAlias) return failGroup(`aggregate uses unknown join alias "${aggregation.joinAlias}"`);
    const compiled = aggregateExprForField(aggregation, field, recordAlias);
    if (!compiled.ok) return failGroup(compiled.error);
    const key = aggregateOutputKey(aggregation.fieldId, aggregation.agg);
    aggregateExprsByKey.set(key, { expr: compiled.expr, type: compiled.sqlType });
    selectParts.push(sql`${compiled.expr} AS ${sql.unsafe(`"${key}"`)}`);
    aggregateColumns.push({
      kind: "aggregate",
      key,
      label: aggregation.label ?? key,
      fieldId: aggregation.fieldId,
      agg: aggregation.agg,
      sqlType: compiled.sqlType,
    });
  }
  for (const aggregation of formulaAggregations) {
    const compiled = compileFormulaAggregateColumn(aggregation, fields, options, resolveFormulaField);
    if (!compiled.ok) return failGroup(compiled.error);
    aggregateExprsByKey.set(compiled.key, { expr: compiled.expr, type: formulaAggregateSqlType(aggregation) });
    selectParts.push(sql`${compiled.expr} AS ${sql.unsafe(`"${compiled.key}"`)}`);
    aggregateColumns.push({
      kind: "aggregate",
      key: compiled.key,
      label: aggregation.id,
      fieldId: aggregation.id,
      agg: aggregation.agg,
      sqlType: formulaAggregateSqlType(aggregation),
    });
  }
  if (groupBy.length > 0 && aggregations.length === 0 && formulaAggregations.length === 0) {
    const key = aggregateOutputKey("*", "count");
    const expr = sql`COUNT(*)::bigint`;
    aggregateExprsByKey.set(key, { expr, type: "numeric" });
    selectParts.push(sql`${expr} AS ${sql.unsafe(`"${key}"`)}`);
    aggregateColumns.push({
      kind: "aggregate",
      key,
      label: key,
      fieldId: "*",
      agg: "count",
      sqlType: "numeric",
    });
  }

  const having =
    plan.formulaHaving && aggregateExprsByKey.size > 0
      ? compileFormulaPredicateAstToSql(plan.formulaHaving.expression, {
          fields: [],
          resolveField: (ref) => {
            const aggregate = plan.formulaHaving?.aggregateRefs.find((item) => normalizeRefKey(item.ref) === normalizeRefKey(ref));
            if (!aggregate) return null;
            const resolved = aggregateExprsByKey.get(aggregateKey(aggregate));
            return resolved ? { sql: resolved.expr, type: resolved.type } : null;
          },
        })
      : null;
  if (having && !having.ok) return failGroup(`having: ${having.error}`);

  const groupSort = plan.sqlGroupSort ?? [];
  for (const sort of groupSort) {
    const key = aggregateOutputKey(sort.fieldId, sort.agg);
    if (!aggregateExprsByKey.has(key)) return failGroup(`group sort references missing aggregate "${key}"`);
  }

  const conditions: unknown[] = [sql`r.table_id = ${plan.tableId}::uuid`, recordDeletedCondition(plan), renderClause(filter.clause)];
  const viewScope = compileViewSourceRecordScope(plan, fields, options);
  if (!viewScope.ok) return failGroup(viewScope.error);
  if (viewScope.condition) conditions.push(viewScope.condition);
  if (plan.wherePredicate) {
    const extraWhere = compileWherePredicate(plan.wherePredicate, fields, {
      timeZone: options.timeZone,
      computedFieldSql: options.computedFieldSql,
      resolveField: resolveFormulaField,
    });
    if (!extraWhere.ok) return failGroup(`where: ${extraWhere.error}`);
    conditions.push(extraWhere.sql);
  }
  if (options.searchClause) conditions.push(options.searchClause);
  const where = conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);
  const groupBySql = groupExprs.map((_, index) => sql.unsafe(String(index + 1)));
  const groupByClause = groupBySql.length > 0 ? sql`GROUP BY ${joinFragments(groupBySql, sql`, `)}` : sql``;
  const orderBySql = [...groupSort.map(sqlGroupAggregateOrderPart), ...groupBy.map(sqlGroupOrderPart)];
  const orderByClause = orderBySql.length > 0 ? sql`ORDER BY ${joinFragments(orderBySql, sql`, `)}` : sql``;
  const limit = Math.min(Math.max(options.limit ?? plan.query.limit ?? 100, 1), 1000);
  const offset = Math.min(Math.max(plan.offset ?? 0, 0), 10_000);

  return {
    ok: true,
    query: {
      sql: sql`
        SELECT ${joinFragments(selectParts, sql`, `)}
        FROM grids.records r
        JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        ${joinFragments(joinSql, sql` `)}
        WHERE ${where}
        ${groupByClause}
        HAVING ${having && having.ok ? having.expression.sql : sql`TRUE`}
        ${orderByClause}
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

export const compileDslGroupedQueryPlanToSql = (plan: DslResolvedSqlQueryPlan, options: DslSqlCompileOptions): DslSqlGroupCompileResult => {
  if (!hasGroupedShape(plan)) return failGroup("query is not grouped");
  if (plan.sqlGroupBy !== undefined || (plan.joins?.length ?? 0) > 0) {
    return compileJoinedGroupedQueryPlanToSql(plan, options);
  }
  if ((plan.joinedColumns?.length ?? 0) > 0) {
    return failGroup("grouped DSL queries use group and aggregate output, not select columns");
  }
  if ((plan.query.columns?.length ?? 0) > 0) {
    return failGroup("grouped DSL queries use group and aggregate output, not select columns");
  }
  const groupBy = plan.query.groupBy ?? [];
  if (groupBy.length === 0) return failGroup("grouped DSL query needs at least one group field");

  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const resolveFormulaField = scopedFormulaResolverForPlan(plan, fields, new Map(), options);
  const extraWhere = compileGroupExtraWhere(plan, fields, options, resolveFormulaField);
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
    searchClause: options.searchClause,
    extraWhere: extraWhere.where,
    limit: options.limit ?? plan.query.limit,
    offset: plan.offset,
    includeDeleted: plan.query.includeDeleted,
    deletedOnly: plan.query.deletedOnly,
    timeZone: options.timeZone,
    dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
    computedFieldSql: options.computedFieldSql,
    resolveField: resolveFormulaField,
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
    return failAggregate("aggregate-only relation joins are compiled by the grouped SQL compiler");
  }
  if ((plan.query.sort?.length ?? 0) > 0 || (plan.sqlSort?.length ?? 0) > 0 || (plan.query.groupSort?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries cannot sort");
  }

  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const resolveFormulaField = scopedFormulaResolverForPlan(plan, fields, new Map(), options);
  const filter = compileFilter(plan.query.filter ?? null, fields, { timeZone: options.timeZone });
  if (!filter.ok) return failAggregate(`filter: ${filter.error}`);
  const aggregateCompiled = compileAggregates(aggregations, fields);
  if (!aggregateCompiled.ok) return failAggregate(`aggregate: ${aggregateCompiled.error}`);
  const extraWhere = compileGroupExtraWhere(plan, fields, options, resolveFormulaField);
  if (!extraWhere.ok) return failAggregate(extraWhere.error);
  const formulaColumns: Array<{ key: string; expr: unknown }> = [];
  for (const aggregation of formulaAggregations) {
    const compiled = compileFormulaAggregateColumn(aggregation, fields, options, resolveFormulaField);
    if (!compiled.ok) return failAggregate(compiled.error);
    formulaColumns.push(compiled);
  }
  const allAggregateColumns = [...aggregateCompiled.columns, ...formulaColumns];
  const jsonPairs = allAggregateColumns.map((column) => sql`${column.key}::text, ${column.expr}`);
  if (jsonPairs.length === 0) return failAggregate("query has no aggregate output");
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const columns: DslSqlAggregateOutputColumn[] = aggregations.map(
    (aggregation): DslSqlAggregateOutputColumn => ({
      key: aggregateOutputKey(aggregation.fieldId, aggregation.agg),
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
    AND ${recordDeletedCondition(plan)}
    AND ${renderClause(filter.clause)}
    AND ${extraWhere.where ?? sql`TRUE`}
    AND ${options.searchClause ?? sql`TRUE`}`;
  return {
    ok: true,
    query: {
      sql: sql`
        SELECT jsonb_build_object(${joinFragments(jsonPairs, sql`, `)}) AS result
        FROM grids.records r
        JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE ${where}
      `,
      columns,
      limit: 1,
      offset: 0,
    },
  };
};

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
    options?: { joinAliases?: Map<string, string>; derived?: NonNullable<DslResolvedSqlQueryPlan["derivedViewSource"]>; compileOptions?: DslSqlCompileOptions },
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
    const column = columnsByKey.get(groupKey(index));
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

  const selectFragments: unknown[] = derived.outputColumns.map((column) => sql`${derivedColumnReference(column)} AS ${quotedIdentifier(column.key)}`);
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
  const orderParts = explicitOrder.length > 0 || joinedOrder.parts.length > 0 ? [...explicitOrder, ...joinedOrder.parts] : derivedDefaultOrder(derived);
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
