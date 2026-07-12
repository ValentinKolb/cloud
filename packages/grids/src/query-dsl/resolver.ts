import { type FilterTree, type GroupSortSpec, type RecordMetaQuery, type RecordQuery, RecordQuerySchema } from "../contracts";
import {
  type DslFormulaAggregation,
  type DslFormulaHavingPredicate,
  type DslResolvedSqlAggregation,
  resolveHavingPredicate,
  resolveSqlAggregations,
} from "./resolver-aggregates";
import type { DslResolverContext, DslTableSource, DslViewSource } from "./resolver-context";
import { type DslResolvedDerivedViewSource, resolveDerivedViewSourcePlan } from "./resolver-derived-source";
import {
  type DslPlanDiagnosticSpans,
  type DslResolverDiagnostic,
  diagnostic,
  diagnosticSpansForAst,
  isResolverDiagnostic as isDiagnostic,
} from "./resolver-diagnostics";
import {
  type DslResolvedSqlGroupBy,
  type DslResolvedSqlGroupSort,
  type DslResolvedSqlSort,
  resolveGroupBy,
  resolveGroupedQueryPlanSort,
  resolveQueryPlanSort,
  resolveSqlGroupedQueryPlanSort,
} from "./resolver-group-sort";
import { type DslResolvedRelationJoin, resolveJoins } from "./resolver-joins";
import { type DslJoinedColumn, type DslOutputColumn, resolveQueryPlanSelect } from "./resolver-output";
import { recordQueryBlocker, withoutColumns } from "./resolver-record-query";
import { aliveFields, createScope, isDefaultSelectableField } from "./resolver-scope";
import { type DslResolvedSqlSearch, resolveSearch } from "./resolver-search";
import { isDerivedViewSource, resolveSource, validateViewSource, viewSourceNeedsRecordScope } from "./resolver-source";
import { type DslWherePredicate, mergeRecordMeta, resolveWhere } from "./resolver-where";
import type { DslQueryAst } from "./types";

export type { DslFormulaAggregation, DslResolvedSqlAggregation } from "./resolver-aggregates";
export type { DslResolverContext, DslTableSource, DslViewSource } from "./resolver-context";
export type { DslDerivedViewColumn } from "./resolver-derived-columns";
export { derivedViewColumns } from "./resolver-derived-columns";
export type { DslDerivedViewAggregation, DslDerivedViewGroupBy } from "./resolver-derived-source";
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

type DslResolveResult = { ok: true; plan: DslResolvedQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

type DslSqlQueryPlanResolveResult = { ok: true; plan: DslResolvedSqlQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

const hasGroupedDslShape = (ast: DslQueryAst): boolean => ast.groupBy.length > 0 || ast.aggregations.length > 0 || Boolean(ast.having);

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
