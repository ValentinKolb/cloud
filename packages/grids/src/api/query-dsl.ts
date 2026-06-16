import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import {
  DslQueryAutocompleteBodySchema,
  DslQueryAutocompleteResponseSchema,
  DslQueryExecuteBodySchema,
  DslQueryExecuteResponseSchema,
  DslQueryCompileViewBodySchema,
  DslQueryCompileViewResponseSchema,
  DslQueryPreviewBodySchema,
  DslQueryPreviewResponseSchema,
} from "../contracts";
import { buildDslQueryIntelligence } from "../query-dsl/intelligence";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { resolveDslQueryToQueryPlan } from "../query-dsl/resolver";
import { buildPermissionedGqlResolverContext, canonicalGqlSource, emptyDslAst, executeGqlSource, sourceAst } from "./gql-runtime";
import { gateAt } from "./permissions";

type GqlApiOptions = {
  requireAuthenticated?: MiddlewareHandler<AuthContext>;
};

export const createGqlApi = (options: GqlApiOptions = {}) =>
  new Hono<AuthContext>()
    .use(options.requireAuthenticated ?? auth.requireRole("authenticated"))
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
        const result = await executeGqlSource(c, baseId, body);
        return c.json(result.response);
      },
    )
    .post(
      "/by-base/:baseId/execute",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Execute a GQL statement for records/table surfaces",
        responses: {
          200: jsonResponse(DslQueryExecuteResponseSchema, "Query diagnostics or tabular result"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DslQueryExecuteBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const result = await executeGqlSource(c, baseId, body, { maxRows: 10_000 });
        return c.json(result.response);
      },
    )
    .post(
      "/by-base/:baseId/autocomplete",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Return permission-safe GQL autocomplete items and diagnostics",
        responses: {
          200: jsonResponse(DslQueryAutocompleteResponseSchema, "GQL autocomplete items and diagnostics"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DslQueryAutocompleteBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const parsed = parseGridsQueryDsl(body.query);
        const seedAst = parsed.ok ? parsed.ast : emptyDslAst();
        const ctx = await buildPermissionedGqlResolverContext(c, baseId, body.currentTableId, body.currentSource, seedAst, {
          loadViews: true,
          loadAllFields: true,
        });

        const diagnostics = parsed.ok
          ? (() => {
              const ast = sourceAst(parsed.ast, body.currentSource, ctx);
              const resolved = resolveDslQueryToQueryPlan(ast, ctx);
              return resolved.ok ? [] : resolved.diagnostics;
            })()
          : parsed.diagnostics;
        const items = buildDslQueryIntelligence({
          query: body.query,
          caret: body.caret ?? body.query.length,
          ctx,
          ...(body.currentSource ? { currentSource: body.currentSource } : {}),
        });

        return c.json({ ok: true as const, diagnostics, items });
      },
    )
    .post(
      "/by-base/:baseId/compile-view",
      describeRoute({
        tags: ["Grids:GQL"],
        summary: "Compile and canonicalize a GQL statement for a saved view",
        responses: {
          200: jsonResponse(DslQueryCompileViewResponseSchema, "Canonical View source or diagnostics"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", DslQueryCompileViewBodySchema),
      async (c) => {
        const baseId = c.req.param("baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const body = c.req.valid("json");
        const canonical = await canonicalGqlSource(c, baseId, body);
        if (!canonical.ok) return c.json({ ok: false, diagnostics: canonical.diagnostics });

        return c.json({ ok: true, tableId: canonical.tableId, source: canonical.source });
      },
    );

const app = createGqlApi();
export default app;
