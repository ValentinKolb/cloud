import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, getDateConfig, jsonResponse, respond, type AuthContext, v } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import {
  DslQueryCompileViewBodySchema,
  DslQueryCompileViewResponseSchema,
  DslQueryPreviewBodySchema,
  DslQueryPreviewResponseSchema,
} from "../contracts";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { previewDslQuery } from "../query-dsl/preview";
import {
  resolveDslQueryToQueryPlan,
  resolveDslQueryToViewQuery,
  type DslResolverContext,
  type DslTableSource,
  type DslViewSource,
} from "../query-dsl/resolver";
import { collectDslFieldTableIds, needsDslViewCatalog } from "../query-dsl/source-plan";
import type { DslQueryAst } from "../query-dsl/types";
import { gridsService } from "../service";
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
  const readableTables: Table[] = [];

  for (const table of tables) {
    const gate = await gateAt(c, { baseId, tableId: table.id }, "read");
    if (gate.ok) readableTables.push(table);
  }

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

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .post(
    "/by-base/:baseId/preview",
    describeRoute({
      tags: ["Grids:Query DSL"],
      summary: "Parse and preview a Grids query DSL statement",
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
      const result = await previewDslQuery(resolved.plan, {
        fieldsByTableId: ctx.fieldsByTableId,
        timeZone: dateConfig.timeZone,
        limit: body.limit,
      });
      if (!result.ok) return c.json({ ok: false, diagnostics: [{ message: result.error.message }] });
      return c.json(result.data);
    },
  )
  .post(
    "/by-base/:baseId/compile-view",
    describeRoute({
      tags: ["Grids:Query DSL"],
      summary: "Compile a Grids query DSL statement into a normal saved-view query",
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
  );

export default app;
