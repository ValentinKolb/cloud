import { sql } from "bun";
import { parseFormula } from "../formula/parser";
import type { BinOp, Expr } from "../formula/types";
import { normalizeRefKey } from "../ref-syntax";
import { scalarSqlTypeForField, storageOf } from "./field-storage";
import { compileFormulaFunction } from "./formula-sql-functions";
import {
  type FormulaSqlCompileResult,
  type FormulaSqlExpression,
  type FormulaSqlType,
  formulaSqlAnyError,
  formulaSqlAsBoolean,
  formulaSqlAsDate,
  formulaSqlAsNumeric,
  formulaSqlAsText,
  formulaSqlAsTimestamp,
  formulaSqlError,
  formulaSqlFail,
  formulaSqlLiteral,
  formulaSqlOk,
  formulaSqlOrErrors,
} from "./formula-sql-values";
import type { Field } from "./types";

const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;
const MAX_FORMULA_INLINE_DEPTH = 8;

export type FormulaSqlFieldResolver = (ref: string) => FormulaSqlExpression | string | null;

type FormulaSqlCompileOptions = {
  fields: Field[];
  /** Trusted SQL alias for the records table. Defaults to `r`. */
  recordAlias?: string;
  dateConfig?: import("@valentinkolb/stdlib").DateContext;
  now?: Date;
  resolveField?: FormulaSqlFieldResolver;
  /** Pre-built SQL for lookup/rollup fields (by field id). */
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  /** GQL-only support for explicit scoped refs such as customer.name. */
  scopedRefs?: boolean;
};

type CompileContext = Required<Pick<FormulaSqlCompileOptions, "recordAlias" | "now">> &
  Pick<FormulaSqlCompileOptions, "dateConfig" | "resolveField" | "computedFieldSql"> & {
    fieldsByRef: Map<string, Field[]>;
    inlineStack: Set<string>;
    depth: number;
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

export const formulaSqlTypeForField = (field: Field): FormulaSqlType => scalarSqlTypeForField(field);

type ComparisonOperator = Extract<BinOp, "!=" | "<" | "<=" | "=" | ">" | ">=">;
type ArithmeticOperator = Extract<BinOp, "%" | "*" | "+" | "-" | "/">;

const comparisonOperands = (left: FormulaSqlExpression, right: FormulaSqlExpression): { leftSql: unknown; rightSql: unknown } => {
  if (left.type === "numeric" || right.type === "numeric") {
    return { leftSql: formulaSqlAsNumeric(left), rightSql: formulaSqlAsNumeric(right) };
  }
  if (left.type === "datetime" || right.type === "datetime") {
    return { leftSql: formulaSqlAsTimestamp(left), rightSql: formulaSqlAsTimestamp(right) };
  }
  if (left.type === "date" || right.type === "date") return { leftSql: formulaSqlAsDate(left), rightSql: formulaSqlAsDate(right) };
  if (left.type === "boolean" && right.type === "boolean") {
    return { leftSql: formulaSqlAsBoolean(left), rightSql: formulaSqlAsBoolean(right) };
  }
  return { leftSql: formulaSqlAsText(left), rightSql: formulaSqlAsText(right) };
};

const compileComparison = (op: ComparisonOperator, left: FormulaSqlExpression, right: FormulaSqlExpression): FormulaSqlCompileResult => {
  const operands = comparisonOperands(left, right);
  const errorSql = formulaSqlAnyError([left, right]);
  if (op === "=" || op === "!=") {
    const equal = sql`(${operands.leftSql} IS NOT DISTINCT FROM ${operands.rightSql})`;
    return formulaSqlOk(op === "=" ? equal : sql`NOT ${equal}`, "boolean", errorSql);
  }
  if (op === "<") return formulaSqlOk(sql`(${operands.leftSql} < ${operands.rightSql})`, "boolean", errorSql);
  if (op === "<=") return formulaSqlOk(sql`(${operands.leftSql} <= ${operands.rightSql})`, "boolean", errorSql);
  if (op === ">") return formulaSqlOk(sql`(${operands.leftSql} > ${operands.rightSql})`, "boolean", errorSql);
  return formulaSqlOk(sql`(${operands.leftSql} >= ${operands.rightSql})`, "boolean", errorSql);
};

const compileArithmetic = (op: ArithmeticOperator, left: FormulaSqlExpression, right: FormulaSqlExpression): FormulaSqlCompileResult => {
  const inheritedError = formulaSqlAnyError([left, right]);
  if (op === "+") {
    if (left.type === "text" && right.type === "text") {
      return formulaSqlOk(sql`(${formulaSqlAsText(left)} || ${formulaSqlAsText(right)})`, "text", inheritedError);
    }
    return formulaSqlOk(sql`(${formulaSqlAsNumeric(left)} + ${formulaSqlAsNumeric(right)})`, "numeric", inheritedError);
  }
  if (op === "-") return formulaSqlOk(sql`(${formulaSqlAsNumeric(left)} - ${formulaSqlAsNumeric(right)})`, "numeric", inheritedError);
  if (op === "*") return formulaSqlOk(sql`(${formulaSqlAsNumeric(left)} * ${formulaSqlAsNumeric(right)})`, "numeric", inheritedError);
  const leftSql = formulaSqlAsNumeric(left);
  const rightSql = formulaSqlAsNumeric(right);
  const ownError = sql`(${leftSql} IS NOT NULL AND ${rightSql} = 0)`;
  const errorSql = formulaSqlOrErrors([inheritedError, ownError]);
  if (op === "/") {
    return formulaSqlOk(sql`(${leftSql} / NULLIF(${rightSql}, 0))`, "numeric", errorSql);
  }
  return formulaSqlOk(sql`MOD(${leftSql}, NULLIF(${rightSql}, 0))`, "numeric", errorSql);
};

const compileBinaryOperator = (op: BinOp, left: FormulaSqlExpression, right: FormulaSqlExpression): FormulaSqlCompileResult => {
  if (op === "&&" || op === "||") {
    const leftSql = formulaSqlAsBoolean(left);
    const rightSql = formulaSqlAsBoolean(right);
    const evaluateRight = op === "&&" ? leftSql : sql`NOT ${leftSql}`;
    const errorSql =
      left.errorSql === undefined && right.errorSql === undefined
        ? undefined
        : sql`(${formulaSqlError(left)} OR (${evaluateRight} AND ${formulaSqlError(right)}))`;
    return formulaSqlOk(op === "&&" ? sql`(${leftSql} AND ${rightSql})` : sql`(${leftSql} OR ${rightSql})`, "boolean", errorSql);
  }
  if (op === "=" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
    return compileComparison(op, left, right);
  }
  return compileArithmetic(op, left, right);
};

const inlineFormulaField = (field: Field, context: CompileContext): FormulaSqlCompileResult => {
  if (context.inlineStack.has(field.id)) return formulaSqlFail(`Formula field "${field.name}" references itself (cycle)`);
  if (context.depth >= MAX_FORMULA_INLINE_DEPTH) return formulaSqlFail(`Formula nesting is too deep at field "${field.name}"`);
  const expression = (field.config as { expression?: unknown }).expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return formulaSqlFail(`Formula field "${field.name}" has no expression`);
  }
  const parsed = parseFormula(expression);
  if (!parsed.ok) return formulaSqlFail(`Formula field "${field.name}": ${parsed.error}`);
  const inlineStack = new Set(context.inlineStack);
  inlineStack.add(field.id);
  return compileExpression(parsed.ast, { ...context, inlineStack, depth: context.depth + 1 });
};

const compileFieldExpression = (expression: Extract<Expr, { kind: "field" }>, context: CompileContext): FormulaSqlCompileResult => {
  const custom = context.resolveField?.(expression.fieldId);
  if (typeof custom === "string") return formulaSqlFail(custom);
  if (custom) return formulaSqlOk(custom.sql, custom.type, custom.errorSql);
  const field = fieldByRef(context.fieldsByRef, expression.fieldId);
  if (typeof field === "string") return formulaSqlFail(field);
  if (field.type === "formula") return inlineFormulaField(field, context);
  if (field.type === "lookup" || field.type === "rollup") {
    const computed = context.computedFieldSql?.get(field.id);
    if (computed) return formulaSqlOk(computed.sql, computed.type, computed.errorSql);
  }
  const projection = storageOf(field).project(field, context.recordAlias);
  if (projection === null) return formulaSqlFail(`Field ${field.name} (${field.type}) cannot be compiled into SQL formulas yet`);
  return formulaSqlOk(projection, formulaSqlTypeForField(field));
};

const compileUnaryExpression = (expression: Extract<Expr, { kind: "unop" }>, context: CompileContext): FormulaSqlCompileResult => {
  const operand = compileExpression(expression.operand, context);
  if (!operand.ok) return operand;
  if (expression.op === "-") {
    return formulaSqlOk(sql`(-${formulaSqlAsNumeric(operand.expression)})`, "numeric", operand.expression.errorSql);
  }
  return formulaSqlOk(sql`NOT ${formulaSqlAsBoolean(operand.expression)}`, "boolean", operand.expression.errorSql);
};

const compileBinaryExpression = (expression: Extract<Expr, { kind: "binop" }>, context: CompileContext): FormulaSqlCompileResult => {
  const left = compileExpression(expression.left, context);
  if (!left.ok) return left;
  const right = compileExpression(expression.right, context);
  if (!right.ok) return right;
  return compileBinaryOperator(expression.op, left.expression, right.expression);
};

const compileExpression = (expression: Expr, context: CompileContext): FormulaSqlCompileResult => {
  switch (expression.kind) {
    case "literal": {
      const literal = formulaSqlLiteral(expression.value);
      return formulaSqlOk(literal.sql, literal.type);
    }
    case "field":
      return compileFieldExpression(expression, context);
    case "unop":
      return compileUnaryExpression(expression, context);
    case "binop":
      return compileBinaryExpression(expression, context);
    case "call":
      return compileFormulaFunction(expression.fn, expression.args, context, (args) =>
        args.map((argument) => compileExpression(argument, context)),
      );
  }
};

export const compileFormulaAstToSql = (ast: Expr, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const recordAlias = options.recordAlias ?? "r";
  if (!SQL_ALIAS.test(recordAlias)) return formulaSqlFail(`Unsafe SQL record alias ${recordAlias}`);
  return compileExpression(ast, {
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
  if (compiled.expression.type !== "boolean") return formulaSqlFail("Formula predicate must return a boolean value");
  return compiled;
};

export const compileFormulaSourceToSql = (source: string, options: FormulaSqlCompileOptions): FormulaSqlCompileResult => {
  const parsed = parseFormula(source, { scopedRefs: options.scopedRefs });
  if (!parsed.ok) return formulaSqlFail(parsed.error);
  return compileFormulaAstToSql(parsed.ast, options);
};
