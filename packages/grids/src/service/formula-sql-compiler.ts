import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { parseFormula } from "../formula/parser";
import type { BinOp, Expr, Literal } from "../formula/types";
import { normalizeRefKey } from "../ref-syntax";
import { scalarSqlTypeForField, storageOf } from "./field-storage";
import type { Field } from "./types";

const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;
const DATE_UNITS = new Set(["day", "days", "month", "months", "year", "years", "hour", "hours", "minute", "minutes"]);
const DIFF_UNITS = new Set(["day", "days", "hour", "hours", "minute", "minutes", "second", "seconds"]);

export type FormulaSqlType = "numeric" | "text" | "boolean" | "date" | "datetime" | "unknown";

export type FormulaSqlExpression = {
  sql: unknown;
  type: FormulaSqlType;
};

export type FormulaSqlFieldResolver = (ref: string) => FormulaSqlExpression | string | null;

export type FormulaSqlCompileOptions = {
  fields: Field[];
  /** Trusted SQL alias for the records table. Defaults to `r`. */
  recordAlias?: string;
  dateConfig?: DateContext;
  now?: Date;
  resolveField?: FormulaSqlFieldResolver;
  /** Pre-built SQL for lookup/rollup fields (by field id) so they can be used
   *  as scalar operands. Built async by the caller (cross-table subqueries). */
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  /** GQL-only: allow explicit scoped refs such as customer.name while parsing
   *  ad-hoc formula sources. Persisted formula fields keep this disabled. */
  scopedRefs?: boolean;
};

export type FormulaSqlCompileResult = { ok: true; expression: FormulaSqlExpression } | { ok: false; error: string };

type CompileContext = Required<Pick<FormulaSqlCompileOptions, "recordAlias" | "now">> &
  Pick<FormulaSqlCompileOptions, "dateConfig" | "resolveField" | "computedFieldSql"> & {
    fieldsByRef: Map<string, Field[]>;
    /** Formula field ids currently being inlined — for cycle detection. */
    inlineStack: Set<string>;
    /** Inlining depth guard. */
    depth: number;
  };

/** Hard cap on nested formula-field inlining so a deep (but acyclic) chain
 *  can't produce an unbounded SQL expression. */
const MAX_FORMULA_INLINE_DEPTH = 8;

const ok = (sqlFragment: unknown, type: FormulaSqlType): FormulaSqlCompileResult => ({
  ok: true,
  expression: { sql: sqlFragment, type },
});

const fail = (error: string): FormulaSqlCompileResult => ({ ok: false, error });

const sqlJoin = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
};

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
    addFieldRef(map, field.id, field);
    addFieldRef(map, field.shortId, field);
    addFieldRef(map, field.name, field);
  }
  return map;
};

const fieldByRef = (map: Map<string, Field[]>, ref: string): Field | string => {
  const candidates = (map.get(normalizeRefKey(ref)) ?? []).filter((field) => field.deletedAt === null);
  if (candidates.length === 0) return `Unknown formula field reference "${ref}"`;
  if (candidates.length > 1) return `Ambiguous formula field reference "${ref}"`;
  return candidates[0]!;
};

export const formulaSqlTypeForField = (field: Field): FormulaSqlType => {
  return scalarSqlTypeForField(field);
};

const sqlLiteral = (value: Literal): FormulaSqlExpression => {
  if (value === null) return { sql: sql`NULL`, type: "unknown" };
  if (typeof value === "number") return { sql: sql`${String(value)}::numeric`, type: "numeric" };
  if (typeof value === "boolean") return { sql: sql`${value}::boolean`, type: "boolean" };
  return { sql: sql`${value}::text`, type: "text" };
};

const asNumeric = (expr: FormulaSqlExpression): unknown => {
  if (expr.type === "numeric") return sql`(${expr.sql})::numeric`;
  if (expr.type === "boolean") return sql`CASE WHEN ${expr.sql} THEN 1::numeric ELSE 0::numeric END`;
  return sql`grids.try_numeric((${expr.sql})::text)`;
};

const asText = (expr: FormulaSqlExpression): unknown => sql`COALESCE((${expr.sql})::text, '')`;

const asBoolean = (expr: FormulaSqlExpression): unknown => {
  if (expr.type === "boolean") return sql`COALESCE(${expr.sql}, false)`;
  if (expr.type === "numeric") return sql`COALESCE((${expr.sql})::numeric <> 0, false)`;
  return sql`COALESCE((${expr.sql})::text <> '', false)`;
};

const asDate = (expr: FormulaSqlExpression): unknown => {
  if (expr.type === "date") return sql`(${expr.sql})::date`;
  if (expr.type === "datetime") return sql`(${expr.sql})::date`;
  return sql`grids.try_iso_date((${expr.sql})::text)`;
};

const asTimestamp = (expr: FormulaSqlExpression): unknown => {
  if (expr.type === "datetime") return sql`(${expr.sql})::timestamptz`;
  if (expr.type === "date") return sql`(${expr.sql})::timestamp`;
  return sql`grids.try_timestamptz((${expr.sql})::text)`;
};

const literalString = (expr: Expr): string | null =>
  expr.kind === "literal" && typeof expr.value === "string" ? expr.value.toLowerCase() : null;

const compileMany = (args: Expr[], ctx: CompileContext): FormulaSqlCompileResult[] => args.map((arg) => compileExpr(arg, ctx));

const firstError = (results: FormulaSqlCompileResult[]): FormulaSqlCompileResult | null =>
  results.find((result): result is Extract<FormulaSqlCompileResult, { ok: false }> => !result.ok) ?? null;

const numericValues = (args: FormulaSqlExpression[], aggregate: "AVG" | "MIN" | "MAX" | "MEDIAN" | "SUM"): unknown => {
  if (args.length === 0) return sql`NULL::numeric`;
  const rows = sqlJoin(
    args.map((arg) => sql`(${asNumeric(arg)})`),
    sql`, `,
  );
  if (aggregate === "MEDIAN") {
    return sql`(
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric
      FROM (VALUES ${rows}) AS formula_values(v)
      WHERE v IS NOT NULL
    )`;
  }
  const fn = aggregate === "AVG" ? sql`AVG(v)` : aggregate === "MIN" ? sql`MIN(v)` : aggregate === "MAX" ? sql`MAX(v)` : sql`SUM(v)`;
  return sql`(
    SELECT ${fn}
    FROM (VALUES ${rows}) AS formula_values(v)
    WHERE v IS NOT NULL
  )`;
};

const compileBinop = (op: BinOp, left: FormulaSqlExpression, right: FormulaSqlExpression): FormulaSqlCompileResult => {
  if (op === "&&") return ok(sql`(${asBoolean(left)} AND ${asBoolean(right)})`, "boolean");
  if (op === "||") return ok(sql`(${asBoolean(left)} OR ${asBoolean(right)})`, "boolean");

  const comparisonOperands = (): { leftSql: unknown; rightSql: unknown } => {
    if (left.type === "numeric" || right.type === "numeric") return { leftSql: asNumeric(left), rightSql: asNumeric(right) };
    if (left.type === "datetime" || right.type === "datetime") return { leftSql: asTimestamp(left), rightSql: asTimestamp(right) };
    if (left.type === "date" || right.type === "date") return { leftSql: asDate(left), rightSql: asDate(right) };
    if (left.type === "boolean" && right.type === "boolean") return { leftSql: asBoolean(left), rightSql: asBoolean(right) };
    return { leftSql: asText(left), rightSql: asText(right) };
  };

  if (op === "=" || op === "!=") {
    const operands = comparisonOperands();
    const equal = sql`(${operands.leftSql} IS NOT DISTINCT FROM ${operands.rightSql})`;
    return ok(op === "=" ? equal : sql`NOT ${equal}`, "boolean");
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    const operands = comparisonOperands();
    if (op === "<") return ok(sql`(${operands.leftSql} < ${operands.rightSql})`, "boolean");
    if (op === "<=") return ok(sql`(${operands.leftSql} <= ${operands.rightSql})`, "boolean");
    if (op === ">") return ok(sql`(${operands.leftSql} > ${operands.rightSql})`, "boolean");
    return ok(sql`(${operands.leftSql} >= ${operands.rightSql})`, "boolean");
  }
  if (op === "+") {
    if (left.type === "text" && right.type === "text") return ok(sql`(${asText(left)} || ${asText(right)})`, "text");
    return ok(sql`(${asNumeric(left)} + ${asNumeric(right)})`, "numeric");
  }
  if (op === "-") return ok(sql`(${asNumeric(left)} - ${asNumeric(right)})`, "numeric");
  if (op === "*") return ok(sql`(${asNumeric(left)} * ${asNumeric(right)})`, "numeric");
  if (op === "/") return ok(sql`(${asNumeric(left)} / NULLIF(${asNumeric(right)}, 0))`, "numeric");
  return ok(sql`MOD(${asNumeric(left)}, NULLIF(${asNumeric(right)}, 0))`, "numeric");
};

const compileDateAdd = (args: Expr[], compiled: FormulaSqlExpression[]): FormulaSqlCompileResult => {
  const unit = literalString(args[2] ?? { kind: "literal", value: "days" });
  if (unit === null || !DATE_UNITS.has(unit)) return fail("DATEADD needs a literal unit: days, months, years, hours, or minutes");
  const date = unit.startsWith("hour") || unit.startsWith("minute") ? asTimestamp(compiled[0]!) : asDate(compiled[0]!);
  const amount = sql`(${asNumeric(compiled[1]!)} || ${unit})::interval`;
  if (unit.startsWith("hour") || unit.startsWith("minute")) return ok(sql`(${date} + ${amount})`, "datetime");
  return ok(sql`(${date} + ${amount})::date`, "date");
};

const compileDateDiff = (args: Expr[], compiled: FormulaSqlExpression[]): FormulaSqlCompileResult => {
  const unit = literalString(args[2] ?? { kind: "literal", value: "days" });
  if (unit === null || !DIFF_UNITS.has(unit)) return fail("DATEDIFF needs a literal unit: days, hours, minutes, or seconds");
  if (unit === "day" || unit === "days") return ok(sql`(${asDate(compiled[1]!)} - ${asDate(compiled[0]!)} )::numeric`, "numeric");
  const seconds = sql`EXTRACT(EPOCH FROM (${asTimestamp(compiled[1]!)} - ${asTimestamp(compiled[0]!)}))`;
  if (unit === "hour" || unit === "hours") return ok(sql`FLOOR(${seconds} / 3600)::numeric`, "numeric");
  if (unit === "minute" || unit === "minutes") return ok(sql`FLOOR(${seconds} / 60)::numeric`, "numeric");
  return ok(sql`FLOOR(${seconds})::numeric`, "numeric");
};

const FORMULA_ARITY: Record<string, { min: number; max: number }> = {
  ABS: { min: 1, max: 1 },
  ROUND: { min: 1, max: 2 },
  FLOOR: { min: 1, max: 1 },
  CEIL: { min: 1, max: 1 },
  SQRT: { min: 1, max: 1 },
  POW: { min: 2, max: 2 },
  MOD: { min: 2, max: 2 },
  SUM: { min: 1, max: Number.POSITIVE_INFINITY },
  AVG: { min: 1, max: Number.POSITIVE_INFINITY },
  MEAN: { min: 1, max: Number.POSITIVE_INFINITY },
  MEDIAN: { min: 1, max: Number.POSITIVE_INFINITY },
  MIN: { min: 1, max: Number.POSITIVE_INFINITY },
  MAX: { min: 1, max: Number.POSITIVE_INFINITY },
  COUNT: { min: 1, max: Number.POSITIVE_INFINITY },
  PERCENT: { min: 2, max: 2 },
  CONCAT: { min: 1, max: Number.POSITIVE_INFINITY },
  LEN: { min: 1, max: 1 },
  LOWER: { min: 1, max: 1 },
  UPPER: { min: 1, max: 1 },
  TRIM: { min: 1, max: 1 },
  LEFT: { min: 2, max: 2 },
  RIGHT: { min: 2, max: 2 },
  SUBSTRING: { min: 3, max: 3 },
  REPLACE: { min: 3, max: 3 },
  IF: { min: 3, max: 3 },
  IFEMPTY: { min: 2, max: 2 },
  IFERROR: { min: 2, max: 2 },
  AND: { min: 1, max: Number.POSITIVE_INFINITY },
  OR: { min: 1, max: Number.POSITIVE_INFINITY },
  NOT: { min: 1, max: 1 },
  ISBLANK: { min: 1, max: 1 },
  CONTAINS: { min: 2, max: 2 },
  STARTSWITH: { min: 2, max: 2 },
  ENDSWITH: { min: 2, max: 2 },
  ICONTAINS: { min: 2, max: 2 },
  ISTARTSWITH: { min: 2, max: 2 },
  IENDSWITH: { min: 2, max: 2 },
  TODAY: { min: 0, max: 0 },
  NOW: { min: 0, max: 0 },
  YEAR: { min: 1, max: 1 },
  MONTH: { min: 1, max: 1 },
  DAY: { min: 1, max: 1 },
  DATEADD: { min: 2, max: 3 },
  DATEDIFF: { min: 2, max: 3 },
};

const formatArity = (spec: { min: number; max: number }): string => {
  if (spec.min === spec.max) return spec.min === 1 ? "1 argument" : `${spec.min} arguments`;
  if (spec.max === Number.POSITIVE_INFINITY) return `at least ${spec.min} argument${spec.min === 1 ? "" : "s"}`;
  return `${spec.min}-${spec.max} arguments`;
};

const compileFunction = (fn: string, args: Expr[], ctx: CompileContext): FormulaSqlCompileResult => {
  const upper = fn.toUpperCase();
  const arity = FORMULA_ARITY[upper];
  if (arity && (args.length < arity.min || args.length > arity.max)) {
    return fail(`${upper} needs ${formatArity(arity)}; got ${args.length}`);
  }
  const compiledResults = compileMany(args, ctx);
  const error = firstError(compiledResults);
  if (error) return error;
  const compiled = compiledResults.map((result) => (result as Extract<FormulaSqlCompileResult, { ok: true }>).expression);
  const arg = (index: number): FormulaSqlExpression => compiled[index] ?? { sql: sql`NULL`, type: "unknown" };
  const numericArg = (index: number): unknown => asNumeric(arg(index));
  const textArg = (index: number): unknown => asText(arg(index));
  const boolArg = (index: number): unknown => asBoolean(arg(index));

  if (upper === "ABS") return ok(sql`ABS(${numericArg(0)})`, "numeric");
  if (upper === "ROUND") return ok(sql`ROUND(${numericArg(0)}, COALESCE(FLOOR(${numericArg(1)})::int, 0))`, "numeric");
  if (upper === "FLOOR") return ok(sql`FLOOR(${numericArg(0)})`, "numeric");
  if (upper === "CEIL") return ok(sql`CEIL(${numericArg(0)})`, "numeric");
  if (upper === "SQRT") return ok(sql`CASE WHEN ${numericArg(0)} < 0 THEN NULL ELSE SQRT(${numericArg(0)}) END`, "numeric");
  if (upper === "POW") return ok(sql`POWER(${numericArg(0)}, ${numericArg(1)})`, "numeric");
  if (upper === "MOD") return ok(sql`MOD(${numericArg(0)}, NULLIF(${numericArg(1)}, 0))`, "numeric");
  if (upper === "SUM") return ok(numericValues(compiled, "SUM"), "numeric");
  if (upper === "AVG" || upper === "MEAN") return ok(numericValues(compiled, "AVG"), "numeric");
  if (upper === "MEDIAN") return ok(numericValues(compiled, "MEDIAN"), "numeric");
  if (upper === "MIN") return ok(numericValues(compiled, "MIN"), "numeric");
  if (upper === "MAX") return ok(numericValues(compiled, "MAX"), "numeric");
  if (upper === "COUNT") {
    if (compiled.length === 0) return ok(sql`0::numeric`, "numeric");
    const parts = compiled.map((expr) => sql`CASE WHEN ${expr.sql} IS NULL OR (${expr.sql})::text = '' THEN 0 ELSE 1 END`);
    return ok(sql`(${sqlJoin(parts, sql` + `)})::numeric`, "numeric");
  }
  if (upper === "PERCENT") return ok(sql`(${numericArg(0)} / NULLIF(${numericArg(1)}, 0) * 100)`, "numeric");

  if (upper === "CONCAT") return ok(compiled.length === 0 ? sql`''::text` : sql`CONCAT(${sqlJoin(compiled.map(asText), sql`, `)})`, "text");
  if (upper === "LEN") return ok(sql`CHAR_LENGTH(${textArg(0)})::numeric`, "numeric");
  if (upper === "LOWER") return ok(sql`LOWER(${textArg(0)})`, "text");
  if (upper === "UPPER") return ok(sql`UPPER(${textArg(0)})`, "text");
  if (upper === "TRIM") return ok(sql`TRIM(${textArg(0)})`, "text");
  if (upper === "LEFT") return ok(sql`LEFT(${textArg(0)}, GREATEST(FLOOR(${numericArg(1)})::int, 0))`, "text");
  if (upper === "RIGHT") return ok(sql`RIGHT(${textArg(0)}, GREATEST(FLOOR(${numericArg(1)})::int, 0))`, "text");
  if (upper === "SUBSTRING") {
    return ok(
      sql`SUBSTRING(${textArg(0)} FROM GREATEST(FLOOR(${numericArg(1)})::int, 0) + 1 FOR GREATEST(FLOOR(${numericArg(2)})::int, 0))`,
      "text",
    );
  }
  if (upper === "REPLACE") return ok(sql`REPLACE(${textArg(0)}, ${textArg(1)}, ${textArg(2)})`, "text");

  if (upper === "IF") {
    const thenType = arg(1).type;
    const elseType = arg(2).type;
    return ok(sql`CASE WHEN ${boolArg(0)} THEN ${arg(1).sql} ELSE ${arg(2).sql} END`, thenType === elseType ? thenType : "unknown");
  }
  if (upper === "IFEMPTY")
    return ok(sql`CASE WHEN ${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '' THEN ${arg(1).sql} ELSE ${arg(0).sql} END`, arg(0).type);
  if (upper === "IFERROR") return ok(sql`COALESCE(${arg(0).sql}, ${arg(1).sql})`, arg(0).type === arg(1).type ? arg(0).type : "unknown");
  if (upper === "AND") return ok(compiled.length === 0 ? sql`true` : sql`(${sqlJoin(compiled.map(asBoolean), sql` AND `)})`, "boolean");
  if (upper === "OR") return ok(compiled.length === 0 ? sql`false` : sql`(${sqlJoin(compiled.map(asBoolean), sql` OR `)})`, "boolean");
  if (upper === "NOT") return ok(sql`NOT ${boolArg(0)}`, "boolean");
  if (upper === "ISBLANK") return ok(sql`(${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '')`, "boolean");
  if (upper === "CONTAINS") return ok(sql`POSITION(${textArg(1)} IN ${textArg(0)}) > 0`, "boolean");
  if (upper === "STARTSWITH") return ok(sql`POSITION(${textArg(1)} IN ${textArg(0)}) = 1`, "boolean");
  if (upper === "ENDSWITH") return ok(sql`RIGHT(${textArg(0)}, CHAR_LENGTH(${textArg(1)})) = ${textArg(1)}`, "boolean");
  if (upper === "ICONTAINS")
    return ok(sql`POSITION(LOWER(${textArg(1)}) IN LOWER(${textArg(0)})) > 0`, "boolean");
  if (upper === "ISTARTSWITH")
    return ok(sql`POSITION(LOWER(${textArg(1)}) IN LOWER(${textArg(0)})) = 1`, "boolean");
  if (upper === "IENDSWITH")
    return ok(sql`RIGHT(LOWER(${textArg(0)}), CHAR_LENGTH(${textArg(1)})) = LOWER(${textArg(1)})`, "boolean");

  if (upper === "TODAY") {
    const timeZone = normalizeTimeZone(ctx.dateConfig?.timeZone, "UTC");
    return ok(sql`${dates.formatDateKey(ctx.now, { ...ctx.dateConfig, timeZone })}::date`, "date");
  }
  if (upper === "NOW") return ok(sql`${ctx.now.toISOString()}::timestamptz`, "datetime");
  if (upper === "YEAR") return ok(sql`EXTRACT(YEAR FROM ${asDate(arg(0))})::numeric`, "numeric");
  if (upper === "MONTH") return ok(sql`EXTRACT(MONTH FROM ${asDate(arg(0))})::numeric`, "numeric");
  if (upper === "DAY") return ok(sql`EXTRACT(DAY FROM ${asDate(arg(0))})::numeric`, "numeric");
  if (upper === "DATEADD") return compileDateAdd(args, compiled);
  if (upper === "DATEDIFF") return compileDateDiff(args, compiled);

  return fail(`Unsupported formula function ${fn}`);
};

const inlineFormulaField = (field: Field, ctx: CompileContext): FormulaSqlCompileResult => {
  if (ctx.inlineStack.has(field.id)) return fail(`Formula field "${field.name}" references itself (cycle)`);
  if (ctx.depth >= MAX_FORMULA_INLINE_DEPTH) return fail(`Formula nesting is too deep at field "${field.name}"`);
  const expression = (field.config as { expression?: unknown }).expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return fail(`Formula field "${field.name}" has no expression`);
  }
  const parsed = parseFormula(expression);
  if (!parsed.ok) return fail(`Formula field "${field.name}": ${parsed.error}`);
  const nextStack = new Set(ctx.inlineStack);
  nextStack.add(field.id);
  return compileExpr(parsed.ast, { ...ctx, inlineStack: nextStack, depth: ctx.depth + 1 });
};

const compileExpr = (expr: Expr, ctx: CompileContext): FormulaSqlCompileResult => {
  if (expr.kind === "literal") {
    const literal = sqlLiteral(expr.value);
    return ok(literal.sql, literal.type);
  }
  if (expr.kind === "field") {
    const custom = ctx.resolveField?.(expr.fieldId);
    if (typeof custom === "string") return fail(custom);
    if (custom) return ok(custom.sql, custom.type);
    const field = fieldByRef(ctx.fieldsByRef, expr.fieldId);
    if (typeof field === "string") return fail(field);
    // A formula field referenced inside another expression inlines its own
    // compiled SQL, so formula fields are first-class operands (filter/sort/
    // aggregate/nested formula) — not just top-level select columns.
    if (field.type === "formula") return inlineFormulaField(field, ctx);
    // Lookup/rollup fields resolve to their pre-built correlated-subquery SQL
    // when the caller supplied it (GQL); otherwise they fall through to the
    // "cannot compile" error below.
    if (field.type === "lookup" || field.type === "rollup") {
      const computed = ctx.computedFieldSql?.get(field.id);
      if (computed) return ok(computed.sql, computed.type);
    }
    const descriptor = storageOf(field);
    const projection = descriptor.project(field, ctx.recordAlias);
    if (projection === null) return fail(`Field ${field.name} (${field.type}) cannot be compiled into SQL formulas yet`);
    return ok(projection, formulaSqlTypeForField(field));
  }
  if (expr.kind === "unop") {
    const operand = compileExpr(expr.operand, ctx);
    if (!operand.ok) return operand;
    if (expr.op === "-") return ok(sql`(-${asNumeric(operand.expression)})`, "numeric");
    return ok(sql`NOT ${asBoolean(operand.expression)}`, "boolean");
  }
  if (expr.kind === "binop") {
    const left = compileExpr(expr.left, ctx);
    if (!left.ok) return left;
    const right = compileExpr(expr.right, ctx);
    if (!right.ok) return right;
    return compileBinop(expr.op, left.expression, right.expression);
  }
  return compileFunction(expr.fn, expr.args, ctx);
};

export const compileFormulaAstToSql = (ast: Expr, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const recordAlias = options.recordAlias ?? "r";
  if (!SQL_ALIAS.test(recordAlias)) return fail(`Unsafe SQL record alias ${recordAlias}`);
  return compileExpr(ast, {
    fieldsByRef: buildFieldMap(options.fields),
    recordAlias,
    dateConfig: options.dateConfig,
    now: options.now ?? new Date(),
    resolveField: options.resolveField,
    computedFieldSql: options.computedFieldSql,
    inlineStack: new Set(),
    depth: 0,
  });
};

export const compileFormulaPredicateAstToSql = (ast: Expr, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const compiled = compileFormulaAstToSql(ast, options);
  if (!compiled.ok) return compiled;
  if (compiled.expression.type !== "boolean") return fail("Formula predicate must return a boolean value");
  return compiled;
};

export const compileFormulaSourceToSql = (source: string, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const parsed = parseFormula(source, { scopedRefs: options.scopedRefs });
  if (!parsed.ok) return fail(parsed.error);
  return compileFormulaAstToSql(parsed.ast, options);
};
