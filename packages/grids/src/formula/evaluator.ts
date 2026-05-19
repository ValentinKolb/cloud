import { FN_LIBRARY, isFormulaError } from "./functions";
import { decimalToString, isExactShaped, isNullish, toDecimalValue, toNumber } from "./numeric";
import { type Expr, formulaError, type Literal } from "./types";

type EvalContext = {
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
        // Decimal-string shaped values preserve precision via Decimal.
        if (isExactShaped(v)) {
          const d = toDecimalValue(v);
          return d === null ? null : decimalToString(d.decimal.negated());
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
      // sorts numerically too); Decimal-based for decimal-string
      // operands so "9.99" < "24.50" is numeric, not lexicographic;
      // JS-number comparison for the rest.
      if (op === "<" || op === "<=" || op === ">" || op === ">=") {
        if (wantExact) {
          const ld = toDecimalValue(l);
          const rd = toDecimalValue(r);
          if (ld === null || rd === null) return null;
          if (op === "<") return ld.decimal.lt(rd.decimal);
          if (op === "<=") return ld.decimal.lte(rd.decimal);
          if (op === ">") return ld.decimal.gt(rd.decimal);
          return ld.decimal.gte(rd.decimal);
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

      // Arithmetic — exact path for decimal-string operands, JS-number
      // path otherwise. The exact path returns a string so JSONB round-
      // tripping preserves the precision the Decimal computed.
      if (wantExact) {
        const ld = toDecimalValue(l);
        const rd = toDecimalValue(r);
        if (ld === null || rd === null) return null;
        if (op === "+") return decimalToString(ld.decimal.plus(rd.decimal));
        if (op === "-") return decimalToString(ld.decimal.minus(rd.decimal));
        if (op === "*") return decimalToString(ld.decimal.times(rd.decimal));
        if (op === "/") {
          if (rd.decimal.isZero()) return formulaError("DIV_ZERO");
          return decimalToString(ld.decimal.div(rd.decimal));
        }
        if (op === "%") {
          if (rd.decimal.isZero()) return formulaError("DIV_ZERO");
          return decimalToString(ld.decimal.mod(rd.decimal));
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
      if (ast.fn === "IFERROR") {
        if (ast.args.length !== 2) return formulaError("IFERROR_BAD_ARGS");
        const value = evaluate(ast.args[0]!, ctx);
        return isFormulaError(value) ? evaluate(ast.args[1]!, ctx) : value;
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
  // Objects get JSON-stringified.
  return JSON.stringify(v);
};
