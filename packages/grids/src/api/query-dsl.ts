import { ErrorResponseSchema, hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateGqlQuerySchema,
  DslQueryCompileViewBodySchema,
  DslQueryCompileViewResponseSchema,
  DslQueryPreviewBodySchema,
  DslQueryPreviewFailureSchema,
  DslQueryPreviewResponseSchema,
  GqlQueryListSchema,
  GqlQuerySaveResponseSchema,
  GqlQuerySchema,
  UpdateGqlQuerySchema,
} from "../contracts";
import { canonicalizeDslQuery } from "../query-dsl/canonical";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { dslPreviewDiagnosticForCompilerError, previewDslQuery } from "../query-dsl/preview";
import {
  type DslResolvedSqlQueryPlan,
  type DslResolverContext,
  type DslTableSource,
  type DslViewSource,
  resolveDslQueryToQueryPlan,
  resolveDslQueryToViewQuery,
} from "../query-dsl/resolver";
import { collectDslFieldTableIds, collectDslPlanExtraFieldTableIds, needsDslViewCatalog } from "../query-dsl/source-plan";
import type { DslQueryAst } from "../query-dsl/types";
import { gridsService } from "../service";
import type { GqlQuery } from "../service/gql-queries";
import type { Field, Table } from "../service/types";
import { gateAt } from "./permissions";

type DslCurrentSource = { kind: "table"; tableId: string } | { kind: "view"; viewId: string } | undefined;

const sourceAst = (ast: DslQueryAst, source: DslCurrentSource, ctx: DslResolverContext): DslQueryAst => {
  if (ast.source || !source) return ast;
  if (source.kind === "table") {
    const table = ctx.tables.find((item) => item.id === source.tableId);
    return table ? { ...ast, source: { kind: "table", ref: table.id } } : ast;
  }
  const view = (ctx.views ?? []).find((item) => item.id === source.viewId);
  return view ? { ...ast, source: { kind: "view", ref: view.id } } : ast;
};

const buildResolverContext = async (
  c: Context<AuthContext>,
  baseId: string,
  currentTableId: string | undefined,
  currentSource: DslCurrentSource,
  ast: DslQueryAst,
): Promise<DslResolverContext> => {
  const user = c.get("user");
  const tables = await gridsService.table.listByBase(baseId);

  // Resolve read access for every table concurrently — a base can have many
  // tables and this runs on each preview keystroke, so a sequential await loop
  // would serialize N grant lookups into N round-trips of latency.
  const gates = await Promise.all(tables.map((table) => gateAt(c, { baseId, tableId: table.id }, "read")));
  const readableTables: Table[] = tables.filter((_, index) => gates[index]?.ok);

  const dslTables: DslTableSource[] = readableTables.map((table) => ({
    kind: "table",
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  }));
  const currentTable = currentTableId ? dslTables.find((table) => table.id === currentTableId) : undefined;
  const views: DslViewSource[] = [];

  if (needsDslViewCatalog(ast) || currentSource?.kind === "view") {
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
          query: view.query,
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
  const fieldTableIds = collectDslFieldTableIds({ ast: effectiveAst, currentTableId: effectiveCurrentTableId, tables: dslTables, views });
  const fieldGroups = await Promise.all(
    fieldTableIds.map(async (tableId) => ({
      tableId,
      fields: await gridsService.field.listByTable(tableId),
    })),
  );
  const fieldsByTableId = Object.fromEntries(fieldGroups.map((group) => [group.tableId, group.fields])) as Record<string, Field[]>;

  return {
    ...(currentTable ? { currentTable } : {}),
    tables: dslTables,
    views,
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

const canonicalGqlSource = async (
  c: Context<AuthContext>,
  baseId: string,
  body: { query: string; currentTableId?: string; currentSource?: DslCurrentSource },
): Promise<
  | { ok: true; source: string; tableId: string }
  | { ok: false; diagnostics: { message: string; line?: number; column?: number; length?: number }[] }
> => {
  const parsed = parseGridsQueryDsl(body.query);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

  const ctx = await buildResolverContext(c, baseId, body.currentTableId, body.currentSource, parsed.ast);
  const ast = sourceAst(parsed.ast, body.currentSource, ctx);
  const canonical = canonicalizeDslQuery(ast, ctx);
  if (!canonical.ok) return { ok: false, diagnostics: canonical.diagnostics };
  return { ok: true, source: canonical.source, tableId: canonical.plan.tableId };
};

const canReadSavedGqlQuery = async (c: Context<AuthContext>, query: GqlQuery): Promise<boolean> => {
  const gate = await gateAt(c, { baseId: query.baseId }, "read");
  if (!gate.ok) return false;
  if (query.ownerUserId === null || query.ownerUserId === c.get("user").id) return true;
  const adminGate = await gateAt(c, { baseId: query.baseId }, "admin");
  return adminGate.ok;
};

type GqlApiOptions = {
  requireAuthenticated?: MiddlewareHandler<AuthContext>;
};

export const createGqlApi = (options: GqlApiOptions = {}) =>
  new Hono<AuthContext>()
    .use(options.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get(
      "/by-base/:baseId/saved",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "List saved GQL statements visible in a base",
        responses: {
          200: jsonResponse(GqlQueryListSchema, "Saved GQL statements"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const user = c.get("user");
        return c.json(await gridsService.gqlQuery.listForBase({ baseId, userId: user.id, includePrivate: gate.data === "admin" }));
      },
    )
    .post(
      "/by-base/:baseId/saved",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Save a rich GQL statement losslessly",
        responses: {
          200: jsonResponse(DslQueryPreviewFailureSchema, "GQL diagnostics"),
          201: jsonResponse(GqlQuerySaveResponseSchema, "Saved GQL statement"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateGqlQuerySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const body = c.req.valid("json");
        const gate = body.shared ? await gateAt(c, { baseId }, "admin") : await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const canonical = await canonicalGqlSource(c, baseId, body);
        if (!canonical.ok) return c.json({ ok: false, diagnostics: canonical.diagnostics });

        const user = c.get("user");
        const created = await gridsService.gqlQuery.create(
          {
            baseId,
            tableId: canonical.tableId,
            name: body.name,
            icon: body.icon ?? null,
            source: canonical.source,
            ownerUserId: body.shared ? null : user.id,
          },
          user.id,
        );
        if (!created.ok) return c.json({ message: created.error.message }, created.error.status);
        return c.json({ ok: true, query: created.data }, 201);
      },
    )
    .get(
      "/saved/:queryId",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Get a saved GQL statement",
        responses: {
          200: jsonResponse(GqlQuerySchema, "Saved GQL statement"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const queryId = c.req.param("queryId")!;
        const saved = await gridsService.gqlQuery.get(queryId);
        if (!saved || !(await canReadSavedGqlQuery(c, saved))) return c.json({ message: "GQL query not found" }, 404);
        return c.json(saved);
      },
    )
    .post(
      "/by-base/:baseId/preview",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Parse and preview a GQL statement",
        responses: {
          200: jsonResponse(DslQueryPreviewResponseSchema, "Query diagnostics or tabular preview"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DslQueryPreviewBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const parsed = parseGridsQueryDsl(body.query);
        if (!parsed.ok) return c.json({ ok: false, diagnostics: parsed.diagnostics });

        const ctx = await buildResolverContext(c, baseId, body.currentTableId, body.currentSource, parsed.ast);
        const ast = sourceAst(parsed.ast, body.currentSource, ctx);
        const resolved = resolveDslQueryToQueryPlan(ast, ctx);
        if (!resolved.ok) return c.json({ ok: false, diagnostics: resolved.diagnostics });

        const dateConfig = await getDateConfig(c);
        const user = c.get("user");
        const fieldsByTableId = await fieldsWithPlanExtras(ctx.fieldsByTableId, resolved.plan);
        const result = await previewDslQuery(resolved.plan, {
          fieldsByTableId,
          timeZone: dateConfig.timeZone,
          limit: body.limit,
          viewer: { userId: user.id, userGroups: user.memberofGroupIds, isAdmin: hasRole(user, "admin") },
        });
        if (!result.ok) {
          return c.json({ ok: false, diagnostics: [dslPreviewDiagnosticForCompilerError(resolved.plan, result.error.message)] });
        }
        return c.json(result.data);
      },
    )
    .post(
      "/by-base/:baseId/compile-view",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Compile a GQL statement into a normal saved-view query",
        responses: {
          200: jsonResponse(DslQueryCompileViewResponseSchema, "Compiled ViewQuery or diagnostics"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DslQueryCompileViewBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const parsed = parseGridsQueryDsl(body.query);
        if (!parsed.ok) return c.json({ ok: false, diagnostics: parsed.diagnostics });

        const ctx = await buildResolverContext(c, baseId, body.currentTableId, body.currentSource, parsed.ast);
        const ast = sourceAst(parsed.ast, body.currentSource, ctx);
        const resolved = resolveDslQueryToViewQuery(ast, ctx);
        if (!resolved.ok) return c.json({ ok: false, diagnostics: resolved.diagnostics });

        return c.json({ ok: true, tableId: resolved.plan.tableId, query: resolved.plan.query });
      },
    )
    .patch(
      "/saved/:queryId",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Update a saved GQL statement",
        responses: {
          200: jsonResponse(GqlQuerySaveResponseSchema, "Updated GQL statement or diagnostics"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", UpdateGqlQuerySchema),
      async (c) => {
        const queryId = c.req.param("queryId")!;
        const saved = await gridsService.gqlQuery.get(queryId);
        if (!saved) return c.json({ message: "GQL query not found" }, 404);
        if (!(await canReadSavedGqlQuery(c, saved))) return c.json({ message: "GQL query not found" }, 404);
        const user = c.get("user");
        const body = c.req.valid("json");
        const isOwner = saved.ownerUserId === user.id;
        const isPublishing = body.shared === true && saved.ownerUserId !== null;
        const isUnpublishing = body.shared === false && saved.ownerUserId === null;
        const gate =
          isPublishing || isUnpublishing || saved.ownerUserId === null || !isOwner
            ? await gateAt(c, { baseId: saved.baseId }, "admin")
            : await gateAt(c, { baseId: saved.baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const canonical =
          body.query !== undefined
            ? await canonicalGqlSource(c, saved.baseId, {
                query: body.query,
                ...(body.currentTableId ? { currentTableId: body.currentTableId } : {}),
                ...(body.currentSource ? { currentSource: body.currentSource } : {}),
              })
            : null;
        if (canonical && !canonical.ok) return c.json({ ok: false, diagnostics: canonical.diagnostics });

        const updated = await gridsService.gqlQuery.update(
          queryId,
          {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.icon !== undefined ? { icon: body.icon } : {}),
            ...(body.position !== undefined ? { position: body.position } : {}),
            ...(body.shared !== undefined ? { shared: body.shared } : {}),
            ...(canonical && canonical.ok ? { source: canonical.source, tableId: canonical.tableId } : {}),
          },
          user.id,
        );
        if (!updated.ok) return c.json({ message: updated.error.message }, updated.error.status);
        return c.json({ ok: true, query: updated.data });
      },
    )
    .delete(
      "/saved/:queryId",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Delete a saved GQL statement",
        responses: {
          204: { description: "Deleted" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const queryId = c.req.param("queryId")!;
        const saved = await gridsService.gqlQuery.get(queryId);
        if (!saved) return c.json({ message: "GQL query not found" }, 404);
        if (!(await canReadSavedGqlQuery(c, saved))) return c.json({ message: "GQL query not found" }, 404);
        const user = c.get("user");
        const isOwner = saved.ownerUserId === user.id;
        const gate =
          saved.ownerUserId === null || !isOwner
            ? await gateAt(c, { baseId: saved.baseId }, "admin")
            : await gateAt(c, { baseId: saved.baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.gqlQuery.remove(queryId, user.id);
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )
    .post(
      "/saved/:queryId/restore",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Restore a soft-deleted GQL statement",
        responses: {
          200: jsonResponse(GqlQuerySchema, "Restored"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const queryId = c.req.param("queryId")!;
        const saved = await gridsService.gqlQuery.get(queryId, { includeDeleted: true });
        if (!saved) return c.json({ message: "GQL query not found" }, 404);
        if (!(await canReadSavedGqlQuery(c, saved))) return c.json({ message: "GQL query not found" }, 404);
        const user = c.get("user");
        const isOwner = saved.ownerUserId === user.id;
        const gate =
          saved.ownerUserId === null || !isOwner
            ? await gateAt(c, { baseId: saved.baseId }, "admin")
            : await gateAt(c, { baseId: saved.baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const restored = await gridsService.gqlQuery.restore(queryId, user.id);
        if (!restored.ok) return c.json({ message: restored.error.message }, restored.error.status);
        return c.json(restored.data);
      },
    );

const app = createGqlApi();
export default app;
