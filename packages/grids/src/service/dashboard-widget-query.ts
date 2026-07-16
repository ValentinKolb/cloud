import { parseGridsQueryDsl } from "../query-dsl/parser";
import { type DslResolvedSqlQueryPlan, resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import * as fields from "./fields";
import { buildTrustedGqlResolverContext } from "./gql-resolver-context";
import type { Field } from "./types";

type CompiledDashboardWidgetQuery = {
  plan: DslResolvedSqlQueryPlan;
  fieldsByTableId: Record<string, Field[]>;
  tableShortIds: Record<string, string>;
};

type CompileDashboardWidgetQueryResult = { ok: true; data: CompiledDashboardWidgetQuery } | { ok: false; error: string };

const diagnosticMessage = (diagnostics: Array<{ message: string }>, fallback: string) =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || fallback;

export const compileDashboardWidgetQuery = async (params: {
  baseId: string;
  source: string;
  currentTableId?: string;
}): Promise<CompileDashboardWidgetQueryResult> => {
  const parsed = parseGridsQueryDsl(params.source);
  if (!parsed.ok) return { ok: false, error: diagnosticMessage(parsed.diagnostics, "invalid GQL source") };

  const context = await buildTrustedGqlResolverContext({
    baseId: params.baseId,
    ...(params.currentTableId ? { currentTableId: params.currentTableId } : {}),
    ast: parsed.ast,
    purpose: "dashboard-widget-render",
  });
  const resolved = resolveDslQueryToQueryPlan(parsed.ast, context);
  if (!resolved.ok) return { ok: false, error: diagnosticMessage(resolved.diagnostics, "invalid GQL source") };

  const missingFieldTableIds = collectDslPlanExtraFieldTableIds(resolved.plan).filter(
    (tableId) => context.fieldsByTableId[tableId] === undefined,
  );
  const missingFields = await Promise.all(
    missingFieldTableIds.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })),
  );

  return {
    ok: true,
    data: {
      plan: resolved.plan,
      fieldsByTableId: {
        ...context.fieldsByTableId,
        ...Object.fromEntries(missingFields.map((group) => [group.tableId, group.fields])),
      },
      tableShortIds: Object.fromEntries(context.tables.map((table) => [table.id, table.shortId])),
    },
  };
};
