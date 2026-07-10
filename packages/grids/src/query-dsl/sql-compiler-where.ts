import { sql } from "bun";
import { compileFilter, renderClause } from "../service/filter-compiler";
import { compileFormulaPredicateAstToSql, type FormulaSqlExpression, type FormulaSqlFieldResolver } from "../service/formula-sql-compiler";
import { compileRecordMetaFilter } from "../service/record-metadata";
import type { Field } from "../service/types";
import type { DslWherePredicate } from "./resolver";

type PredicateCompileOptions = {
  timeZone?: string;
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  resolveField?: FormulaSqlFieldResolver;
};

type PredicateCompileResult = { ok: true; sql: unknown } | { ok: false; error: string };

const joinPredicateParts = (parts: unknown[], separator: unknown): unknown => {
  if (parts.length === 0) return sql``;
  return parts.slice(1).reduce((acc, part) => sql`${acc}${separator}${part}`, parts[0]!);
};

export const compileWherePredicate = (
  node: DslWherePredicate,
  fields: Field[],
  options: PredicateCompileOptions,
): PredicateCompileResult => {
  switch (node.kind) {
    case "and":
    case "or": {
      const parts: unknown[] = [];
      for (const part of node.parts) {
        const compiled = compileWherePredicate(part, fields, options);
        if (!compiled.ok) return compiled;
        parts.push(sql`(${compiled.sql})`);
      }
      if (parts.length === 0) return { ok: true, sql: node.kind === "and" ? sql`TRUE` : sql`FALSE` };
      return { ok: true, sql: joinPredicateParts(parts, node.kind === "and" ? sql` AND ` : sql` OR `) };
    }
    case "not": {
      const compiled = compileWherePredicate(node.part, fields, options);
      if (!compiled.ok) return compiled;
      return { ok: true, sql: sql`(NOT (${compiled.sql}))` };
    }
    case "filter":
    case "tree": {
      const compiled = compileFilter(node.kind === "tree" ? node.tree : node.leaf, fields, { timeZone: options.timeZone });
      if (!compiled.ok) return { ok: false, error: compiled.error };
      return { ok: true, sql: renderClause(compiled.clause) };
    }
    case "recordMeta":
      return { ok: true, sql: compileRecordMetaFilter(node.meta) };
    case "formula": {
      const compiled = compileFormulaPredicateAstToSql(node.expression, {
        fields,
        recordAlias: "r",
        dateConfig: options.timeZone ? { timeZone: options.timeZone } : undefined,
        computedFieldSql: options.computedFieldSql,
        resolveField: options.resolveField,
      });
      if (!compiled.ok) return { ok: false, error: compiled.error };
      return { ok: true, sql: compiled.expression.sql };
    }
  }
};
