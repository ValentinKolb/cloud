import type { Expr } from "../formula/types";
import type { DslQueryAst, DslSourceSpan } from "./types";

export type DslResolverDiagnostic = {
  line?: number;
  column?: number;
  length?: number;
  message: string;
};

export type DslPlanDiagnosticSpans = {
  source?: DslSourceSpan;
  where?: DslSourceSpan;
  having?: DslSourceSpan;
  search?: DslSourceSpan;
  select?: Array<{ label: string; span?: DslSourceSpan }>;
  groupBy?: Array<{ label: string; span?: DslSourceSpan }>;
  aggregations?: Array<{ alias: string; span?: DslSourceSpan }>;
  sort?: DslSourceSpan[];
};

export const diagnosticSpansForAst = (ast: DslQueryAst, groupLabels?: string[]): DslPlanDiagnosticSpans => ({
  ...(ast.source?.span ? { source: ast.source.span } : {}),
  ...(ast.where?.span ? { where: ast.where.span } : {}),
  ...(ast.having?.span ? { having: ast.having.span } : {}),
  ...(ast.search?.span ? { search: ast.search.span } : {}),
  ...(ast.select.length > 0
    ? {
        select: ast.select.map((item) => ({
          label: item.alias ?? (item.kind === "field" ? item.field.ref : item.alias),
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.groupBy.length > 0
    ? {
        groupBy: ast.groupBy.map((item, index) => ({
          label: groupLabels?.[index] ?? item.field.ref,
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.aggregations.length > 0
    ? {
        aggregations: ast.aggregations.map((item) => ({
          alias: item.alias,
          ...(item.span ? { span: item.span } : {}),
        })),
      }
    : {}),
  ...(ast.sort.length > 0 ? { sort: ast.sort.map((item) => item.span).filter((span): span is DslSourceSpan => Boolean(span)) } : {}),
});

export const diagnostic = (message: string, span?: DslSourceSpan): DslResolverDiagnostic => ({
  ...(span ? { line: span.line, column: span.column, length: span.length } : {}),
  message,
});

export const spanForExpr = (base: DslSourceSpan | undefined, expr: Expr): DslSourceSpan | undefined =>
  base && expr.span
    ? {
        line: base.line,
        column: base.column + expr.span.start,
        length: Math.max(expr.span.end - expr.span.start, 1),
      }
    : base;

export const isResolverDiagnostic = (value: unknown): value is DslResolverDiagnostic =>
  typeof value === "object" && value !== null && "message" in value;
