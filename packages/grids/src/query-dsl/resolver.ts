import { sql } from "bun";
import { ViewQuerySchema, type AggregationSpec, type FilterTree, type ViewQuery } from "../contracts";
import type { Expr, Literal } from "../formula/types";
import { normalizeRefKey } from "../ref-syntax";
import { compileFormulaAstToSql, type FormulaSqlType } from "../service/formula-sql-compiler";
import { storageOf } from "../service/field-storage";
import { isAggregatable, isGroupable, type GroupAggregationSpec, type GroupHavingRef, type GroupSortSpec } from "../service/group-compiler";
import type { Field } from "../service/types";
import type { DslAggregateItem, DslGroupItem, DslJoin, DslQualifiedRef, DslQueryAst, DslSelectItem, DslSortItem, DslSourceRef } from "./types";

export type DslResolverDiagnostic = {
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
  query: ViewQuery;
};

export type DslResolverContext = {
  currentTable?: DslTableSource;
  tables: DslTableSource[];
  views?: DslViewSource[];
  fieldsByTableId: Record<string, Field[]>;
};

export type DslResolvedQueryPlan = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  query: ViewQuery;
  offset?: number;
};

export type DslFormulaPredicate = {
  kind: "formula";
  source: string;
  expression: Expr;
  sqlType: FormulaSqlType;
};

export type DslFormulaHavingPredicate = DslFormulaPredicate & {
  aggregateRefs: GroupHavingRef[];
};

export type DslFormulaAggregation = Extract<GroupAggregationSpec, { kind: "formula" }> & {
  ref: string;
  source: string;
  sqlType: FormulaSqlType;
};

export type DslResolvedRelationJoin = {
  mode: DslJoin["mode"];
  alias: string;
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
  joins?: DslResolvedRelationJoin[];
  outputColumns?: DslOutputColumn[];
  joinedColumns?: DslJoinedColumn[];
  sqlSort?: DslResolvedSqlSort[];
  formulaGroupSort?: GroupSortSpec[];
  formulaAggregations?: DslFormulaAggregation[];
  formulaWhere?: DslFormulaPredicate;
  formulaHaving?: DslFormulaHavingPredicate;
};

export type DslResolvedSqlSort =
  | {
      kind: "field";
      fieldId: string;
      direction: "asc" | "desc";
    }
  | {
      kind: "computed";
      alias: string;
      direction: "asc" | "desc";
    }
  | {
      kind: "joined";
      alias: string;
      direction: "asc" | "desc";
    }
  | {
      kind: "joinedField";
      joinAlias: string;
      tableId: string;
      fieldId: string;
      direction: "asc" | "desc";
    };

export type DslResolveResult = { ok: true; plan: DslResolvedQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

export type DslSqlQueryPlanResolveResult =
  | { ok: true; plan: DslResolvedSqlQueryPlan }
  | { ok: false; diagnostics: DslResolverDiagnostic[] };

type ResolvedSource = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  baseQuery: ViewQuery;
};

type Scope = {
  fields: Field[];
  byRef: Map<string, Field[]>;
  readableTableIds: Set<string>;
  joins: Map<string, JoinScope>;
  fieldAliases: Map<string, string>;
  joinedAliases: Set<string>;
  computedAliases: Set<string>;
};

type JoinScope = {
  alias: string;
  tableId: string;
  source: DslTableSource;
  fields: Field[];
  byRef: Map<string, Field[]>;
  depth: number;
};

const MAX_JOIN_COUNT = 5;
const MAX_JOIN_DEPTH = 3;
const FORMULA_AGGREGATE_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

const diagnostic = (message: string): DslResolverDiagnostic => ({ message });

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

const createScope = (fields: Field[], ctx: DslResolverContext): Scope => ({
  fields,
  byRef: buildFieldMap(fields),
  readableTableIds: new Set(ctx.tables.map((table) => table.id)),
  joins: new Map(),
  fieldAliases: new Map(),
  joinedAliases: new Set(),
  computedAliases: new Set(),
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
  if ((kind === "computed" && field.type !== "formula") || kind === "unknown") return false;
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
  const matches = astSource.kind === "table" ? tables : astSource.kind === "view" ? views : [...tables, ...views];

  if (matches.length === 0) return diagnostic(`source "${astSource.ref}" is not available`);
  if (matches.length > 1) return diagnostic(`source "${astSource.ref}" is ambiguous; use table or view`);

  const source = matches[0]!;
  if (source.kind === "view") return { source, tableId: source.tableId, baseQuery: source.query };
  return { source, tableId: source.id, baseQuery: {} };
};

const nonFilterViewScopeKeys = (query: ViewQuery): string[] => {
  const keys: string[] = [];
  if (query.search) keys.push("search");
  if (query.recordMeta) keys.push("record metadata");
  if ((query.sort?.length ?? 0) > 0) keys.push("sort");
  if ((query.groupBy?.length ?? 0) > 0) keys.push("group by");
  if ((query.groupSort?.length ?? 0) > 0) keys.push("group sort");
  if ((query.aggregations?.length ?? 0) > 0) keys.push("aggregations");
  if ((query.columns?.length ?? 0) > 0) keys.push("columns");
  if ((query.groupedColumnOrder?.length ?? 0) > 0) keys.push("grouped column order");
  if ((query.hiddenGroupedColumns?.length ?? 0) > 0) keys.push("hidden grouped columns");
  if (query.limit !== undefined) keys.push("limit");
  if (query.includeDeleted) keys.push("include deleted");
  if (query.deletedOnly) keys.push("deleted only");
  return keys;
};

const validateFilterOnlyViewSource = (source: ResolvedSource): DslResolverDiagnostic | null => {
  if (source.source.kind !== "view") return null;
  const unsupported = nonFilterViewScopeKeys(source.baseQuery);
  if (unsupported.length === 0) return null;
  return diagnostic(
    `view source uses ${unsupported.join(", ")}, but DSL view sources support only filters until view subqueries are implemented`,
  );
};

const hasGroupedDslShape = (ast: DslQueryAst): boolean => ast.groupBy.length > 0 || ast.aggregations.length > 0 || Boolean(ast.having);

const computedIdForAlias = (alias: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < alias.length; i++) {
    hash ^= alias.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `computed_${(hash >>> 0).toString(36).padStart(7, "0")}`;
};

const fieldByRef = (scope: Scope, ref: string): Field | DslResolverDiagnostic => {
  const fields = (scope.byRef.get(normalizeRefKey(ref)) ?? []).filter((field) => !field.deletedAt);
  if (fields.length === 0) return diagnostic(`unknown field "${ref}"`);
  if (fields.length > 1) return diagnostic(`ambiguous field "${ref}"`);
  return fields[0]!;
};

const fieldByRefMap = (byRef: Map<string, Field[]>, ref: string, label: string): Field | DslResolverDiagnostic => {
  const fields = (byRef.get(normalizeRefKey(ref)) ?? []).filter((field) => !field.deletedAt);
  if (fields.length === 0) return diagnostic(`unknown field ${label}`);
  if (fields.length > 1) return diagnostic(`ambiguous field ${label}`);
  return fields[0]!;
};

const joinScopeByAlias = (scope: Scope, alias: string): JoinScope | DslResolverDiagnostic => {
  const join = scope.joins.get(alias);
  if (!join) return diagnostic(`unknown join alias "${alias}"`);
  return join;
};

const isDiagnostic = (value: unknown): value is DslResolverDiagnostic => typeof value === "object" && value !== null && "message" in value;

const isAliasSortTarget = (target: DslSortItem["target"]): target is Extract<DslSortItem["target"], { kind: "alias" }> =>
  "kind" in target && target.kind === "alias";

const isQualifiedSortTarget = (target: DslSortItem["target"]): target is DslQualifiedRef => !isAliasSortTarget(target);

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

const sortAlias = (target: DslSortItem["target"], scope: Scope): string | null => {
  if (isAliasSortTarget(target)) return target.alias;
  if (target.scope) return null;
  const ref = target.ref;
  if (fieldAliasId(scope, ref) || setHasAlias(scope.joinedAliases, ref) || setHasAlias(scope.computedAliases, ref)) return ref;
  return null;
};

const resolveFieldItem = (item: Extract<DslSelectItem, { kind: "field" }>, scope: Scope) => {
  if (item.field.scope) return diagnostic("scoped fields require join support, which is not enabled for ViewQuery yet");
  const field = fieldByRef(scope, item.field.ref);
  if (isDiagnostic(field)) return field;
  const relationDiagnostic = relationOutputDiagnostic(field, scope);
  if (relationDiagnostic) return relationDiagnostic;
  if (item.alias && (scope.fieldAliases.has(item.alias) || scope.computedAliases.has(item.alias))) {
    return diagnostic(`duplicate select alias "${item.alias}"`);
  }
  if (item.alias) scope.fieldAliases.set(item.alias, field.id);
  return { fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) };
};

const resolveJoinedFieldItem = (item: Extract<DslSelectItem, { kind: "field" }>, scope: Scope): DslJoinedColumn | DslResolverDiagnostic => {
  if (!item.field.scope) return diagnostic("joined field resolver needs a scoped field");
  const join = joinScopeByAlias(scope, item.field.scope);
  if (isDiagnostic(join)) return join;
  const field = fieldByRefMap(join.byRef, item.field.ref, `${item.field.scope}."${item.field.ref}"`);
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

const resolveSelect = (select: DslSelectItem[], scope: Scope): ViewQuery["columns"] | DslResolverDiagnostic => {
  if (select.length === 0) return undefined;
  const columns: NonNullable<ViewQuery["columns"]> = [];
  const computedIds = new Set<string>();
  for (const item of select) {
    if (item.kind === "field") {
      const column = resolveFieldItem(item, scope);
      if (isDiagnostic(column)) return column;
      columns.push(column);
      continue;
    }
    if (scope.fieldAliases.has(item.alias) || scope.computedAliases.has(item.alias)) {
      return diagnostic(`duplicate select alias "${item.alias}"`);
    }
    const compiled = compileFormulaAstToSql(item.expression, { fields: scope.fields });
    if (!compiled.ok) return diagnostic(`select "${item.alias}": ${compiled.error}`);
    scope.computedAliases.add(item.alias);
    const computedId = computedIdForAlias(item.alias);
    if (computedIds.has(computedId)) return diagnostic(`computed select id collision for alias "${item.alias}"`);
    computedIds.add(computedId);
    columns.push({
      kind: "computed",
      id: computedId,
      label: item.alias,
      expression: item.source,
    });
  }
  return columns;
};

const resolveQueryPlanSelect = (
  select: DslSelectItem[],
  scope: Scope,
): { columns?: ViewQuery["columns"]; joinedColumns: DslJoinedColumn[]; outputColumns: DslOutputColumn[] } | DslResolverDiagnostic => {
  if (select.length === 0) return { joinedColumns: [], outputColumns: [] };
  const columns: NonNullable<ViewQuery["columns"]> = [];
  const joinedColumns: DslJoinedColumn[] = [];
  const outputColumns: DslOutputColumn[] = [];
  const computedIds = new Set<string>();

  for (const item of select) {
    const alias = item.kind === "field" ? item.alias : item.alias;
    if (
      alias &&
      (scope.joins.has(alias) || scope.fieldAliases.has(alias) || scope.joinedAliases.has(alias) || scope.computedAliases.has(alias))
    ) {
      return diagnostic(`duplicate select alias "${alias}"`);
    }

    if (item.kind === "field") {
      if (item.field.scope) {
        const joined = resolveJoinedFieldItem(item, scope);
        if (isDiagnostic(joined)) return joined;
        if (item.alias) scope.joinedAliases.add(item.alias);
        joinedColumns.push(joined);
        outputColumns.push({ kind: "joined", ...joined });
        continue;
      }
      const field = fieldByRef(scope, item.field.ref);
      if (isDiagnostic(field)) return field;
      const relationDiagnostic = relationOutputDiagnostic(field, scope);
      if (relationDiagnostic) return relationDiagnostic;
      if (item.alias) scope.fieldAliases.set(item.alias, field.id);
      columns.push({ fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
      outputColumns.push({ kind: "field", fieldId: field.id, ...(item.alias ? { label: item.alias } : {}) });
      continue;
    }

    const compiled = compileFormulaAstToSql(item.expression, { fields: scope.fields });
    if (!compiled.ok) return diagnostic(`select "${item.alias}": ${compiled.error}`);
    scope.computedAliases.add(item.alias);
    const computedId = computedIdForAlias(item.alias);
    if (computedIds.has(computedId)) return diagnostic(`computed select id collision for alias "${item.alias}"`);
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

const mergeScopedFilter = (baseFilter: ViewQuery["filter"], dslFilter: ViewQuery["filter"]): ViewQuery["filter"] => {
  if (!baseFilter) return dslFilter;
  if (!dslFilter) return baseFilter;
  return { op: "AND", filters: [baseFilter, dslFilter] };
};

const scopedSource = (
  scope: Scope,
  source: ResolvedSource,
  alias: string | undefined,
): { tableId: string; fields: Field[]; byRef: Map<string, Field[]>; depth: number } | DslResolverDiagnostic => {
  if (!alias) return { tableId: source.tableId, fields: scope.fields, byRef: scope.byRef, depth: 0 };
  const join = joinScopeByAlias(scope, alias);
  if (isDiagnostic(join)) return join;
  return join;
};

const resolveJoinSource = (join: DslJoin, ctx: DslResolverContext): DslTableSource | DslResolverDiagnostic => {
  const source = resolveSource(join.source, ctx);
  if (isDiagnostic(source)) return source;
  if (source.source.kind !== "table") return diagnostic(`join "${join.alias}" must target a table source`);
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
  if (scope.joins.has(join.alias)) return diagnostic(`duplicate join alias "${join.alias}"`);

  const leftUsesAlias = join.on.left.scope === join.alias;
  const rightUsesAlias = join.on.right.scope === join.alias;
  if (leftUsesAlias === rightUsesAlias) return diagnostic(`join "${join.alias}" must compare one relation field to ${join.alias}.#id`);

  const aliasSide = leftUsesAlias ? join.on.left : join.on.right;
  const fromSide = aliasSide === join.on.left ? join.on.right : join.on.left;

  if (normalizeRefKey(aliasSide.ref) !== "id") return diagnostic(`join "${join.alias}" must target ${join.alias}.id`);

  const from = scopedSource(scope, source, fromSide.scope);
  if (isDiagnostic(from)) return from;
  const relationField = fieldByRefMap(from.byRef, fromSide.ref, `${fromSide.scope ? `${fromSide.scope}.` : ""}"${fromSide.ref}"`);
  if (isDiagnostic(relationField)) return relationField;
  if (relationField.type !== "relation") return diagnostic(`join "${join.alias}" must start from a relation field`);
  const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
  if (!targetTableId) return diagnostic(`join "${join.alias}" relation field has no target table`);
  if (targetTableId !== targetSource.id) return diagnostic(`join "${join.alias}" target table does not match the relation field`);

  const depth = from.depth + 1;
  if (depth > MAX_JOIN_DEPTH) return diagnostic(`join depth exceeds ${MAX_JOIN_DEPTH}`);
  const fields = aliveFields(ctx.fieldsByTableId[targetSource.id] ?? []);
  scope.joins.set(join.alias, {
    alias: join.alias,
    tableId: targetSource.id,
    source: targetSource,
    fields,
    byRef: buildFieldMap(fields),
    depth,
  });

  return {
    mode: join.mode,
    alias: join.alias,
    source: targetSource,
    tableId: targetSource.id,
    fromScope: fromSide.scope ?? null,
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
  if (joins.length > MAX_JOIN_COUNT) diagnostics.push(diagnostic(`query can join at most ${MAX_JOIN_COUNT} tables`));
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

const literalValue = (expr: Expr): Literal | null | DslResolverDiagnostic => {
  if (expr.kind !== "literal") return diagnostic("filter values must be literals in the ViewQuery resolver");
  return expr.value;
};

const comparisonField = (expr: Expr, scope: Scope): Field | DslResolverDiagnostic => {
  if (expr.kind !== "field") return diagnostic("filter comparisons need a field on one side");
  return fieldByRef(scope, expr.fieldId);
};

const invertComparison = (op: string): string | null => {
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

const opForField = (field: Field, op: string, value: Literal | null): string | DslResolverDiagnostic => {
  if (value === null) {
    if (op === "=") return "isEmpty";
    if (op === "!=") return "isNotEmpty";
    return diagnostic(`null comparison "${op}" is not supported`);
  }

  switch (field.type) {
    case "text":
    case "longtext":
    case "id":
      if (op === "=") return "equals";
      if (op === "!=") return "notEquals";
      return diagnostic(`operator "${op}" is not supported for ${field.type} fields`);
    case "number":
    case "percent":
    case "duration":
      if (["=", "!=", "<", "<=", ">", ">="].includes(op)) return op;
      return diagnostic(`operator "${op}" is not supported for ${field.type} fields`);
    case "date":
      if (op === "=") return "=";
      if (op === "<") return "before";
      if (op === ">") return "after";
      return diagnostic(`operator "${op}" is not supported for date fields yet`);
    case "boolean":
      if (op === "=") return "=";
      return diagnostic(`operator "${op}" is not supported for boolean fields`);
    case "select":
      if (op === "=") return "is";
      if (op === "!=") return "isNot";
      return diagnostic(`operator "${op}" is not supported for select fields`);
    default:
      return diagnostic(`field type "${field.type}" cannot be filtered by DSL yet`);
  }
};

const filterFromComparison = (expr: Extract<Expr, { kind: "binop" }>, scope: Scope): FilterTree | DslResolverDiagnostic => {
  const leftField = expr.left.kind === "field";
  const rightField = expr.right.kind === "field";
  if (leftField === rightField) return diagnostic("filter comparisons must compare one field to one literal");

  const fieldExpr = leftField ? expr.left : expr.right;
  const valueExpr = leftField ? expr.right : expr.left;
  const op = leftField ? expr.op : invertComparison(expr.op);
  if (!op) return diagnostic(`operator "${expr.op}" is not supported`);

  const field = comparisonField(fieldExpr, scope);
  if (isDiagnostic(field)) return field;
  const value = literalValue(valueExpr);
  if (isDiagnostic(value)) return value;
  const mappedOp = opForField(field, op, value);
  if (isDiagnostic(mappedOp)) return mappedOp;
  return mappedOp === "isEmpty" || mappedOp === "isNotEmpty"
    ? { fieldId: field.id, op: mappedOp }
    : { fieldId: field.id, op: mappedOp, value };
};

const resolveFilterExpr = (expr: Expr, scope: Scope): FilterTree | DslResolverDiagnostic => {
  if (expr.kind !== "binop") return diagnostic("where must be a comparison or boolean expression");
  if (expr.op === "&&" || expr.op === "||") {
    const left = resolveFilterExpr(expr.left, scope);
    if (isDiagnostic(left)) return left;
    const right = resolveFilterExpr(expr.right, scope);
    if (isDiagnostic(right)) return right;
    return { op: expr.op === "&&" ? "AND" : "OR", filters: [left, right] };
  }
  return filterFromComparison(expr, scope);
};

const resolveFormulaPredicate = (where: NonNullable<DslQueryAst["where"]>, scope: Scope): DslFormulaPredicate | DslResolverDiagnostic => {
  const compiled = compileFormulaAstToSql(where.expression, { fields: scope.fields });
  if (!compiled.ok) return diagnostic(`where formula: ${compiled.error}`);
  if (compiled.expression.type !== "boolean") return diagnostic("where formula must return a boolean value");
  return {
    kind: "formula",
    source: where.source,
    expression: where.expression,
    sqlType: compiled.expression.type,
  };
};

const formulaTypeForAggregate = (item: DslAggregateItem, field: Field | null): FormulaSqlType => {
  if (item.argument === "*" || item.fn === "count" || item.fn === "countEmpty" || item.fn === "countUnique") return "numeric";
  if (item.fn === "sum" || item.fn === "avg" || item.fn === "median") return "numeric";
  if (!field) return "unknown";
  if (field.type === "number" || field.type === "percent" || field.type === "duration") return "numeric";
  if (field.type === "date") return (field.config as { includeTime?: boolean }).includeTime ? "datetime" : "date";
  if (field.type === "boolean") return "boolean";
  if (field.type === "text" || field.type === "longtext" || field.type === "id") return "text";
  return "unknown";
};

const GROUP_SQL_AGGS = new Set<DslAggregateItem["fn"]>(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);

const viewAggForDsl = (fn: DslAggregateItem["fn"]): AggregationSpec["agg"] => fn;

const groupAggForDsl = (fn: DslAggregateItem["fn"]): GroupHavingRef["agg"] | DslResolverDiagnostic => {
  if (!GROUP_SQL_AGGS.has(fn)) {
    return diagnostic(`aggregate "${fn}" is not supported by grouped SQL queries yet`);
  }
  return fn as GroupHavingRef["agg"];
};

const aggregateOutputKey = (fieldId: string | "*", agg: string): string => `${fieldId}__${agg}`;

const duplicateAggregateOutputDiagnostic = (label: string, agg: string): DslResolverDiagnostic =>
  diagnostic(`duplicate aggregate output for "${label}" with "${agg}"`);

const isViewAggregatable = (field: Field, agg: AggregationSpec["agg"]): boolean => {
  if (field.deletedAt) return false;
  if (field.type === "relation" || field.type === "formula" || field.type === "lookup" || field.type === "rollup") return false;
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  if (agg === "sum" || agg === "avg" || agg === "median") {
    return field.type === "number" || field.type === "percent" || field.type === "duration";
  }
  if (agg === "min" || agg === "max") {
    return (
      field.type === "number" ||
      field.type === "percent" ||
      field.type === "duration" ||
      field.type === "date" ||
      field.type === "text" ||
      field.type === "longtext"
    );
  }
  if (agg === "earliest" || agg === "latest") return field.type === "date";
  return false;
};

const isFormulaAggregatable = (type: FormulaSqlType, agg: GroupHavingRef["agg"]): boolean => {
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  if (agg === "sum" || agg === "avg") return type === "numeric";
  if (agg === "min" || agg === "max") return type === "numeric" || type === "date" || type === "datetime" || type === "text";
  return false;
};

const resolveSqlAggregations = (
  items: DslAggregateItem[],
  scope: Scope,
  options: { grouped: boolean },
): {
  aggregations: NonNullable<ViewQuery["aggregations"]>;
  formulaAggregations: DslFormulaAggregation[];
  diagnostics: DslResolverDiagnostic[];
} => {
  const aggregations: NonNullable<ViewQuery["aggregations"]> = [];
  const formulaAggregations: DslFormulaAggregation[] = [];
  const diagnostics: DslResolverDiagnostic[] = [];
  const aliases = new Set<string>();
  const outputKeys = new Set<string>();

  for (const item of items) {
    if (aliases.has(item.alias)) {
      diagnostics.push(diagnostic(`duplicate aggregate alias "${item.alias}"`));
      continue;
    }
    aliases.add(item.alias);

    const groupAgg = groupAggForDsl(item.fn);

    if (typeof item.argument === "object" && "kind" in item.argument) {
      if (isDiagnostic(groupAgg)) {
        diagnostics.push(groupAgg);
        continue;
      }
      const compiled = compileFormulaAstToSql(item.argument.expression, { fields: scope.fields });
      if (!compiled.ok) {
        diagnostics.push(diagnostic(`aggregate "${item.alias}" formula: ${compiled.error}`));
        continue;
      }
      if (!isFormulaAggregatable(compiled.expression.type, groupAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with formula type "${compiled.expression.type}"`));
        continue;
      }
      if (!FORMULA_AGGREGATE_ALIAS_RE.test(item.alias)) {
        diagnostics.push(diagnostic(`formula aggregate alias "${item.alias}" must be 50 characters or less`));
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
        diagnostics.push(diagnostic(`aggregate "${item.fn}" cannot use *`));
        continue;
      }
      const outputKey = aggregateOutputKey("*", "count");
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic("*", "count"));
        continue;
      }
      outputKeys.add(outputKey);
      aggregations.push({ fieldId: "*", agg: "count", label: item.alias });
      continue;
    }

    if (item.argument.scope) {
      diagnostics.push(diagnostic("scoped aggregate fields require join support"));
      continue;
    }
    const field = fieldByRef(scope, item.argument.ref);
    if (isDiagnostic(field)) {
      diagnostics.push(field);
      continue;
    }
    const relationDiagnostic = relationOutputDiagnostic(field, scope);
    if (relationDiagnostic) {
      diagnostics.push(relationDiagnostic);
      continue;
    }
    if (options.grouped) {
      if (isDiagnostic(groupAgg)) {
        diagnostics.push(groupAgg);
        continue;
      }
      if (!isAggregatable(field, groupAgg, false)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`));
        continue;
      }
      const outputKey = aggregateOutputKey(field.id, groupAgg);
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(field.name, item.fn));
        continue;
      }
      outputKeys.add(outputKey);
      aggregations.push({ fieldId: field.id, agg: groupAgg, label: item.alias });
    } else {
      const viewAgg = viewAggForDsl(item.fn);
      if (!isViewAggregatable(field, viewAgg)) {
        diagnostics.push(diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`));
        continue;
      }
      const outputKey = aggregateOutputKey(field.id, viewAgg);
      if (outputKeys.has(outputKey)) {
        diagnostics.push(duplicateAggregateOutputDiagnostic(field.name, item.fn));
        continue;
      }
      outputKeys.add(outputKey);
      aggregations.push({ fieldId: field.id, agg: viewAgg, label: item.alias });
    }
  }

  return { aggregations, formulaAggregations, diagnostics };
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
      const compiled = compileFormulaAstToSql(item.argument.expression, { fields: scope.fields });
      if (!compiled.ok) return diagnostic(`aggregate "${item.alias}" formula: ${compiled.error}`);
      if (!isFormulaAggregatable(compiled.expression.type, groupAgg)) {
        return diagnostic(`agg "${item.fn}" not compatible with formula type "${compiled.expression.type}"`);
      }
      refs.set(item.alias, {
        ref: {
          kind: "formula",
          id: item.alias,
          ref: item.alias,
          expression: item.argument.expression,
          agg: groupAgg,
        },
        sqlType:
          groupAgg === "count" || groupAgg === "countEmpty" || groupAgg === "countUnique" || groupAgg === "sum" || groupAgg === "avg"
            ? "numeric"
            : compiled.expression.type,
      });
      continue;
    }

    if (item.argument === "*") {
      if (item.fn !== "count") return diagnostic(`aggregate "${item.fn}" cannot use *`);
      refs.set(item.alias, { ref: { ref: item.alias, fieldId: "*", agg: groupAgg }, sqlType: "numeric" });
      continue;
    }
    if (item.argument.scope) return diagnostic("scoped aggregate fields require join support");
    const field = fieldByRef(scope, item.argument.ref);
    if (isDiagnostic(field)) return field;
    const relationDiagnostic = relationOutputDiagnostic(field, scope);
    if (relationDiagnostic) return relationDiagnostic;
    refs.set(item.alias, {
      ref: { ref: item.alias, fieldId: field.id, agg: groupAgg },
      sqlType: formulaTypeForAggregate(item, field),
    });
    continue;
  }

  const compiled = compileFormulaAstToSql(having.expression, {
    fields: [],
    resolveField: (ref) => {
      const agg = refs.get(ref);
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
  if (!compiled.ok) return diagnostic(`having formula: ${compiled.error}`);
  if (compiled.expression.type !== "boolean") return diagnostic("having formula must return a boolean value");

  return {
    kind: "formula",
    source: having.source,
    expression: having.expression,
    sqlType: compiled.expression.type,
    aggregateRefs: [...refs.values()].map((item) => item.ref),
  };
};

const resolveGroupBy = (items: DslGroupItem[], scope: Scope): NonNullable<ViewQuery["groupBy"]> | DslResolverDiagnostic => {
  const groupBy: NonNullable<ViewQuery["groupBy"]> = [];
  for (const item of items) {
    if (item.field.scope) return diagnostic("scoped group-by fields require join support");
    const field = fieldByRef(scope, item.field.ref);
    if (isDiagnostic(field)) return field;
    const relationDiagnostic = relationOutputDiagnostic(field, scope);
    if (relationDiagnostic) return relationDiagnostic;
    if (!isGroupable(field)) return diagnostic(`field "${field.name}" (type "${field.type}") is not groupable`);
    if (item.granularity && field.type !== "date") {
      return diagnostic(`granularity "${item.granularity}" is only valid on date fields, not "${field.type}"`);
    }
    groupBy.push({ fieldId: field.id, ...(item.granularity ? { granularity: item.granularity } : {}) });
  }
  return groupBy;
};

const resolveAggregations = (
  items: DslAggregateItem[],
  scope: Scope,
  options: { grouped: boolean },
): NonNullable<ViewQuery["aggregations"]> | DslResolverDiagnostic => {
  const aggregations: NonNullable<ViewQuery["aggregations"]> = [];
  const aliases = new Set<string>();
  const outputKeys = new Set<string>();
  for (const item of items) {
    if (aliases.has(item.alias)) return diagnostic(`duplicate aggregate alias "${item.alias}"`);
    aliases.add(item.alias);
    if (typeof item.argument === "object" && "kind" in item.argument) {
      return diagnostic(`aggregate "${item.alias}" uses a formula argument; formula aggregates need QueryPlan`);
    }
    const groupAgg = options.grouped ? groupAggForDsl(item.fn) : null;
    if (isDiagnostic(groupAgg)) return groupAgg;
    const viewAgg = options.grouped && groupAgg ? groupAgg : viewAggForDsl(item.fn);
    if (item.argument === "*") {
      if (viewAgg !== "count") return diagnostic(`aggregate "${item.fn}" cannot use *`);
      const outputKey = aggregateOutputKey("*", "count");
      if (outputKeys.has(outputKey)) return duplicateAggregateOutputDiagnostic("*", "count");
      outputKeys.add(outputKey);
      aggregations.push({ fieldId: "*", agg: viewAgg, label: item.alias });
      continue;
    }
    if (item.argument.scope) return diagnostic("scoped aggregate fields require join support");
    const field = fieldByRef(scope, item.argument.ref);
    if (isDiagnostic(field)) return field;
    if (!isViewAggregatable(field, viewAgg)) {
      return diagnostic(`agg "${item.fn}" not compatible with field type "${field.type}"`);
    }
    const outputKey = aggregateOutputKey(field.id, viewAgg);
    if (outputKeys.has(outputKey)) return duplicateAggregateOutputDiagnostic(field.name, item.fn);
    outputKeys.add(outputKey);
    aggregations.push({ fieldId: field.id, agg: viewAgg, label: item.alias });
  }
  return aggregations;
};

const resolveSort = (items: DslSortItem[], scope: Scope): NonNullable<ViewQuery["sort"]> | DslResolverDiagnostic => {
  const sort: NonNullable<ViewQuery["sort"]> = [];
  for (const item of items) {
    const target = item.target;
    const alias = sortAlias(target, scope);
    if (alias) {
      const fieldId = fieldAliasId(scope, alias);
      if (fieldId) {
        sort.push({ fieldId, direction: item.direction });
        continue;
      }
      if (setHasAlias(scope.joinedAliases, alias)) {
        return diagnostic(`sort by joined alias "${alias}" is not supported yet`);
      }
      if (setHasAlias(scope.computedAliases, alias)) {
        return diagnostic(`sort by computed alias "${alias}" is not supported by ViewQuery yet`);
      }
      return diagnostic(`unknown sort alias "${alias}"`);
    }
    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`);
    if (target.scope) return diagnostic("scoped sort fields require join support");
    const field = fieldByRef(scope, target.ref);
    if (isDiagnostic(field)) return field;
    sort.push({ fieldId: field.id, direction: item.direction });
  }
  return sort;
};

const resolveQueryPlanSort = (
  items: DslSortItem[],
  scope: Scope,
): { viewSort: NonNullable<ViewQuery["sort"]>; sqlSort: DslResolvedSqlSort[] } | DslResolverDiagnostic => {
  const viewSort: NonNullable<ViewQuery["sort"]> = [];
  const sqlSort: DslResolvedSqlSort[] = [];
  for (const item of items) {
    const target = item.target;
    const alias = sortAlias(target, scope);
    if (alias) {
      const fieldId = fieldAliasId(scope, alias);
      if (fieldId) {
        viewSort.push({ fieldId, direction: item.direction });
        sqlSort.push({ kind: "field", fieldId, direction: item.direction });
        continue;
      }
      if (setHasAlias(scope.joinedAliases, alias)) {
        sqlSort.push({ kind: "joined", alias, direction: item.direction });
        continue;
      }
      if (setHasAlias(scope.computedAliases, alias)) {
        sqlSort.push({ kind: "computed", alias, direction: item.direction });
        continue;
      }
      return diagnostic(`unknown sort alias "${alias}"`);
    }
    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`);
    if (target.scope) {
      const join = joinScopeByAlias(scope, target.scope);
      if (isDiagnostic(join)) return join;
      const field = fieldByRefMap(join.byRef, target.ref, `${target.scope}."${target.ref}"`);
      if (isDiagnostic(field)) return field;
      sqlSort.push({
        kind: "joinedField",
        joinAlias: join.alias,
        tableId: join.tableId,
        fieldId: field.id,
        direction: item.direction,
      });
      continue;
    }
    const field = fieldByRef(scope, target.ref);
    if (isDiagnostic(field)) return field;
    viewSort.push({ fieldId: field.id, direction: item.direction });
    sqlSort.push({ kind: "field", fieldId: field.id, direction: item.direction });
  }
  return { viewSort, sqlSort };
};

type ResolvedGroupedSort = {
  groupBy: NonNullable<ViewQuery["groupBy"]>;
  groupSort: NonNullable<ViewQuery["groupSort"]>;
  formulaGroupSort: GroupSortSpec[];
};

const resolveGroupedQueryPlanSort = (
  items: DslSortItem[],
  scope: Scope,
  groupBy: NonNullable<ViewQuery["groupBy"]>,
  aggregations: NonNullable<ViewQuery["aggregations"]>,
  formulaAggregations: DslFormulaAggregation[],
): ResolvedGroupedSort | DslResolverDiagnostic => {
  const nextGroupBy = groupBy.map((item) => ({ ...item }));
  const groupSort: NonNullable<ViewQuery["groupSort"]> = [];
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
        return diagnostic(`grouped sort alias "${alias}" must be a group field or aggregate alias`);
      }
      return diagnostic(`unknown sort alias "${alias}"`);
    }

    if (!isQualifiedSortTarget(target)) return diagnostic(`unknown sort alias "${target.alias}"`);
    if (target.scope) return diagnostic("scoped sort fields require join support");
    const field = fieldByRef(scope, target.ref);
    if (isDiagnostic(field)) return field;
    const groupItem = nextGroupBy.find((candidate) => candidate.fieldId === field.id);
    if (!groupItem) return diagnostic(`grouped sort field "${field.name}" must also be in group by`);
    groupItem.direction = item.direction;
  }

  return { groupBy: nextGroupBy, groupSort, formulaGroupSort };
};

export const resolveDslQueryToViewQuery = (ast: DslQueryAst, ctx: DslResolverContext): DslResolveResult => {
  const errors: DslResolverDiagnostic[] = [];
  const source = resolveSource(ast.source, ctx);
  if (isDiagnostic(source)) return { ok: false, diagnostics: [source] };
  const sourceCompatibility = validateFilterOnlyViewSource(source);
  if (sourceCompatibility) return { ok: false, diagnostics: [sourceCompatibility] };

  if (ast.joins.length > 0) errors.push(diagnostic("joins are parsed, but relation-safe QueryPlan joins are not enabled yet"));
  if (ast.having) errors.push(diagnostic("having is parsed, but QueryPlan having support is not enabled yet"));
  if ((ast.offset ?? 0) > 0) errors.push(diagnostic("offset cannot be saved as a regular view yet"));

  const fields = aliveFields(ctx.fieldsByTableId[source.tableId] ?? []);
  const scope = createScope(fields, ctx);

  const columns = resolveSelect(ast.select, scope);
  if (isDiagnostic(columns)) errors.push(columns);

  const filter = ast.where ? resolveFilterExpr(ast.where.expression, scope) : undefined;
  if (isDiagnostic(filter)) errors.push(filter);

  const groupBy = resolveGroupBy(ast.groupBy, scope);
  if (isDiagnostic(groupBy)) errors.push(groupBy);

  const aggregateOnly = !isDiagnostic(groupBy) && ast.aggregations.length > 0 && groupBy.length === 0;
  if (aggregateOnly) {
    errors.push(diagnostic("aggregate-only DSL queries cannot be saved as a regular view yet; add group by or use preview"));
  }

  const aggregations = resolveAggregations(ast.aggregations, scope, {
    grouped: !isDiagnostic(groupBy) && groupBy.length > 0,
  });
  if (isDiagnostic(aggregations)) errors.push(aggregations);

  const sort = resolveSort(ast.sort, scope);
  if (isDiagnostic(sort)) errors.push(sort);

  if (errors.length > 0) return { ok: false, diagnostics: errors };
  if (isDiagnostic(columns)) return { ok: false, diagnostics: [columns] };
  if (isDiagnostic(filter)) return { ok: false, diagnostics: [filter] };
  if (isDiagnostic(groupBy)) return { ok: false, diagnostics: [groupBy] };
  if (isDiagnostic(aggregations)) return { ok: false, diagnostics: [aggregations] };
  if (isDiagnostic(sort)) return { ok: false, diagnostics: [sort] };

  const scopedFilter = mergeScopedFilter(source.baseQuery.filter, filter);
  const query: ViewQuery = {
    ...source.baseQuery,
    ...(scopedFilter !== undefined ? { filter: scopedFilter } : {}),
    ...(columns !== undefined ? { columns } : {}),
    ...(groupBy.length > 0 ? { groupBy } : {}),
    ...(aggregations.length > 0 ? { aggregations } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
  };

  const parsed = ViewQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, diagnostics: [diagnostic("resolved query does not match the ViewQuery contract")] };
  }

  return {
    ok: true,
    plan: {
      source: source.source,
      tableId: source.tableId,
      query: parsed.data,
    },
  };
};

export const resolveDslQueryToQueryPlan = (ast: DslQueryAst, ctx: DslResolverContext): DslSqlQueryPlanResolveResult => {
  const errors: DslResolverDiagnostic[] = [];
  const source = resolveSource(ast.source, ctx);
  if (isDiagnostic(source)) return { ok: false, diagnostics: [source] };
  const sourceCompatibility = validateFilterOnlyViewSource(source);
  if (sourceCompatibility) return { ok: false, diagnostics: [sourceCompatibility] };

  const fields = aliveFields(ctx.fieldsByTableId[source.tableId] ?? []);
  const scope = createScope(fields, ctx);

  if (ast.joins.length > 0 && hasGroupedDslShape(ast)) {
    errors.push(diagnostic("grouped DSL queries with relation joins are not supported yet"));
  }

  const joins = resolveJoins(ast.joins, source, scope, ctx);
  errors.push(...joins.diagnostics);

  const select = resolveQueryPlanSelect(ast.select, scope);
  if (isDiagnostic(select)) errors.push(select);

  const filter = ast.where ? resolveFilterExpr(ast.where.expression, scope) : undefined;
  const formulaWhere = ast.where && isDiagnostic(filter) ? resolveFormulaPredicate(ast.where, scope) : undefined;
  if (isDiagnostic(filter) && formulaWhere === undefined) errors.push(filter);
  if (isDiagnostic(formulaWhere)) errors.push(formulaWhere);

  const groupBy = resolveGroupBy(ast.groupBy, scope);
  if (isDiagnostic(groupBy)) errors.push(groupBy);
  if (ast.having && !isDiagnostic(groupBy) && groupBy.length === 0 && (source.baseQuery.groupBy?.length ?? 0) === 0) {
    errors.push(diagnostic("having requires a grouped query"));
  }

  const aggregateOnly = !isDiagnostic(groupBy) && ast.aggregations.length > 0 && groupBy.length === 0;
  const sqlAggregations = resolveSqlAggregations(ast.aggregations, scope, { grouped: !aggregateOnly });
  errors.push(...sqlAggregations.diagnostics);
  if (aggregateOnly) {
    if (ast.select.length > 0) errors.push(diagnostic("aggregate-only DSL queries cannot select row fields"));
    if (ast.joins.length > 0) errors.push(diagnostic("aggregate-only DSL queries with relation joins are not supported yet"));
    if (ast.sort.length > 0) errors.push(diagnostic("aggregate-only DSL queries cannot sort"));
  }
  const formulaHaving = ast.having ? resolveHavingPredicate(ast.having, ast.aggregations, scope) : undefined;
  if (isDiagnostic(formulaHaving)) errors.push(formulaHaving);

  const groupedSort =
    !isDiagnostic(groupBy) && groupBy.length > 0
      ? resolveGroupedQueryPlanSort(ast.sort, scope, groupBy, sqlAggregations.aggregations, sqlAggregations.formulaAggregations)
      : undefined;
  if (isDiagnostic(groupedSort)) errors.push(groupedSort);

  const sort = groupedSort === undefined ? resolveQueryPlanSort(ast.sort, scope) : undefined;
  if (isDiagnostic(sort)) errors.push(sort);

  if (errors.length > 0) return { ok: false, diagnostics: errors };
  if (isDiagnostic(select)) return { ok: false, diagnostics: [select] };
  if (isDiagnostic(filter)) {
    if (formulaWhere === undefined || isDiagnostic(formulaWhere)) return { ok: false, diagnostics: [filter] };
  }
  if (isDiagnostic(groupBy)) return { ok: false, diagnostics: [groupBy] };
  if (isDiagnostic(formulaHaving)) return { ok: false, diagnostics: [formulaHaving] };
  if (isDiagnostic(groupedSort)) return { ok: false, diagnostics: [groupedSort] };
  if (isDiagnostic(sort)) return { ok: false, diagnostics: [sort] };

  const scopedFilter = mergeScopedFilter(source.baseQuery.filter, filter !== undefined && !isDiagnostic(filter) ? filter : undefined);
  const resolvedGroupBy = groupedSort ? groupedSort.groupBy : groupBy;
  const defaultColumns =
    ast.select.length === 0 && resolvedGroupBy.length === 0 && ast.aggregations.length === 0 && !ast.having
      ? fields.filter((field) => isDefaultSelectableField(field, scope)).map((field) => ({ fieldId: field.id }))
      : undefined;
  const query: ViewQuery = {
    ...source.baseQuery,
    ...(scopedFilter !== undefined ? { filter: scopedFilter } : {}),
    ...(select.columns !== undefined ? { columns: select.columns } : defaultColumns !== undefined ? { columns: defaultColumns } : {}),
    ...(resolvedGroupBy.length > 0 ? { groupBy: resolvedGroupBy } : {}),
    ...(sqlAggregations.aggregations.length > 0 ? { aggregations: sqlAggregations.aggregations } : {}),
    ...(groupedSort && groupedSort.groupSort.length > 0 ? { groupSort: groupedSort.groupSort } : {}),
    ...(sort && sort.viewSort.length > 0 ? { sort: sort.viewSort } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
  };

  const parsed = ViewQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, diagnostics: [diagnostic("resolved query does not match the ViewQuery contract")] };
  }

  const plan: DslResolvedSqlQueryPlan = {
    source: source.source,
    tableId: source.tableId,
    query: parsed.data,
    readableTableIds: [...scope.readableTableIds],
    ...(ast.offset !== undefined ? { offset: ast.offset } : {}),
    ...(joins.joins.length > 0 ? { joins: joins.joins } : {}),
    ...(!isDiagnostic(select) && select.outputColumns.length > 0 ? { outputColumns: select.outputColumns } : {}),
    ...(!isDiagnostic(select) && select.joinedColumns.length > 0 ? { joinedColumns: select.joinedColumns } : {}),
    ...(sort && sort.sqlSort.length > 0 ? { sqlSort: sort.sqlSort } : {}),
    ...(groupedSort && groupedSort.formulaGroupSort.length > 0 ? { formulaGroupSort: groupedSort.formulaGroupSort } : {}),
    ...(sqlAggregations.formulaAggregations.length > 0 ? { formulaAggregations: sqlAggregations.formulaAggregations } : {}),
    ...(formulaWhere && !isDiagnostic(formulaWhere) ? { formulaWhere } : {}),
    ...(formulaHaving && !isDiagnostic(formulaHaving) ? { formulaHaving } : {}),
  };

  return { ok: true, plan };
};
