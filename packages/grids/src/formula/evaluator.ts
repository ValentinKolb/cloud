import Decimal from "decimal.js";
import { FN_LIBRARY, isFormulaError } from "./functions";
import { formulaError, type Expr, type Literal } from "./types";

export type EvalContext = {
  /** Record data keyed by field id (UUID). */
  fields: Record<string, unknown>;
  /** Optional `slug → fieldId` map. Lets the evaluator resolve `#slug`
   *  field-references in formulas to the underlying UUID-keyed record
   *  data. Both syntaxes (`#slug` and `{uuid}`) emit the same `field`
   *  AST node — at evaluation, we try the value as a UUID first, then
   *  fall back to the slug map. */
  slugToId?: Record<string, string>;
};

const isNullish = (v: unknown): boolean => v === null || v === undefined;

/**
 * "Exact-shaped" inputs: decimal cells (stored as numeric strings to
 * dodge JS double drift) and currency objects (`{amount, currency}`).
 * When either side of an arithmetic op is exact-shaped we route the
 * whole computation through decimal.js and return the result as a
 * string — that's the only way `24.50 * 1.19` produces "29.155"
 * instead of `29.154999999999998`. Pure-number ops keep using JS
 * doubles so existing back-compat behaviour (and toBeCloseTo tests)
 * stays put.
 */
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const isExactShaped = (v: unknown): boolean => {
  if (typeof v === "string") return NUMERIC_STRING.test(v);
  if (typeof v === "object" && v !== null && "amount" in v) return true;
  return false;
};

const toNumber = (v: unknown): number | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  // Currency cells are stored as `{amount, currency}` objects in JSONB.
  // Treat them as their amount in arithmetic so `#price * 1.19` actually
  // computes the marked-up price instead of silently null-propagating.
  if (typeof v === "object" && v !== null && "amount" in v) {
    return toNumber((v as { amount: unknown }).amount);
  }
  return null;
};

/**
 * Coerce to a Decimal for exact arithmetic. Mirrors `toNumber` but goes
 * through decimal.js so string inputs preserve their declared precision
 * end-to-end. Returns null on inputs that decimal.js would reject (NaN,
 * Infinity, garbage strings, non-money objects).
 */
const toDecimal = (v: unknown): Decimal | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    // Stringify before passing to Decimal so a float literal like 1.19
    // doesn't bring its double-representation noise into the Decimal.
    return new Decimal(String(v));
  }
  if (typeof v === "string") {
    if (!NUMERIC_STRING.test(v)) return null;
    try {
      const d = new Decimal(v);
      return d.isFinite() ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "boolean") return new Decimal(v ? 1 : 0);
  if (typeof v === "object" && v !== null && "amount" in v) {
    return toDecimal((v as { amount: unknown }).amount);
  }
  return null;
};

/** Render a Decimal back to the wire format used for record data —
 *  `toFixed()` (no exponent, no trailing-zero padding past the actual
 *  precision) so JSON round-tripping stays byte-identical. */
const decimalToString = (d: Decimal): string => d.toFixed();

const truthy = (v: unknown): boolean => {
  if (isNullish(v)) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return Boolean(v);
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
    case "field": {
      // Try UUID-keyed lookup first; fall back to slug→id resolution
      // so `#slug` formulas work against the same UUID-keyed data.
      const direct = ctx.fields[ast.fieldId];
      if (direct !== undefined) return direct;
      const resolved = ctx.slugToId?.[ast.fieldId];
      if (resolved !== undefined) return ctx.fields[resolved] ?? null;
      return null;
    }
    case "unop": {
      const v = evaluate(ast.operand, ctx);
      if (isFormulaError(v)) return v;
      if (ast.op === "-") {
        // Money-shaped → preserve precision via Decimal.
        if (isExactShaped(v)) {
          const d = toDecimal(v);
          return d === null ? null : decimalToString(d.negated());
        }
        const n = toNumber(v);
        return n === null ? null : -n;
      }
      // "!"
      return !truthy(v);
    }
    case "binop": {
      const op = ast.op;

      // Short-circuit logical ops to match Excel/JS semantics.
      if (op === "&&") {
        const left = evaluate(ast.left, ctx);
        if (isFormulaError(left)) return left;
        if (!truthy(left)) return false;
        const right = evaluate(ast.right, ctx);
        if (isFormulaError(right)) return right;
        return truthy(right);
      }
      if (op === "||") {
        const left = evaluate(ast.left, ctx);
        if (isFormulaError(left)) return left;
        if (truthy(left)) return true;
        const right = evaluate(ast.right, ctx);
        if (isFormulaError(right)) return right;
        return truthy(right);
      }

      const l = evaluate(ast.left, ctx);
      const r = evaluate(ast.right, ctx);
      if (isFormulaError(l)) return l;
      if (isFormulaError(r)) return r;

      // Equality coerces only nullish-equality; otherwise strict comparison.
      if (op === "=") return isNullish(l) && isNullish(r) ? true : l === r;
      if (op === "!=") return isNullish(l) && isNullish(r) ? false : l !== r;

      // Null propagation for arithmetic / comparison.
      if (isNullish(l) || isNullish(r)) return null;

      const wantExact = isExactShaped(l) || isExactShaped(r);

      // Comparisons. Lexicographic for plain text strings (the date-
      // string ISO ordering happens to be correct because YYYY-MM-DD
      // sorts numerically too); Decimal-based for money-shaped operands
      // so 9.99 < 24.50 instead of "9.99" < "24.50" (the lexicographic
      // string compare would say false there); JS-double for the rest.
      if (op === "<" || op === "<=" || op === ">" || op === ">=") {
        if (wantExact) {
          const ld = toDecimal(l);
          const rd = toDecimal(r);
          if (ld === null || rd === null) return null;
          if (op === "<") return ld.lt(rd);
          if (op === "<=") return ld.lte(rd);
          if (op === ">") return ld.gt(rd);
          return ld.gte(rd);
        }
        if (typeof l === "string" && typeof r === "string") {
          if (op === "<") return l < r;
          if (op === "<=") return l <= r;
          if (op === ">") return l > r;
          return l >= r;
        }
        const ln = toNumber(l);
        const rn = toNumber(r);
        if (ln === null || rn === null) return null;
        if (op === "<") return ln < rn;
        if (op === "<=") return ln <= rn;
        if (op === ">") return ln > rn;
        return ln >= rn;
      }

      // Arithmetic — exact path for money-shaped operands, JS-double
      // path otherwise. The exact path returns a string so JSONB round-
      // tripping preserves the precision the Decimal computed; the
      // double path keeps existing numeric behaviour.
      if (wantExact) {
        const ld = toDecimal(l);
        const rd = toDecimal(r);
        if (ld === null || rd === null) return null;
        if (op === "+") return decimalToString(ld.plus(rd));
        if (op === "-") return decimalToString(ld.minus(rd));
        if (op === "*") return decimalToString(ld.times(rd));
        if (op === "/") {
          if (rd.isZero()) return formulaError("DIV_ZERO");
          return decimalToString(ld.div(rd));
        }
        if (op === "%") {
          if (rd.isZero()) return formulaError("DIV_ZERO");
          return decimalToString(ld.mod(rd));
        }
      }

      // `+` doubles as string concat when BOTH operands are non-numeric
      // strings. The wantExact branch above already caught the "looks
      // like a number" case so "24.50" + "1.19" adds instead of concats.
      if (op === "+" && typeof l === "string" && typeof r === "string") return l + r;
      const ln = toNumber(l);
      const rn = toNumber(r);
      if (ln === null || rn === null) return null;
      if (op === "+") return ln + rn;
      if (op === "-") return ln - rn;
      if (op === "*") return ln * rn;
      if (op === "/") {
        if (rn === 0) return formulaError("DIV_ZERO");
        return ln / rn;
      }
      if (op === "%") {
        if (rn === 0) return formulaError("DIV_ZERO");
        return ln % rn;
      }
      return null;
    }
    case "call": {
      // IF short-circuits: only the selected branch evaluates. A guard
      // like `IF({den}=0, null, {num}/{den})` would otherwise still hit
      // DIV_ZERO from the unused branch.
      if (ast.fn === "IF" && ast.args.length === 3) {
        const cond = evaluate(ast.args[0]!, ctx);
        if (isFormulaError(cond)) return cond;
        return evaluate(ast.args[truthy(cond) ? 1 : 2]!, ctx);
      }
      // AND / OR also short-circuit, mirroring the `&&` and `||`
      // operators. Without this, AND(FALSE, 1/0) returned #DIV_ZERO
      // even though the first arg is false (chunk 6 important — two
      // boolean models in the same engine).
      if (ast.fn === "AND") {
        for (const a of ast.args) {
          const v = evaluate(a, ctx);
          if (isFormulaError(v)) return v;
          if (!truthy(v)) return false;
        }
        return true;
      }
      if (ast.fn === "OR") {
        for (const a of ast.args) {
          const v = evaluate(a, ctx);
          if (isFormulaError(v)) return v;
          if (truthy(v)) return true;
        }
        return false;
      }
      const fn = FN_LIBRARY[ast.fn];
      if (!fn) return formulaError(`UNKNOWN_FN:${ast.fn}`);
      const args: unknown[] = [];
      for (const a of ast.args) {
        const v = evaluate(a, ctx);
        if (isFormulaError(v)) return v;
        args.push(v);
      }
      try {
        return fn(args);
      } catch {
        return formulaError(`FN_ERROR:${ast.fn}`);
      }
    }
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
  // Objects (e.g. unexpected currency-object) get JSON-stringified.
  return JSON.stringify(v);
};
