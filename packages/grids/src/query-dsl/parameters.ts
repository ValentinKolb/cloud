import type { Expr, Literal } from "../formula/types";
import type { DslQueryAst } from "./types";

export type DslQueryParameters = Record<string, Literal>;

export type BindDslQueryParametersResult = { ok: true; ast: DslQueryAst } | { ok: false; error: string };

const bindExpression = (expression: Expr, parameters: DslQueryParameters, used: Set<string>): Expr | string => {
  if (expression.kind === "call" && expression.fn === "PARAM") {
    const [name, ...extra] = expression.args;
    if (extra.length > 0 || name?.kind !== "literal" || typeof name.value !== "string") {
      return "param() expects exactly one text parameter name";
    }
    if (!Object.hasOwn(parameters, name.value)) return `Unknown query parameter "${name.value}"`;
    used.add(name.value);
    return { kind: "literal", value: parameters[name.value]!, ...(expression.span ? { span: expression.span } : {}) };
  }
  if (expression.kind === "call") {
    const args: Expr[] = [];
    for (const argument of expression.args) {
      const bound = bindExpression(argument, parameters, used);
      if (typeof bound === "string") return bound;
      args.push(bound);
    }
    return { ...expression, args };
  }
  if (expression.kind === "binop") {
    const left = bindExpression(expression.left, parameters, used);
    if (typeof left === "string") return left;
    const right = bindExpression(expression.right, parameters, used);
    if (typeof right === "string") return right;
    return { ...expression, left, right };
  }
  if (expression.kind === "unop") {
    const operand = bindExpression(expression.operand, parameters, used);
    return typeof operand === "string" ? operand : { ...expression, operand };
  }
  return expression;
};

export const bindDslQueryParameters = (ast: DslQueryAst, parameters: DslQueryParameters): BindDslQueryParametersResult => {
  const used = new Set<string>();
  const bind = (expression: Expr): Expr | string => bindExpression(expression, parameters, used);

  const select: DslQueryAst["select"] = [];
  for (const item of ast.select) {
    if (item.kind !== "formula") {
      select.push(item);
      continue;
    }
    const expression = bind(item.expression);
    if (typeof expression === "string") return { ok: false, error: expression };
    select.push({ ...item, expression });
  }

  const aggregations: DslQueryAst["aggregations"] = [];
  for (const item of ast.aggregations) {
    if (item.argument === "*" || !("kind" in item.argument) || item.argument.kind !== "formula") {
      aggregations.push(item);
      continue;
    }
    const expression = bind(item.argument.expression);
    if (typeof expression === "string") return { ok: false, error: expression };
    aggregations.push({ ...item, argument: { ...item.argument, expression } });
  }

  const where = ast.where ? bind(ast.where.expression) : undefined;
  if (typeof where === "string") return { ok: false, error: where };
  const having = ast.having ? bind(ast.having.expression) : undefined;
  if (typeof having === "string") return { ok: false, error: having };

  const unused = Object.keys(parameters)
    .filter((name) => !used.has(name))
    .sort();
  if (unused.length > 0) return { ok: false, error: `Unused query parameter${unused.length === 1 ? "" : "s"}: ${unused.join(", ")}` };

  return {
    ok: true,
    ast: {
      ...ast,
      select,
      aggregations,
      ...(ast.where ? { where: { ...ast.where, expression: where! } } : {}),
      ...(ast.having ? { having: { ...ast.having, expression: having! } } : {}),
    },
  };
};
