import { normalizeTimeZone } from "@valentinkolb/cloud/shared";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { Expr } from "../formula/types";
import {
  type FormulaSqlCompileResult,
  type FormulaSqlExpression,
  formulaSqlAsBoolean,
  formulaSqlAsDate,
  formulaSqlAsNumeric,
  formulaSqlAsText,
  formulaSqlAsTimestamp,
  formulaSqlFail,
  formulaSqlOk,
  joinFormulaSql,
} from "./formula-sql-values";

const DATE_UNITS = new Set(["day", "days", "month", "months", "year", "years", "hour", "hours", "minute", "minutes"]);
const DIFF_UNITS = new Set(["day", "days", "hour", "hours", "minute", "minutes", "second", "seconds"]);

const FORMULA_ARITY = {
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
} as const satisfies Record<string, { min: number; max: number }>;

type FormulaFunctionName = keyof typeof FORMULA_ARITY;
type FunctionCompileContext = { dateConfig?: DateContext; now: Date };
type FormulaFunctionContext = {
  sourceArgs: Expr[];
  compiled: FormulaSqlExpression[];
  compileContext: FunctionCompileContext;
  arg: (index: number) => FormulaSqlExpression;
  numericArg: (index: number) => unknown;
  textArg: (index: number) => unknown;
  boolArg: (index: number) => unknown;
};
type FormulaFunctionCompiler = (context: FormulaFunctionContext) => FormulaSqlCompileResult;

const literalString = (expression: Expr): string | null =>
  expression.kind === "literal" && typeof expression.value === "string" ? expression.value.toLowerCase() : null;

const numericValues = (args: FormulaSqlExpression[], aggregate: "AVG" | "MIN" | "MAX" | "MEDIAN" | "SUM"): unknown => {
  if (args.length === 0) return sql`NULL::numeric`;
  const rows = joinFormulaSql(
    args.map((arg) => sql`(${formulaSqlAsNumeric(arg)})`),
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
  return sql`(SELECT ${fn} FROM (VALUES ${rows}) AS formula_values(v) WHERE v IS NOT NULL)`;
};

const compileDateAdd = (args: Expr[], compiled: FormulaSqlExpression[]): FormulaSqlCompileResult => {
  const unit = literalString(args[2] ?? { kind: "literal", value: "days" });
  if (unit === null || !DATE_UNITS.has(unit)) return formulaSqlFail("DATEADD needs a literal unit: days, months, years, hours, or minutes");
  const date = unit.startsWith("hour") || unit.startsWith("minute") ? formulaSqlAsTimestamp(compiled[0]!) : formulaSqlAsDate(compiled[0]!);
  const amount = sql`(${formulaSqlAsNumeric(compiled[1]!)} || ${unit})::interval`;
  if (unit.startsWith("hour") || unit.startsWith("minute")) return formulaSqlOk(sql`(${date} + ${amount})`, "datetime");
  return formulaSqlOk(sql`(${date} + ${amount})::date`, "date");
};

const compileDateDiff = (args: Expr[], compiled: FormulaSqlExpression[]): FormulaSqlCompileResult => {
  const unit = literalString(args[2] ?? { kind: "literal", value: "days" });
  if (unit === null || !DIFF_UNITS.has(unit)) return formulaSqlFail("DATEDIFF needs a literal unit: days, hours, minutes, or seconds");
  if (unit === "day" || unit === "days") {
    return formulaSqlOk(sql`(${formulaSqlAsDate(compiled[1]!)} - ${formulaSqlAsDate(compiled[0]!)} )::numeric`, "numeric");
  }
  const seconds = sql`EXTRACT(EPOCH FROM (${formulaSqlAsTimestamp(compiled[1]!)} - ${formulaSqlAsTimestamp(compiled[0]!)}))`;
  if (unit === "hour" || unit === "hours") return formulaSqlOk(sql`FLOOR(${seconds} / 3600)::numeric`, "numeric");
  if (unit === "minute" || unit === "minutes") return formulaSqlOk(sql`FLOOR(${seconds} / 60)::numeric`, "numeric");
  return formulaSqlOk(sql`FLOOR(${seconds})::numeric`, "numeric");
};

const FORMULA_FUNCTION_COMPILERS = {
  ABS: ({ numericArg }) => formulaSqlOk(sql`ABS(${numericArg(0)})`, "numeric"),
  ROUND: ({ numericArg }) => formulaSqlOk(sql`ROUND(${numericArg(0)}, COALESCE(FLOOR(${numericArg(1)})::int, 0))`, "numeric"),
  FLOOR: ({ numericArg }) => formulaSqlOk(sql`FLOOR(${numericArg(0)})`, "numeric"),
  CEIL: ({ numericArg }) => formulaSqlOk(sql`CEIL(${numericArg(0)})`, "numeric"),
  SQRT: ({ numericArg }) => formulaSqlOk(sql`CASE WHEN ${numericArg(0)} < 0 THEN NULL ELSE SQRT(${numericArg(0)}) END`, "numeric"),
  POW: ({ numericArg }) => formulaSqlOk(sql`POWER(${numericArg(0)}, ${numericArg(1)})`, "numeric"),
  MOD: ({ numericArg }) => formulaSqlOk(sql`MOD(${numericArg(0)}, NULLIF(${numericArg(1)}, 0))`, "numeric"),
  SUM: ({ compiled }) => formulaSqlOk(numericValues(compiled, "SUM"), "numeric"),
  AVG: ({ compiled }) => formulaSqlOk(numericValues(compiled, "AVG"), "numeric"),
  MEAN: ({ compiled }) => formulaSqlOk(numericValues(compiled, "AVG"), "numeric"),
  MEDIAN: ({ compiled }) => formulaSqlOk(numericValues(compiled, "MEDIAN"), "numeric"),
  MIN: ({ compiled }) => formulaSqlOk(numericValues(compiled, "MIN"), "numeric"),
  MAX: ({ compiled }) => formulaSqlOk(numericValues(compiled, "MAX"), "numeric"),
  COUNT: ({ compiled }) => {
    if (compiled.length === 0) return formulaSqlOk(sql`0::numeric`, "numeric");
    const parts = compiled.map(
      (expression) => sql`CASE WHEN ${expression.sql} IS NULL OR (${expression.sql})::text = '' THEN 0 ELSE 1 END`,
    );
    return formulaSqlOk(sql`(${joinFormulaSql(parts, sql` + `)})::numeric`, "numeric");
  },
  PERCENT: ({ numericArg }) => formulaSqlOk(sql`(${numericArg(0)} / NULLIF(${numericArg(1)}, 0) * 100)`, "numeric"),
  CONCAT: ({ compiled }) =>
    formulaSqlOk(compiled.length === 0 ? sql`''::text` : sql`CONCAT(${joinFormulaSql(compiled.map(formulaSqlAsText), sql`, `)})`, "text"),
  LEN: ({ textArg }) => formulaSqlOk(sql`CHAR_LENGTH(${textArg(0)})::numeric`, "numeric"),
  LOWER: ({ textArg }) => formulaSqlOk(sql`LOWER(${textArg(0)})`, "text"),
  UPPER: ({ textArg }) => formulaSqlOk(sql`UPPER(${textArg(0)})`, "text"),
  TRIM: ({ textArg }) => formulaSqlOk(sql`TRIM(${textArg(0)})`, "text"),
  LEFT: ({ textArg, numericArg }) => formulaSqlOk(sql`LEFT(${textArg(0)}, GREATEST(FLOOR(${numericArg(1)})::int, 0))`, "text"),
  RIGHT: ({ textArg, numericArg }) => formulaSqlOk(sql`RIGHT(${textArg(0)}, GREATEST(FLOOR(${numericArg(1)})::int, 0))`, "text"),
  SUBSTRING: ({ textArg, numericArg }) =>
    formulaSqlOk(
      sql`SUBSTRING(${textArg(0)} FROM GREATEST(FLOOR(${numericArg(1)})::int, 0) + 1 FOR GREATEST(FLOOR(${numericArg(2)})::int, 0))`,
      "text",
    ),
  REPLACE: ({ textArg }) => formulaSqlOk(sql`REPLACE(${textArg(0)}, ${textArg(1)}, ${textArg(2)})`, "text"),
  IF: ({ arg, boolArg }) => {
    const thenType = arg(1).type;
    const elseType = arg(2).type;
    return formulaSqlOk(
      sql`CASE WHEN ${boolArg(0)} THEN ${arg(1).sql} ELSE ${arg(2).sql} END`,
      thenType === elseType ? thenType : "unknown",
    );
  },
  IFEMPTY: ({ arg }) =>
    formulaSqlOk(sql`CASE WHEN ${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '' THEN ${arg(1).sql} ELSE ${arg(0).sql} END`, arg(0).type),
  IFERROR: ({ arg }) => formulaSqlOk(sql`COALESCE(${arg(0).sql}, ${arg(1).sql})`, arg(0).type === arg(1).type ? arg(0).type : "unknown"),
  AND: ({ compiled }) =>
    formulaSqlOk(compiled.length === 0 ? sql`true` : sql`(${joinFormulaSql(compiled.map(formulaSqlAsBoolean), sql` AND `)})`, "boolean"),
  OR: ({ compiled }) =>
    formulaSqlOk(compiled.length === 0 ? sql`false` : sql`(${joinFormulaSql(compiled.map(formulaSqlAsBoolean), sql` OR `)})`, "boolean"),
  NOT: ({ boolArg }) => formulaSqlOk(sql`NOT ${boolArg(0)}`, "boolean"),
  ISBLANK: ({ arg }) => formulaSqlOk(sql`(${arg(0).sql} IS NULL OR (${arg(0).sql})::text = '')`, "boolean"),
  CONTAINS: ({ textArg }) => formulaSqlOk(sql`POSITION(${textArg(1)} IN ${textArg(0)}) > 0`, "boolean"),
  STARTSWITH: ({ textArg }) => formulaSqlOk(sql`POSITION(${textArg(1)} IN ${textArg(0)}) = 1`, "boolean"),
  ENDSWITH: ({ textArg }) => formulaSqlOk(sql`RIGHT(${textArg(0)}, CHAR_LENGTH(${textArg(1)})) = ${textArg(1)}`, "boolean"),
  ICONTAINS: ({ textArg }) => formulaSqlOk(sql`POSITION(LOWER(${textArg(1)}) IN LOWER(${textArg(0)})) > 0`, "boolean"),
  ISTARTSWITH: ({ textArg }) => formulaSqlOk(sql`POSITION(LOWER(${textArg(1)}) IN LOWER(${textArg(0)})) = 1`, "boolean"),
  IENDSWITH: ({ textArg }) => formulaSqlOk(sql`RIGHT(LOWER(${textArg(0)}), CHAR_LENGTH(${textArg(1)})) = LOWER(${textArg(1)})`, "boolean"),
  TODAY: ({ compileContext }) => {
    const timeZone = normalizeTimeZone(compileContext.dateConfig?.timeZone, "UTC");
    return formulaSqlOk(sql`${dates.formatDateKey(compileContext.now, { ...compileContext.dateConfig, timeZone })}::date`, "date");
  },
  NOW: ({ compileContext }) => formulaSqlOk(sql`${compileContext.now.toISOString()}::timestamptz`, "datetime"),
  YEAR: ({ arg }) => formulaSqlOk(sql`EXTRACT(YEAR FROM ${formulaSqlAsDate(arg(0))})::numeric`, "numeric"),
  MONTH: ({ arg }) => formulaSqlOk(sql`EXTRACT(MONTH FROM ${formulaSqlAsDate(arg(0))})::numeric`, "numeric"),
  DAY: ({ arg }) => formulaSqlOk(sql`EXTRACT(DAY FROM ${formulaSqlAsDate(arg(0))})::numeric`, "numeric"),
  DATEADD: ({ sourceArgs, compiled }) => compileDateAdd(sourceArgs, compiled),
  DATEDIFF: ({ sourceArgs, compiled }) => compileDateDiff(sourceArgs, compiled),
} satisfies Record<FormulaFunctionName, FormulaFunctionCompiler>;

const formatArity = (spec: { min: number; max: number }): string => {
  if (spec.min === spec.max) return spec.min === 1 ? "1 argument" : `${spec.min} arguments`;
  if (spec.max === Number.POSITIVE_INFINITY) return `at least ${spec.min} argument${spec.min === 1 ? "" : "s"}`;
  return `${spec.min}-${spec.max} arguments`;
};

export const compileFormulaFunction = (
  fn: string,
  args: Expr[],
  compileContext: FunctionCompileContext,
  compileArgs: (args: Expr[]) => FormulaSqlCompileResult[],
): FormulaSqlCompileResult => {
  const upper = fn.toUpperCase();
  const arity = FORMULA_ARITY[upper as FormulaFunctionName];
  if (arity && (args.length < arity.min || args.length > arity.max)) {
    return formulaSqlFail(`${upper} needs ${formatArity(arity)}; got ${args.length}`);
  }
  const results = compileArgs(args);
  const error = results.find((result): result is Extract<FormulaSqlCompileResult, { ok: false }> => !result.ok);
  if (error) return error;
  const compiled = results.map((result) => (result as Extract<FormulaSqlCompileResult, { ok: true }>).expression);
  const arg = (index: number): FormulaSqlExpression => compiled[index] ?? { sql: sql`NULL`, type: "unknown" };
  const compiler = FORMULA_FUNCTION_COMPILERS[upper as FormulaFunctionName] as FormulaFunctionCompiler | undefined;
  if (!compiler) return formulaSqlFail(`Unsupported formula function ${fn}`);
  return compiler({
    sourceArgs: args,
    compiled,
    compileContext,
    arg,
    numericArg: (index) => formulaSqlAsNumeric(arg(index)),
    textArg: (index) => formulaSqlAsText(arg(index)),
    boolArg: (index) => formulaSqlAsBoolean(arg(index)),
  });
};
