import { sql } from "bun";
import type { Literal } from "../formula/types";

export type FormulaSqlType = "numeric" | "text" | "boolean" | "date" | "datetime" | "unknown";

export type FormulaSqlExpression = {
  sql: unknown;
  type: FormulaSqlType;
};

export type FormulaSqlCompileResult = { ok: true; expression: FormulaSqlExpression } | { ok: false; error: string };

export const formulaSqlOk = (sqlFragment: unknown, type: FormulaSqlType): FormulaSqlCompileResult => ({
  ok: true,
  expression: { sql: sqlFragment, type },
});

export const formulaSqlFail = (error: string): FormulaSqlCompileResult => ({ ok: false, error });

export const joinFormulaSql = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
};

export const formulaSqlLiteral = (value: Literal): FormulaSqlExpression => {
  if (value === null) return { sql: sql`NULL`, type: "unknown" };
  if (typeof value === "number") return { sql: sql`${String(value)}::numeric`, type: "numeric" };
  if (typeof value === "boolean") return { sql: sql`${value}::boolean`, type: "boolean" };
  return { sql: sql`${value}::text`, type: "text" };
};

export const formulaSqlAsNumeric = (expression: FormulaSqlExpression): unknown => {
  if (expression.type === "numeric") return sql`(${expression.sql})::numeric`;
  if (expression.type === "boolean") return sql`CASE WHEN ${expression.sql} THEN 1::numeric ELSE 0::numeric END`;
  return sql`grids.try_numeric((${expression.sql})::text)`;
};

export const formulaSqlAsText = (expression: FormulaSqlExpression): unknown => sql`COALESCE((${expression.sql})::text, '')`;

export const formulaSqlAsBoolean = (expression: FormulaSqlExpression): unknown => {
  if (expression.type === "boolean") return sql`COALESCE(${expression.sql}, false)`;
  if (expression.type === "numeric") return sql`COALESCE((${expression.sql})::numeric <> 0, false)`;
  return sql`COALESCE((${expression.sql})::text <> '', false)`;
};

export const formulaSqlAsDate = (expression: FormulaSqlExpression): unknown => {
  if (expression.type === "date") return sql`(${expression.sql})::date`;
  if (expression.type === "datetime") return sql`(${expression.sql})::date`;
  return sql`grids.try_iso_date((${expression.sql})::text)`;
};

export const formulaSqlAsTimestamp = (expression: FormulaSqlExpression): unknown => {
  if (expression.type === "datetime") return sql`(${expression.sql})::timestamptz`;
  if (expression.type === "date") return sql`(${expression.sql})::timestamp`;
  return sql`grids.try_timestamptz((${expression.sql})::text)`;
};
