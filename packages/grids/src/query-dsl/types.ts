import type { AggregateKind } from "../aggregate-catalog";
import type { Expr } from "../formula/types";

export type DslSourceSpan = {
  line: number;
  column: number;
  length: number;
};

type DslSourceKind = "table" | "view";

export type DslSourceRef = {
  kind: DslSourceKind;
  ref: string;
  span?: DslSourceSpan;
};

export type DslQualifiedRef = {
  scope?: string;
  ref: string;
  span?: DslSourceSpan;
};

export type DslSelectItem =
  | {
      kind: "field";
      field: DslQualifiedRef;
      alias?: string;
      span?: DslSourceSpan;
    }
  | {
      kind: "formula";
      expression: Expr;
      source: string;
      alias: string;
      span?: DslSourceSpan;
    };

type DslJoinMode = "inner" | "left";

export type DslJoin = {
  mode: DslJoinMode;
  source: DslSourceRef;
  alias: string;
  on: {
    left: DslQualifiedRef;
    right: DslQualifiedRef;
  };
  span?: DslSourceSpan;
};

export type DslSortItem = {
  target: DslQualifiedRef | { kind: "alias"; alias: string };
  direction: "asc" | "desc";
  /** `nulls first` / `nulls last` modifier; defaults to last. */
  nullsFirst?: boolean;
  span?: DslSourceSpan;
};

export type DslGroupItem = {
  field: DslQualifiedRef;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
  span?: DslSourceSpan;
};

export type DslAggregateFn = AggregateKind;

export type DslAggregateItem = {
  fn: DslAggregateFn;
  argument: "*" | DslQualifiedRef | { kind: "formula"; expression: Expr; source: string };
  alias: string;
  span?: DslSourceSpan;
};

export type DslQueryAst = {
  source?: DslSourceRef;
  sourceAlias?: string;
  joins: DslJoin[];
  select: DslSelectItem[];
  where?: { expression: Expr; source: string; span?: DslSourceSpan };
  groupBy: DslGroupItem[];
  aggregations: DslAggregateItem[];
  having?: { expression: Expr; source: string; span?: DslSourceSpan };
  sort: DslSortItem[];
  /** `search 'text'` / `search 'text' in Name, Notes` — free-text search. */
  search?: { q: string; fields: DslQualifiedRef[]; span?: DslSourceSpan };
  limit?: number;
  offset?: number;
  /** `include deleted` — list live and trashed records. */
  includeDeleted?: boolean;
  /** `deleted only` — list only trashed records (the trash view). */
  deletedOnly?: boolean;
};

export type DslParseDiagnostic = {
  line: number;
  column?: number;
  length?: number;
  message: string;
};

export type DslParseResult = { ok: true; ast: DslQueryAst } | { ok: false; diagnostics: DslParseDiagnostic[] };
