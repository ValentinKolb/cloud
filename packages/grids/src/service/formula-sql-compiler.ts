import { sql } from "bun";
import { dates, type DateContext } from "@valentinkolb/stdlib";
import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { parseFormula } from "../formula/parser";
import type { BinOp, Expr, Literal } from "../formula/types";
import { storageOf } from "./field-storage";
import type { Field } from "./types";

const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;
const DATE_UNITS = new Set(["day", "days", "month", "months", "year", "years", "hour", "hours", "minute", "minutes"]);
const DIFF_UNITS = new Set(["day", "days", "hour", "hours", "minute", "minutes", "second", "seconds"]);

export type FormulaSqlType = "numeric" | "text" | "boolean" | "date" | "datetime" | "unknown";

export type FormulaSqlExpression = {
  sql: unknown;
  type: FormulaSqlType;
};

export type FormulaSqlCompileOptions = {
  fields: Field[];
  /** Trusted SQL alias for the records table. Defaults to `r`. */
  recordAlias?: string;
  dateConfig?: DateContext;
  now?: Date;
};

export type FormulaSqlCompileResult =
  | { ok: true; expression: FormulaSqlExpression }
  | { ok: false; error: string };

type CompileContext = Required<Pick<FormulaSqlCompileOptions, "recordAlias" | "now">> &
  Pick<FormulaSqlCompileOptions, "dateConfig"> & {
    fieldsByRef: Map<string, Field>;
  };

const ok = (sqlFragment: unknown, type: FormulaSqlType): FormulaSqlCompileResult => ({
  ok: true,
  expression: { sql: sqlFragment, type },
});

const fail = (error: string): FormulaSqlCompileResult => ({ ok: false, error });

const sqlJoin = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
};

const buildFieldMap = (fields: Field[]): Map<string, Field> => {
  const map = new Map<string, Field>();
  for (const field of fields) {
    map.set(field.id, field);
    map.set(field.shortId, field);
  }
  return map;
};

const typeForField = (field: Field): FormulaSqlType => {
  const descriptor = storageOf(field);
  if (descriptor.kind === "numeric") return "numeric";
  if (descriptor.kind === "text") return "text";
  if (descriptor.kind === "boolean") return "boolean";
  if (descriptor.kind === "date") return (field.config as { includeTime?: boolean }).includeTime ? "datetime" : "date";
  if (descriptor.kind === "datetime" || descriptor.kind === "system") return "datetime";
  return "unknown";
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
  const fn =
    aggregate === "AVG"
      ? sql`AVG(v)`
      : aggregate === "MIN"
        ? sql`MIN(v)`
        : aggregate === "MAX"
          ? sql`MAX(v)`
          : sql`SUM(v)`;
  return sql`(
    SELECT ${fn}
    FROM (VALUES ${rows}) AS formula_values(v)
    WHERE v IS NOT NULL
  )`;
};

const compileBinop = (op: BinOp, left: FormulaSqlExpression, right: FormulaSqlExpression): FormulaSqlCompileResult => {
  if (op === "&&") return ok(sql`(${asBoolean(left)} AND ${asBoolean(right)})`, "boolean");
  if (op === "||") return ok(sql`(${asBoolean(left)} OR ${asBoolean(right)})`, "boolean");
  if (op === "=") return ok(sql`(${left.sql} IS NOT DISTINCT FROM ${right.sql})`, "boolean");
  if (op === "!=") return ok(sql`NOT (${left.sql} IS NOT DISTINCT FROM ${right.sql})`, "boolean");
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    const leftSql = left.type === "numeric" || right.type === "numeric" ? asNumeric(left) : left.sql;
    const rightSql = left.type === "numeric" || right.type === "numeric" ? asNumeric(right) : right.sql;
    if (op === "<") return ok(sql`(${leftSql} < ${rightSql})`, "boolean");
    if (op === "<=") return ok(sql`(${leftSql} <= ${rightSql})`, "boolean");
    if (op === ">") return ok(sql`(${leftSql} > ${rightSql})`, "boolean");
    return ok(sql`(${leftSql} >= ${rightSql})`, "boolean");
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

const compileFunction = (fn: string, args: Expr[], ctx: CompileContext): FormulaSqlCompileResult => {
  const upper = fn.toUpperCase();
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
  if (upper === "IFEMPTY") return ok(sql`CASE WHEN ${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '' THEN ${arg(1).sql} ELSE ${arg(0).sql} END`, arg(0).type);
  if (upper === "IFERROR") return ok(sql`COALESCE(${arg(0).sql}, ${arg(1).sql})`, arg(0).type === arg(1).type ? arg(0).type : "unknown");
  if (upper === "AND") return ok(compiled.length === 0 ? sql`true` : sql`(${sqlJoin(compiled.map(asBoolean), sql` AND `)})`, "boolean");
  if (upper === "OR") return ok(compiled.length === 0 ? sql`false` : sql`(${sqlJoin(compiled.map(asBoolean), sql` OR `)})`, "boolean");
  if (upper === "NOT") return ok(sql`NOT ${boolArg(0)}`, "boolean");
  if (upper === "ISBLANK") return ok(sql`(${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '')`, "boolean");
  if (upper === "CONTAINS") return ok(sql`POSITION(${textArg(1)} IN ${textArg(0)}) > 0`, "boolean");

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

const compileExpr = (expr: Expr, ctx: CompileContext): FormulaSqlCompileResult => {
  if (expr.kind === "literal") {
    const literal = sqlLiteral(expr.value);
    return ok(literal.sql, literal.type);
  }
  if (expr.kind === "field") {
    const field = ctx.fieldsByRef.get(expr.fieldId);
    if (!field || field.deletedAt !== null) return fail(`Unknown formula field reference #${expr.fieldId}`);
    const descriptor = storageOf(field);
    const projection = descriptor.project(field, ctx.recordAlias);
    if (projection === null) return fail(`Field ${field.name} (${field.type}) cannot be compiled into SQL formulas yet`);
    return ok(projection, typeForField(field));
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
  });
};

export const compileFormulaSourceToSql = (source: string, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const parsed = parseFormula(source);
  if (!parsed.ok) return fail(parsed.error);
  return compileFormulaAstToSql(parsed.ast, options);
};
