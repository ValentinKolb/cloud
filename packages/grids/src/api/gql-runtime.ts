import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import type { DslQueryPreviewBody, DslQueryPreviewDiagnostic, RecordQuery } from "../contracts";
import { canonicalizeDslQuery } from "../query-dsl/canonical";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { dslPreviewDiagnosticForCompilerError, previewDslQuery } from "../query-dsl/preview";
import {
  type DslResolvedSqlQueryPlan,
  type DslResolverContext,
  type DslTableSource,
  type DslViewSource,
  resolveDslQueryToQueryPlan,
  resolveDslQueryToRecordQuery,
} from "../query-dsl/resolver";
import { collectDslFieldTableIds, collectDslPlanExtraFieldTableIds, needsDslViewCatalog } from "../query-dsl/source-plan";
import type { DslQueryAst } from "../query-dsl/types";
import { gridsService } from "../service";
import { hydrateDslViewQueries } from "../service/gql-resolver-context";
import type { Field, Table } from "../service/types";
import { gateAt } from "./permissions";

export type DslCurrentSource = { kind: "table"; tableId: string } | { kind: "view"; viewId: string } | undefined;

type ResolverContextOptions = {
  loadViews?: boolean;
  loadAllFields?: boolean;
  trustedAllSources?: boolean;
};

const withViewPresentation = (query: RecordQuery, presentation: RecordQuery | undefined): RecordQuery => {
  if (!presentation) return query;
  return {
    ...query,
    ...(presentation.columns ? { columns: presentation.columns } : {}),
    ...(presentation.groupBy ? { groupBy: presentation.groupBy } : {}),
    ...(presentation.aggregations ? { aggregations: presentation.aggregations } : {}),
    ...(presentation.groupedColumnOrder ? { groupedColumnOrder: presentation.groupedColumnOrder } : {}),
    ...(presentation.hiddenGroupedColumns ? { hiddenGroupedColumns: presentation.hiddenGroupedColumns } : {}),
  };
};

export const emptyDslAst = (): DslQueryAst => ({
  joins: [],
  select: [],
  groupBy: [],
  aggregations: [],
  sort: [],
});

export const sourceAst = (ast: DslQueryAst, source: DslCurrentSource, ctx: DslResolverContext): DslQueryAst => {
  if (ast.source || !source) return ast;
  if (source.kind === "table") {
    const table = ctx.tables.find((item) => item.id === source.tableId);
    return table ? { ...ast, source: { kind: "table", ref: table.id } } : ast;
  }
  const view = (ctx.views ?? []).find((item) => item.id === source.viewId);
  return view ? { ...ast, source: { kind: "view", ref: view.id } } : ast;
};

export const buildPermissionedGqlResolverContext = async (
  c: Context<AuthContext>,
  baseId: string,
  currentTableId: string | undefined,
  currentSource: DslCurrentSource,
  ast: DslQueryAst,
  options: ResolverContextOptions = {},
): Promise<DslResolverContext> => {
  const user = c.get("user");
  const tables = await gridsService.table.listByBase(baseId);

  let readableTables: Table[] = tables;
  if (!options.trustedAllSources) {
    const gates = await Promise.all(tables.map((table) => gateAt(c, { baseId, tableId: table.id }, "read")));
    readableTables = tables.filter((_, index) => gates[index]?.ok);
  }

  const dslTables: DslTableSource[] = readableTables.map((table) => ({
    kind: "table",
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  }));
  const currentTable = currentTableId ? dslTables.find((table) => table.id === currentTableId) : undefined;
  const views: DslViewSource[] = [];

  if (options.loadViews || needsDslViewCatalog(ast) || currentSource?.kind === "view") {
    const viewGroups = await Promise.all(
      readableTables.map((table) =>
        gridsService.view.listForTable({
          tableId: table.id,
          userId: user.id,
          userGroups: user.memberofGroupIds,
        }),
      ),
    );
    views.push(
      ...viewGroups.flatMap((visibleViews) =>
        visibleViews.map((view) => ({
          kind: "view" as const,
          id: view.id,
          shortId: view.shortId,
          name: view.name,
          tableId: view.tableId,
          source: view.source,
          query: {},
        })),
      ),
    );
  }

  const effectiveAst = sourceAst(ast, currentSource, {
    ...(currentTable ? { currentTable } : {}),
    tables: dslTables,
    views,
    fieldsByTableId: {},
  });
  const effectiveCurrentTableId = currentSource?.kind === "table" ? currentSource.tableId : currentTableId;
  const fieldTableIds =
    options.loadAllFields || views.length > 0
      ? dslTables.map((table) => table.id)
      : collectDslFieldTableIds({ ast: effectiveAst, currentTableId: effectiveCurrentTableId, tables: dslTables, views });
  const fieldGroups = await Promise.all(
    fieldTableIds.map(async (tableId) => ({
      tableId,
      fields: await gridsService.field.listByTable(tableId),
    })),
  );
  const fieldsByTableId = Object.fromEntries(fieldGroups.map((group) => [group.tableId, group.fields])) as Record<string, Field[]>;
  const hydratedViews = hydrateDslViewQueries({ tables: dslTables, views, fieldsByTableId });

  return {
    ...(currentTable ? { currentTable } : {}),
    tables: dslTables,
    views: hydratedViews,
    fieldsByTableId,
  };
};

const fieldsWithPlanExtras = async (
  fieldsByTableId: Record<string, Field[]>,
  plan: DslResolvedSqlQueryPlan,
): Promise<Record<string, Field[]>> => {
  const missing = collectDslPlanExtraFieldTableIds(plan).filter((tableId) => fieldsByTableId[tableId] === undefined);
  if (missing.length === 0) return fieldsByTableId;
  const groups = await Promise.all(
    missing.map(async (tableId) => ({
      tableId,
      fields: await gridsService.field.listByTable(tableId),
    })),
  );
  return { ...fieldsByTableId, ...Object.fromEntries(groups.map((group) => [group.tableId, group.fields])) };
};

export const canonicalGqlSource = async (
  c: Context<AuthContext>,
  baseId: string,
  body: { query: string; currentTableId?: string; currentSource?: DslCurrentSource },
): Promise<
  { ok: true; source: string; tableId: string; plan: DslResolvedSqlQueryPlan } | { ok: false; diagnostics: DslQueryPreviewDiagnostic[] }
> => {
  const parsed = parseGridsQueryDsl(body.query);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const ctx = await buildPermissionedGqlResolverContext(c, baseId, body.currentTableId, body.currentSource, parsed.ast);
  const ast = sourceAst(parsed.ast, body.currentSource, ctx);
  const canonical = canonicalizeDslQuery(ast, ctx);
  if (!canonical.ok) return { ok: false, diagnostics: canonical.diagnostics };
  return { ok: true, source: canonical.source, tableId: canonical.plan.tableId, plan: canonical.plan };
};

export const executeGqlSource = async (
  c: Context<AuthContext>,
  baseId: string,
  body: DslQueryPreviewBody,
  options: { maxRows?: number } = {},
) => {
  const parsed = parseGridsQueryDsl(body.query);
  if (!parsed.ok) return { ok: true as const, response: { ok: false as const, diagnostics: parsed.diagnostics } };

  const ctx = await buildPermissionedGqlResolverContext(c, baseId, body.currentTableId, body.currentSource, parsed.ast);
  const ast = sourceAst(parsed.ast, body.currentSource, ctx);
  const resolved = resolveDslQueryToQueryPlan(ast, ctx);
  if (!resolved.ok) return { ok: true as const, response: { ok: false as const, diagnostics: resolved.diagnostics } };

  const dateConfig = await getDateConfig(c);
  const user = c.get("user");
  const fieldsByTableId = await fieldsWithPlanExtras(ctx.fieldsByTableId, resolved.plan);
  const result = await previewDslQuery(resolved.plan, {
    fieldsByTableId,
    timeZone: dateConfig.timeZone,
    limit: body.limit,
    ...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
    viewer: { userId: user.id, userGroups: user.memberofGroupIds, isAdmin: hasRole(user, "admin") },
  });
  if (!result.ok) {
    return {
      ok: true as const,
      response: { ok: false as const, diagnostics: [dslPreviewDiagnosticForCompilerError(resolved.plan, result.error.message)] },
    };
  }
  return { ok: true as const, response: result.data };
};

export const compileGqlViewWrite = async (
  c: Context<AuthContext>,
  params: { baseId: string; tableId: string; source?: string; trustedAllSources?: boolean },
): Promise<{ ok: true; source: string } | { ok: false; diagnostics: DslQueryPreviewDiagnostic[] }> => {
  const source = params.source?.trim() || `from table {${params.tableId}}`;

  const parsed = parseGridsQueryDsl(source);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const currentSource: DslCurrentSource = { kind: "table", tableId: params.tableId };
  const ctx = await buildPermissionedGqlResolverContext(c, params.baseId, params.tableId, currentSource, parsed.ast, {
    trustedAllSources: params.trustedAllSources,
  });
  const ast = sourceAst(parsed.ast, currentSource, ctx);
  const canonical = canonicalizeDslQuery(ast, ctx);
  if (!canonical.ok) return { ok: false, diagnostics: canonical.diagnostics };
  if (canonical.plan.tableId !== params.tableId) {
    return { ok: false, diagnostics: [{ message: "view source must resolve to this view's table" }] };
  }

  return {
    ok: true,
    source: canonical.source,
  };
};

export const compileGqlToRecordQuery = async (
  c: Context<AuthContext>,
  params: { baseId: string; tableId: string; source: string; presentation?: RecordQuery; trustedAllSources?: boolean },
): Promise<{ ok: true; source: string; query: RecordQuery } | { ok: false; diagnostics: DslQueryPreviewDiagnostic[] }> => {
  const parsed = parseGridsQueryDsl(params.source);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const currentSource: DslCurrentSource = { kind: "table", tableId: params.tableId };
  const ctx = await buildPermissionedGqlResolverContext(c, params.baseId, params.tableId, currentSource, parsed.ast, {
    trustedAllSources: params.trustedAllSources,
  });
  const ast = sourceAst(parsed.ast, currentSource, ctx);
  const canonical = canonicalizeDslQuery(ast, ctx);
  if (!canonical.ok) return { ok: false, diagnostics: canonical.diagnostics };
  if (canonical.plan.tableId !== params.tableId) {
    return { ok: false, diagnostics: [{ message: "query source must resolve to this table" }] };
  }

  const resolved = resolveDslQueryToRecordQuery(ast, ctx);
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  return { ok: true, source: canonical.source, query: withViewPresentation(resolved.plan.query, params.presentation) };
};
