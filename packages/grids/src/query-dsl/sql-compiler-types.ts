import type { FormulaSqlExpression, FormulaSqlType } from "../service/formula-sql-compiler";
import type { Field } from "../service/types";

export type DslSqlOutputColumn = {
  key: string;
  label: string;
  tableId: string;
  fieldId?: string;
  joinAlias?: string;
  type: string;
  sqlType: FormulaSqlType | "json";
};

export type DslSqlCompileOptions = {
  fieldsByTableId: Record<string, Field[]>;
  timeZone?: string;
  limit?: number;
  joinFanoutLimit?: number;
  /** Pre-compiled full-text search predicate built asynchronously by the caller. */
  searchClause?: unknown;
  /** Pre-built SQL for lookup/rollup fields by field id. */
  computedFieldSql?: Map<string, FormulaSqlExpression>;
  /** Pre-built lookup/rollup SQL for joined scopes by GQL join alias. */
  computedFieldSqlByJoinAlias?: Map<string, Map<string, FormulaSqlExpression>>;
  /** Pre-compiled search predicate for the saved view used as source. */
  viewSourceSearchClause?: unknown;
};

export type DslSqlCompiledQuery = {
  sql: unknown;
  columns: DslSqlOutputColumn[];
  joinAliases: Record<string, string>;
  limit: number;
  offset: number;
};

export type DslSqlCompileResult = { ok: true; query: DslSqlCompiledQuery } | { ok: false; error: string };

export type DslSqlGroupOutputColumn =
  | {
      kind: "group";
      key: string;
      label: string;
      fieldId: string;
      tableId?: string;
      type: string;
      sqlType: DslSqlOutputColumn["sqlType"];
    }
  | {
      kind: "aggregate";
      key: string;
      label: string;
      fieldId: string | "*";
      agg: string;
      sqlType: FormulaSqlType;
    };

type DslSqlCompiledGroupQuery = {
  sql: unknown;
  columns: DslSqlGroupOutputColumn[];
  limit: number;
  offset: number;
  cursorable: boolean;
};

export type DslSqlGroupCompileResult = { ok: true; query: DslSqlCompiledGroupQuery } | { ok: false; error: string };

export type DslSqlAggregateOutputColumn = {
  key: string;
  label: string;
  fieldId: string | "*";
  agg: string;
  sqlType: FormulaSqlType;
};

type DslSqlCompiledAggregateQuery = {
  sql: unknown;
  columns: DslSqlAggregateOutputColumn[];
  limit: 1;
  offset: 0;
};

export type DslSqlAggregateCompileResult = { ok: true; query: DslSqlCompiledAggregateQuery } | { ok: false; error: string };
