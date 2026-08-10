import {
  canonicalCustomAppQueryContext,
  customAppQueryPlanHash,
  customAppQueryPlanRelationTargetTableIds,
} from "../custom-apps/query-plan-hash";
import { bindDslQueryContext, type DslQueryContextValues } from "../query-dsl/parameters";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { type DslResolvedSqlQueryPlan, resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { collectDslPlanExtraFieldTableIds } from "../query-dsl/source-plan";
import * as fields from "./fields";
import { buildTrustedGqlResolverContext } from "./gql-resolver-context";
import type { Field } from "./types";

type CompiledCustomAppQuery = {
  plan: DslResolvedSqlQueryPlan;
  planHash: string;
  fieldsByTableId: Record<string, Field[]>;
  tableShortIds: Record<string, string>;
};

type CompileCustomAppQueryResult = { ok: true; data: CompiledCustomAppQuery } | { ok: false; error: string };

const diagnosticMessage = (diagnostics: Array<{ message: string }>, fallback: string) =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || fallback;

export const compileCustomAppQuery = async (params: {
  baseId: string;
  source: string;
  currentTableId?: string;
  context: DslQueryContextValues;
}): Promise<CompileCustomAppQueryResult> => {
  const parsed = parseGridsQueryDsl(params.source);
  if (!parsed.ok) return { ok: false, error: diagnosticMessage(parsed.diagnostics, "invalid GQL source") };
  const bound = bindDslQueryContext(parsed.ast, params.context);
  if (!bound.ok) return { ok: false, error: bound.error };
  const canonicalBound = bindDslQueryContext(parsed.ast, canonicalCustomAppQueryContext(params.context));
  if (!canonicalBound.ok) return { ok: false, error: canonicalBound.error };

  const context = await buildTrustedGqlResolverContext({
    baseId: params.baseId,
    ...(params.currentTableId ? { currentTableId: params.currentTableId } : {}),
    ast: bound.ast,
    purpose: "custom-app-render",
  });
  const resolved = resolveDslQueryToQueryPlan(bound.ast, context);
  if (!resolved.ok) return { ok: false, error: diagnosticMessage(resolved.diagnostics, "invalid GQL source") };
  const canonicalResolved = resolveDslQueryToQueryPlan(canonicalBound.ast, context);
  if (!canonicalResolved.ok) return { ok: false, error: diagnosticMessage(canonicalResolved.diagnostics, "invalid GQL source") };

  const missingFieldTableIds = [
    ...new Set([...collectDslPlanExtraFieldTableIds(resolved.plan), ...collectDslPlanExtraFieldTableIds(canonicalResolved.plan)]),
  ].filter((tableId) => context.fieldsByTableId[tableId] === undefined);
  const missingFields = await Promise.all(
    missingFieldTableIds.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })),
  );

  const fieldsWithPlanExtras = {
    ...context.fieldsByTableId,
    ...Object.fromEntries(missingFields.map((group) => [group.tableId, group.fields])),
  };
  const relationTargetTableIds = customAppQueryPlanRelationTargetTableIds(canonicalResolved.plan, fieldsWithPlanExtras).filter(
    (tableId) => fieldsWithPlanExtras[tableId] === undefined,
  );
  const relationTargetFields = await Promise.all(
    relationTargetTableIds.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })),
  );
  const fieldsByTableId = {
    ...fieldsWithPlanExtras,
    ...Object.fromEntries(relationTargetFields.map((group) => [group.tableId, group.fields])),
  };

  return {
    ok: true,
    data: {
      plan: resolved.plan,
      planHash: customAppQueryPlanHash(canonicalResolved.plan, fieldsByTableId),
      fieldsByTableId,
      tableShortIds: Object.fromEntries(context.tables.map((table) => [table.id, table.shortId])),
    },
  };
};
