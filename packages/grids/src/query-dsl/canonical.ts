import type { Expr, Literal } from "../formula/types";
import { normalizeRefKey, parseQualifiedIdentifierRef } from "../ref-syntax";
import type { Field } from "../service/types";
import {
  type DslDerivedViewColumn,
  type DslResolvedRelationJoin,
  type DslResolvedSqlQueryPlan,
  type DslResolverContext,
  type DslResolverDiagnostic,
  resolveDslQueryToQueryPlan,
} from "./resolver";
import type { DslAggregateItem, DslQualifiedRef, DslQueryAst, DslSortItem } from "./types";

type CanonicalResult = { ok: true; source: string; plan: DslResolvedSqlQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

type CanonicalScope = {
  tableId: string;
  sourceAlias?: string;
  derivedColumns?: DslDerivedViewColumn[];
  fieldsByTableId: Record<string, Field[]>;
  joinsByAlias: Map<string, DslResolvedRelationJoin>;
};

type FormulaPrintOptions = {
  aggregateAliases?: ReadonlySet<string>;
};

type DslAggregateFormulaArgument = Extract<DslAggregateItem["argument"], { kind: "formula" }>;

const GQL_PREDICATE_FUNCTIONS = new Set([
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
const SELECT_MEMBERSHIP_FUNCTIONS = new Set(["ONEOF", "NONEOF", "CONTAINSALL"]);
const COMPARISON_OPS = new Set(["=", "!="]);

const fieldRef = (id: string): string => `{${id}}`;

const sourceRef = (kind: "table" | "view", id: string): string => `${kind} {${id}}`;

const quotedRef = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const isAlive = (field: Field): boolean => !field.deletedAt;

const lookupField = (fields: Field[], ref: string): Field | null | "ambiguous" => {
  const key = normalizeRefKey(ref);
  const matches = fields.filter(
    (field) =>
      isAlive(field) &&
      (normalizeRefKey(field.id) === key || normalizeRefKey(field.shortId) === key || normalizeRefKey(field.name) === key),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) return "ambiguous";
  return matches[0]!;
};

const scopeTableId = (scope: CanonicalScope, alias: string | undefined): string | null => {
  if (!alias) return scope.tableId;
  if (scope.sourceAlias && normalizeRefKey(scope.sourceAlias) === normalizeRefKey(alias)) return scope.tableId;
  return scope.joinsByAlias.get(normalizeRefKey(alias))?.tableId ?? null;
};

const canonicalScopeAlias = (scope: CanonicalScope, alias: string | undefined): string | undefined => {
  if (!alias) return undefined;
  if (scope.sourceAlias && normalizeRefKey(scope.sourceAlias) === normalizeRefKey(alias)) return scope.sourceAlias;
  return scope.joinsByAlias.get(normalizeRefKey(alias))?.alias ?? alias;
};

const fieldForRef = (
  ref: DslQualifiedRef,
  scope: CanonicalScope,
): { ok: true; field: Field } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  if (scope.derivedColumns && !ref.scope) {
    const key = normalizeRefKey(ref.ref);
    const matches = scope.derivedColumns.filter((column) => column.refs.some((candidate) => normalizeRefKey(candidate) === key));
    if (matches.length === 0) return { ok: false, diagnostic: { message: `unknown derived column "${ref.ref}"`, ...ref.span } };
    return { ok: false, diagnostic: { message: `derived column "${matches[0]!.label}" is not a source field`, ...ref.span } };
  }
  const tableId = scopeTableId(scope, ref.scope);
  if (!tableId) return { ok: false, diagnostic: { message: `unknown scope "${ref.scope}"`, ...ref.span } };
  const field = lookupField(scope.fieldsByTableId[tableId] ?? [], ref.ref);
  if (field === "ambiguous") return { ok: false, diagnostic: { message: `ambiguous field "${ref.ref}"`, ...ref.span } };
  if (!field) return { ok: false, diagnostic: { message: `unknown field "${ref.ref}"`, ...ref.span } };
  return { ok: true, field };
};

const resolveFieldRef = (
  ref: DslQualifiedRef,
  scope: CanonicalScope,
): { ok: true; text: string } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  if (scope.derivedColumns && !ref.scope) {
    const key = normalizeRefKey(ref.ref);
    const matches = scope.derivedColumns.filter((column) => column.refs.some((candidate) => normalizeRefKey(candidate) === key));
    if (matches.length === 0) return { ok: false, diagnostic: { message: `unknown derived column "${ref.ref}"`, ...ref.span } };
    if (matches.length > 1) return { ok: false, diagnostic: { message: `ambiguous derived column "${ref.ref}"`, ...ref.span } };
    return { ok: true, text: quotedRef(matches[0]!.key) };
  }
  const resolved = fieldForRef(ref, scope);
  if (!resolved.ok) return { ok: false, diagnostic: resolved.diagnostic };
  const field = resolved.field;
  const alias = canonicalScopeAlias(scope, ref.scope);
  return { ok: true, text: alias ? `${alias}.${fieldRef(field.id)}` : fieldRef(field.id) };
};

const fieldForFormulaFieldRef = (
  ref: string,
  scope: CanonicalScope,
  options: FormulaPrintOptions,
): { ok: true; field: Field } | { ok: true; field: null } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  const qualified = parseQualifiedIdentifierRef(ref) ?? { ref };
  if (!qualified.scope && options.aggregateAliases?.has(normalizeRefKey(qualified.ref))) return { ok: true, field: null };
  if (scope.derivedColumns && !qualified.scope) return { ok: true, field: null };
  const resolved = fieldForRef(qualified, scope);
  return resolved.ok ? { ok: true, field: resolved.field } : resolved;
};

const resolveFormulaFieldRef = (
  ref: string,
  scope: CanonicalScope,
  options: FormulaPrintOptions,
): { ok: true; text: string } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  const qualified = parseQualifiedIdentifierRef(ref) ?? { ref };
  if (!qualified.scope && options.aggregateAliases?.has(normalizeRefKey(qualified.ref))) return { ok: true, text: qualified.ref };
  return resolveFieldRef(qualified, scope);
};

const canonicalSelectValue = (
  field: Field,
  value: Literal,
): { ok: true; value: Literal } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  if (field.type !== "select" || typeof value !== "string") return { ok: true, value };
  const options = (field.config as { options?: Array<{ id: string; label?: string }> }).options;
  if (!options || options.length === 0) return { ok: true, value };
  const byId = options.find((option) => option.id === value);
  if (byId) return { ok: true, value: byId.id };
  const key = normalizeRefKey(value);
  const byLabel = options.filter((option) => normalizeRefKey(option.label ?? "") === key);
  if (byLabel.length === 1) return { ok: true, value: byLabel[0]!.id };
  if (byLabel.length > 1) return { ok: false, diagnostic: { message: `option "${value}" is ambiguous in "${field.name}"` } };
  const labels = options.map((option) => option.label || option.id).join(", ");
  return { ok: false, diagnostic: { message: `unknown option "${value}" for "${field.name}"; expected one of: ${labels}` } };
};

const stringLiteral = (value: string): string =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t").replaceAll("'", "\\'")}'`;

const literalSource = (value: Literal): string => {
  if (value === null) return "null";
  if (typeof value === "string") return stringLiteral(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return Number.isFinite(value) ? String(value) : "null";
};

const BINOP_PRECEDENCE: Record<string, number> = {
  "||": 10,
  "&&": 20,
  "=": 30,
  "!=": 30,
  "<": 40,
  "<=": 40,
  ">": 40,
  ">=": 40,
  "+": 50,
  "-": 50,
  "*": 60,
  "/": 60,
  "%": 60,
};

const publicBinop = (op: string): string => {
  if (op === "&&") return "and";
  if (op === "||") return "or";
  return op;
};

const publicCallName = (fn: string): string => (GQL_PREDICATE_FUNCTIONS.has(fn) ? fn.toLowerCase() : fn.toUpperCase());

const parenthesize = (text: string, ownPrecedence: number, parentPrecedence: number): string =>
  ownPrecedence < parentPrecedence ? `(${text})` : text;

const formulaSource = (
  expr: Expr,
  scope: CanonicalScope,
  options: FormulaPrintOptions = {},
  parentPrecedence = 0,
): { ok: true; text: string } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  switch (expr.kind) {
    case "literal":
      return { ok: true, text: literalSource(expr.value) };
    case "field":
      return resolveFormulaFieldRef(expr.fieldId, scope, options);
    case "call": {
      const args: string[] = [];
      const fieldArg = expr.args[0]?.kind === "field" ? fieldForFormulaFieldRef(expr.args[0].fieldId, scope, options) : null;
      if (fieldArg && !fieldArg.ok) return fieldArg;
      for (const [index, arg] of expr.args.entries()) {
        if (index > 0 && SELECT_MEMBERSHIP_FUNCTIONS.has(expr.fn) && fieldArg?.ok && fieldArg.field && arg.kind === "literal") {
          const stable = canonicalSelectValue(fieldArg.field, arg.value);
          if (!stable.ok) return stable;
          args.push(literalSource(stable.value));
          continue;
        }
        const printed = formulaSource(arg, scope, options);
        if (!printed.ok) return printed;
        args.push(printed.text);
      }
      return { ok: true, text: `${publicCallName(expr.fn)}(${args.join(", ")})` };
    }
    case "unop": {
      const ownPrecedence = 70;
      const operand = formulaSource(expr.operand, scope, options, ownPrecedence);
      if (!operand.ok) return operand;
      const text = expr.op === "!" ? `not ${operand.text}` : `-${operand.text}`;
      return { ok: true, text: parenthesize(text, ownPrecedence, parentPrecedence) };
    }
    case "binop": {
      const ownPrecedence = BINOP_PRECEDENCE[expr.op] ?? 0;
      const left = formulaSource(expr.left, scope, options, ownPrecedence);
      if (!left.ok) return left;
      const right = formulaSource(expr.right, scope, options, ownPrecedence + 1);
      if (!right.ok) return right;
      let leftText = left.text;
      let rightText = right.text;
      if (COMPARISON_OPS.has(expr.op)) {
        const leftField = expr.left.kind === "field" ? fieldForFormulaFieldRef(expr.left.fieldId, scope, options) : null;
        if (leftField && !leftField.ok) return leftField;
        const rightField = expr.right.kind === "field" ? fieldForFormulaFieldRef(expr.right.fieldId, scope, options) : null;
        if (rightField && !rightField.ok) return rightField;
        if (leftField?.ok && leftField.field && expr.right.kind === "literal") {
          const stable = canonicalSelectValue(leftField.field, expr.right.value);
          if (!stable.ok) return stable;
          rightText = literalSource(stable.value);
        } else if (rightField?.ok && rightField.field && expr.left.kind === "literal") {
          const stable = canonicalSelectValue(rightField.field, expr.left.value);
          if (!stable.ok) return stable;
          leftText = literalSource(stable.value);
        }
      }
      const text = `${leftText} ${publicBinop(expr.op)} ${rightText}`;
      return { ok: true, text: parenthesize(text, ownPrecedence, parentPrecedence) };
    }
  }
};

const sourceLine = (plan: DslResolvedSqlQueryPlan): string => {
  const source = sourceRef(plan.source.kind, plan.source.id);
  return plan.sourceAlias ? `from ${source} as ${plan.sourceAlias}` : `from ${source}`;
};

const joinLine = (join: DslResolvedRelationJoin, scope: CanonicalScope): string => {
  const mode = join.mode === "left" ? "left join" : "join";
  const source = sourceRef("table", join.tableId);
  const fromIdRef = join.fromScope ?? scope.sourceAlias ?? undefined;
  const fromId = fromIdRef ? `${fromIdRef}.id` : "id";
  const fromRelation = join.fromScope ? `${join.fromScope}.${fieldRef(join.relationFieldId)}` : fieldRef(join.relationFieldId);
  const on =
    join.direction === "forward" ? `${fromRelation} = ${join.alias}.id` : `${join.alias}.${fieldRef(join.relationFieldId)} = ${fromId}`;
  return `${mode} ${source} as ${join.alias} on ${on}`;
};

const selectLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (ast.select.length === 0) return { ok: true, lines: [] };
  const parts: string[] = [];
  for (const item of ast.select) {
    if (item.kind === "field") {
      const ref = resolveFieldRef(item.field, scope);
      if (!ref.ok) return { ok: false, diagnostics: [ref.diagnostic] };
      parts.push(item.alias ? `${ref.text} as ${item.alias}` : ref.text);
      continue;
    }
    const expression = formulaSource(item.expression, scope);
    if (!expression.ok) return { ok: false, diagnostics: [expression.diagnostic] };
    parts.push(`formula(${expression.text}) as ${item.alias}`);
  }
  return { ok: true, lines: [`select ${parts.join(", ")}`] };
};

const whereLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (!ast.where) return { ok: true, lines: [] };
  const expression = formulaSource(ast.where.expression, scope);
  return expression.ok ? { ok: true, lines: [`where ${expression.text}`] } : { ok: false, diagnostics: [expression.diagnostic] };
};

const groupLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (ast.groupBy.length === 0) return { ok: true, lines: [] };
  const parts: string[] = [];
  for (const group of ast.groupBy) {
    const ref = resolveFieldRef(group.field, scope);
    if (!ref.ok) return { ok: false, diagnostics: [ref.diagnostic] };
    parts.push(group.granularity ? `${ref.text} by ${group.granularity}` : ref.text);
  }
  return { ok: true, lines: [`group by ${parts.join(", ")}`] };
};

const aggregateLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (ast.aggregations.length === 0) return { ok: true, lines: [] };
  const parts: string[] = [];
  for (const item of ast.aggregations) {
    const arg = aggregateArgumentSource(item, scope);
    if (!arg.ok) return { ok: false, diagnostics: [arg.diagnostic] };
    parts.push(`${item.fn}(${arg.text}) as ${item.alias}`);
  }
  return { ok: true, lines: [`aggregate ${parts.join(", ")}`] };
};

const aggregateArgumentSource = (
  item: DslAggregateItem,
  scope: CanonicalScope,
): { ok: true; text: string } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  const argument = item.argument;
  if (argument === "*") return { ok: true, text: "*" };
  if (isAggregateFormulaArgument(argument)) {
    const expression = formulaSource(argument.expression, scope);
    return expression.ok ? { ok: true, text: `formula(${expression.text})` } : expression;
  }
  return resolveFieldRef(argument, scope);
};

const isAggregateFormulaArgument = (argument: DslAggregateItem["argument"]): argument is DslAggregateFormulaArgument =>
  typeof argument === "object" && argument !== null && "kind" in argument && argument.kind === "formula";

const havingLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (!ast.having) return { ok: true, lines: [] };
  const aliases = new Set(ast.aggregations.map((item) => normalizeRefKey(item.alias)));
  const expression = formulaSource(ast.having.expression, scope, { aggregateAliases: aliases });
  return expression.ok ? { ok: true, lines: [`having ${expression.text}`] } : { ok: false, diagnostics: [expression.diagnostic] };
};

const sortLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (ast.sort.length === 0) return { ok: true, lines: [] };
  const aliases = sortAliasMap(ast);
  const parts: string[] = [];
  for (const item of ast.sort) {
    const target = sortTargetSource(item.target, scope, aliases);
    if (!target.ok) return { ok: false, diagnostics: [target.diagnostic] };
    const nulls = item.nullsFirst === undefined ? "" : item.nullsFirst ? " nulls first" : " nulls last";
    parts.push(`${target.text} ${item.direction}${nulls}`);
  }
  return { ok: true, lines: [`sort ${parts.join(", ")}`] };
};

const sortAliasMap = (ast: DslQueryAst): Map<string, string> => {
  const aliases = new Map<string, string>();
  for (const item of ast.select) {
    if (item.alias) aliases.set(normalizeRefKey(item.alias), item.alias);
  }
  for (const item of ast.aggregations) aliases.set(normalizeRefKey(item.alias), item.alias);
  return aliases;
};

const sortTargetSource = (
  target: DslSortItem["target"],
  scope: CanonicalScope,
  aliases: ReadonlyMap<string, string>,
): { ok: true; text: string } | { ok: false; diagnostic: DslResolverDiagnostic } => {
  if ("kind" in target) return { ok: true, text: target.alias };
  const alias = !target.scope ? aliases.get(normalizeRefKey(target.ref)) : undefined;
  if (alias) return { ok: true, text: alias };
  return resolveFieldRef(target, scope);
};

const searchLine = (
  ast: DslQueryAst,
  scope: CanonicalScope,
): { ok: true; lines: string[] } | { ok: false; diagnostics: DslResolverDiagnostic[] } => {
  if (!ast.search) return { ok: true, lines: [] };
  const fields: string[] = [];
  for (const field of ast.search.fields) {
    const ref = resolveFieldRef(field, scope);
    if (!ref.ok) return { ok: false, diagnostics: [ref.diagnostic] };
    fields.push(ref.text);
  }
  return {
    ok: true,
    lines: [`search ${stringLiteral(ast.search.q)}${fields.length > 0 ? ` in ${fields.join(", ")}` : ""}`],
  };
};

const staticLines = (ast: DslQueryAst): string[] => [
  ...(ast.limit !== undefined ? [`limit ${ast.limit}`] : []),
  ...(ast.offset !== undefined ? [`offset ${ast.offset}`] : []),
  ...(ast.deletedOnly ? ["deleted only"] : ast.includeDeleted ? ["include deleted"] : []),
];

export const canonicalizeDslQuery = (ast: DslQueryAst, ctx: DslResolverContext): CanonicalResult => {
  const resolved = resolveDslQueryToQueryPlan(ast, ctx);
  if (!resolved.ok) return resolved;
  const plan = resolved.plan;
  const scope: CanonicalScope = {
    tableId: plan.tableId,
    ...(plan.sourceAlias ? { sourceAlias: plan.sourceAlias } : {}),
    ...(plan.derivedViewSource ? { derivedColumns: plan.derivedViewSource.columns } : {}),
    fieldsByTableId: ctx.fieldsByTableId,
    joinsByAlias: new Map((plan.joins ?? []).map((join) => [normalizeRefKey(join.alias), join])),
  };

  const lines: string[] = [sourceLine(plan), ...(plan.joins ?? []).map((join) => joinLine(join, scope))];
  for (const section of [
    selectLine(ast, scope),
    whereLine(ast, scope),
    groupLine(ast, scope),
    aggregateLine(ast, scope),
    havingLine(ast, scope),
    sortLine(ast, scope),
    searchLine(ast, scope),
  ]) {
    if (!section.ok) return { ok: false, diagnostics: section.diagnostics };
    lines.push(...section.lines);
  }
  lines.push(...staticLines(ast));

  return { ok: true, source: lines.join("\n"), plan };
};
