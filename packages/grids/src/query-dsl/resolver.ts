import { sql } from "bun";
import { type FilterTree, type GroupSortSpec, type RecordMetaQuery, type RecordQuery, RecordQuerySchema } from "../contracts";
import type { Expr } from "../formula/types";
import { normalizeRefKey } from "../ref-syntax";
import {
  aggregateOutputKey,
  aggregateSqlTypeForField,
  aggregateSqlTypeForFormula,
  isFieldAggregatable,
  isFormulaAggregatable,
} from "../service/aggregate-capabilities";
import {
  compileFormulaAstToSql,
  compileFormulaPredicateAstToSql,
  type FormulaSqlExpression,
  type FormulaSqlType,
} from "../service/formula-sql-compiler";
import { type GroupHavingRef, isGroupable } from "../service/group-compiler";
import type { Field } from "../service/types";
import {
  type DslFormulaAggregation,
  type DslFormulaHavingPredicate,
  type DslResolvedSqlAggregation,
  duplicateAggregateOutputDiagnostic,
  FORMULA_AGGREGATE_ALIAS_RE,
  groupAggForDsl,
  hasLabelRef,
  isComputedValueAggregateField,
  resolveComputedValueAggregation,
  resolveHavingPredicate,
  resolveSqlAggregations,
} from "./resolver-aggregates";
import type { DslResolverContext, DslTableSource, DslViewSource } from "./resolver-context";
import {
  createDerivedFormulaFieldResolver,
  type DslDerivedViewColumn,
  derivedColumnByRef,
  derivedColumnSqlType,
  derivedViewColumns,
  formulaSqlTypeForDerivedField,
  uniqueRefs,
} from "./resolver-derived-columns";
import {
  type DslPlanDiagnosticSpans,
  type DslResolverDiagnostic,
  diagnostic,
  diagnosticSpansForAst,
  isResolverDiagnostic as isDiagnostic,
} from "./resolver-diagnostics";
import { scopedFormulaResolverForScope } from "./resolver-formula-scope";
import {
  type DslResolvedSqlGroupBy,
  type DslResolvedSqlGroupSort,
  type DslResolvedSqlSort,
  isAliasSortTarget,
  isQualifiedSortTarget,
  resolveGroupBy,
  resolveGroupedQueryPlanSort,
  resolveQueryPlanSort,
  resolveSqlGroupedQueryPlanSort,
} from "./resolver-group-sort";
import { type DslResolvedDerivedRelationJoin, type DslResolvedRelationJoin, resolveDerivedJoins, resolveJoins } from "./resolver-joins";
import { type DslJoinedColumn, type DslOutputColumn, resolveQueryPlanSelect } from "./resolver-output";
import { recordQueryBlocker, withoutColumns } from "./resolver-record-query";
import {
  aliveFields,
  createScope,
  fieldByRefMap,
  hasAnyOutputAlias,
  isDefaultSelectableField,
  type JoinScope,
  joinScopeByAlias,
  relationOutputDiagnostic,
  type Scope,
} from "./resolver-scope";
import { type DslResolvedSqlSearch, resolveDerivedSearch, resolveSearch } from "./resolver-search";
import { isDerivedViewSource, type ResolvedSource, resolveSource, validateViewSource, viewSourceNeedsRecordScope } from "./resolver-source";
import { type DslWherePredicate, mergeRecordMeta, resolveWhere } from "./resolver-where";
import type { DslAggregateItem, DslGroupItem, DslQueryAst, DslSelectItem, DslSortItem, DslSourceSpan } from "./types";

export type { DslFormulaAggregation, DslFormulaHavingPredicate, DslResolvedSqlAggregation } from "./resolver-aggregates";
export type { DslResolverContext, DslTableSource, DslViewSource } from "./resolver-context";
export type { DslDerivedViewColumn } from "./resolver-derived-columns";
export { derivedViewColumns } from "./resolver-derived-columns";
export type { DslResolverDiagnostic } from "./resolver-diagnostics";
export type { DslResolvedSqlGroupBy, DslResolvedSqlSort } from "./resolver-group-sort";
export type { DslResolvedDerivedRelationJoin, DslResolvedRelationJoin } from "./resolver-joins";
export type { DslJoinedColumn, DslOutputColumn } from "./resolver-output";
export type { DslWherePredicate } from "./resolver-where";

type DslResolvedQueryPlan = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  sourceAlias?: string;
  query: RecordQuery;
  offset?: number;
};

export type DslResolvedSqlQueryPlan = DslResolvedQueryPlan & {
  readableTableIds: string[];
  viewSourceQuery?: RecordQuery;
  joins?: DslResolvedRelationJoin[];
  outputColumns?: DslOutputColumn[];
  joinedColumns?: DslJoinedColumn[];
  sqlSort?: DslResolvedSqlSort[];
  sqlGroupBy?: DslResolvedSqlGroupBy[];
  sqlGroupSort?: DslResolvedSqlGroupSort[];
  sqlAggregations?: DslResolvedSqlAggregation[];
  sqlSearch?: DslResolvedSqlSearch[];
  derivedViewSource?: DslResolvedDerivedViewSource;
  formulaGroupSort?: GroupSortSpec[];
  formulaAggregations?: DslFormulaAggregation[];
  wherePredicate?: DslWherePredicate;
  formulaHaving?: DslFormulaHavingPredicate;
  diagnosticSpans?: DslPlanDiagnosticSpans;
};

export type DslDerivedViewGroupBy =
  | {
      kind: "derived";
      column: DslDerivedViewColumn;
      key: string;
      label: string;
      type: string;
      sqlType: FormulaSqlType | "json";
      granularity?: "day" | "week" | "month" | "quarter" | "year";
      direction?: "asc" | "desc";
      nullsFirst?: boolean;
    }
  | {
      kind: "joined";
      joinAlias: string;
      tableId: string;
      fieldId: string;
      key: string;
      label: string;
      type: string;
      sqlType: FormulaSqlType | "json";
      granularity?: "day" | "week" | "month" | "quarter" | "year";
      direction?: "asc" | "desc";
      nullsFirst?: boolean;
    };

export type DslDerivedViewAggregation = {
  key: string;
  label: string;
  fieldId: string | "*";
  agg: DslAggregateItem["fn"];
  sqlType: FormulaSqlType;
  column?: DslDerivedViewColumn;
  tableId?: string;
  joinAlias?: string;
};

type DslDerivedViewGroupSort = {
  key: string;
  direction: "asc" | "desc";
  nullsFirst?: boolean;
};

type DslResolvedDerivedViewSource = {
  query: RecordQuery;
  columns: DslDerivedViewColumn[];
  outputColumns: DslDerivedViewColumn[];
  sort: Array<{ column: DslDerivedViewColumn; direction: "asc" | "desc"; nullsFirst?: boolean }>;
  joinedColumns?: DslJoinedColumn[];
  joinedSort?: Extract<DslResolvedSqlSort, { kind: "joinedField" }>[];
  joins?: DslResolvedDerivedRelationJoin[];
  relationJoins?: DslResolvedRelationJoin[];
  search?: { q: string; columns: DslDerivedViewColumn[] };
  joinedSearch?: DslResolvedSqlSearch[];
  where?: { expression: Expr; source: string };
  groupBy?: DslDerivedViewGroupBy[];
  aggregations?: DslDerivedViewAggregation[];
  formulaAggregations?: DslFormulaAggregation[];
  groupSort?: DslDerivedViewGroupSort[];
  having?: DslFormulaHavingPredicate;
};

type DslResolveResult = { ok: true; plan: DslResolvedQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

type DslSqlQueryPlanResolveResult = { ok: true; plan: DslResolvedSqlQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

const createDerivedScopedFormulaFieldResolver = (
  columns: DslDerivedViewColumn[],
  scope: Scope,
  recordAlias: string,
): ((ref: string) => FormulaSqlExpression | string | null) => {
  const scoped = scopedFormulaResolverForScope(scope);
  const derived = createDerivedFormulaFieldResolver(columns, recordAlias);
  return (ref) => scoped(ref) ?? derived(ref);
};

const hasGroupedDslShape = (ast: DslQueryAst): boolean => ast.groupBy.length > 0 || ast.aggregations.length > 0 || Boolean(ast.having);

const resolveDerivedSelect = (
  select: DslSelectItem[],
  columns: DslDerivedViewColumn[],
  scope: Scope,
): { outputColumns: DslDerivedViewColumn[]; joinedColumns: DslJoinedColumn[] } | DslResolverDiagnostic => {
  if (select.length === 0) return { outputColumns: columns, joinedColumns: [] };
  const output: DslDerivedViewColumn[] = [];
  const joinedColumns: DslJoinedColumn[] = [];
  const seen = new Set<string>();
  for (const item of select) {
    if (item.kind !== "field")
      return diagnostic("derived view sources can select output columns and joined fields, not computed formulas yet", item.span);
    if (item.field.scope) {
      const join = joinScopeByAlias(scope, item.field.scope, item.field.span ?? item.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, item.field.ref, `${item.field.scope}."${item.field.ref}"`, item.field.span ?? item.span);
      if (isDiagnostic(field)) return field;
      const relationDiagnostic = relationOutputDiagnostic(field, scope);
      if (relationDiagnostic) return relationDiagnostic;
      const key = `${join.alias}.${field.id}`;
      if (seen.has(key)) return diagnostic(`duplicate joined field "${item.field.scope}.${item.field.ref}"`, item.field.span ?? item.span);
      seen.add(key);
      joinedColumns.push({
        joinAlias: join.alias,
        tableId: join.tableId,
        fieldId: field.id,
        label: item.alias ?? `${join.alias}.${field.name}`,
      });
      continue;
    }
    const column = derivedColumnByRef(columns, item.field.ref, item.field.span ?? item.span);
    if (isDiagnostic(column)) return column;
    const key = `derived.${column.key}`;
    if (seen.has(key)) return diagnostic(`duplicate derived column "${item.field.ref}"`, item.field.span ?? item.span);
    seen.add(column.key);
    seen.add(key);
    output.push(item.alias ? { ...column, label: item.alias, refs: uniqueRefs([item.alias, ...column.refs]) } : column);
  }
  return { outputColumns: output, joinedColumns };
};

const resolveDerivedSort = (
  sort: DslSortItem[],
  columns: DslDerivedViewColumn[],
  scope: Scope,
):
  | { sort: DslResolvedDerivedViewSource["sort"]; joinedSort: NonNullable<DslResolvedDerivedViewSource["joinedSort"]> }
  | DslResolverDiagnostic => {
  const resolved: DslResolvedDerivedViewSource["sort"] = [];
  const joinedSort: NonNullable<DslResolvedDerivedViewSource["joinedSort"]> = [];
  for (const item of sort) {
    const ref = isAliasSortTarget(item.target) ? item.target.alias : item.target.ref;
    if (isQualifiedSortTarget(item.target) && item.target.scope) {
      const join = joinScopeByAlias(scope, item.target.scope, item.target.span ?? item.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, item.target.ref, `${item.target.scope}."${item.target.ref}"`, item.target.span ?? item.span);
      if (isDiagnostic(field)) return field;
      joinedSort.push({
        kind: "joinedField",
        joinAlias: join.alias,
        tableId: join.tableId,
        fieldId: field.id,
        direction: item.direction,
        ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}),
      });
      continue;
    }
    const column = derivedColumnByRef(columns, ref, item.span);
    if (isDiagnostic(column)) return column;
    resolved.push({ column, direction: item.direction, ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}) });
  }
  return { sort: resolved, joinedSort };
};

const resolveDerivedWhere = (
  where: DslQueryAst["where"],
  columns: DslDerivedViewColumn[],
  scope: Scope,
): DslResolvedDerivedViewSource["where"] | DslResolverDiagnostic | undefined => {
  if (!where) return undefined;
  const compiled = compileFormulaPredicateAstToSql(where.expression, {
    fields: [],
    recordAlias: "d",
    resolveField: createDerivedScopedFormulaFieldResolver(columns, scope, "d"),
  });
  if (!compiled.ok) return diagnostic(`where: ${compiled.error}`, where.span);
  return { expression: where.expression, source: where.source };
};

const resolveDerivedGroupBy = (
  groups: DslGroupItem[],
  columns: DslDerivedViewColumn[],
  scope: Scope,
): DslDerivedViewGroupBy[] | DslResolverDiagnostic => {
  const resolved: DslDerivedViewGroupBy[] = [];
  for (const [index, group] of groups.entries()) {
    if (group.field.scope) {
      const join = joinScopeByAlias(scope, group.field.scope, group.field.span ?? group.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, group.field.ref, `${group.field.scope}."${group.field.ref}"`, group.field.span ?? group.span);
      if (isDiagnostic(field)) return field;
      const joinedComputedGroup = field.type === "formula" || field.type === "lookup" || field.type === "rollup";
      if (!joinedComputedGroup && !isGroupable(field)) {
        return diagnostic(`field "${field.name}" (type "${field.type}") is not groupable`, group.field.span ?? group.span);
      }
      if (group.granularity && field.type !== "date") {
        return diagnostic(`granularity "${group.granularity}" is only valid on date fields, not "${field.type}"`, group.span);
      }
      resolved.push({
        kind: "joined",
        joinAlias: join.alias,
        tableId: join.tableId,
        fieldId: field.id,
        key: `gk_${index}`,
        label: group.granularity ? `${field.name} (${group.granularity})` : field.name,
        type: group.granularity ? "date" : field.type,
        sqlType: group.granularity ? "date" : formulaSqlTypeForDerivedField(field),
        ...(group.granularity ? { granularity: group.granularity } : {}),
      });
      continue;
    }
    const column = derivedColumnByRef(columns, group.field.ref, group.field.span ?? group.span);
    if (isDiagnostic(column)) return column;
    if (group.granularity && column.sqlType !== "date" && column.sqlType !== "datetime") {
      return diagnostic(`granularity "${group.granularity}" is only valid on date fields, not "${column.label}"`, group.span);
    }
    resolved.push({
      kind: "derived",
      column,
      key: `gk_${index}`,
      label: group.granularity ? `${column.label} (${group.granularity})` : column.label,
      type: group.granularity ? "date" : column.type,
      sqlType: group.granularity ? "date" : column.sqlType,
      ...(group.granularity ? { granularity: group.granularity } : {}),
    });
  }
  return resolved;
};

const derivedAggregationSqlType = (
  column: DslDerivedViewColumn | null,
  agg: DslAggregateItem["fn"],
  isStarField = false,
): FormulaSqlType => {
  if (isStarField) return "numeric";
  if (!column) return "unknown";
  return aggregateSqlTypeForFormula(derivedColumnSqlType(column), agg);
};

const isDerivedColumnAggregatable = (column: DslDerivedViewColumn | null, agg: DslAggregateItem["fn"], isStarField = false): boolean => {
  if (isStarField) return agg === "count";
  if (!column) return false;
  return isFormulaAggregatable(derivedColumnSqlType(column), agg);
};

const resolveDerivedAggregations = (
  items: DslAggregateItem[],
  columns: DslDerivedViewColumn[],
  scope: Scope,
  groupLabels: string[] = [],
): {
  aggregations: DslDerivedViewAggregation[];
  formulaAggregations: DslFormulaAggregation[];
  diagnostics: DslResolverDiagnostic[];
} => {
  const aggregations: DslDerivedViewAggregation[] = [];
  const formulaAggregations: DslFormulaAggregation[] = [];
  const diagnostics: DslResolverDiagnostic[] = [];
  const aliases = new Set<string>();
  const outputKeys = new Set<string>();

  for (const item of items) {
    const aliasKey = normalizeRefKey(item.alias);
    if (aliases.has(aliasKey)) {
      diagnostics.push(diagnostic(`duplicate aggregate alias "${item.alias}"`, item.span));
      continue;
    }
    const aliasConflict = derivedAggregateAliasConflictDiagnostic(item.alias, columns, scope, groupLabels, item.span);
    if (aliasConflict) {
      diagnostics.push(aliasConflict);
      continue;
    }
    aliases.add(aliasKey);

    const groupAgg = groupAggForDsl(item.fn);
    if (isDiagnostic(groupAgg)) {
      diagnostics.push(groupAgg);
      continue;
    }

    if (typeof item.argument === "object" && "kind" in item.argument) {
      const compiled = compileFormulaAstToSql(item.argument.expression, {
        fields: [],
        resolveField: createDerivedScopedFormulaFieldResolver(columns, scope, "d"),
      });
      if (!compiled.ok) {
        diagnostics.push(diagnostic(`aggregate "${item.alias}" formula: ${compiled.error}`, item.span));
        continue;
      }
      if (!isFormulaAggregatable(compiled.expression.type, groupAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with formula type "${compiled.expression.type}"`, item.span));
        continue;
      }
      if (!FORMULA_AGGREGATE_ALIAS_RE.test(item.alias)) {
        diagnostics.push(diagnostic(`formula aggregate alias "${item.alias}" must be 50 characters or less`, item.span));
        continue;
      }
      if (outputKeys.has(item.alias)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(item.alias, item.fn));
        continue;
      }
      outputKeys.add(item.alias);
      formulaAggregations.push({
        kind: "formula",
        id: item.alias,
        ref: item.alias,
        source: item.argument.source,
        expression: item.argument.expression,
        agg: groupAgg,
        sqlType: compiled.expression.type,
      });
      continue;
    }

    if (item.argument === "*") {
      if (item.fn !== "count") {
        diagnostics.push(diagnostic(`aggregate "${item.fn}" cannot use *`, item.span));
        continue;
      }
      const key = aggregateOutputKey("*", "count");
      if (outputKeys.has(key)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic("*", "count"));
        continue;
      }
      outputKeys.add(key);
      aggregations.push({ key, label: item.alias, fieldId: "*", agg: "count", sqlType: "numeric" });
      continue;
    }

    if (item.argument.scope) {
      const join = joinScopeByAlias(scope, item.argument.scope, item.argument.span ?? item.span);
      if (isDiagnostic(join)) {
        diagnostics.push(join);
        continue;
      }
      const field = fieldByRefMap(
        join.byRef,
        item.argument.ref,
        `${item.argument.scope}."${item.argument.ref}"`,
        item.argument.span ?? item.span,
      );
      if (isDiagnostic(field)) {
        diagnostics.push(field);
        continue;
      }
      if (isComputedValueAggregateField(field)) {
        const formulaAggregation = resolveComputedValueAggregation(item, item.argument, groupAgg, scope);
        if (isDiagnostic(formulaAggregation)) {
          diagnostics.push(formulaAggregation);
          continue;
        }
        formulaAggregations.push(formulaAggregation);
        continue;
      }
      if (!isFieldAggregatable(field, groupAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`, item.span));
        continue;
      }
      const key = aggregateOutputKey(field.id, groupAgg);
      if (outputKeys.has(key)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(field.name, item.fn));
        continue;
      }
      outputKeys.add(key);
      aggregations.push({
        key,
        label: item.alias,
        fieldId: field.id,
        tableId: join.tableId,
        joinAlias: join.alias,
        agg: groupAgg,
        sqlType: aggregateSqlTypeForField(field, groupAgg, false),
      });
      continue;
    }
    const column = derivedColumnByRef(columns, item.argument.ref, item.argument.span ?? item.span);
    if (isDiagnostic(column)) {
      diagnostics.push(column);
      continue;
    }
    if (!isDerivedColumnAggregatable(column, groupAgg)) {
      diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with derived column "${column.label}"`, item.span));
      continue;
    }
    const key = aggregateOutputKey(column.key, groupAgg);
    if (outputKeys.has(key)) {
      diagnostics.push(duplicateAggregateOutputDiagnostic(column.label, item.fn));
      continue;
    }
    outputKeys.add(key);
    aggregations.push({
      key,
      label: item.alias,
      fieldId: column.key,
      agg: groupAgg,
      sqlType: derivedAggregationSqlType(column, groupAgg),
      column,
    });
  }

  return { aggregations, formulaAggregations, diagnostics };
};

const resolveDerivedHavingPredicate = (
  having: NonNullable<DslQueryAst["having"]>,
  aggregations: DslDerivedViewAggregation[],
  formulaAggregations: DslFormulaAggregation[],
): DslFormulaHavingPredicate | DslResolverDiagnostic => {
  const refs = new Map<string, { ref: GroupHavingRef; sqlType: FormulaSqlType }>();
  for (const aggregation of aggregations) {
    refs.set(normalizeRefKey(aggregation.label), {
      ref: { ref: aggregation.label, fieldId: aggregation.fieldId, agg: aggregation.agg as GroupHavingRef["agg"] },
      sqlType: aggregation.sqlType,
    });
  }
  for (const aggregation of formulaAggregations) {
    refs.set(normalizeRefKey(aggregation.ref), {
      ref: {
        kind: "formula",
        id: aggregation.id,
        ref: aggregation.ref,
        expression: aggregation.expression,
        agg: aggregation.agg,
      },
      sqlType: aggregateSqlTypeForFormula(aggregation.sqlType, aggregation.agg),
    });
  }

  const compiled = compileFormulaAstToSql(having.expression, {
    fields: [],
    resolveField: (ref) => {
      const aggregate = refs.get(normalizeRefKey(ref));
      if (!aggregate) return null;
      const cast =
        aggregate.sqlType === "numeric"
          ? sql`NULL::numeric`
          : aggregate.sqlType === "boolean"
            ? sql`NULL::boolean`
            : aggregate.sqlType === "date"
              ? sql`NULL::date`
              : aggregate.sqlType === "datetime"
                ? sql`NULL::timestamptz`
                : sql`NULL::text`;
      return { sql: cast, type: aggregate.sqlType };
    },
  });
  if (!compiled.ok) return diagnostic(`having formula: ${compiled.error}`, having.span);
  if (compiled.expression.type !== "boolean") return diagnostic("having formula must return a boolean value", having.span);

  return {
    kind: "formula",
    source: having.source,
    expression: having.expression,
    sqlType: compiled.expression.type,
    aggregateRefs: [...refs.values()].map((item) => item.ref),
  };
};

const sameDerivedGroupColumn = (group: DslDerivedViewGroupBy, column: DslDerivedViewColumn): boolean =>
  group.kind === "derived" && group.column.key === column.key;

const sameDerivedJoinedGroupField = (group: DslDerivedViewGroupBy, join: JoinScope, field: Field): boolean =>
  group.kind === "joined" && group.joinAlias === join.alias && group.tableId === join.tableId && group.fieldId === field.id;

const resolveDerivedGroupedSort = (
  sort: DslSortItem[],
  columns: DslDerivedViewColumn[],
  scope: Scope,
  groupBy: DslDerivedViewGroupBy[],
  aggregations: DslDerivedViewAggregation[],
  formulaAggregations: DslFormulaAggregation[],
): { groupBy: DslDerivedViewGroupBy[]; groupSort: DslDerivedViewGroupSort[] } | DslResolverDiagnostic => {
  const nextGroupBy = groupBy.map((item) => ({ ...item }));
  const groupSort: DslDerivedViewGroupSort[] = [];

  for (const item of sort) {
    const target = item.target;
    const targetRef = isAliasSortTarget(target) ? target.alias : target.ref;
    if (isQualifiedSortTarget(target) && target.scope) {
      const join = joinScopeByAlias(scope, target.scope, target.span ?? item.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, target.ref, `${target.scope}."${target.ref}"`, target.span ?? item.span);
      if (isDiagnostic(field)) return field;
      const group = nextGroupBy.find((candidate) => sameDerivedJoinedGroupField(candidate, join, field));
      if (!group) return diagnostic(`grouped sort field "${field.name}" must also be in group by`, target.span ?? item.span);
      group.direction = item.direction;
      if (item.nullsFirst !== undefined) group.nullsFirst = item.nullsFirst;
      continue;
    }

    const aggregate = aggregations.find((candidate) => normalizeRefKey(candidate.label) === normalizeRefKey(targetRef));
    if (aggregate) {
      groupSort.push({
        key: aggregate.key,
        direction: item.direction,
        ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}),
      });
      continue;
    }

    const formulaAggregate = formulaAggregations.find((candidate) => normalizeRefKey(candidate.ref) === normalizeRefKey(targetRef));
    if (formulaAggregate) {
      groupSort.push({
        key: aggregateOutputKey(formulaAggregate.id, formulaAggregate.agg),
        direction: item.direction,
        ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}),
      });
      continue;
    }

    const column = derivedColumnByRef(columns, targetRef, item.span);
    if (isDiagnostic(column)) return diagnostic(`grouped sort alias "${targetRef}" must be a group field or aggregate alias`, item.span);
    const group = nextGroupBy.find((candidate) => sameDerivedGroupColumn(candidate, column));
    if (!group) return diagnostic(`grouped sort field "${column.label}" must also be in group by`, item.span);
    group.direction = item.direction;
    if (item.nullsFirst !== undefined) group.nullsFirst = item.nullsFirst;
  }

  return { groupBy: nextGroupBy, groupSort };
};

const resolveDerivedViewSourcePlan = (ast: DslQueryAst, source: ResolvedSource, ctx: DslResolverContext): DslSqlQueryPlanResolveResult => {
  const diagnostics: DslResolverDiagnostic[] = [];
  if (ast.includeDeleted || ast.deletedOnly) {
    diagnostics.push(diagnostic("deleted-row clauses belong inside the saved view source, not on derived view output"));
  }
  if (source.baseQuery.recordMeta) {
    diagnostics.push(diagnostic("view sources with record metadata cannot be used as derived views yet", source.span));
  }

  const fields = aliveFields(ctx.fieldsByTableId[source.tableId] ?? []);
  const columns = derivedViewColumns(source.baseQuery, fields);
  if (isDiagnostic(columns)) diagnostics.push(columns);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  if (isDiagnostic(columns)) return { ok: false, diagnostics: [columns] };

  const scope = createScope(fields, ctx, source.tableId, ast.sourceAlias);
  const joins = resolveDerivedJoins(ast.joins, columns, source, scope, ctx);
  if (joins.diagnostics.length > 0) return { ok: false, diagnostics: joins.diagnostics };

  const where = resolveDerivedWhere(ast.where, columns, scope);
  if (isDiagnostic(where)) return { ok: false, diagnostics: [where] };
  const search = resolveDerivedSearch(ast.search, columns, scope);
  if (isDiagnostic(search)) return { ok: false, diagnostics: [search] };

  const groupedShape = ast.groupBy.length > 0 || ast.aggregations.length > 0 || Boolean(ast.having);
  if (groupedShape) {
    if (ast.select.length > 0)
      return {
        ok: false,
        diagnostics: [
          diagnostic("grouped derived view source queries use group and aggregate output, not select columns", ast.select[0]?.span),
        ],
      };

    const groupBy = resolveDerivedGroupBy(ast.groupBy, columns, scope);
    if (isDiagnostic(groupBy)) return { ok: false, diagnostics: [groupBy] };
    if (ast.having && groupBy.length === 0)
      return { ok: false, diagnostics: [diagnostic("having requires a grouped query", ast.having.span)] };

    const aggregateOnly = ast.aggregations.length > 0 && groupBy.length === 0;
    if (aggregateOnly && ast.sort.length > 0) {
      return { ok: false, diagnostics: [diagnostic("aggregate-only derived view source queries cannot sort", ast.sort[0]?.span)] };
    }

    const aggregations = resolveDerivedAggregations(
      ast.aggregations,
      columns,
      scope,
      groupBy.map((group) => group.label),
    );
    if (aggregations.diagnostics.length > 0) return { ok: false, diagnostics: aggregations.diagnostics };
    const having = ast.having
      ? resolveDerivedHavingPredicate(ast.having, aggregations.aggregations, aggregations.formulaAggregations)
      : undefined;
    if (isDiagnostic(having)) return { ok: false, diagnostics: [having] };
    const groupedSort =
      groupBy.length > 0
        ? resolveDerivedGroupedSort(ast.sort, columns, scope, groupBy, aggregations.aggregations, aggregations.formulaAggregations)
        : undefined;
    if (isDiagnostic(groupedSort)) return { ok: false, diagnostics: [groupedSort] };

    return {
      ok: true,
      plan: {
        source: source.source,
        tableId: source.tableId,
        ...(ast.sourceAlias ? { sourceAlias: ast.sourceAlias } : {}),
        query: ast.limit !== undefined ? { limit: ast.limit } : {},
        readableTableIds: ctx.tables.map((table) => table.id),
        diagnosticSpans: diagnosticSpansForAst(
          ast,
          groupBy.map((group) => group.label),
        ),
        ...(ast.offset !== undefined ? { offset: ast.offset } : {}),
        derivedViewSource: {
          query: source.baseQuery,
          columns,
          outputColumns: [],
          sort: [],
          ...(joins.joins.length > 0 ? { joins: joins.joins } : {}),
          ...(joins.relationJoins.length > 0 ? { relationJoins: joins.relationJoins } : {}),
          ...(search?.search ? { search: search.search } : {}),
          ...(search && search.joinedSearch.length > 0 ? { joinedSearch: search.joinedSearch } : {}),
          ...(where ? { where } : {}),
          ...(groupedSort ? { groupBy: groupedSort.groupBy } : groupBy.length > 0 ? { groupBy } : {}),
          ...(aggregations.aggregations.length > 0 ? { aggregations: aggregations.aggregations } : {}),
          ...(aggregations.formulaAggregations.length > 0 ? { formulaAggregations: aggregations.formulaAggregations } : {}),
          ...(groupedSort && groupedSort.groupSort.length > 0 ? { groupSort: groupedSort.groupSort } : {}),
          ...(having && !isDiagnostic(having) ? { having } : {}),
        },
      },
    };
  }

  const output = resolveDerivedSelect(ast.select, columns, scope);
  if (isDiagnostic(output)) return { ok: false, diagnostics: [output] };
  const sort = resolveDerivedSort(ast.sort, columns, scope);
  if (isDiagnostic(sort)) return { ok: false, diagnostics: [sort] };
  if (output.outputColumns.length === 0 && output.joinedColumns.length === 0) {
    return { ok: false, diagnostics: [diagnostic("derived view source has no output columns", ast.select[0]?.span)] };
  }

  return {
    ok: true,
    plan: {
      source: source.source,
      tableId: source.tableId,
      ...(ast.sourceAlias ? { sourceAlias: ast.sourceAlias } : {}),
      query: ast.limit !== undefined ? { limit: ast.limit } : {},
      readableTableIds: ctx.tables.map((table) => table.id),
      diagnosticSpans: diagnosticSpansForAst(ast),
      ...(ast.offset !== undefined ? { offset: ast.offset } : {}),
      derivedViewSource: {
        query: source.baseQuery,
        columns,
        outputColumns: output.outputColumns,
        sort: sort.sort,
        ...(output.joinedColumns.length > 0 ? { joinedColumns: output.joinedColumns } : {}),
        ...(sort.joinedSort.length > 0 ? { joinedSort: sort.joinedSort } : {}),
        ...(joins.joins.length > 0 ? { joins: joins.joins } : {}),
        ...(joins.relationJoins.length > 0 ? { relationJoins: joins.relationJoins } : {}),
        ...(search?.search ? { search: search.search } : {}),
        ...(search && search.joinedSearch.length > 0 ? { joinedSearch: search.joinedSearch } : {}),
        ...(where ? { where } : {}),
      },
    },
  };
};

const hasDerivedColumnRef = (columns: DslDerivedViewColumn[], ref: string): boolean => {
  const key = normalizeRefKey(ref);
  return columns.some((column) => column.refs.some((candidate) => normalizeRefKey(candidate) === key));
};

const derivedAggregateAliasConflictDiagnostic = (
  alias: string,
  columns: DslDerivedViewColumn[],
  scope: Scope,
  groupLabels: string[],
  span?: DslSourceSpan,
): DslResolverDiagnostic | null => {
  if (hasLabelRef(groupLabels, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with a group field`, span);
  if (hasAnyOutputAlias(scope, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with an existing output alias`, span);
  if (hasDerivedColumnRef(columns, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with a derived column`, span);
  return null;
};

const mergeScopedFilter = (baseFilter: RecordQuery["filter"], dslFilter: RecordQuery["filter"]): RecordQuery["filter"] => {
  if (!baseFilter) return dslFilter;
  if (!dslFilter) return baseFilter;
  return { op: "AND", filters: [baseFilter, dslFilter] };
};

/**
 * Resolve to the RecordQuery runtime shape. There is a single resolver — this
 * runs the full QueryPlan resolver, then accepts the result only when the
 * records-table endpoint can carry it directly. Richer GQL still resolves and
 * previews through the SQL plan, but this compatibility helper reports why it
 * cannot be downgraded to RecordQuery.
 */
export const resolveDslQueryToRecordQuery = (ast: DslQueryAst, ctx: DslResolverContext): DslResolveResult => {
  const resolved = resolveDslQueryToQueryPlan(ast, ctx);
  if (!resolved.ok) return resolved;
  const plan = resolved.plan;

  const blocker = recordQueryBlocker(plan, ast);
  if (blocker) return { ok: false, diagnostics: [blocker] };

  // When the user wrote no select/group/aggregate, leave `columns` unset so the
  // saved view follows the table's live columns instead of freezing the
  // auto-expanded all-fields list the preview uses for its output.
  const autoColumns = ast.select.length === 0 && ast.groupBy.length === 0 && ast.aggregations.length === 0 && !ast.having;
  const query = autoColumns ? withoutColumns(plan.query) : plan.query;

  return { ok: true, plan: { source: plan.source, tableId: plan.tableId, query } };
};

export const resolveDslQueryToQueryPlan = (ast: DslQueryAst, ctx: DslResolverContext): DslSqlQueryPlanResolveResult => {
  const errors: DslResolverDiagnostic[] = [];
  const source = resolveSource(ast.source, ctx);
  if (isDiagnostic(source)) return { ok: false, diagnostics: [source] };
  if (isDerivedViewSource(source)) return resolveDerivedViewSourcePlan(ast, source, ctx);
  const sourceCompatibility = validateViewSource(source);
  if (sourceCompatibility) return { ok: false, diagnostics: [sourceCompatibility] };

  const fields = aliveFields(ctx.fieldsByTableId[source.tableId] ?? []);
  const scope = createScope(fields, ctx, source.tableId, ast.sourceAlias);
  const joinedGrouped = ast.joins.length > 0 && hasGroupedDslShape(ast);

  const joins = resolveJoins(ast.joins, source, scope, ctx);
  errors.push(...joins.diagnostics);

  const select = resolveQueryPlanSelect(ast.select, scope);
  if (isDiagnostic(select)) errors.push(select);

  let whereFilter: FilterTree | undefined;
  let whereRecordMeta: RecordMetaQuery | undefined;
  let wherePredicate: DslWherePredicate | undefined;
  if (ast.where) {
    const resolved = resolveWhere(ast.where, scope);
    if (resolved.kind === "error") errors.push(resolved.diagnostic);
    else if (resolved.kind === "filter") {
      whereFilter = resolved.tree;
      whereRecordMeta = resolved.recordMeta;
    } else wherePredicate = resolved.node;
  }

  const search = resolveSearch(ast.search, scope);
  errors.push(...search.diagnostics);

  const groupBy = resolveGroupBy(ast.groupBy, scope, { joinedQuery: joinedGrouped });
  if (isDiagnostic(groupBy)) errors.push(groupBy);
  const effectiveGroupCount = !isDiagnostic(groupBy) ? groupBy.sqlGroupBy.length : 0;
  if (ast.having && !isDiagnostic(groupBy) && effectiveGroupCount === 0 && (source.baseQuery.groupBy?.length ?? 0) === 0) {
    errors.push(diagnostic("having requires a grouped query", ast.having.span));
  }

  const aggregateOnly = !isDiagnostic(groupBy) && ast.aggregations.length > 0 && effectiveGroupCount === 0;
  const sqlAggregations = resolveSqlAggregations(ast.aggregations, scope, {
    grouped: !aggregateOnly,
    joinedQuery: joinedGrouped,
    groupLabels: !isDiagnostic(groupBy) ? groupBy.sqlGroupBy.map((group) => group.label ?? group.fieldId) : [],
  });
  errors.push(...sqlAggregations.diagnostics);
  if (aggregateOnly) {
    if (ast.select.length > 0) errors.push(diagnostic("aggregate-only DSL queries cannot select row fields", ast.select[0]?.span));
    if (ast.sort.length > 0) errors.push(diagnostic("aggregate-only DSL queries cannot sort", ast.sort[0]?.span));
  }
  const formulaHaving = ast.having ? resolveHavingPredicate(ast.having, ast.aggregations, scope) : undefined;
  if (isDiagnostic(formulaHaving)) errors.push(formulaHaving);

  const sqlOnlyGroupedPlan = !isDiagnostic(groupBy) && groupBy.sqlGroupBy.length !== groupBy.viewGroupBy.length;
  const usesSqlGroupedPlan = !isDiagnostic(groupBy) && (joinedGrouped || sqlOnlyGroupedPlan);
  const groupedSort =
    !usesSqlGroupedPlan && !isDiagnostic(groupBy) && groupBy.viewGroupBy.length > 0
      ? resolveGroupedQueryPlanSort(ast.sort, scope, groupBy.viewGroupBy, sqlAggregations.aggregations, sqlAggregations.formulaAggregations)
      : undefined;
  if (isDiagnostic(groupedSort)) errors.push(groupedSort);

  const sqlGroupedSort =
    usesSqlGroupedPlan && !isDiagnostic(groupBy)
      ? resolveSqlGroupedQueryPlanSort(
          ast.sort,
          scope,
          groupBy.sqlGroupBy,
          sqlAggregations.sqlAggregations,
          sqlAggregations.formulaAggregations,
        )
      : undefined;
  if (isDiagnostic(sqlGroupedSort)) errors.push(sqlGroupedSort);

  const sort = groupedSort === undefined && sqlGroupedSort === undefined ? resolveQueryPlanSort(ast.sort, scope) : undefined;
  if (isDiagnostic(sort)) errors.push(sort);

  if (errors.length > 0) return { ok: false, diagnostics: errors };
  if (isDiagnostic(select)) return { ok: false, diagnostics: [select] };
  if (isDiagnostic(groupBy)) return { ok: false, diagnostics: [groupBy] };
  if (isDiagnostic(formulaHaving)) return { ok: false, diagnostics: [formulaHaving] };
  if (isDiagnostic(groupedSort)) return { ok: false, diagnostics: [groupedSort] };
  if (isDiagnostic(sqlGroupedSort)) return { ok: false, diagnostics: [sqlGroupedSort] };
  if (isDiagnostic(sort)) return { ok: false, diagnostics: [sort] };

  // The view source's saved filter merges into the where: as a plain AND in
  // pure-filter mode, folded into the predicate tree in formula/NOT mode so it
  // still applies in SQL exactly once.
  const scopedViewSource = viewSourceNeedsRecordScope(source);
  const { filter: baseFilter, ...baseQueryRestWithSourceScope } = source.baseQuery;
  let baseQueryRest: Omit<RecordQuery, "filter"> = baseQueryRestWithSourceScope;
  if (scopedViewSource) {
    const { search: _search, recordMeta: _recordMeta, ...rest } = baseQueryRest;
    baseQueryRest = rest;
  }
  if (hasGroupedDslShape(ast)) {
    const { columns: _columns, sort: _sort, limit: _limit, ...rest } = baseQueryRest;
    baseQueryRest = rest;
  }
  if (wherePredicate && baseFilter) {
    wherePredicate = { kind: "and", parts: [{ kind: "tree", tree: baseFilter }, wherePredicate] };
  }
  const scopedFilter = wherePredicate ? undefined : mergeScopedFilter(baseFilter, whereFilter);
  const scopedRecordMeta = mergeRecordMeta(baseQueryRest.recordMeta, whereRecordMeta);
  const resolvedGroupBy = usesSqlGroupedPlan ? [] : groupedSort ? groupedSort.groupBy : groupBy.viewGroupBy;
  const defaultColumns =
    ast.select.length === 0 && groupBy.sqlGroupBy.length === 0 && ast.aggregations.length === 0 && !ast.having
      ? fields.filter((field) => isDefaultSelectableField(field, scope)).map((field) => ({ fieldId: field.id }))
      : undefined;
  const query: RecordQuery = {
    ...baseQueryRest,
    ...(scopedFilter !== undefined ? { filter: scopedFilter } : {}),
    ...(scopedRecordMeta ? { recordMeta: scopedRecordMeta } : {}),
    ...(select.columns !== undefined ? { columns: select.columns } : defaultColumns !== undefined ? { columns: defaultColumns } : {}),
    ...(resolvedGroupBy.length > 0 ? { groupBy: resolvedGroupBy } : {}),
    ...(sqlAggregations.aggregations.length > 0 ? { aggregations: sqlAggregations.aggregations } : {}),
    ...(groupedSort && groupedSort.groupSort.length > 0 ? { groupSort: groupedSort.groupSort } : {}),
    ...(search.searchSpec ? { search: search.searchSpec } : {}),
    ...(sort && sort.viewSort.length > 0 ? { sort: sort.viewSort } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
    ...(ast.deletedOnly ? { deletedOnly: true } : ast.includeDeleted ? { includeDeleted: true } : {}),
  };

  const parsed = RecordQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, diagnostics: [diagnostic("resolved query does not match the RecordQuery contract")] };
  }

  const plan: DslResolvedSqlQueryPlan = {
    source: source.source,
    tableId: source.tableId,
    ...(ast.sourceAlias ? { sourceAlias: ast.sourceAlias } : {}),
    query: parsed.data,
    readableTableIds: [...scope.readableTableIds],
    diagnosticSpans: diagnosticSpansForAst(
      ast,
      groupBy.sqlGroupBy.map((group) => group.label ?? group.fieldId),
    ),
    ...(scopedViewSource ? { viewSourceQuery: source.baseQuery } : {}),
    ...(ast.offset !== undefined ? { offset: ast.offset } : {}),
    ...(joins.joins.length > 0 ? { joins: joins.joins } : {}),
    ...(!isDiagnostic(select) && select.outputColumns.length > 0 ? { outputColumns: select.outputColumns } : {}),
    ...(!isDiagnostic(select) && select.joinedColumns.length > 0 ? { joinedColumns: select.joinedColumns } : {}),
    ...(sort && sort.sqlSort.length > 0 ? { sqlSort: sort.sqlSort } : {}),
    ...(usesSqlGroupedPlan
      ? {
          sqlGroupBy: sqlGroupedSort ? sqlGroupedSort.sqlGroupBy : groupBy.sqlGroupBy,
          ...(sqlGroupedSort && sqlGroupedSort.sqlGroupSort.length > 0 ? { sqlGroupSort: sqlGroupedSort.sqlGroupSort } : {}),
          sqlAggregations: sqlAggregations.sqlAggregations,
        }
      : {}),
    ...(search.sqlSearch.length > 0 ? { sqlSearch: search.sqlSearch } : {}),
    ...(groupedSort && groupedSort.formulaGroupSort.length > 0 ? { formulaGroupSort: groupedSort.formulaGroupSort } : {}),
    ...(sqlAggregations.formulaAggregations.length > 0 ? { formulaAggregations: sqlAggregations.formulaAggregations } : {}),
    ...(wherePredicate ? { wherePredicate } : {}),
    ...(formulaHaving && !isDiagnostic(formulaHaving) ? { formulaHaving } : {}),
  };

  return { ok: true, plan };
};
