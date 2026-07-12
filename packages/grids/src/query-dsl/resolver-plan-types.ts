import type { GroupSortSpec, RecordQuery } from "../contracts";
import type { DslFormulaAggregation, DslFormulaHavingPredicate, DslResolvedSqlAggregation } from "./resolver-aggregates";
import type { DslTableSource, DslViewSource } from "./resolver-context";
import type { DslResolvedDerivedViewSource } from "./resolver-derived-source";
import type { DslPlanDiagnosticSpans, DslResolverDiagnostic } from "./resolver-diagnostics";
import type { DslResolvedSqlGroupBy, DslResolvedSqlGroupSort, DslResolvedSqlSort } from "./resolver-group-sort";
import type { DslResolvedRelationJoin } from "./resolver-joins";
import type { DslJoinedColumn, DslOutputColumn } from "./resolver-output";
import type { DslResolvedSqlSearch } from "./resolver-search";
import type { DslWherePredicate } from "./resolver-where";

type DslResolvedQueryPlan = {
  source: DslTableSource | DslViewSource;
  tableId: string;
  sourceAlias?: string;
  query: RecordQuery;
  offset?: number;
};

export type DslResolvedSqlQueryPlan = DslResolvedQueryPlan & {
  readableTableIds: string[];
  viewSourceQuery?: RecordQuery;
  joins?: DslResolvedRelationJoin[];
  outputColumns?: DslOutputColumn[];
  joinedColumns?: DslJoinedColumn[];
  sqlSort?: DslResolvedSqlSort[];
  sqlGroupBy?: DslResolvedSqlGroupBy[];
  sqlGroupSort?: DslResolvedSqlGroupSort[];
  sqlAggregations?: DslResolvedSqlAggregation[];
  sqlSearch?: DslResolvedSqlSearch[];
  derivedViewSource?: DslResolvedDerivedViewSource;
  formulaGroupSort?: GroupSortSpec[];
  formulaAggregations?: DslFormulaAggregation[];
  wherePredicate?: DslWherePredicate;
  formulaHaving?: DslFormulaHavingPredicate;
  diagnosticSpans?: DslPlanDiagnosticSpans;
};

export type DslRecordQueryResolveResult = { ok: true; plan: DslResolvedQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };

export type DslQueryPlanResolveResult = { ok: true; plan: DslResolvedSqlQueryPlan } | { ok: false; diagnostics: DslResolverDiagnostic[] };
