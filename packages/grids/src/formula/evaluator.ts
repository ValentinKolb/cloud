import { FN_LIBRARY, isFormulaError } from "./functions";
import { formulaError, type Expr, type Literal } from "./types";

export type EvalContext = {
  /** Record data keyed by field id. */
  fields: Record<string, unknown>;
};

const isNullish = (v: unknown): boolean => v === null || v === undefined;

const toNumber = (v: unknown): number | null => {
  if (isNullish(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
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
    case "field":
      return ctx.fields[ast.fieldId] ?? null;
    case "unop": {
      const v = evaluate(ast.operand, ctx);
      if (isFormulaError(v)) return v;
      if (ast.op === "-") {
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

      // Comparisons: number-aware (works for date strings too via Date.parse).
      if (op === "<" || op === "<=" || op === ">" || op === ">=") {
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

      // Arithmetic. `+` doubles as string concat when both operands are strings.
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
