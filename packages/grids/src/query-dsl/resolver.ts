import { sql } from "bun";
import {
  type AggregationSpec,
  type FilterTree,
  type GroupSortSpec,
  type RecordMetaQuery,
  type RecordMetaSortKey,
  type RecordMetaUserKey,
  type RecordQuery,
  RecordQuerySchema,
} from "../contracts";
import type { Expr, Literal } from "../formula/types";
import { formatIdentifierRef, normalizeRefKey, parseQualifiedIdentifierRef } from "../ref-syntax";
import {
  aggregateOutputKey,
  aggregateSqlTypeForField,
  aggregateSqlTypeForFormula,
  isAggregateKind,
  isFieldAggregatable,
  isFormulaAggregatable,
} from "../service/aggregate-capabilities";
import { groupSqlTypeForField, storageOf } from "../service/field-storage";
import {
  compileFormulaAstToSql,
  compileFormulaPredicateAstToSql,
  type FormulaSqlExpression,
  type FormulaSqlType,
  formulaSqlTypeForField,
} from "../service/formula-sql-compiler";
import { type GroupAggregationSpec, type GroupHavingRef, isGroupable } from "../service/group-compiler";
import { filterSearchableFields } from "../service/search";
import type { Field } from "../service/types";
import { createDslScopedFormulaFieldResolver, isScopedFormulaFieldRef } from "./scoped-formula";
import type {
  DslAggregateItem,
  DslGroupItem,
  DslJoin,
  DslQualifiedRef,
  DslQueryAst,
  DslSelectItem,
  DslSortItem,
  DslSourceRef,
  DslSourceSpan,
} from "./types";

export type DslResolverDiagnostic = {
  line?: number;
  column?: number;
  length?: number;
  message: string;
};

export type DslTableSource = {
  kind: "table";
  id: string;
  shortId: string;
  name: string;
};

export type DslViewSource = {
  kind: "view";
  id: string;
  shortId: string;
  name: string;
  tableId: string;
  source?: string;
  query: RecordQuery;
};

export type DslResolverContext = {
  currentTable?: DslTableSource;
  tables: DslTableSource[];
  views?: DslViewSource[];
  fieldsByTableId: Record<string, Field[]>;
};

type DslResolvedQueryPlan = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  sourceAlias?: string;
  query: RecordQuery;
  offset?: number;
};

type DslFormulaPredicate = {
  kind: "formula";
  source: string;
  expression: Expr;
  sqlType: FormulaSqlType;
};

type DslFormulaHavingPredicate = DslFormulaPredicate & {
  aggregateRefs: GroupHavingRef[];
};

export type DslFormulaAggregation = Extract<GroupAggregationSpec, { kind: "formula" }> & {
  ref: string;
  source: string;
  sqlType: FormulaSqlType;
};

export type DslResolvedSqlGroupBy = {
  fieldId: string;
  tableId: string;
  joinAlias?: string;
  label?: string;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
  direction?: "asc" | "desc";
  nullsFirst?: boolean;
};

type DslResolvedSqlGroupSort = GroupSortSpec & {
  nullsFirst?: boolean;
};

export type DslResolvedSqlAggregation = {
  fieldId: string | "*";
  tableId?: string;
  joinAlias?: string;
  agg: DslAggregateItem["fn"];
  label?: string;
};

export type DslResolvedRelationJoin = {
  mode: DslJoin["mode"];
  alias: string;
  direction: "forward" | "reverse";
  source: DslTableSource;
  tableId: string;
  fromScope: string | null;
  fromTableId: string;
  relationFieldId: string;
  depth: number;
};

export type DslJoinedColumn = {
  joinAlias: string;
  tableId: string;
  fieldId: string;
  label?: string;
};

export type DslOutputColumn =
  | {
      kind: "field";
      fieldId: string;
      label?: string;
    }
  | {
      kind: "computed";
      id: string;
      label: string;
      expression: string;
    }
  | ({ kind: "joined" } & DslJoinedColumn);

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

type DslPlanDiagnosticSpans = {
  source?: DslSourceSpan;
  where?: DslSourceSpan;
  having?: DslSourceSpan;
  search?: DslSourceSpan;
  select?: Array<{ label: string; span?: DslSourceSpan }>;
  groupBy?: Array<{ label: string; span?: DslSourceSpan }>;
  aggregations?: Array<{ alias: string; span?: DslSourceSpan }>;
  sort?: DslSourceSpan[];
};

export type DslResolvedSqlSort =
  | {
      kind: "field";
      fieldId: string;
      direction: "asc" | "desc";
      nullsFirst?: boolean;
    }
  | {
      kind: "computed";
      alias: string;
      direction: "asc" | "desc";
      nullsFirst?: boolean;
    }
  | {
      kind: "joined";
      alias: string;
      direction: "asc" | "desc";
      nullsFirst?: boolean;
    }
  | {
      kind: "joinedField";
      joinAlias: string;
      tableId: string;
      fieldId: string;
      direction: "asc" | "desc";
      nullsFirst?: boolean;
    };

type DslResolvedSqlSearch = {
  q: string;
  tableId: string;
  joinAlias: string;
  fieldIds: string[];
};

export type DslDerivedViewColumn = {
  kind: "group" | "aggregate";
  key: string;
  label: string;
  refs: string[];
  sqlType: FormulaSqlType | "json";
  type: string;
  fieldId?: string;
  targetTableId?: string;
  agg?: string;
};

export type DslResolvedDerivedRelationJoin = {
  mode: DslJoin["mode"];
  alias: string;
  source: DslTableSource;
  tableId: string;
  column: DslDerivedViewColumn;
  depth: number;
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

type ResolvedSource = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  baseQuery: RecordQuery;
  span?: DslSourceSpan;
};

const diagnosticSpansForAst = (ast: DslQueryAst, groupLabels?: string[]): DslPlanDiagnosticSpans => ({
  ...(ast.source?.span ? { source: ast.source.span } : {}),
  ...(ast.where?.span ? { where: ast.where.span } : {}),
  ...(ast.having?.span ? { having: ast.having.span } : {}),
  ...(ast.search?.span ? { search: ast.search.span } : {}),
  ...(ast.select.length > 0
    ? {
        select: ast.select.map((item) => ({
          label: item.alias ?? (item.kind === "field" ? item.field.ref : item.alias),
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.groupBy.length > 0
    ? {
        groupBy: ast.groupBy.map((item, index) => ({
          label: groupLabels?.[index] ?? item.field.ref,
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.aggregations.length > 0
    ? {
        aggregations: ast.aggregations.map((item) => ({
          alias: item.alias,
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.sort.length > 0 ? { sort: ast.sort.map((item) => item.span).filter((span): span is DslSourceSpan => Boolean(span)) } : {}),
});

type Scope = {
  tableId: string;
  sourceAlias?: string;
  fields: Field[];
  byRef: Map<string, Field[]>;
  readableTableIds: Set<string>;
  joins: Map<string, JoinScope>;
  fieldAliases: Map<string, string>;
  joinedAliases: Set<string>;
  computedAliases: Set<string>;
  /** Type-only stand-in for lookup/rollup fields so resolve-time formula
   *  validation accepts them; real SQL is injected at compile time. */
  computedStub: Map<string, FormulaSqlExpression>;
};

type JoinScope = {
  alias: string;
  tableId: string;
  source: DslTableSource;
  fields: Field[];
  byRef: Map<string, Field[]>;
  computedStub: Map<string, FormulaSqlExpression>;
  depth: number;
};

const MAX_JOIN_COUNT = 5;
const MAX_JOIN_DEPTH = 3;
const FORMULA_AGGREGATE_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

const diagnostic = (message: string, span?: DslSourceSpan): DslResolverDiagnostic => ({
  ...(span ? { line: span.line, column: span.column, length: span.length } : {}),
  message,
});

const spanForExpr = (base: DslSourceSpan | undefined, expr: Expr): DslSourceSpan | undefined =>
  base && expr.span
    ? {
        line: base.line,
        column: base.column + expr.span.start,
        length: Math.max(expr.span.end - expr.span.start, 1),
      }
    : base;

const aliveFields = (fields: Field[]): Field[] => fields.filter((field) => !field.deletedAt).sort((a, b) => a.position - b.position);

const addFieldRef = (map: Map<string, Field[]>, ref: string | null | undefined, field: Field): void => {
  if (!ref) return;
  const key = normalizeRefKey(ref);
  const existing = map.get(key) ?? [];
  if (!existing.some((item) => item.id === field.id)) existing.push(field);
  map.set(key, existing);
};

const buildFieldMap = (fields: Field[]): Map<string, Field[]> => {
  const map = new Map<string, Field[]>();
  for (const field of fields) {
    addFieldRef(map, field.shortId, field);
    addFieldRef(map, field.id, field);
    addFieldRef(map, field.name, field);
  }
  return map;
};

const buildComputedStub = (fields: Field[]): Map<string, FormulaSqlExpression> =>
  new Map(
    fields
      .filter((field) => !field.deletedAt && (field.type === "lookup" || field.type === "rollup"))
      .map((field) => [field.id, { sql: sql`NULL`, type: "unknown" as const }]),
  );

const createScope = (fields: Field[], ctx: DslResolverContext, tableId: string, sourceAlias?: string): Scope => ({
  tableId,
  ...(sourceAlias ? { sourceAlias } : {}),
  fields,
  byRef: buildFieldMap(fields),
  readableTableIds: new Set(ctx.tables.map((table) => table.id)),
  joins: new Map(),
  fieldAliases: new Map(),
  joinedAliases: new Set(),
  computedAliases: new Set(),
  computedStub: buildComputedStub(fields),
});

const relationTargetTableId = (field: Field): string | null => {
  if (field.type !== "relation") return null;
  return (field.config as { targetTableId?: string }).targetTableId ?? null;
};

const relationOutputDiagnostic = (field: Field, scope: Scope): DslResolverDiagnostic | null => {
  const targetTableId = relationTargetTableId(field);
  if (!targetTableId || scope.readableTableIds.has(targetTableId)) return null;
  return diagnostic(`relation field "${field.name}" target table is not available`);
};

const isDefaultSelectableField = (field: Field, scope: Scope): boolean => {
  const kind = storageOf(field).kind;
  if (kind === "unknown") return false;
  // Computed kinds: formula / lookup / rollup project to SQL; file does not.
  if (kind === "computed" && field.type !== "formula" && field.type !== "lookup" && field.type !== "rollup") return false;
  return relationOutputDiagnostic(field, scope) === null;
};

const resolveSource = (astSource: DslSourceRef | undefined, ctx: DslResolverContext): ResolvedSource | DslResolverDiagnostic => {
  if (!astSource) {
    if (!ctx.currentTable) return diagnostic("query needs a source table or view");
    return { source: ctx.currentTable, tableId: ctx.currentTable.id, baseQuery: {} };
  }

  const sourceMatches = (source: { id: string; shortId: string; name: string }) => {
    const ref = normalizeRefKey(astSource.ref);
    return normalizeRefKey(source.shortId) === ref || normalizeRefKey(source.id) === ref || normalizeRefKey(source.name) === ref;
  };
  const tables = ctx.tables.filter(sourceMatches);
  const views = (ctx.views ?? []).filter(sourceMatches);
  const matches = astSource.kind === "table" ? tables : views;

  if (matches.length === 0) return diagnostic(`source "${astSource.ref}" is not available`, astSource.span);
  if (matches.length > 1) return diagnostic(`source "${astSource.ref}" is ambiguous; use table or view`, astSource.span);

  const source = matches[0]!;
  if (source.kind === "view") return { source, tableId: source.tableId, baseQuery: source.query, span: astSource.span };
  return { source, tableId: source.id, baseQuery: {}, span: astSource.span };
};

const unsupportedViewSourceKeys = (query: RecordQuery): string[] => {
  const keys: string[] = [];
  if ((query.groupBy?.length ?? 0) > 0) keys.push("group by");
  if ((query.groupSort?.length ?? 0) > 0) keys.push("group sort");
  if ((query.aggregations?.length ?? 0) > 0) keys.push("aggregations");
  if ((query.groupedColumnOrder?.length ?? 0) > 0) keys.push("grouped column order");
  if ((query.hiddenGroupedColumns?.length ?? 0) > 0) keys.push("hidden grouped columns");
  return keys;
};

const validateViewSource = (source: ResolvedSource): DslResolverDiagnostic | null => {
  if (source.source.kind !== "view") return null;
  const unsupported = unsupportedViewSourceKeys(source.baseQuery);
  if (unsupported.length === 0) return null;
  return diagnostic(`view source uses ${unsupported.join(", ")}, but DSL view sources support only row-shaped saved views`, source.span);
};

const isDerivedViewSource = (source: ResolvedSource): boolean =>
  source.source.kind === "view" && ((source.baseQuery.groupBy?.length ?? 0) > 0 || (source.baseQuery.aggregations?.length ?? 0) > 0);

const sqlTypeForGroupField = (field: Field): DslDerivedViewColumn["sqlType"] => {
  return groupSqlTypeForField(field);
};

const uniqueRefs = (refs: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ref of refs) {
    const trimmed = ref?.trim();
    if (!trimmed) continue;
    const key = normalizeRefKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

export const derivedViewColumns = (query: RecordQuery, fields: Field[]): DslDerivedViewColumn[] | DslResolverDiagnostic => {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const columns: DslDerivedViewColumn[] = [];

  for (const [index, group] of (query.groupBy ?? []).entries()) {
    const field = fieldsById.get(group.fieldId);
    if (!field) return diagnostic(`view source group field ${group.fieldId} is not available`);
    const key = `gk_${index}`;
    const fallback = group.granularity ? `${field.name} (${group.granularity})` : field.name;
    const label = group.label?.trim() || fallback;
    const targetTableId = relationTargetTableId(field);
    columns.push({
      kind: "group",
      key,
      label,
      refs: uniqueRefs([key, label, field.id, field.shortId, field.name]),
      fieldId: field.id,
      ...(targetTableId ? { targetTableId } : {}),
      type: field.type,
      sqlType: sqlTypeForGroupField(field),
    });
  }

  for (const aggregation of query.aggregations ?? []) {
    const field = aggregation.fieldId === "*" ? null : fieldsById.get(aggregation.fieldId);
    if (aggregation.fieldId !== "*" && !field) return diagnostic(`view source aggregate field ${aggregation.fieldId} is not available`);
    const key = aggregateOutputKey(aggregation.fieldId, aggregation.agg);
    const fallback = aggregation.fieldId === "*" ? "# records" : `${aggregation.agg} ${field?.name ?? "value"}`;
    const label = aggregation.label?.trim() || fallback;
    columns.push({
      kind: "aggregate",
      key,
      label,
      refs: uniqueRefs([
        key,
        label,
        aggregation.label,
        aggregation.fieldId === "*" ? "count" : `${aggregation.agg} ${field?.name ?? ""}`,
        aggregation.fieldId === "*" ? "rows" : undefined,
      ]),
      fieldId: aggregation.fieldId,
      agg: aggregation.agg,
      type: "aggregate",
      sqlType: aggregateSqlTypeForField(field ?? null, aggregation.agg, aggregation.fieldId === "*"),
    });
  }

  return columns;
};

const derivedColumnByRef = (
  columns: DslDerivedViewColumn[],
  ref: string,
  span?: DslSourceSpan,
): DslDerivedViewColumn | DslResolverDiagnostic => {
  const key = normalizeRefKey(ref);
  const matches = columns.filter((column) => column.refs.some((candidate) => normalizeRefKey(candidate) === key));
  if (matches.length === 0) return diagnostic(`unknown derived column "${ref}"`, span);
  if (matches.length > 1) return diagnostic(`ambiguous derived column "${ref}"`, span);
  return matches[0]!;
};

const derivedColumnSqlType = (column: DslDerivedViewColumn): FormulaSqlType => (column.sqlType === "json" ? "unknown" : column.sqlType);

const formulaSqlTypeForDerivedField = (field: Field): FormulaSqlType | "json" => {
  const kind = storageOf(field).kind;
  if (kind === "relationLink" || kind === "jsonbArray") return "text";
  return formulaSqlTypeForField(field);
};

const createDerivedFormulaFieldResolver =
  (columns: DslDerivedViewColumn[], recordAlias: string): ((ref: string) => FormulaSqlExpression | string | null) =>
  (ref) => {
    const column = derivedColumnByRef(columns, ref);
    if ("message" in column) return column.message;
    return { sql: sql`${sql.unsafe(`${recordAlias}."${column.key}"`)}`, type: derivedColumnSqlType(column) };
  };

const createDerivedScopedFormulaFieldResolver = (
  columns: DslDerivedViewColumn[],
  scope: Scope,
  recordAlias: string,
): ((ref: string) => FormulaSqlExpression | string | null) => {
  const scoped = scopedFormulaResolverForScope(scope);
  const derived = createDerivedFormulaFieldResolver(columns, recordAlias);
  return (ref) => scoped(ref) ?? derived(ref);
};

const isDerivedSearchableColumn = (column: DslDerivedViewColumn): boolean => column.sqlType !== "json";

const resolveDerivedSearch = (
  search: DslQueryAst["search"],
  columns: DslDerivedViewColumn[],
  scope: Scope,
): { search?: DslResolvedDerivedViewSource["search"]; joinedSearch: DslResolvedSqlSearch[] } | DslResolverDiagnostic | undefined => {
  if (!search) return undefined;
  if (search.fields.length === 0) return { search: { q: search.q, columns: columns.filter(isDerivedSearchableColumn) }, joinedSearch: [] };

  const resolved: DslDerivedViewColumn[] = [];
  const joined = new Map<string, DslResolvedSqlSearch>();
  const seen = new Set<string>();
  for (const ref of search.fields) {
    if (ref.scope) {
      const join = joinScopeByAlias(scope, ref.scope, ref.span ?? search.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, ref.ref, `${ref.scope}."${ref.ref}"`, ref.span ?? search.span);
      if (isDiagnostic(field)) return field;
      if (!filterSearchableFields([field]).some((candidate) => candidate.id === field.id)) {
        return diagnostic(`field "${field.name}" (type "${field.type}") is not searchable`, ref.span ?? search.span);
      }
      const existing = joined.get(join.alias) ?? { q: search.q, tableId: join.tableId, joinAlias: join.alias, fieldIds: [] };
      if (!existing.fieldIds.includes(field.id)) existing.fieldIds.push(field.id);
      joined.set(join.alias, existing);
      continue;
    }
    const column = derivedColumnByRef(columns, ref.ref, ref.span ?? search.span);
    if (isDiagnostic(column)) return column;
    if (!isDerivedSearchableColumn(column))
      return diagnostic(`derived column "${column.label}" is not searchable`, ref.span ?? search.span);
    if (seen.has(column.key)) continue;
    seen.add(column.key);
    resolved.push(column);
  }
  return { ...(resolved.length > 0 ? { search: { q: search.q, columns: resolved } } : {}), joinedSearch: [...joined.values()] };
};

const viewSourceNeedsRecordScope = (source: ResolvedSource): boolean =>
  source.source.kind === "view" &&
  (source.baseQuery.limit !== undefined || source.baseQuery.search !== undefined || source.baseQuery.recordMeta !== undefined);

const hasGroupedDslShape = (ast: DslQueryAst): boolean => ast.groupBy.length > 0 || ast.aggregations.length > 0 || Boolean(ast.having);

const computedIdForAlias = (alias: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < alias.length; i++) {
    hash ^= alias.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `computed_${(hash >>> 0).toString(36).padStart(7, "0")}`;
};

const fieldByRef = (scope: Scope, ref: string, span?: DslSourceSpan): Field | DslResolverDiagnostic => {
  const fields = (scope.byRef.get(normalizeRefKey(ref)) ?? []).filter((field) => !field.deletedAt);
  if (fields.length === 0) return diagnostic(`unknown field "${ref}"`, span);
  if (fields.length > 1) return diagnostic(`ambiguous field "${ref}"`, span);
  return fields[0]!;
};

const fieldByRefMap = (byRef: Map<string, Field[]>, ref: string, label: string, span?: DslSourceSpan): Field | DslResolverDiagnostic => {
  const fields = (byRef.get(normalizeRefKey(ref)) ?? []).filter((field) => !field.deletedAt);
  if (fields.length === 0) return diagnostic(`unknown field ${label}`, span);
  if (fields.length > 1) return diagnostic(`ambiguous field ${label}`, span);
  return fields[0]!;
};

const aliasKey = (alias: string): string => normalizeRefKey(alias);
const hasJoinAlias = (scope: Scope, alias: string): boolean => scope.joins.has(aliasKey(alias));
const setJoinAlias = (scope: Scope, alias: string, join: JoinScope): void => {
  scope.joins.set(aliasKey(alias), join);
};
const refUsesAlias = (ref: DslQualifiedRef, alias: string): boolean => normalizeRefKey(ref.scope ?? "") === normalizeRefKey(alias);

const joinScopeByAlias = (scope: Scope, alias: string, span?: DslSourceSpan): JoinScope | DslResolverDiagnostic => {
  const join = scope.joins.get(aliasKey(alias));
  if (!join) return diagnostic(`unknown join alias "${alias}"`, span);
  return join;
};

const isDiagnostic = (value: unknown): value is DslResolverDiagnostic => typeof value === "object" && value !== null && "message" in value;

const isAliasSortTarget = (target: DslSortItem["target"]): target is Extract<DslSortItem["target"], { kind: "alias" }> =>
  "kind" in target && target.kind === "alias";

const isQualifiedSortTarget = (target: DslSortItem["target"]): target is DslQualifiedRef => !isAliasSortTarget(target);

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

const fieldAliasId = (scope: Scope, alias: string): string | null => {
  const key = normalizeRefKey(alias);
  for (const [candidate, fieldId] of scope.fieldAliases) {
    if (normalizeRefKey(candidate) === key) return fieldId;
  }
  return null;
};

const setHasAlias = (aliases: Set<string>, alias: string): boolean => {
  const key = normalizeRefKey(alias);
  for (const candidate of aliases) {
    if (normalizeRefKey(candidate) === key) return true;
  }
  return false;
};

const isBaseScope = (scope: Scope, alias: string | undefined): boolean =>
  Boolean(alias && scope.sourceAlias && normalizeRefKey(alias) === normalizeRefKey(scope.sourceAlias));

const hasAnyOutputAlias = (scope: Scope, alias: string): boolean =>
  hasJoinAlias(scope, alias) ||
  fieldAliasId(scope, alias) !== null ||
  setHasAlias(scope.joinedAliases, alias) ||
  setHasAlias(scope.computedAliases, alias) ||
  isBaseScope(scope, alias);

const hasFieldRef = (fields: Field[], alias: string): boolean => {
  const key = normalizeRefKey(alias);
  return fields.some((field) => !field.deletedAt && (normalizeRefKey(field.shortId) === key || normalizeRefKey(field.name) === key));
};

const aliasConflictDiagnostic = (scope: Scope, alias: string, span?: DslSourceSpan): DslResolverDiagnostic | null => {
  if (hasAnyOutputAlias(scope, alias)) return diagnostic(`duplicate select alias "${alias}"`, span);
  if (hasFieldRef(scope.fields, alias)) return diagnostic(`select alias "${alias}" conflicts with a source field`, span);
  return null;
};

const hasLabelRef = (labels: string[], ref: string): boolean => {
  const key = normalizeRefKey(ref);
  return labels.some((label) => normalizeRefKey(label) === key);
};

const aggregateAliasConflictDiagnostic = (
  scope: Scope,
  alias: string,
  groupLabels: string[],
  span?: DslSourceSpan,
): DslResolverDiagnostic | null => {
  if (hasLabelRef(groupLabels, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with a group field`, span);
  if (hasAnyOutputAlias(scope, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with an existing output alias`, span);
  if (hasFieldRef(scope.fields, alias)) return diagnostic(`aggregate alias "${alias}" conflicts with a source field`, span);
  return null;
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

const isSearchableField = (field: Field, fields: Field[]): boolean =>
  filterSearchableFields(fields).some((candidate) => candidate.id === field.id);

const sortAlias = (target: DslSortItem["target"], scope: Scope): string | null => {
  if (isAliasSortTarget(target)) return target.alias;
  if (target.scope) return null;
  const ref = target.ref;
  if (fieldAliasId(scope, ref) || setHasAlias(scope.joinedAliases, ref) || setHasAlias(scope.computedAliases, ref)) return ref;
  return null;
};

const resolveJoinedFieldItem = (item: Extract<DslSelectItem, { kind: "field" }>, scope: Scope): DslJoinedColumn | DslResolverDiagnostic => {
  if (!item.field.scope) return diagnostic("joined field resolver needs a scoped field", item.field.span);
  const join = joinScopeByAlias(scope, item.field.scope, item.field.span);
  if (isDiagnostic(join)) return join;
  const field = fieldByRefMap(join.byRef, item.field.ref, `${item.field.scope}."${item.field.ref}"`, item.field.span);
  if (isDiagnostic(field)) return field;
  const relationDiagnostic = relationOutputDiagnostic(field, scope);
  if (relationDiagnostic) return relationDiagnostic;
  return {
    joinAlias: join.alias,
    tableId: join.tableId,
    fieldId: field.id,
    ...(item.alias ? { label: item.alias } : {}),
  };
};

const scopedFormulaResolverForScope = (scope: Scope) =>
  createDslScopedFormulaFieldResolver({
    base: {
      ...(scope.sourceAlias ? { alias: scope.sourceAlias } : {}),
      fields: scope.fields,
      recordAlias: "r",
      computedFieldSql: scope.computedStub,
    },
    joins: [...scope.joins.values()].map((join) => ({
      alias: join.alias,
      fields: join.fields,
      recordAlias: join.alias,
      computedFieldSql: join.computedStub,
    })),
  });

const resolveQueryPlanSelect = (
  select: DslSelectItem[],
  scope: Scope,
): { columns?: RecordQuery["columns"]; joinedColumns: DslJoinedColumn[]; outputColumns: DslOutputColumn[] } | DslResolverDiagnostic => {
  if (select.length === 0) return { joinedColumns: [], outputColumns: [] };
  const columns: NonNullable<RecordQuery["columns"]> = [];
  const joinedColumns: DslJoinedColumn[] = [];
  const outputColumns: DslOutputColumn[] = [];
  const computedIds = new Set<string>();

  for (const item of select) {
    const alias = item.kind === "field" ? item.alias : item.alias;
    if (alias) {
      const aliasConflict = aliasConflictDiagnostic(scope, alias, item.span);
      if (aliasConflict) return aliasConflict;
    }

    if (item.kind === "field") {
      if (isBaseScope(scope, item.field.scope)) {
        const field = fieldByRef(scope, item.field.ref, item.field.span);
        if (isDiagnostic(field)) return field;
        const relationDiagnostic = relationOutputDiagnostic(field, scope);
        if (relationDiagnostic) return relationDiagnostic;
        if (item.alias) scope.fieldAliases.set(item.alias, field.id);
        columns.push({ fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
        outputColumns.push({ kind: "field", fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
        continue;
      }
      if (item.field.scope) {
        const joined = resolveJoinedFieldItem(item, scope);
        if (isDiagnostic(joined)) return joined;
        if (item.alias) scope.joinedAliases.add(item.alias);
        joinedColumns.push(joined);
        outputColumns.push({ kind: "joined", ...joined });
        continue;
      }
      const field = fieldByRef(scope, item.field.ref, item.field.span);
      if (isDiagnostic(field)) return field;
      const relationDiagnostic = relationOutputDiagnostic(field, scope);
      if (relationDiagnostic) return relationDiagnostic;
      if (item.alias) scope.fieldAliases.set(item.alias, field.id);
      columns.push({ fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
      outputColumns.push({ kind: "field", fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
      continue;
    }

    const compiled = compileFormulaAstToSql(item.expression, {
      fields: scope.fields,
      computedFieldSql: scope.computedStub,
      resolveField: scopedFormulaResolverForScope(scope),
    });
    if (!compiled.ok) return diagnostic(`select "${item.alias}": ${compiled.error}`, item.span);
    scope.computedAliases.add(item.alias);
    const computedId = computedIdForAlias(item.alias);
    if (computedIds.has(computedId)) return diagnostic(`computed select id collision for alias "${item.alias}"`, item.span);
    computedIds.add(computedId);
    columns.push({
      kind: "computed",
      id: computedId,
      label: item.alias,
      expression: item.source,
    });
    outputColumns.push({
      kind: "computed",
      id: computedId,
      label: item.alias,
      expression: item.source,
    });
  }

  return { columns: columns.length > 0 ? columns : undefined, joinedColumns, outputColumns };
};

const mergeScopedFilter = (baseFilter: RecordQuery["filter"], dslFilter: RecordQuery["filter"]): RecordQuery["filter"] => {
  if (!baseFilter) return dslFilter;
  if (!dslFilter) return baseFilter;
  return { op: "AND", filters: [baseFilter, dslFilter] };
};

const scopedSource = (
  scope: Scope,
  source: ResolvedSource,
  alias: string | undefined,
): { tableId: string; fields: Field[]; byRef: Map<string, Field[]>; depth: number; alias?: string } | DslResolverDiagnostic => {
  if (!alias) return { tableId: source.tableId, fields: scope.fields, byRef: scope.byRef, depth: 0 };
  if (isBaseScope(scope, alias)) return { tableId: source.tableId, fields: scope.fields, byRef: scope.byRef, depth: 0 };
  const join = joinScopeByAlias(scope, alias);
  if (isDiagnostic(join)) return join;
  return join;
};

const resolveScopedField = (
  scope: Scope,
  ref: DslQualifiedRef,
): { field: Field; tableId: string; joinAlias?: string } | DslResolverDiagnostic => {
  if (isBaseScope(scope, ref.scope)) {
    const field = fieldByRef(scope, ref.ref, ref.span);
    if (isDiagnostic(field)) return field;
    return { field, tableId: scope.tableId };
  }
  if (ref.scope) {
    const join = joinScopeByAlias(scope, ref.scope, ref.span);
    if (isDiagnostic(join)) return join;
    const field = fieldByRefMap(join.byRef, ref.ref, `${ref.scope}."${ref.ref}"`, ref.span);
    if (isDiagnostic(field)) return field;
    return { field, tableId: join.tableId, joinAlias: join.alias };
  }
  const field = fieldByRef(scope, ref.ref, ref.span);
  if (isDiagnostic(field)) return field;
  return { field, tableId: scope.tableId };
};

const resolveJoinSource = (join: DslJoin, ctx: DslResolverContext): DslTableSource | DslResolverDiagnostic => {
  const source = resolveSource(join.source, ctx);
  if (isDiagnostic(source)) return source;
  if (source.source.kind !== "table") return diagnostic(`join "${join.alias}" must target a table source`, join.span);
  return source.source;
};

const resolveRelationJoin = (
  join: DslJoin,
  source: ResolvedSource,
  scope: Scope,
  ctx: DslResolverContext,
): DslResolvedRelationJoin | DslResolverDiagnostic => {
  const targetSource = resolveJoinSource(join, ctx);
  if (isDiagnostic(targetSource)) return targetSource;
  if (hasJoinAlias(scope, join.alias)) return diagnostic(`duplicate join alias "${join.alias}"`, join.span);
  const targetFields = aliveFields(ctx.fieldsByTableId[targetSource.id] ?? []);
  const targetByRef = buildFieldMap(targetFields);

  const leftUsesAlias = refUsesAlias(join.on.left, join.alias);
  const rightUsesAlias = refUsesAlias(join.on.right, join.alias);
  if (leftUsesAlias === rightUsesAlias)
    return diagnostic(`join "${join.alias}" must compare one relation field to ${join.alias}.id`, join.span);

  const aliasSide = leftUsesAlias ? join.on.left : join.on.right;
  const fromSide = aliasSide === join.on.left ? join.on.right : join.on.left;

  const from = scopedSource(scope, source, fromSide.scope);
  if (isDiagnostic(from)) return from;

  const depth = from.depth + 1;
  if (depth > MAX_JOIN_DEPTH) return diagnostic(`join depth exceeds ${MAX_JOIN_DEPTH}`, join.span);

  const setJoinScope = () => {
    setJoinAlias(scope, join.alias, {
      alias: join.alias,
      tableId: targetSource.id,
      source: targetSource,
      fields: targetFields,
      byRef: targetByRef,
      computedStub: buildComputedStub(targetFields),
      depth,
    });
  };

  if (normalizeRefKey(aliasSide.ref) === "id") {
    const relationField = fieldByRefMap(
      from.byRef,
      fromSide.ref,
      `${fromSide.scope ? `${fromSide.scope}.` : ""}"${fromSide.ref}"`,
      fromSide.span,
    );
    if (isDiagnostic(relationField)) return relationField;
    if (relationField.type !== "relation")
      return diagnostic(`join "${join.alias}" must start from a relation field`, fromSide.span ?? join.span);
    const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
    if (!targetTableId) return diagnostic(`join "${join.alias}" relation field has no target table`, fromSide.span ?? join.span);
    if (targetTableId !== targetSource.id)
      return diagnostic(`join "${join.alias}" target table does not match the relation field`, join.span);

    setJoinScope();
    return {
      mode: join.mode,
      alias: join.alias,
      direction: "forward",
      source: targetSource,
      tableId: targetSource.id,
      fromScope: from.alias ?? null,
      fromTableId: from.tableId,
      relationFieldId: relationField.id,
      depth,
    };
  }

  if (normalizeRefKey(fromSide.ref) !== "id")
    return diagnostic(`join "${join.alias}" must target ${join.alias}.id`, fromSide.span ?? join.span);
  const relationField = fieldByRefMap(targetByRef, aliasSide.ref, `${join.alias}."${aliasSide.ref}"`, aliasSide.span);
  if (isDiagnostic(relationField)) return relationField;
  if (relationField.type !== "relation")
    return diagnostic(`join "${join.alias}" must use a relation field on ${join.alias}`, aliasSide.span ?? join.span);
  const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
  if (!targetTableId) return diagnostic(`join "${join.alias}" relation field has no target table`, aliasSide.span ?? join.span);
  if (targetTableId !== from.tableId)
    return diagnostic(`join "${join.alias}" reverse target table does not match the source id`, join.span);

  setJoinScope();
  return {
    mode: join.mode,
    alias: join.alias,
    direction: "reverse",
    source: targetSource,
    tableId: targetSource.id,
    fromScope: from.alias ?? null,
    fromTableId: from.tableId,
    relationFieldId: relationField.id,
    depth,
  };
};

const resolveJoins = (
  joins: DslJoin[],
  source: ResolvedSource,
  scope: Scope,
  ctx: DslResolverContext,
): { joins: DslResolvedRelationJoin[]; diagnostics: DslResolverDiagnostic[] } => {
  const diagnostics: DslResolverDiagnostic[] = [];
  const resolved: DslResolvedRelationJoin[] = [];
  if (joins.length > MAX_JOIN_COUNT)
    diagnostics.push(diagnostic(`query can join at most ${MAX_JOIN_COUNT} tables`, joins[MAX_JOIN_COUNT]?.span));
  for (const join of joins.slice(0, MAX_JOIN_COUNT)) {
    const result = resolveRelationJoin(join, source, scope, ctx);
    if (isDiagnostic(result)) {
      diagnostics.push(result);
      continue;
    }
    resolved.push(result);
  }
  return { joins: resolved, diagnostics };
};

const resolveDerivedRelationJoin = (
  join: DslJoin,
  columns: DslDerivedViewColumn[],
  source: ResolvedSource,
  scope: Scope,
  ctx: DslResolverContext,
):
  | { kind: "derived"; join: DslResolvedDerivedRelationJoin }
  | { kind: "record"; join: DslResolvedRelationJoin }
  | DslResolverDiagnostic => {
  const leftUsesAlias = refUsesAlias(join.on.left, join.alias);
  const rightUsesAlias = refUsesAlias(join.on.right, join.alias);
  if (leftUsesAlias === rightUsesAlias) {
    return diagnostic(`join "${join.alias}" must compare one derived relation column to ${join.alias}.id`, join.span);
  }

  const aliasSide = leftUsesAlias ? join.on.left : join.on.right;
  const fromSide = aliasSide === join.on.left ? join.on.right : join.on.left;

  if (normalizeRefKey(aliasSide.ref) === "id" && !fromSide.scope) {
    const targetSource = resolveJoinSource(join, ctx);
    if (isDiagnostic(targetSource)) return targetSource;
    if (hasJoinAlias(scope, join.alias)) return diagnostic(`duplicate join alias "${join.alias}"`, join.span);
    const column = derivedColumnByRef(columns, fromSide.ref, fromSide.span ?? join.span);
    if (isDiagnostic(column)) return column;
    if (column.kind !== "group" || column.type !== "relation" || !column.targetTableId) {
      return diagnostic(`derived column "${column.label}" is not a relation record id and cannot be joined`, fromSide.span ?? join.span);
    }
    if (column.targetTableId !== targetSource.id) {
      return diagnostic(`join "${join.alias}" target table does not match derived relation column "${column.label}"`, join.span);
    }
    const targetFields = aliveFields(ctx.fieldsByTableId[targetSource.id] ?? []);
    const depth = 1;
    setJoinAlias(scope, join.alias, {
      alias: join.alias,
      tableId: targetSource.id,
      source: targetSource,
      fields: targetFields,
      byRef: buildFieldMap(targetFields),
      computedStub: buildComputedStub(targetFields),
      depth,
    });
    return {
      kind: "derived",
      join: {
        mode: join.mode,
        alias: join.alias,
        source: targetSource,
        tableId: targetSource.id,
        column,
        depth,
      },
    };
  }

  if (fromSide.scope && hasJoinAlias(scope, fromSide.scope)) {
    const relationJoin = resolveRelationJoin(join, source, scope, ctx);
    if (isDiagnostic(relationJoin)) return relationJoin;
    if (relationJoin.fromScope === null) {
      return diagnostic(`join "${join.alias}" cannot use the derived view source as a record`, join.span);
    }
    return { kind: "record", join: relationJoin };
  }

  return diagnostic(
    `join "${join.alias}" must start from a derived relation column or an existing joined record`,
    fromSide.span ?? join.span,
  );
};

const resolveDerivedJoins = (
  joins: DslJoin[],
  columns: DslDerivedViewColumn[],
  source: ResolvedSource,
  scope: Scope,
  ctx: DslResolverContext,
): {
  joins: DslResolvedDerivedRelationJoin[];
  relationJoins: DslResolvedRelationJoin[];
  diagnostics: DslResolverDiagnostic[];
} => {
  const diagnostics: DslResolverDiagnostic[] = [];
  const derivedJoins: DslResolvedDerivedRelationJoin[] = [];
  const relationJoins: DslResolvedRelationJoin[] = [];
  if (joins.length > MAX_JOIN_COUNT)
    diagnostics.push(diagnostic(`query can join at most ${MAX_JOIN_COUNT} tables`, joins[MAX_JOIN_COUNT]?.span));
  for (const join of joins.slice(0, MAX_JOIN_COUNT)) {
    const result = resolveDerivedRelationJoin(join, columns, source, scope, ctx);
    if (isDiagnostic(result)) {
      diagnostics.push(result);
      continue;
    }
    if (result.kind === "derived") derivedJoins.push(result.join);
    else relationJoins.push(result.join);
  }
  return { joins: derivedJoins, relationJoins, diagnostics };
};

// ──────────────────────────────────────────────────────────────────
// `where` predicate resolution
// ──────────────────────────────────────────────────────────────────
// A `where` expression is a boolean predicate. We resolve it into a
// DslWherePredicate tree where every leaf is either a *typed filter*
// (compiled by the shared filter-compiler — index-friendly and directly
// representable as FilterTree) or a *formula* (compiled to SQL by the formula
// compiler — cross-field / arithmetic predicates). Both paths execute 100% in
// SQL.
//
// Routing is deterministic so there are no surprising gaps:
//   - `field <op> literal` and the predicate functions below → typed
//     filter leaf, first-class for every filterable field type.
//   - field-vs-field, arithmetic, scalar functions, bare non-boolean
//     fields → formula leaf.
//   - `and` / `or` / `not` → boolean predicate nodes.
// A predicate is "pure" for the RecordQuery runtime when it contains only
// and/or + typed-filter leaves. NOT and formula leaves stay in the SQL plan.

type DslFilterLeaf = { fieldId: string; op: string; value?: unknown; caseInsensitive?: boolean };

export type DslWherePredicate =
  | { kind: "and"; parts: DslWherePredicate[] }
  | { kind: "or"; parts: DslWherePredicate[] }
  | { kind: "not"; part: DslWherePredicate }
  | { kind: "filter"; leaf: DslFilterLeaf }
  | { kind: "recordMeta"; meta: RecordMetaQuery }
  /** Pre-built FilterTree (e.g. a view source's saved filter) folded in. */
  | { kind: "tree"; tree: FilterTree }
  /** Boolean SQL formula — cross-field / arithmetic / scalar-function predicate. */
  | { kind: "formula"; expression: Expr };

type WhereResolution =
  | { kind: "filter"; tree?: FilterTree; recordMeta?: RecordMetaQuery }
  | { kind: "predicate"; node: DslWherePredicate }
  | { kind: "error"; diagnostic: DslResolverDiagnostic };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPARISON_OPS = new Set(["=", "!=", "<", "<=", ">", ">="]);
const NUMBER_TYPES = new Set(["number", "percent", "duration"]);
const TEXT_TYPES = new Set(["text", "longtext", "id"]);
// Field types GQL can turn into a typed filter leaf. Everything else
// (json, file, formula, lookup, rollup) is rejected with a clear error
// instead of silently doing nothing.
const FILTERABLE_TYPES = new Set([...TEXT_TYPES, ...NUMBER_TYPES, "date", "boolean", "select", "relation"]);
const PREDICATE_FNS = new Set([
  "ONEOF",
  "NONEOF",
  "CONTAINS",
  "CONTAINSALL",
  "STARTSWITH",
  "ENDSWITH",
  "ICONTAINS",
  "ISTARTSWITH",
  "IENDSWITH",
]);
const REMOVED_EMPTY_PREDICATE_FNS = new Set(["ISEMPTY", "ISNOTEMPTY"]);
const REMOVED_MEMBERSHIP_PREDICATE_FNS = new Set(["ANYOF", "CONTAINSANY"]);
const RECORD_SCOPE = "record";
const RECORD_META_USER_KEYS = new Set<RecordMetaUserKey>(["createdBy", "updatedBy", "deletedBy"]);

const normalizeRecordRef = (ref: string): string => ref.replaceAll("_", "").toLowerCase();

const recordMetaUserKeyForRef = (ref: string): RecordMetaUserKey | null => {
  const parsed = parseQualifiedIdentifierRef(ref);
  if (!parsed?.scope || normalizeRefKey(parsed.scope) !== RECORD_SCOPE) return null;
  const normalized = normalizeRecordRef(parsed.ref);
  for (const key of RECORD_META_USER_KEYS) {
    if (normalizeRecordRef(key) === normalized) return key;
  }
  return null;
};

const isRecordIdRef = (ref: string): boolean => {
  const parsed = parseQualifiedIdentifierRef(ref);
  return Boolean(parsed?.scope && normalizeRefKey(parsed.scope) === RECORD_SCOPE && normalizeRecordRef(parsed.ref) === "id");
};

const recordMetaSortKeyForRef = (ref: DslQualifiedRef): RecordMetaSortKey | null => {
  if (!ref.scope || normalizeRefKey(ref.scope) !== RECORD_SCOPE) return null;
  const normalized = normalizeRecordRef(ref.ref);
  if (normalized === "createdat") return "createdAt";
  if (normalized === "updatedat") return "updatedAt";
  if (normalized === "deletedat") return "deletedAt";
  return null;
};

const isRecordScopedRef = (ref: DslQualifiedRef): boolean => Boolean(ref.scope && normalizeRefKey(ref.scope) === RECORD_SCOPE);

const recordIdPredicate = (values: Literal[], span?: DslSourceSpan): DslWherePredicate | DslResolverDiagnostic => {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !UUID_RE.test(value)) return diagnostic("record.id expects record ids (uuid)", span);
    ids.push(value);
  }
  if (ids.length === 0) return diagnostic("record.id needs at least one record id", span);
  return { kind: "recordMeta", meta: { ids: [...new Set(ids)] } };
};

const recordMetaPredicate = (
  key: RecordMetaUserKey,
  values: Literal[],
  span?: DslSourceSpan,
): DslWherePredicate | DslResolverDiagnostic => {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !UUID_RE.test(value)) return diagnostic(`record.${key} expects user ids (uuid)`, span);
    ids.push(value);
  }
  if (ids.length === 0) return diagnostic(`record.${key} needs at least one user id`, span);
  return { kind: "recordMeta", meta: { users: { [key]: [...new Set(ids)] } } };
};

const mergeRecordMeta = (...items: Array<RecordMetaQuery | null | undefined>): RecordMetaQuery | undefined => {
  const ids = new Set<string>();
  const users: NonNullable<RecordMetaQuery["users"]> = {};
  for (const item of items) {
    for (const id of item?.ids ?? []) ids.add(id);
    for (const key of ["createdBy", "updatedBy", "deletedBy"] as const) {
      const values = item?.users?.[key] ?? [];
      if (values.length > 0) users[key] = [...new Set([...(users[key] ?? []), ...values])];
    }
  }
  return ids.size > 0 || Object.keys(users).length > 0
    ? { ...(ids.size > 0 ? { ids: [...ids] } : {}), ...(Object.keys(users).length > 0 ? { users } : {}) }
    : undefined;
};

const invertComparison = (op: string): string => {
  switch (op) {
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    default:
      return op;
  }
};

const literalKind = (value: Literal): string =>
  value === null ? "null" : typeof value === "number" ? "a number" : typeof value === "boolean" ? "true/false" : "text";

const filterLeaf = (fieldId: string, op: string, value?: unknown, options: { caseInsensitive?: boolean } = {}): DslWherePredicate => ({
  kind: "filter",
  leaf: {
    fieldId,
    op,
    ...(value !== undefined ? { value } : {}),
    ...(options.caseInsensitive ? { caseInsensitive: true } : {}),
  },
});

const formulaLeaf = (expr: Expr, scope: Scope, baseSpan?: DslSourceSpan): DslWherePredicate | DslResolverDiagnostic => {
  const compiled = compileFormulaAstToSql(expr, {
    fields: scope.fields,
    computedFieldSql: scope.computedStub,
    resolveField: scopedFormulaResolverForScope(scope),
  });
  if (!compiled.ok) return diagnostic(`where: ${compiled.error}`, spanForExpr(baseSpan, expr));
  if (compiled.expression.type !== "boolean")
    return diagnostic("where condition must be a true/false expression", spanForExpr(baseSpan, expr));
  return { kind: "formula", expression: expr };
};

const unsupportedOp = (field: Field, op: string, span?: DslSourceSpan): DslResolverDiagnostic =>
  diagnostic(`operator "${op}" is not supported for ${field.type} field "${field.name}"`, span);

const emptinessLeaf = (field: Field, empty: boolean, span?: DslSourceSpan): DslWherePredicate | DslResolverDiagnostic => {
  if (!FILTERABLE_TYPES.has(field.type)) return diagnostic(`field "${field.name}" (type "${field.type}") cannot be filtered`, span);
  return filterLeaf(field.id, empty ? "isEmpty" : "isNotEmpty");
};

/** Resolve a select literal (option id or case-insensitive label) to its
 *  stored option id. Fields without configured options accept the raw value
 *  (forward-compatible for templated/empty configs). */
const resolveSelectOption = (field: Field, raw: string, span?: DslSourceSpan): string | DslResolverDiagnostic => {
  const options = (field.config as { options?: Array<{ id: string; label?: string }> }).options;
  if (!options || options.length === 0) return raw;
  const byId = options.find((option) => option.id === raw);
  if (byId) return byId.id;
  const key = normalizeRefKey(raw);
  const byLabel = options.filter((option) => normalizeRefKey(option.label ?? "") === key);
  if (byLabel.length === 1) return byLabel[0]!.id;
  if (byLabel.length > 1) return diagnostic(`option "${raw}" is ambiguous in "${field.name}"`, span);
  const labels = options.map((option) => option.label || option.id).join(", ");
  return diagnostic(`unknown option "${raw}" for "${field.name}"; expected one of: ${labels}`, span);
};

/** `field <op> literal` → typed filter leaf, per field type. */
const typedComparisonLeaf = (
  field: Field,
  op: string,
  value: Literal,
  scope: Scope,
  span?: DslSourceSpan,
): DslWherePredicate | DslResolverDiagnostic => {
  if (value === null) {
    if (op === "=") return emptinessLeaf(field, true, span);
    if (op === "!=") return emptinessLeaf(field, false, span);
    return diagnostic(`cannot compare "${field.name}" to null with "${op}"`, span);
  }
  if (!FILTERABLE_TYPES.has(field.type)) return diagnostic(`field "${field.name}" (type "${field.type}") cannot be filtered`, span);

  if (TEXT_TYPES.has(field.type)) {
    if (op === "=") return typeof value === "string" ? filterLeaf(field.id, "equals", value) : expectedTextError(field, value, span);
    if (op === "!=") return typeof value === "string" ? filterLeaf(field.id, "notEquals", value) : expectedTextError(field, value, span);
    return unsupportedOp(field, op, span);
  }
  if (NUMBER_TYPES.has(field.type)) {
    if (!COMPARISON_OPS.has(op)) return unsupportedOp(field, op, span);
    if (typeof value !== "number") return diagnostic(`"${field.name}" expects a number, got ${literalKind(value)}`, span);
    return filterLeaf(field.id, op, value);
  }
  if (field.type === "date") return dateComparisonLeaf(field, op, value, span);
  if (field.type === "boolean") {
    if (op !== "=" && op !== "!=") return unsupportedOp(field, op, span);
    if (typeof value !== "boolean") return diagnostic(`"${field.name}" expects true or false, got ${literalKind(value)}`, span);
    return filterLeaf(field.id, "=", op === "=" ? value : !value);
  }
  if (field.type === "select") {
    if (op !== "=" && op !== "!=") return unsupportedOp(field, op, span);
    if (typeof value !== "string") return diagnostic(`"${field.name}" expects an option label or id, got ${literalKind(value)}`, span);
    const optionId = resolveSelectOption(field, value, span);
    if (isDiagnostic(optionId)) return optionId;
    return filterLeaf(field.id, op === "=" ? "is" : "isNot", optionId);
  }
  // relation
  if (op !== "=" && op !== "!=") return unsupportedOp(field, op, span);
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    return diagnostic(`"${field.name}" is a relation; compare it to a record id (uuid)`, span);
  }
  return filterLeaf(field.id, op === "=" ? "containsAny" : "notContainsAny", [value]);
};

const expectedTextError = (field: Field, value: Literal, span?: DslSourceSpan): DslResolverDiagnostic =>
  diagnostic(`"${field.name}" expects text, got ${literalKind(value)}`, span);

const dateComparisonLeaf = (field: Field, op: string, value: Literal, span?: DslSourceSpan): DslWherePredicate | DslResolverDiagnostic => {
  if (typeof value !== "string") return diagnostic(`"${field.name}" expects a date string, got ${literalKind(value)}`, span);
  const mapped =
    op === "="
      ? "="
      : op === "!="
        ? "notEquals"
        : op === "<"
          ? "before"
          : op === "<="
            ? "onOrBefore"
            : op === ">"
              ? "after"
              : op === ">="
                ? "onOrAfter"
                : null;
  if (!mapped) return unsupportedOp(field, op, span);
  return filterLeaf(field.id, mapped, value);
};

/** Membership: `oneof(field, a, b, …)` and friends, per field type. */
const membershipLeaf = (
  field: Field,
  values: Literal[],
  scope: Scope,
  mode: "any" | "all" | "none",
  span?: DslSourceSpan,
): DslWherePredicate | DslResolverDiagnostic => {
  if (values.length === 0) return diagnostic(`"${field.name}" membership needs at least one value`, span);
  if (!FILTERABLE_TYPES.has(field.type)) return diagnostic(`field "${field.name}" (type "${field.type}") cannot be filtered`, span);

  if (field.type === "select") {
    const ids: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") return diagnostic(`"${field.name}" options must be text`, span);
      const id = resolveSelectOption(field, value, span);
      if (isDiagnostic(id)) return id;
      ids.push(id);
    }
    if (mode === "any") return filterLeaf(field.id, "isAnyOf", ids);
    if (mode === "none") return filterLeaf(field.id, "isNoneOf", ids);
    return { kind: "and", parts: ids.map((id) => filterLeaf(field.id, "is", id)) };
  }
  if (field.type === "relation") {
    const ids: string[] = [];
    for (const value of values) {
      if (typeof value !== "string" || !UUID_RE.test(value)) return diagnostic(`"${field.name}" expects record ids (uuid)`, span);
      ids.push(value);
    }
    if (mode === "any") return filterLeaf(field.id, "containsAny", ids);
    if (mode === "none") return filterLeaf(field.id, "notContainsAny", ids);
    return { kind: "and", parts: ids.map((id) => filterLeaf(field.id, "containsAny", [id])) };
  }
  if (mode === "all")
    return diagnostic(`CONTAINSALL is only valid on select and relation fields; use explicit comparisons for "${field.name}"`, span);
  // Scalar types: OR of equals (any), AND of not-equals (none), AND of equals (all).
  const op = mode === "none" ? "!=" : "=";
  const parts: DslWherePredicate[] = [];
  for (const value of values) {
    const leaf = typedComparisonLeaf(field, op, value, scope, span);
    if (isDiagnostic(leaf)) return leaf;
    parts.push(leaf);
  }
  if (parts.length === 1) return parts[0]!;
  return { kind: mode === "any" ? "or" : "and", parts };
};

const textMatchLeaf = (
  field: Field,
  op: "contains" | "startsWith" | "endsWith",
  label: string,
  value: Literal,
  span?: DslSourceSpan,
  options: { caseInsensitive?: boolean } = {},
): DslWherePredicate | DslResolverDiagnostic => {
  if (!TEXT_TYPES.has(field.type)) return diagnostic(`"${field.name}" must be a text field for ${label}`, span);
  if (typeof value !== "string") return diagnostic(`"${field.name}" ${label} expects text`, span);
  return filterLeaf(field.id, op, value, options);
};

/** Predicate functions like `oneof(status, 'Open', 'Closed')`. Returns
 *  `null` when the call is not a recognised predicate over (field, literals)
 *  so the caller can fall back to compiling it as a boolean SQL formula. */
const buildPredicateFunction = (
  expr: Extract<Expr, { kind: "call" }>,
  scope: Scope,
  baseSpan?: DslSourceSpan,
): DslWherePredicate | DslResolverDiagnostic | null => {
  if (REMOVED_EMPTY_PREDICATE_FNS.has(expr.fn)) {
    const replacement = expr.fn === "ISEMPTY" ? "= null" : "!= null";
    return diagnostic(`use field ${replacement} instead of ${expr.fn}(field) in GQL predicates`, spanForExpr(baseSpan, expr));
  }
  if (REMOVED_MEMBERSHIP_PREDICATE_FNS.has(expr.fn)) {
    return diagnostic(`use oneof(field, ...) instead of ${expr.fn}(field, ...) in GQL predicates`, spanForExpr(baseSpan, expr));
  }
  if (!PREDICATE_FNS.has(expr.fn)) return null;
  const [first, ...rest] = expr.args;
  if (!first || first.kind !== "field") return null;
  const metaKey = recordMetaUserKeyForRef(first.fieldId);
  if (isRecordIdRef(first.fieldId)) {
    if (expr.fn !== "ONEOF") return diagnostic("record.id supports oneof(record.id, ...) only", spanForExpr(baseSpan, expr));
    const values: Literal[] = [];
    for (const arg of rest) {
      if (arg.kind !== "literal") return diagnostic("record.id expects literal record ids", spanForExpr(baseSpan, arg));
      values.push(arg.value);
    }
    return recordIdPredicate(values, spanForExpr(baseSpan, expr));
  }
  if (metaKey) {
    if (expr.fn !== "ONEOF")
      return diagnostic(`record.${metaKey} supports oneof(record.${metaKey}, ...) only`, spanForExpr(baseSpan, expr));
    const values: Literal[] = [];
    for (const arg of rest) {
      if (arg.kind !== "literal") return diagnostic(`record.${metaKey} expects literal user ids`, spanForExpr(baseSpan, arg));
      values.push(arg.value);
    }
    return recordMetaPredicate(metaKey, values, spanForExpr(baseSpan, expr));
  }
  if (isScopedFormulaFieldRef(first.fieldId)) return null;
  const fieldSpan = spanForExpr(baseSpan, first);
  const callSpan = spanForExpr(baseSpan, expr);
  const field = fieldByRef(scope, first.fieldId, fieldSpan);
  if (isDiagnostic(field)) return field;
  // Computed/unstorable fields have no typed filter leaf — decline so the call
  // compiles as a boolean SQL formula instead.
  if (!FILTERABLE_TYPES.has(field.type)) return null;

  const values: Literal[] = [];
  for (const arg of rest) {
    if (arg.kind !== "literal") return null; // dynamic argument → compile as formula
    values.push(arg.value);
  }

  switch (expr.fn) {
    case "ONEOF":
      return membershipLeaf(field, values, scope, "any", callSpan);
    case "NONEOF":
      return membershipLeaf(field, values, scope, "none", callSpan);
    case "CONTAINSALL":
      return membershipLeaf(field, values, scope, "all", callSpan);
    case "CONTAINS": {
      if (values.length !== 1) return diagnostic("CONTAINS takes a field and one value", callSpan);
      const value = values[0]!;
      if (field.type === "select" || field.type === "relation")
        return diagnostic(`use oneof for membership filters on ${field.type} field "${field.name}"`, callSpan);
      return textMatchLeaf(field, "contains", "contains", value, callSpan);
    }
    case "STARTSWITH":
      if (values.length !== 1) return diagnostic("STARTSWITH takes a field and one value", callSpan);
      return textMatchLeaf(field, "startsWith", "startswith", values[0]!, callSpan);
    case "ENDSWITH":
      if (values.length !== 1) return diagnostic("ENDSWITH takes a field and one value", callSpan);
      return textMatchLeaf(field, "endsWith", "endswith", values[0]!, callSpan);
    case "ICONTAINS": {
      if (values.length !== 1) return diagnostic("ICONTAINS takes a field and one value", callSpan);
      const value = values[0]!;
      if (field.type === "select" || field.type === "relation")
        return diagnostic(`use oneof for membership filters on ${field.type} field "${field.name}"`, callSpan);
      return textMatchLeaf(field, "contains", "icontains", value, callSpan, { caseInsensitive: true });
    }
    case "ISTARTSWITH":
      if (values.length !== 1) return diagnostic("ISTARTSWITH takes a field and one value", callSpan);
      return textMatchLeaf(field, "startsWith", "istartswith", values[0]!, callSpan, { caseInsensitive: true });
    case "IENDSWITH":
      if (values.length !== 1) return diagnostic("IENDSWITH takes a field and one value", callSpan);
      return textMatchLeaf(field, "endsWith", "iendswith", values[0]!, callSpan, { caseInsensitive: true });
    default:
      return null;
  }
};

const buildComparisonPredicate = (
  expr: Extract<Expr, { kind: "binop" }>,
  scope: Scope,
  baseSpan?: DslSourceSpan,
): DslWherePredicate | DslResolverDiagnostic => {
  const leftField = expr.left.kind === "field";
  const rightField = expr.right.kind === "field";
  // Exactly one field side + a literal other side → typed filter leaf.
  if (leftField !== rightField) {
    const fieldExpr = (leftField ? expr.left : expr.right) as Extract<Expr, { kind: "field" }>;
    const valueExpr = leftField ? expr.right : expr.left;
    const metaKey = recordMetaUserKeyForRef(fieldExpr.fieldId);
    if (isRecordIdRef(fieldExpr.fieldId)) {
      if (valueExpr.kind !== "literal") return diagnostic("record.id expects a literal record id", spanForExpr(baseSpan, valueExpr));
      const op = leftField ? expr.op : invertComparison(expr.op);
      if (op !== "=") return diagnostic('record.id supports "=" or oneof(...) only', spanForExpr(baseSpan, expr));
      return recordIdPredicate([valueExpr.value], spanForExpr(baseSpan, expr));
    }
    if (metaKey) {
      if (valueExpr.kind !== "literal") return diagnostic(`record.${metaKey} expects a literal user id`, spanForExpr(baseSpan, valueExpr));
      const op = leftField ? expr.op : invertComparison(expr.op);
      if (op !== "=") return diagnostic(`record.${metaKey} supports "=" or oneof(...) only`, spanForExpr(baseSpan, expr));
      return recordMetaPredicate(metaKey, [valueExpr.value], spanForExpr(baseSpan, expr));
    }
    if (isScopedFormulaFieldRef(fieldExpr.fieldId)) return formulaLeaf(expr, scope, baseSpan);
    if (valueExpr.kind !== "literal") return formulaLeaf(expr, scope, baseSpan); // field vs expression → formula
    const fieldSpan = spanForExpr(baseSpan, fieldExpr);
    const valueSpan = spanForExpr(baseSpan, valueExpr);
    const field = fieldByRef(scope, fieldExpr.fieldId, fieldSpan);
    if (isDiagnostic(field)) return field;
    // Computed / unstorable fields (formula, lookup, rollup, json) have no
    // typed filter leaf; let the formula compiler handle them in SQL. Formula
    // fields inline their own expression, so `computed > 5` works.
    if (!FILTERABLE_TYPES.has(field.type)) return formulaLeaf(expr, scope, baseSpan);
    const op = leftField ? expr.op : invertComparison(expr.op);
    return typedComparisonLeaf(field, op, valueExpr.value, scope, valueSpan);
  }
  // field vs field, literal vs literal, expression vs expression → formula.
  return formulaLeaf(expr, scope, baseSpan);
};

const buildPredicate = (expr: Expr, scope: Scope, baseSpan?: DslSourceSpan): DslWherePredicate | DslResolverDiagnostic => {
  if (expr.kind === "binop" && (expr.op === "&&" || expr.op === "||")) {
    const left = buildPredicate(expr.left, scope, baseSpan);
    if (isDiagnostic(left)) return left;
    const right = buildPredicate(expr.right, scope, baseSpan);
    if (isDiagnostic(right)) return right;
    const targetKind = expr.op === "&&" ? "and" : "or";
    const flatten = (node: DslWherePredicate): DslWherePredicate[] =>
      node.kind === targetKind ? (node as { parts: DslWherePredicate[] }).parts : [node];
    return { kind: targetKind, parts: [...flatten(left), ...flatten(right)] };
  }
  if (expr.kind === "unop" && expr.op === "!") {
    const inner = buildPredicate(expr.operand, scope, baseSpan);
    if (isDiagnostic(inner)) return inner;
    return { kind: "not", part: inner };
  }
  if (expr.kind === "binop" && COMPARISON_OPS.has(expr.op)) return buildComparisonPredicate(expr, scope, baseSpan);
  if (expr.kind === "field") {
    if (isRecordIdRef(expr.fieldId)) return diagnostic("record.id must be compared to a record id", spanForExpr(baseSpan, expr));
    const metaKey = recordMetaUserKeyForRef(expr.fieldId);
    if (metaKey) return diagnostic(`record.${metaKey} must be compared to a user id`, spanForExpr(baseSpan, expr));
    if (isScopedFormulaFieldRef(expr.fieldId)) return formulaLeaf(expr, scope, baseSpan);
    const field = fieldByRef(scope, expr.fieldId, spanForExpr(baseSpan, expr));
    if (isDiagnostic(field)) return field;
    if (field.type === "boolean") return filterLeaf(field.id, "=", true);
    return formulaLeaf(expr, scope, baseSpan);
  }
  if (expr.kind === "call") {
    const predicate = buildPredicateFunction(expr, scope, baseSpan);
    if (predicate !== null) return predicate;
    return formulaLeaf(expr, scope, baseSpan);
  }
  return formulaLeaf(expr, scope, baseSpan);
};

const isPurePredicate = (node: DslWherePredicate): boolean => {
  switch (node.kind) {
    case "and":
    case "or":
      return node.parts.every(isPurePredicate);
    case "filter":
    case "tree":
    case "recordMeta":
      return true;
    default:
      return false;
  }
};

const purePredicateParts = (
  node: DslWherePredicate,
): { ok: true; filter?: FilterTree; recordMeta?: RecordMetaQuery } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  switch (node.kind) {
    case "filter":
      return { ok: true, filter: node.leaf as FilterTree };
    case "tree":
      return { ok: true, filter: node.tree };
    case "recordMeta":
      return { ok: true, recordMeta: node.meta };
    case "and": {
      const filters: FilterTree[] = [];
      let recordMeta: RecordMetaQuery | undefined;
      for (const part of node.parts) {
        const split = purePredicateParts(part);
        if (!split.ok) return split;
        if (split.filter) filters.push(split.filter);
        recordMeta = mergeRecordMeta(recordMeta, split.recordMeta);
      }
      return {
        ok: true,
        ...(filters.length === 1 ? { filter: filters[0] } : filters.length > 1 ? { filter: { op: "AND", filters } as FilterTree } : {}),
        ...(recordMeta ? { recordMeta } : {}),
      };
    }
    case "or": {
      const filters: FilterTree[] = [];
      for (const part of node.parts) {
        const split = purePredicateParts(part);
        if (!split.ok) return split;
        if (split.recordMeta) return { ok: false, diagnostic: diagnostic("record metadata predicates can only be combined with and") };
        if (split.filter) filters.push(split.filter);
      }
      return { ok: true, filter: filters.length === 1 ? filters[0] : ({ op: "OR", filters } as FilterTree) };
    }
    default:
      return { ok: false, diagnostic: diagnostic("predicate cannot be represented as a RecordQuery filter") };
  }
};

const resolveWhere = (where: NonNullable<DslQueryAst["where"]>, scope: Scope): WhereResolution => {
  const built = buildPredicate(where.expression, scope, where.span);
  if (isDiagnostic(built)) return { kind: "error", diagnostic: built };
  if (isPurePredicate(built)) {
    const split = purePredicateParts(built);
    if (!split.ok) return { kind: "error", diagnostic: split.diagnostic };
    return {
      kind: "filter",
      ...(split.filter ? { tree: split.filter } : {}),
      ...(split.recordMeta ? { recordMeta: split.recordMeta } : {}),
    };
  }
  return { kind: "predicate", node: built };
};

const formulaTypeForAggregate = (item: DslAggregateItem, field: Field | null): FormulaSqlType => {
  return aggregateSqlTypeForField(field, item.fn, item.argument === "*");
};

const viewAggForDsl = (fn: DslAggregateItem["fn"]): AggregationSpec["agg"] => fn;

const groupAggForDsl = (fn: DslAggregateItem["fn"]): GroupHavingRef["agg"] | DslResolverDiagnostic => {
  if (!isAggregateKind(fn)) {
    return diagnostic(`aggregate "${fn}" is not supported by grouped SQL queries yet`);
  }
  return fn as GroupHavingRef["agg"];
};

const duplicateAggregateOutputDiagnostic = (label: string, agg: string): DslResolverDiagnostic =>
  diagnostic(`duplicate aggregate output for "${label}" with "${agg}"`);

const isComputedValueAggregateField = (field: Field): boolean =>
  field.type === "formula" || field.type === "lookup" || field.type === "rollup";

const qualifiedRefSource = (ref: DslQualifiedRef): string =>
  ref.scope ? `${formatIdentifierRef(ref.scope)}.${formatIdentifierRef(ref.ref)}` : formatIdentifierRef(ref.ref);

const qualifiedRefExpression = (ref: DslQualifiedRef): Expr => ({
  kind: "field",
  fieldId: qualifiedRefSource(ref),
});

const resolveComputedValueAggregation = (
  item: DslAggregateItem,
  argument: DslQualifiedRef,
  groupAgg: GroupHavingRef["agg"],
  scope: Scope,
): DslFormulaAggregation | DslResolverDiagnostic => {
  const expression = qualifiedRefExpression(argument);
  const compiled = compileFormulaAstToSql(expression, {
    fields: scope.fields,
    computedFieldSql: scope.computedStub,
    resolveField: scopedFormulaResolverForScope(scope),
  });
  if (!compiled.ok) return diagnostic(`aggregate "${item.alias}" formula: ${compiled.error}`, item.span);
  if (compiled.expression.type !== "unknown" && !isFormulaAggregatable(compiled.expression.type, groupAgg)) {
    return diagnostic(`agg "${item.fn}" not compatible with formula type "${compiled.expression.type}"`, item.span);
  }
  if (!FORMULA_AGGREGATE_ALIAS_RE.test(item.alias)) {
    return diagnostic(`formula aggregate alias "${item.alias}" must be 50 characters or less`, item.span);
  }
  return {
    kind: "formula",
    id: item.alias,
    ref: item.alias,
    source: qualifiedRefSource(argument),
    expression,
    agg: groupAgg,
    sqlType: compiled.expression.type,
  };
};

const resolveSqlAggregations = (
  items: DslAggregateItem[],
  scope: Scope,
  options: { grouped: boolean; joinedQuery: boolean; groupLabels?: string[] },
): {
  aggregations: NonNullable<RecordQuery["aggregations"]>;
  sqlAggregations: DslResolvedSqlAggregation[];
  formulaAggregations: DslFormulaAggregation[];
  diagnostics: DslResolverDiagnostic[];
} => {
  const aggregations: NonNullable<RecordQuery["aggregations"]> = [];
  const sqlAggregations: DslResolvedSqlAggregation[] = [];
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
    const aliasConflict = aggregateAliasConflictDiagnostic(scope, item.alias, options.groupLabels ?? [], item.span);
    if (aliasConflict) {
      diagnostics.push(aliasConflict);
      continue;
    }
    aliases.add(aliasKey);

    const groupAgg = groupAggForDsl(item.fn);

    if (typeof item.argument === "object" && "kind" in item.argument) {
      if (isDiagnostic(groupAgg)) {
        diagnostics.push(groupAgg);
        continue;
      }
      const compiled = compileFormulaAstToSql(item.argument.expression, {
        fields: scope.fields,
        computedFieldSql: scope.computedStub,
        resolveField: scopedFormulaResolverForScope(scope),
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
      const outputKey = aggregateOutputKey("*", "count");
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic("*", "count"));
        continue;
      }
      outputKeys.add(outputKey);
      aggregations.push({ fieldId: "*", agg: "count", label: item.alias });
      sqlAggregations.push({ fieldId: "*", agg: "count", label: item.alias });
      continue;
    }

    const resolved = resolveScopedField(scope, item.argument);
    if (isDiagnostic(resolved)) {
      diagnostics.push(resolved);
      continue;
    }
    const { field } = resolved;
    const relationDiagnostic = !resolved.joinAlias ? relationOutputDiagnostic(field, scope) : null;
    if (relationDiagnostic) {
      diagnostics.push(relationDiagnostic);
      continue;
    }
    if (isComputedValueAggregateField(field)) {
      if (isDiagnostic(groupAgg)) {
        diagnostics.push(groupAgg);
        continue;
      }
      const formulaAggregation = resolveComputedValueAggregation(item, item.argument, groupAgg, scope);
      if (isDiagnostic(formulaAggregation)) {
        diagnostics.push(formulaAggregation);
        continue;
      }
      formulaAggregations.push(formulaAggregation);
      continue;
    }
    if (options.grouped) {
      if (isDiagnostic(groupAgg)) {
        diagnostics.push(groupAgg);
        continue;
      }
      if (!isFieldAggregatable(field, groupAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`, item.span));
        continue;
      }
      const outputKey = aggregateOutputKey(field.id, groupAgg);
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(field.name, item.fn));
        continue;
      }
      outputKeys.add(outputKey);
      if (!resolved.joinAlias) aggregations.push({ fieldId: field.id, agg: groupAgg, label: item.alias });
      sqlAggregations.push({
        fieldId: field.id,
        tableId: resolved.tableId,
        ...(resolved.joinAlias ? { joinAlias: resolved.joinAlias } : {}),
        agg: groupAgg,
        label: item.alias,
      });
    } else {
      const viewAgg = viewAggForDsl(item.fn);
      if (!isFieldAggregatable(field, viewAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`, item.span));
        continue;
      }
      const outputKey = aggregateOutputKey(field.id, viewAgg);
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(field.name, item.fn));
        continue;
      }
      outputKeys.add(outputKey);
      if (!resolved.joinAlias) aggregations.push({ fieldId: field.id, agg: viewAgg, label: item.alias });
      sqlAggregations.push({
        fieldId: field.id,
        tableId: resolved.tableId,
        ...(resolved.joinAlias ? { joinAlias: resolved.joinAlias } : {}),
        agg: viewAgg,
        label: item.alias,
      });
    }
  }

  return { aggregations, sqlAggregations, formulaAggregations, diagnostics };
};

const resolveHavingPredicate = (
  having: NonNullable<DslQueryAst["having"]>,
  aggregations: DslAggregateItem[],
  scope: Scope,
): DslFormulaHavingPredicate | DslResolverDiagnostic => {
  const refs = new Map<string, { ref: GroupHavingRef; sqlType: FormulaSqlType }>();
  for (const item of aggregations) {
    const groupAgg = groupAggForDsl(item.fn);
    if (isDiagnostic(groupAgg)) return groupAgg;

    if (typeof item.argument === "object" && "kind" in item.argument) {
      const compiled = compileFormulaAstToSql(item.argument.expression, {
        fields: scope.fields,
        computedFieldSql: scope.computedStub,
        resolveField: scopedFormulaResolverForScope(scope),
      });
      if (!compiled.ok) return diagnostic(`aggregate "${item.alias}" formula: ${compiled.error}`, item.span);
      if (!isFormulaAggregatable(compiled.expression.type, groupAgg)) {
        return diagnostic(`agg "${item.fn}" not compatible with formula type "${compiled.expression.type}"`, item.span);
      }
      refs.set(normalizeRefKey(item.alias), {
        ref: {
          kind: "formula",
          id: item.alias,
          ref: item.alias,
          expression: item.argument.expression,
          agg: groupAgg,
        },
        sqlType: aggregateSqlTypeForFormula(compiled.expression.type, groupAgg),
      });
      continue;
    }

    if (item.argument === "*") {
      if (item.fn !== "count") return diagnostic(`aggregate "${item.fn}" cannot use *`, item.span);
      refs.set(normalizeRefKey(item.alias), { ref: { ref: item.alias, fieldId: "*", agg: groupAgg }, sqlType: "numeric" });
      continue;
    }
    const resolved = resolveScopedField(scope, item.argument);
    if (isDiagnostic(resolved)) return resolved;
    const { field } = resolved;
    const relationDiagnostic = !resolved.joinAlias ? relationOutputDiagnostic(field, scope) : null;
    if (relationDiagnostic) return relationDiagnostic;
    if (isComputedValueAggregateField(field)) {
      const computedAggregation = resolveComputedValueAggregation(item, item.argument, groupAgg, scope);
      if (isDiagnostic(computedAggregation)) return computedAggregation;
      refs.set(normalizeRefKey(item.alias), {
        ref: computedAggregation,
        sqlType: aggregateSqlTypeForFormula(computedAggregation.sqlType, groupAgg),
      });
      continue;
    }
    refs.set(normalizeRefKey(item.alias), {
      ref: { ref: item.alias, fieldId: field.id, agg: groupAgg },
      sqlType: formulaTypeForAggregate(item, field),
    });
    continue;
  }

  const compiled = compileFormulaAstToSql(having.expression, {
    fields: [],
    resolveField: (ref) => {
      const agg = refs.get(normalizeRefKey(ref));
      if (!agg) return null;
      const cast =
        agg.sqlType === "numeric"
          ? sql`NULL::numeric`
          : agg.sqlType === "boolean"
            ? sql`NULL::boolean`
            : agg.sqlType === "date"
              ? sql`NULL::date`
              : agg.sqlType === "datetime"
                ? sql`NULL::timestamptz`
                : sql`NULL::text`;
      return { sql: cast, type: agg.sqlType };
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

const resolveGroupBy = (
  items: DslGroupItem[],
  scope: Scope,
  options: { joinedQuery: boolean },
): { viewGroupBy: NonNullable<RecordQuery["groupBy"]>; sqlGroupBy: DslResolvedSqlGroupBy[] } | DslResolverDiagnostic => {
  const viewGroupBy: NonNullable<RecordQuery["groupBy"]> = [];
  const sqlGroupBy: DslResolvedSqlGroupBy[] = [];
  for (const item of items) {
    const resolved = resolveScopedField(scope, item.field);
    if (isDiagnostic(resolved)) return resolved;
    const { field } = resolved;
    const relationDiagnostic = relationOutputDiagnostic(field, scope);
    if (relationDiagnostic) return relationDiagnostic;
    const joinedComputedGroup =
      options.joinedQuery &&
      Boolean(resolved.joinAlias) &&
      (field.type === "formula" || field.type === "lookup" || field.type === "rollup");
    const baseComputedGroup = !resolved.joinAlias && (field.type === "formula" || field.type === "lookup" || field.type === "rollup");
    if (!joinedComputedGroup && !baseComputedGroup && !isGroupable(field))
      return diagnostic(`field "${field.name}" (type "${field.type}") is not groupable`, item.field.span ?? item.span);
    if (item.granularity && field.type !== "date") {
      return diagnostic(`granularity "${item.granularity}" is only valid on date fields, not "${field.type}"`, item.span);
    }
    if (!resolved.joinAlias && !baseComputedGroup) {
      viewGroupBy.push({ fieldId: field.id, ...(item.granularity ? { granularity: item.granularity } : {}) });
    }
    sqlGroupBy.push({
      fieldId: field.id,
      tableId: resolved.tableId,
      label: item.granularity ? `${field.name} (${item.granularity})` : field.name,
      ...(resolved.joinAlias ? { joinAlias: resolved.joinAlias } : {}),
      ...(item.granularity ? { granularity: item.granularity } : {}),
    });
  }
  return { viewGroupBy, sqlGroupBy };
};

const resolveQueryPlanSort = (
  items: DslSortItem[],
  scope: Scope,
): { viewSort: NonNullable<RecordQuery["sort"]>; sqlSort: DslResolvedSqlSort[] } | DslResolverDiagnostic => {
  const viewSort: NonNullable<RecordQuery["sort"]> = [];
  const sqlSort: DslResolvedSqlSort[] = [];
  for (const item of items) {
    const nulls = item.nullsFirst === undefined ? {} : { nullsFirst: item.nullsFirst };
    const target = item.target;
    const alias = sortAlias(target, scope);
    if (alias) {
      const fieldId = fieldAliasId(scope, alias);
      if (fieldId) {
        viewSort.push({ fieldId, direction: item.direction, ...nulls });
        sqlSort.push({ kind: "field", fieldId, direction: item.direction, ...nulls });
        continue;
      }
      if (setHasAlias(scope.joinedAliases, alias)) {
        sqlSort.push({ kind: "joined", alias, direction: item.direction, ...nulls });
        continue;
      }
      if (setHasAlias(scope.computedAliases, alias)) {
        sqlSort.push({ kind: "computed", alias, direction: item.direction, ...nulls });
        continue;
      }
      return diagnostic(`unknown sort alias "${alias}"`, item.span);
    }
    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`, item.span);
    const recordSortKey = recordMetaSortKeyForRef(target);
    if (recordSortKey) {
      viewSort.push({ source: "record", key: recordSortKey, direction: item.direction, ...nulls });
      continue;
    }
    if (isRecordScopedRef(target)) {
      return diagnostic(`record.${target.ref} is not sortable; use record.createdAt, record.updatedAt, or record.deletedAt`, target.span);
    }
    if (isBaseScope(scope, target.scope)) {
      const field = fieldByRef(scope, target.ref, target.span);
      if (isDiagnostic(field)) return field;
      viewSort.push({ fieldId: field.id, direction: item.direction, ...nulls });
      sqlSort.push({ kind: "field", fieldId: field.id, direction: item.direction, ...nulls });
      continue;
    }
    if (target.scope) {
      const join = joinScopeByAlias(scope, target.scope, target.span);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, target.ref, `${target.scope}."${target.ref}"`, target.span);
      if (isDiagnostic(field)) return field;
      sqlSort.push({
        kind: "joinedField",
        joinAlias: join.alias,
        tableId: join.tableId,
        fieldId: field.id,
        direction: item.direction,
        ...nulls,
      });
      continue;
    }
    const field = fieldByRef(scope, target.ref, target.span);
    if (isDiagnostic(field)) return field;
    viewSort.push({ fieldId: field.id, direction: item.direction, ...nulls });
    sqlSort.push({ kind: "field", fieldId: field.id, direction: item.direction, ...nulls });
  }
  return { viewSort, sqlSort };
};

type ResolvedGroupedSort = {
  groupBy: NonNullable<RecordQuery["groupBy"]>;
  groupSort: NonNullable<RecordQuery["groupSort"]>;
  formulaGroupSort: GroupSortSpec[];
};

const resolveGroupedQueryPlanSort = (
  items: DslSortItem[],
  scope: Scope,
  groupBy: NonNullable<RecordQuery["groupBy"]>,
  aggregations: NonNullable<RecordQuery["aggregations"]>,
  formulaAggregations: DslFormulaAggregation[],
): ResolvedGroupedSort | DslResolverDiagnostic => {
  const nextGroupBy = groupBy.map((item) => ({ ...item }));
  const groupSort: NonNullable<RecordQuery["groupSort"]> = [];
  const formulaGroupSort: GroupSortSpec[] = [];

  for (const item of items) {
    const target = item.target;
    const implicitAggregateAlias =
      isQualifiedSortTarget(target) && !target.scope
        ? aggregations.some((candidate) => candidate.label && normalizeRefKey(candidate.label) === normalizeRefKey(target.ref)) ||
          formulaAggregations.some((candidate) => normalizeRefKey(candidate.ref) === normalizeRefKey(target.ref))
          ? target.ref
          : null
        : null;
    const alias = sortAlias(target, scope) ?? implicitAggregateAlias;
    if (alias) {
      const key = normalizeRefKey(alias);
      const aggregate = aggregations.find((candidate) => candidate.label && normalizeRefKey(candidate.label) === key);
      if (aggregate) {
        const agg = groupAggForDsl(aggregate.agg);
        if (isDiagnostic(agg)) return agg;
        groupSort.push({ fieldId: aggregate.fieldId, agg, direction: item.direction });
        continue;
      }

      const formulaAggregate = formulaAggregations.find((candidate) => normalizeRefKey(candidate.ref) === key);
      if (formulaAggregate) {
        formulaGroupSort.push({ fieldId: formulaAggregate.id, agg: formulaAggregate.agg, direction: item.direction });
        continue;
      }
      if (fieldAliasId(scope, alias) || setHasAlias(scope.computedAliases, alias) || setHasAlias(scope.joinedAliases, alias)) {
        return diagnostic(`grouped sort alias "${alias}" must be a group field or aggregate alias`, item.span);
      }
      return diagnostic(`unknown sort alias "${alias}"`, item.span);
    }

    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`, item.span);
    if (target.scope && !isBaseScope(scope, target.scope))
      return diagnostic("scoped sort fields require join support", target.span ?? item.span);
    const field = fieldByRef(scope, target.ref, target.span);
    if (isDiagnostic(field)) return field;
    const groupItem = nextGroupBy.find((candidate) => candidate.fieldId === field.id);
    if (!groupItem) return diagnostic(`grouped sort field "${field.name}" must also be in group by`, target.span ?? item.span);
    groupItem.direction = item.direction;
  }

  return { groupBy: nextGroupBy, groupSort, formulaGroupSort };
};

type ResolvedSqlGroupedSort = {
  sqlGroupBy: DslResolvedSqlGroupBy[];
  sqlGroupSort: DslResolvedSqlGroupSort[];
};

const sameResolvedSqlGroupField = (
  group: DslResolvedSqlGroupBy,
  resolved: { field: Field; tableId: string; joinAlias?: string },
): boolean =>
  group.fieldId === resolved.field.id &&
  group.tableId === resolved.tableId &&
  normalizeRefKey(group.joinAlias ?? "") === normalizeRefKey(resolved.joinAlias ?? "");

const resolveSqlGroupedQueryPlanSort = (
  items: DslSortItem[],
  scope: Scope,
  groupBy: DslResolvedSqlGroupBy[],
  aggregations: DslResolvedSqlAggregation[],
  formulaAggregations: DslFormulaAggregation[],
): ResolvedSqlGroupedSort | DslResolverDiagnostic => {
  const nextGroupBy = groupBy.map((item) => ({ ...item }));
  const sqlGroupSort: DslResolvedSqlGroupSort[] = [];

  for (const item of items) {
    const target = item.target;
    const implicitAggregateAlias =
      isQualifiedSortTarget(target) && !target.scope
        ? aggregations.some((candidate) => candidate.label && normalizeRefKey(candidate.label) === normalizeRefKey(target.ref)) ||
          formulaAggregations.some((candidate) => normalizeRefKey(candidate.ref) === normalizeRefKey(target.ref))
          ? target.ref
          : null
        : null;
    const alias = sortAlias(target, scope) ?? implicitAggregateAlias;
    if (alias) {
      const key = normalizeRefKey(alias);
      const aggregate = aggregations.find((candidate) => candidate.label && normalizeRefKey(candidate.label) === key);
      if (aggregate) {
        const agg = groupAggForDsl(aggregate.agg);
        if (isDiagnostic(agg)) return agg;
        sqlGroupSort.push({
          fieldId: aggregate.fieldId,
          agg,
          direction: item.direction,
          ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}),
        });
        continue;
      }
      const formulaAggregate = formulaAggregations.find((candidate) => normalizeRefKey(candidate.ref) === key);
      if (formulaAggregate) {
        sqlGroupSort.push({
          fieldId: formulaAggregate.id,
          agg: formulaAggregate.agg,
          direction: item.direction,
          ...(item.nullsFirst !== undefined ? { nullsFirst: item.nullsFirst } : {}),
        });
        continue;
      }
      if (fieldAliasId(scope, alias) || setHasAlias(scope.computedAliases, alias) || setHasAlias(scope.joinedAliases, alias)) {
        return diagnostic(`grouped sort alias "${alias}" must be a group field or aggregate alias`, item.span);
      }
      return diagnostic(`unknown sort alias "${alias}"`, item.span);
    }

    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`, item.span);
    const resolved = resolveScopedField(scope, target);
    if (isDiagnostic(resolved)) return resolved;
    const groupItem = nextGroupBy.find((candidate) => sameResolvedSqlGroupField(candidate, resolved));
    if (!groupItem) return diagnostic(`grouped sort field "${resolved.field.name}" must also be in group by`, target.span ?? item.span);
    groupItem.direction = item.direction;
    if (item.nullsFirst !== undefined) groupItem.nullsFirst = item.nullsFirst;
  }

  return { sqlGroupBy: nextGroupBy, sqlGroupSort };
};

const exprHasScopedFieldRef = (expr: Expr): boolean => {
  switch (expr.kind) {
    case "field":
      return isScopedFormulaFieldRef(expr.fieldId);
    case "binop":
      return exprHasScopedFieldRef(expr.left) || exprHasScopedFieldRef(expr.right);
    case "unop":
      return exprHasScopedFieldRef(expr.operand);
    case "call":
      return expr.args.some(exprHasScopedFieldRef);
    default:
      return false;
  }
};

/** Why a successfully-previewable plan can't yet be represented by the
 *  records-table runtime. Returns null when a RecordQuery can carry it. */
const recordQueryBlocker = (plan: DslResolvedSqlQueryPlan, ast: DslQueryAst): DslResolverDiagnostic | null => {
  if (plan.derivedViewSource)
    return diagnostic("derived view source queries cannot be represented by the records-table runtime yet", ast.source?.span);
  if (plan.viewSourceQuery)
    return diagnostic("view sources with limit/scope semantics cannot be represented by the records-table runtime yet", ast.source?.span);
  if (plan.wherePredicate) {
    return diagnostic(
      "this where clause uses a formula, NOT, or cross-field comparison and cannot be represented as a RecordQuery filter yet",
      ast.where?.span,
    );
  }
  if ((plan.joins?.length ?? 0) > 0)
    return diagnostic("queries with relation joins cannot be represented by the records-table runtime yet", ast.joins[0]?.span);
  if (plan.formulaHaving) return diagnostic("having cannot be represented by the records-table runtime yet", ast.having?.span);
  if ((plan.formulaAggregations?.length ?? 0) > 0)
    return diagnostic("formula aggregates cannot be represented by the records-table runtime yet", ast.aggregations[0]?.span);
  if ((plan.sqlGroupBy?.length ?? 0) > 0 && (plan.query.groupBy?.length ?? 0) !== plan.sqlGroupBy?.length) {
    return diagnostic("group by computed fields cannot be represented by the records-table runtime yet", ast.groupBy[0]?.span);
  }
  if ((plan.offset ?? 0) > 0) return diagnostic("offset cannot be represented by the records-table runtime yet");
  if (ast.aggregations.length > 0 && (plan.query.groupBy?.length ?? 0) === 0) {
    return diagnostic(
      "aggregate-only queries cannot be represented by the records-table runtime yet; add group by or use preview",
      ast.aggregations[0]?.span,
    );
  }
  const scopedFormulaSelect = ast.select.find((item) => item.kind === "formula" && exprHasScopedFieldRef(item.expression));
  if (scopedFormulaSelect) {
    return diagnostic(
      "computed formulas with scoped field refs cannot be represented by the records-table runtime yet",
      scopedFormulaSelect.span,
    );
  }
  const computedSort = (plan.sqlSort ?? []).find((sort) => sort.kind === "computed");
  if (computedSort?.kind === "computed") {
    return diagnostic(`sort by computed alias "${computedSort.alias}" is not supported by RecordQuery yet`, ast.sort[0]?.span);
  }
  if ((plan.sqlSort ?? []).some((sort) => sort.kind === "joined" || sort.kind === "joinedField")) {
    return diagnostic("sort by a joined field is not supported by RecordQuery yet", ast.sort[0]?.span);
  }
  return null;
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

const withoutColumns = (query: RecordQuery): RecordQuery => {
  const { columns: _columns, ...rest } = query;
  return rest;
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

  let searchSpec: { q: string; fieldIds?: string[] } | undefined;
  const sqlSearchByJoin = new Map<string, DslResolvedSqlSearch>();
  if (ast.search) {
    const ids: string[] = [];
    for (const ref of ast.search.fields) {
      if (ref.scope && !isBaseScope(scope, ref.scope)) {
        const join = joinScopeByAlias(scope, ref.scope, ref.span);
        if (isDiagnostic(join)) {
          errors.push(join);
          break;
        }
        const field = fieldByRefMap(join.byRef, ref.ref, `${ref.scope}."${ref.ref}"`, ref.span);
        if (isDiagnostic(field)) {
          errors.push(field);
          break;
        }
        if (!isSearchableField(field, join.fields)) {
          errors.push(diagnostic(`field "${field.name}" is not searchable`, ref.span ?? ast.search.span));
          break;
        }
        const existing =
          sqlSearchByJoin.get(join.alias) ??
          ({
            q: ast.search.q,
            tableId: join.tableId,
            joinAlias: join.alias,
            fieldIds: [],
          } satisfies DslResolvedSqlSearch);
        existing.fieldIds.push(field.id);
        sqlSearchByJoin.set(join.alias, existing);
        continue;
      }
      const field = fieldByRef(scope, ref.ref, ref.span);
      if (isDiagnostic(field)) {
        errors.push(field);
        break;
      }
      if (!isSearchableField(field, scope.fields)) {
        errors.push(diagnostic(`field "${field.name}" is not searchable`, ref.span ?? ast.search.span));
        break;
      }
      ids.push(field.id);
    }
    if (ast.search.fields.length === 0 || ids.length > 0)
      searchSpec = ids.length > 0 ? { q: ast.search.q, fieldIds: ids } : { q: ast.search.q };
  }

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
    ...(searchSpec ? { search: searchSpec } : {}),
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
    ...(sqlSearchByJoin.size > 0 ? { sqlSearch: [...sqlSearchByJoin.values()] } : {}),
    ...(groupedSort && groupedSort.formulaGroupSort.length > 0 ? { formulaGroupSort: groupedSort.formulaGroupSort } : {}),
    ...(sqlAggregations.formulaAggregations.length > 0 ? { formulaAggregations: sqlAggregations.formulaAggregations } : {}),
    ...(wherePredicate ? { wherePredicate } : {}),
    ...(formulaHaving && !isDiagnostic(formulaHaving) ? { formulaHaving } : {}),
  };

  return { ok: true, plan };
};
