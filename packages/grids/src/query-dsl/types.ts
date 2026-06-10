import type { Expr } from "../formula/types";

export type DslSourceKind = "table" | "view" | "unknown";

export type DslSourceRef = {
  kind: DslSourceKind;
  ref: string;
};

export type DslQualifiedRef = {
  scope?: string;
  ref: string;
};

export type DslSelectItem =
  | {
      kind: "field";
      field: DslQualifiedRef;
      alias?: string;
    }
  | {
      kind: "formula";
      expression: Expr;
      source: string;
      alias: string;
    };

export type DslJoinMode = "inner" | "left";

export type DslJoin = {
  mode: DslJoinMode;
  source: DslSourceRef;
  alias: string;
  on: {
    left: DslQualifiedRef;
    right: DslQualifiedRef;
  };
};

export type DslSortItem = {
  target: DslQualifiedRef | { kind: "alias"; alias: string };
  direction: "asc" | "desc";
};

export type DslGroupItem = {
  field: DslQualifiedRef;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

export type DslAggregateFn = "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max" | "median" | "earliest" | "latest";

export type DslAggregateItem = {
  fn: DslAggregateFn;
  argument: "*" | DslQualifiedRef | { kind: "formula"; expression: Expr; source: string };
  alias: string;
};

export type DslQueryAst = {
  source?: DslSourceRef;
  joins: DslJoin[];
  select: DslSelectItem[];
  where?: { expression: Expr; source: string };
  groupBy: DslGroupItem[];
  aggregations: DslAggregateItem[];
  having?: { expression: Expr; source: string };
  sort: DslSortItem[];
  limit?: number;
  offset?: number;
};

export type DslParseDiagnostic = {
  line: number;
  message: string;
};

export type DslParseResult = { ok: true; ast: DslQueryAst } | { ok: false; diagnostics: DslParseDiagnostic[] };
