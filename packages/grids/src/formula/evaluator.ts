import { normalizeRefKey } from "../ref-syntax";
import { FN_LIBRARY, type FormulaRuntimeContext, isFormulaError } from "./functions";
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

const evalComparison = (op: BinOp, left: unknown, right: unknown, wantExact: boolean): unknown => {
  // Lexicographic for plain text strings (the date-string ISO ordering
  // happens to be correct because YYYY-MM-DD sorts numerically too);
  // Decimal-based for decimal-string operands so "9.99" < "24.50" is
  // numeric, not lexicographic; JS-number comparison for the rest.
  if (wantExact) return compareExact(op, left, right);
  if (typeof left === "string" && typeof right === "string") return compareStrings(op, left, right);
  return compareNumbers(op, left, right);
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

  // Equality coerces only nullish-equality; otherwise strict comparison.
  if (op === "=") return isNullish(left) && isNullish(right) ? true : left === right;
  if (op === "!=") return isNullish(left) && isNullish(right) ? false : left !== right;

  // Null propagation for arithmetic / comparison.
  if (isNullish(left) || isNullish(right)) return null;

  const wantExact = isExactShaped(left) || isExactShaped(right);
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return evalComparison(op, left, right, wantExact);
  }
  return wantExact ? evalExactArithmetic(op, left, right) : evalNumberArithmetic(op, left, right);
};

const evalShortCircuitCall = (ast: Extract<Expr, { kind: "call" }>, ctx: EvalContext): unknown | undefined => {
  // IF short-circuits: only the selected branch evaluates. A guard
  // like `IF({den}=0, null, {num}/{den})` would otherwise still hit
  // DIV_ZERO from the unused branch.
  if (ast.fn === "IF" && ast.args.length === 3) {
    const cond = evaluate(ast.args[0]!, ctx);
    if (isFormulaError(cond)) return cond;
    return evaluate(ast.args[truthy(cond) ? 1 : 2]!, ctx);
  }

  if (ast.fn === "IFERROR") {
    if (ast.args.length !== 2) return formulaError("IFERROR_BAD_ARGS");
    const value = evaluate(ast.args[0]!, ctx);
    return isFormulaError(value) ? evaluate(ast.args[1]!, ctx) : value;
  }

  // AND / OR also short-circuit, mirroring the `&&` and `||` operators.
  if (ast.fn !== "AND" && ast.fn !== "OR") return undefined;
  for (const arg of ast.args) {
    const value = evaluate(arg, ctx);
    if (isFormulaError(value)) return value;
    if (ast.fn === "AND" && !truthy(value)) return false;
    if (ast.fn === "OR" && truthy(value)) return true;
  }
  return ast.fn === "AND";
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
