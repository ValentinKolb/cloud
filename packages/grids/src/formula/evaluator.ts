import { normalizeRefKey } from "../ref-syntax";
import { FN_LIBRARY, type FormulaRuntimeContext, isFormulaError } from "./functions";
import { formulaComparisonTimestamp, isFormulaComparisonDate } from "./functions-date";
import { decimalToString, isExactShaped, isNullish, toDecimalValue, toNumber } from "./numeric";
import { type BinOp, type Expr, formulaError, type Literal } from "./types";

type EvalContext = FormulaRuntimeContext & {
  /** Record data keyed by field id (UUID). */
  fields: Record<string, unknown>;
  /** Optional `slug → fieldId` map. Lets the evaluator resolve `#slug`
   *  field-references in formulas to the underlying UUID-keyed record
   *  data. Both syntaxes (`#slug` and `{uuid}`) emit the same `field`
   *  AST node — at evaluation, we try the value as a UUID first, then
   *  fall back to the slug map. */
  slugToId?: Record<string, string>;
};

const truthy = (v: unknown): boolean => {
  if (isNullish(v)) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return Boolean(v);
};

const evalField = (fieldId: string, ctx: EvalContext): unknown => {
  // Try UUID-keyed lookup first; fall back to slug→id resolution so
  // `#slug` formulas work against the same UUID-keyed data.
  const direct = ctx.fields[fieldId];
  if (direct !== undefined) return direct;
  const resolved = ctx.slugToId?.[fieldId] ?? ctx.slugToId?.[normalizeRefKey(fieldId)];
  if (resolved !== undefined) return ctx.fields[resolved] ?? null;
  return null;
};

const evalUnary = (ast: Extract<Expr, { kind: "unop" }>, ctx: EvalContext): unknown => {
  const v = evaluate(ast.operand, ctx);
  if (isFormulaError(v)) return v;
  if (ast.op !== "-") return !truthy(v);

  // Decimal-string shaped values preserve precision via Decimal.
  if (isExactShaped(v)) {
    const d = toDecimalValue(v);
    return d === null ? null : decimalToString(d.decimal.negated());
  }
  const n = toNumber(v);
  return n === null ? null : -n;
};

const evalLogicalBinary = (op: "&&" | "||", leftExpr: Expr, rightExpr: Expr, ctx: EvalContext): unknown => {
  const left = evaluate(leftExpr, ctx);
  if (isFormulaError(left)) return left;
  if (op === "&&" && !truthy(left)) return false;
  if (op === "||" && truthy(left)) return true;

  const right = evaluate(rightExpr, ctx);
  if (isFormulaError(right)) return right;
  return truthy(right);
};

const compareExact = (op: BinOp, left: unknown, right: unknown): unknown => {
  const ld = toDecimalValue(left);
  const rd = toDecimalValue(right);
  if (ld === null || rd === null) return null;
  if (op === "<") return ld.decimal.lt(rd.decimal);
  if (op === "<=") return ld.decimal.lte(rd.decimal);
  if (op === ">") return ld.decimal.gt(rd.decimal);
  return ld.decimal.gte(rd.decimal);
};

const compareStrings = (op: BinOp, left: string, right: string): boolean => {
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  return left >= right;
};

const compareNumbers = (op: BinOp, left: unknown, right: unknown): unknown => {
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (ln === null || rn === null) return null;
  if (op === "<") return ln < rn;
  if (op === "<=") return ln <= rn;
  if (op === ">") return ln > rn;
  return ln >= rn;
};

const isNumericComparisonValue = (value: unknown): boolean => (typeof value === "number" && Number.isFinite(value)) || isExactShaped(value);

type ComparisonMode = "numeric" | "temporal" | "boolean" | "text";

const comparisonMode = (left: unknown, right: unknown): ComparisonMode => {
  if (isNumericComparisonValue(left) || isNumericComparisonValue(right)) return "numeric";
  if (isFormulaComparisonDate(left) || isFormulaComparisonDate(right)) return "temporal";
  if (typeof left === "boolean" || typeof right === "boolean") return "boolean";
  return "text";
};

const compareTimestamps = (op: BinOp, left: unknown, right: unknown, ctx: EvalContext): unknown => {
  const leftTimestamp = formulaComparisonTimestamp(left, ctx);
  const rightTimestamp = formulaComparisonTimestamp(right, ctx);
  if (leftTimestamp === null || rightTimestamp === null) return null;
  return compareNumbers(op, leftTimestamp, rightTimestamp);
};

const evalComparison = (op: BinOp, left: unknown, right: unknown, ctx: EvalContext): unknown => {
  const mode = comparisonMode(left, right);
  if (mode === "numeric") return compareExact(op, left, right);
  if (mode === "temporal") return compareTimestamps(op, left, right, ctx);
  if (mode === "boolean") return typeof left === "boolean" && typeof right === "boolean" ? compareNumbers(op, left, right) : null;
  return typeof left === "string" && typeof right === "string" ? compareStrings(op, left, right) : compareNumbers(op, left, right);
};

const evalEquality = (left: unknown, right: unknown, ctx: EvalContext): boolean => {
  if (isNullish(left) || isNullish(right)) return isNullish(left) && isNullish(right);
  const mode = comparisonMode(left, right);
  if (mode === "numeric") {
    const leftDecimal = toDecimalValue(left);
    const rightDecimal = toDecimalValue(right);
    return leftDecimal !== null && rightDecimal !== null && leftDecimal.decimal.eq(rightDecimal.decimal);
  }
  if (mode === "temporal") {
    const leftTimestamp = formulaComparisonTimestamp(left, ctx);
    const rightTimestamp = formulaComparisonTimestamp(right, ctx);
    return leftTimestamp !== null && rightTimestamp !== null && leftTimestamp === rightTimestamp;
  }
  if (mode === "boolean") return typeof left === "boolean" && typeof right === "boolean" && left === right;
  return left === right;
};

const evalExactArithmetic = (op: BinOp, left: unknown, right: unknown): unknown => {
  const ld = toDecimalValue(left);
  const rd = toDecimalValue(right);
  if (ld === null || rd === null) return null;
  if (op === "+") return decimalToString(ld.decimal.plus(rd.decimal));
  if (op === "-") return decimalToString(ld.decimal.minus(rd.decimal));
  if (op === "*") return decimalToString(ld.decimal.times(rd.decimal));
  if (rd.decimal.isZero()) return formulaError("DIV_ZERO");
  if (op === "/") return decimalToString(ld.decimal.div(rd.decimal));
  if (op === "%") return decimalToString(ld.decimal.mod(rd.decimal));
  return null;
};

const evalNumberArithmetic = (op: BinOp, left: unknown, right: unknown): unknown => {
  // `+` doubles as string concat when BOTH operands are non-numeric
  // strings. The exact path already catches numeric-looking strings so
  // "24.50" + "1.19" adds instead of concats.
  if (op === "+" && typeof left === "string" && typeof right === "string") return left + right;

  const ln = toNumber(left);
  const rn = toNumber(right);
  if (ln === null || rn === null) return null;
  if (op === "+") return ln + rn;
  if (op === "-") return ln - rn;
  if (op === "*") return ln * rn;
  if (rn === 0) return formulaError("DIV_ZERO");
  if (op === "/") return ln / rn;
  if (op === "%") return ln % rn;
  return null;
};

const evalBinary = (ast: Extract<Expr, { kind: "binop" }>, ctx: EvalContext): unknown => {
  const op = ast.op;

  // Short-circuit logical ops to match Excel/JS semantics.
  if (op === "&&" || op === "||") return evalLogicalBinary(op, ast.left, ast.right, ctx);

  const left = evaluate(ast.left, ctx);
  const right = evaluate(ast.right, ctx);
  if (isFormulaError(left)) return left;
  if (isFormulaError(right)) return right;

  if (op === "=" || op === "!=") {
    const equal = evalEquality(left, right, ctx);
    return op === "=" ? equal : !equal;
  }

  // Null propagation for arithmetic / comparison.
  if (isNullish(left) || isNullish(right)) return null;

  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return evalComparison(op, left, right, ctx);
  }
  const wantExact = isExactShaped(left) || isExactShaped(right);
  return wantExact ? evalExactArithmetic(op, left, right) : evalNumberArithmetic(op, left, right);
};

type CallExpr = Extract<Expr, { kind: "call" }>;

const evalIfCall = (args: Expr[], ctx: EvalContext): unknown | undefined => {
  if (args.length !== 3) return undefined;
  const condition = evaluate(args[0]!, ctx);
  if (isFormulaError(condition)) return condition;
  return evaluate(args[truthy(condition) ? 1 : 2]!, ctx);
};

const evalIfErrorCall = (args: Expr[], ctx: EvalContext): unknown => {
  if (args.length !== 2) return formulaError("IFERROR_BAD_ARGS");
  const value = evaluate(args[0]!, ctx);
  return isFormulaError(value) ? evaluate(args[1]!, ctx) : value;
};

const evalIfEmptyCall = (args: Expr[], ctx: EvalContext): unknown => {
  if (args.length !== 2) return formulaError("IFEMPTY_BAD_ARGS");
  const value = evaluate(args[0]!, ctx);
  if (isFormulaError(value)) return value;
  return isNullish(value) || value === "" ? evaluate(args[1]!, ctx) : value;
};

const evalLogicalCall = (fn: "AND" | "OR", args: Expr[], ctx: EvalContext): unknown => {
  for (const arg of args) {
    const value = evaluate(arg, ctx);
    if (isFormulaError(value)) return value;
    if (fn === "AND" && !truthy(value)) return false;
    if (fn === "OR" && truthy(value)) return true;
  }
  return fn === "AND";
};

const evalShortCircuitCall = (ast: CallExpr, ctx: EvalContext): unknown | undefined => {
  if (ast.fn === "IF") return evalIfCall(ast.args, ctx);
  if (ast.fn === "IFERROR") return evalIfErrorCall(ast.args, ctx);
  if (ast.fn === "IFEMPTY") return evalIfEmptyCall(ast.args, ctx);
  if (ast.fn === "AND" || ast.fn === "OR") return evalLogicalCall(ast.fn, ast.args, ctx);
  return undefined;
};

const evalCallArgs = (args: Expr[], ctx: EvalContext): unknown[] | ReturnType<typeof formulaError> => {
  const values: unknown[] = [];
  for (const arg of args) {
    const value = evaluate(arg, ctx);
    if (isFormulaError(value)) return value;
    values.push(value);
  }
  return values;
};

const evalCall = (ast: Extract<Expr, { kind: "call" }>, ctx: EvalContext): unknown => {
  const shortCircuit = evalShortCircuitCall(ast, ctx);
  if (shortCircuit !== undefined) return shortCircuit;

  const fn = FN_LIBRARY[ast.fn];
  if (!fn) return formulaError(`UNKNOWN_FN:${ast.fn}`);

  const args = evalCallArgs(ast.args, ctx);
  if (isFormulaError(args)) return args;
  try {
    return fn(args, ctx);
  } catch {
    return formulaError(`FN_ERROR:${ast.fn}`);
  }
};

/**
 * Walks the AST against the given record context. Null propagation: any
 * binary-op operand that resolves to null short-circuits the whole branch
 * to null (Excel-style). Division-by-zero produces a FORMULA_ERROR
 * sentinel rather than NaN/Infinity, so the renderer can show "#DIV/0".
 */
export const evaluate = (ast: Expr, ctx: EvalContext): unknown => {
  switch (ast.kind) {
    case "literal":
      return ast.value;
    case "field":
      return evalField(ast.fieldId, ctx);
    case "unop":
      return evalUnary(ast, ctx);
    case "binop":
      return evalBinary(ast, ctx);
    case "call":
      return evalCall(ast, ctx);
  }
};

/**
 * Renders a formula result for display. Errors become "#ERROR" tokens
 * that the cell formatter can show in red.
 */
export const renderResult = (v: unknown): Literal => {
  if (isFormulaError(v)) return `#${v.code}`;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  // Objects get JSON-stringified.
  return JSON.stringify(v);
};
