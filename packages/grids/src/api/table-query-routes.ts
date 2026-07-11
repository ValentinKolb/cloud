import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, getDateConfig, jsonResponse, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";
import { describeRoute } from "hono-openapi";
import type { infer as ZodInfer } from "zod";
import { type ComputedColumnSpec, type RecordQuery, TableQueryBodySchema, TableQueryResponseSchema } from "../contracts";
import { gridsService } from "../service";
import type { GroupAggregationSpec } from "../service/group-compiler";
import { validateRecordQueryForTable } from "../service/query-validation";
import { compileGqlToRecordQuery } from "./gql-runtime";
import { currentActorViewer, gateAt, hasExplicitGrant, resolveWithGrants } from "./permissions";

type TableQueryBody = ZodInfer<typeof TableQueryBodySchema>;
type TableQueryResponse = ZodInfer<typeof TableQueryResponseSchema>;
type RouteFailure = { ok: false; status: ClientErrorStatusCode | ServerErrorStatusCode; message: string };
type RouteSuccess<T> = { ok: true; data: T };
type QueryView = {
  id: string;
  tableId: string;
  ownerUserId: string | null;
  source: string;
  ui?: { columns?: RecordQuery["columns"]; groupedColumnOrder?: string[]; hiddenGroupedColumns?: string[] };
};
type QueryTarget = {
  table: { id: string; baseId: string };
  view: QueryView | null;
  trustedView: QueryView | null;
};

type TableQueryRouteDeps = {
  service: typeof gridsService;
  compileGql: typeof compileGqlToRecordQuery;
  validateQuery: typeof validateRecordQueryForTable;
  dateConfig: typeof getDateConfig;
  gate: typeof gateAt;
  resolve: typeof resolveWithGrants;
  viewer: typeof currentActorViewer;
  hasExplicitGrant: typeof hasExplicitGrant;
};

const defaultDeps: TableQueryRouteDeps = {
  service: gridsService,
  compileGql: compileGqlToRecordQuery,
  validateQuery: validateRecordQueryForTable,
  dateConfig: getDateConfig,
  gate: gateAt,
  resolve: resolveWithGrants,
  viewer: currentActorViewer,
  hasExplicitGrant,
};

const fail = (status: RouteFailure["status"], message: string): RouteFailure => ({ ok: false, status, message });

const viewUiPresentation = (view: QueryView): RecordQuery => ({
  ...(view.ui?.columns ? { columns: view.ui.columns } : {}),
  ...(view.ui?.groupedColumnOrder ? { groupedColumnOrder: view.ui.groupedColumnOrder } : {}),
  ...(view.ui?.hiddenGroupedColumns ? { hiddenGroupedColumns: view.ui.hiddenGroupedColumns } : {}),
});

const loadQueryTarget = async (
  c: Context<AuthContext>,
  deps: TableQueryRouteDeps,
  tableId: string,
  viewId: string | undefined,
): Promise<RouteSuccess<QueryTarget> | RouteFailure> => {
  const table = await deps.service.table.get(tableId);
  if (!table) return fail(404, "Table not found");

  const view = viewId ? await deps.service.view.get(viewId) : null;
  if (viewId && (!view || view.tableId !== tableId)) return fail(404, "View not found");

  const tableGate = await deps.gate(c, { baseId: table.baseId, tableId }, "read");
  if (!view) {
    return tableGate.ok
      ? { ok: true, data: { table, view: null, trustedView: null } }
      : fail(403, "You do not have permission to access this resource.");
  }

  const { level, grants } = await deps.resolve(c, { baseId: table.baseId, tableId, viewId: view.id });
  if (!deps.service.permission.hasAtLeast(level, "read")) {
    return fail(403, "You do not have permission to access this resource.");
  }
  const isOwner = view.ownerUserId === deps.viewer(c).userId;
  if (view.ownerUserId !== null && !isOwner && !deps.hasExplicitGrant(grants, "view", view.id)) {
    return fail(404, "View not found");
  }

  return { ok: true, data: { table, view, trustedView: tableGate.ok ? null : view } };
};

const resolveQuery = async (
  c: Context<AuthContext>,
  deps: TableQueryRouteDeps,
  target: QueryTarget,
  body: TableQueryBody,
): Promise<RouteSuccess<RecordQuery> | RouteFailure> => {
  const { table, view, trustedView } = target;
  const compiled =
    body.source !== undefined || trustedView
      ? await deps.compileGql(c, {
          baseId: table.baseId,
          tableId: table.id,
          source: trustedView ? trustedView.source : (body.source ?? view?.source ?? `from table {${table.id}}`),
          ...(trustedView
            ? { presentation: viewUiPresentation(trustedView), trustedAllSources: true }
            : body.query
              ? { presentation: body.query }
              : {}),
        })
      : null;
  if (compiled && !compiled.ok) {
    return fail(400, compiled.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source");
  }

  const query = compiled?.ok ? compiled.query : body.query;
  if (!query) return fail(400, "source or query is required");
  const queryValid = await deps.validateQuery(table.id, query);
  return queryValid.ok ? { ok: true, data: query } : fail(queryValid.error.status, queryValid.error.message);
};

const runGroupedQuery = async (
  deps: TableQueryRouteDeps,
  params: {
    target: QueryTarget;
    query: RecordQuery;
    body: TableQueryBody;
    tableFields: Awaited<ReturnType<typeof gridsService.field.listByTable>>;
    viewer: ReturnType<typeof currentActorViewer>;
    dateConfig: Awaited<ReturnType<typeof getDateConfig>>;
  },
): Promise<RouteSuccess<TableQueryResponse> | RouteFailure> => {
  const { target, query, body, tableFields, viewer, dateConfig } = params;
  const unsupported = (query.aggregations ?? []).some((item) => item.agg === "median" || item.agg === "earliest" || item.agg === "latest");
  if (unsupported) {
    return fail(400, "grouped queries support count, countEmpty, countUnique, sum, avg, min, and max only");
  }

  const result = await deps.service.record.group({
    tableId: target.table.id,
    groupBy: query.groupBy!,
    aggregations: (query.aggregations ?? []) as GroupAggregationSpec[],
    groupSort: query.groupSort,
    filter: query.filter ?? null,
    search: query.search ?? null,
    recordMeta: query.recordMeta ?? null,
    cursor: body.cursor ?? null,
    limit: query.limit,
    includeDeleted: query.includeDeleted,
    deletedOnly: query.deletedOnly,
    viewer,
    dateConfig,
  });
  if (!result.ok) return fail(result.error.status, result.error.message);
  const relationLabels = await deps.service.relations.buildLabelCacheForGroupedKeys(
    result.data.buckets,
    query.groupBy!.map((group) => group.fieldId),
    tableFields,
    viewer,
  );
  return {
    ok: true,
    data: {
      buckets: result.data.buckets,
      nextCursor: result.data.nextCursor,
      explode: result.data.explode,
      relationLabels,
    },
  };
};

const runListQuery = async (
  deps: TableQueryRouteDeps,
  params: {
    target: QueryTarget;
    query: RecordQuery;
    body: TableQueryBody;
    viewer: ReturnType<typeof currentActorViewer>;
    dateConfig: Awaited<ReturnType<typeof getDateConfig>>;
  },
): Promise<RouteSuccess<TableQueryResponse> | RouteFailure> => {
  const { target, query, body, viewer, dateConfig } = params;
  const listResult = await deps.service.record.list({
    tableId: target.table.id,
    cursor: body.cursor ?? null,
    limit: query.limit,
    includeDeleted: query.includeDeleted,
    deletedOnly: query.deletedOnly,
    filter: query.filter ?? null,
    search: query.search ?? null,
    recordMeta: query.recordMeta ?? null,
    sort: query.sort,
    includeRelations: true,
    viewer,
    dateConfig,
    computedColumns: query.columns?.filter((column): column is ComputedColumnSpec => "kind" in column && column.kind === "computed"),
    filePreviewFieldIds: body.filePreviewFieldIds,
  });
  if (!listResult.ok) return fail(listResult.error.status, listResult.error.message);

  let aggregates: Record<string, unknown> | undefined = listResult.data.aggregates;
  if (query.aggregations && query.aggregations.length > 0) {
    const aggregateResult = await deps.service.record.aggregate({
      tableId: target.table.id,
      filter: query.filter ?? null,
      search: query.search ?? null,
      recordMeta: query.recordMeta ?? null,
      includeDeleted: query.includeDeleted,
      deletedOnly: query.deletedOnly,
      requests: query.aggregations.map((item) => ({ fieldId: item.fieldId, agg: item.agg })),
      viewer,
      dateConfig,
    });
    if (aggregateResult.ok) aggregates = { ...aggregates, ...aggregateResult.data };
  }

  return {
    ok: true,
    data: {
      items: listResult.data.items,
      aggregates,
      nextCursor: listResult.data.nextCursor,
      filePreviews: listResult.data.filePreviews,
    },
  };
};

export const createTableQueryRoutes = (deps: TableQueryRouteDeps = defaultDeps) =>
  new Hono<AuthContext>().post(
    "/:tableId/query",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Unified query — list / aggregate / group based on RecordQuery body",
      responses: {
        200: jsonResponse(TableQueryResponseSchema, "Query envelope"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
      },
    }),
    v("json", TableQueryBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      const target = await loadQueryTarget(c, deps, c.req.param("tableId")!, body.viewId);
      if (!target.ok) return c.json({ message: target.message }, target.status);

      const resolved = await resolveQuery(c, deps, target.data, body);
      if (!resolved.ok) return c.json({ message: resolved.message }, resolved.status);

      const [tableFields, dateConfig] = await Promise.all([deps.service.field.listByTable(target.data.table.id), deps.dateConfig(c)]);
      const params = { target: target.data, query: resolved.data, body, tableFields, dateConfig, viewer: deps.viewer(c) };
      const result = resolved.data.groupBy?.length ? await runGroupedQuery(deps, params) : await runListQuery(deps, params);
      return result.ok ? c.json(result.data) : c.json({ message: result.message }, result.status);
    },
  );

export const tableQueryRoutes = createTableQueryRoutes();
