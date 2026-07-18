import { sql } from "bun";
import type { DslSqlCompileOptions } from "./sql-compiler-types";

export const dslRecordRelation = (options: Pick<DslSqlCompileOptions, "recordSource">): unknown =>
  options.recordSource ? sql`${options.recordSource.relation} r` : sql`grids.records r`;

export const dslRecordTableCondition = (tableId: string, options: Pick<DslSqlCompileOptions, "recordSource">): unknown =>
  options.recordSource ? sql`TRUE` : sql`r.table_id = ${tableId}::uuid`;

export const dslRelationValuesInRecordData = (options: Pick<DslSqlCompileOptions, "recordSource">): boolean =>
  options.recordSource?.kind === "federated";
