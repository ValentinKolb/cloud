import { sql } from "bun";
import { aggregateOutputKey } from "../service/aggregate-capabilities";
import { compileAggregates } from "../service/aggregate-compiler";
import { compileFilter, renderClause } from "../service/filter-compiler";
import type { DslResolvedSqlQueryPlan } from "./resolver";
import { aliveFields } from "./sql-compiler-fields";
import { joinFragments } from "./sql-compiler-fragments";
import {
  aggregateKey,
  compileFormulaAggregateColumn,
  compileGroupExtraWhere,
  formulaAggregateSqlType,
  viewAggregateSqlType,
} from "./sql-compiler-grouping";
import { recordDeletedCondition, scopedFormulaResolverForPlan } from "./sql-compiler-scope";
import type { DslSqlAggregateCompileResult, DslSqlAggregateOutputColumn, DslSqlCompileOptions } from "./sql-compiler-types";

const failAggregate = (error: string): DslSqlAggregateCompileResult => ({ ok: false, error });

export const compileDslAggregateQueryPlanToSql = (
  plan: DslResolvedSqlQueryPlan,
  options: DslSqlCompileOptions,
): DslSqlAggregateCompileResult => {
  const aggregations = plan.query.aggregations ?? [];
  const formulaAggregations = plan.formulaAggregations ?? [];
  if (aggregations.length === 0 && formulaAggregations.length === 0) return failAggregate("query has no aggregate output");
  if ((plan.query.groupBy?.length ?? 0) > 0 || plan.formulaHaving) {
    return failAggregate("grouped DSL query execution belongs to the grouped compiler");
  }
  if ((plan.query.columns?.length ?? 0) > 0 || (plan.joinedColumns?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries cannot select row columns");
  }
  if ((plan.joins?.length ?? 0) > 0) {
    return failAggregate("aggregate-only relation joins are compiled by the grouped SQL compiler");
  }
  if ((plan.query.sort?.length ?? 0) > 0 || (plan.sqlSort?.length ?? 0) > 0 || (plan.query.groupSort?.length ?? 0) > 0) {
    return failAggregate("aggregate-only DSL queries cannot sort");
  }

  const fields = aliveFields(options.fieldsByTableId[plan.tableId] ?? []);
  const resolveFormulaField = scopedFormulaResolverForPlan(plan, fields, new Map(), options);
  const filter = compileFilter(plan.query.filter ?? null, fields, { timeZone: options.timeZone });
  if (!filter.ok) return failAggregate(`filter: ${filter.error}`);
  const aggregateCompiled = compileAggregates(aggregations, fields);
  if (!aggregateCompiled.ok) return failAggregate(`aggregate: ${aggregateCompiled.error}`);
  const extraWhere = compileGroupExtraWhere(plan, fields, options, resolveFormulaField);
  if (!extraWhere.ok) return failAggregate(extraWhere.error);
  const formulaColumns: Array<{ key: string; expr: unknown }> = [];
  for (const aggregation of formulaAggregations) {
    const compiled = compileFormulaAggregateColumn(aggregation, fields, options, resolveFormulaField);
    if (!compiled.ok) return failAggregate(compiled.error);
    formulaColumns.push(compiled);
  }
  const allAggregateColumns = [...aggregateCompiled.columns, ...formulaColumns];
  const jsonPairs = allAggregateColumns.map((column) => sql`${column.key}::text, ${column.expr}`);
  if (jsonPairs.length === 0) return failAggregate("query has no aggregate output");
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const columns: DslSqlAggregateOutputColumn[] = aggregations.map(
    (aggregation): DslSqlAggregateOutputColumn => ({
      key: aggregateOutputKey(aggregation.fieldId, aggregation.agg),
      label: aggregation.label ?? `${aggregation.agg} ${aggregation.fieldId}`,
      fieldId: aggregation.fieldId,
      agg: aggregation.agg,
      sqlType: viewAggregateSqlType(aggregation, fieldsById),
    }),
  );
  for (const aggregation of formulaAggregations) {
    columns.push({
      key: aggregateKey(aggregation),
      label: aggregation.id,
      fieldId: aggregation.id,
      agg: aggregation.agg,
      sqlType: formulaAggregateSqlType(aggregation),
    });
  }

  const where = sql`r.table_id = ${plan.tableId}::uuid
    AND ${recordDeletedCondition(plan)}
    AND ${renderClause(filter.clause)}
    AND ${extraWhere.where ?? sql`TRUE`}
    AND ${options.searchClause ?? sql`TRUE`}`;
  return {
    ok: true,
    query: {
      sql: sql`
        SELECT jsonb_build_object(${joinFragments(jsonPairs, sql`, `)}) AS result
        FROM grids.records r
        JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE ${where}
      `,
      columns,
      limit: 1,
      offset: 0,
    },
  };
};
