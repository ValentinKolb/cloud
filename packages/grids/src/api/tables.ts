import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  TableSchema,
  TableListSchema,
  CreateTableSchema,
  UpdateTableSchema,
  TableQueryBodySchema,
  TableQueryResponseSchema,
  RelationLookupResponseSchema,
} from "../contracts";
import type { GroupAggregationSpec } from "../service/group-compiler";
import { mergeSearchIntoFilter } from "../service/search";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // List tables of a base.
  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "List tables in a base",
      responses: {
        200: jsonResponse(TableListSchema, "Tables"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const tables = await gridsService.table.listByBase(baseId);
      return c.json(tables);
    },
  )

  // Create table under a base.
  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Create a table",
      responses: {
        201: jsonResponse(TableSchema, "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateTableSchema),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(
        c,
        () => gridsService.table.create({ baseId, name: body.name, description: body.description ?? null }, user.id),
        201,
      );
    },
  )

  .get(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Get table",
      responses: {
        200: jsonResponse(TableSchema, "Table"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(table);
    },
  )

  .patch(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Update table",
      responses: { 200: jsonResponse(TableSchema, "Updated") },
    }),
    v("json", UpdateTableSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.table.update(tableId, c.req.valid("json"), user.id));
    },
  )

  .delete(
    "/:tableId",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Delete table (soft-delete; restorable for 30 days)",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.table.remove(tableId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:tableId/restore",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Restore a soft-deleted table",
      responses: {
        200: jsonResponse(TableSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId, { includeDeleted: true });
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.table.restore(tableId, user.id));
    },
  )

  // ── Unified query endpoint (v3 Slice 5) ──────────────────────────────
  // Body: { query: ViewQuery, cursor? }. Response shape depends on what
  // the ViewQuery asked for — see TableQueryResponseSchema.
  // Old per-action routes (/by-table/:id list, /aggregate/:id, /group/:id)
  // stay alive in api/records.ts for the transition; new consumers
  // should target this endpoint only.
  .post(
    "/:tableId/query",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Unified query — list / aggregate / group based on ViewQuery body",
      responses: {
        200: jsonResponse(TableQueryResponseSchema, "Query envelope"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
      },
    }),
    v("json", TableQueryBodySchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { query, cursor } = c.req.valid("json");

      // Free-text search merge. The client sends `query.search` as a
      // separate concept (so saved-view filters and ad-hoc typing layer
      // cleanly), and the server compiles it into the filter the same
      // way the SSR initial render does — single source of truth in
      // service/search.ts. Without this merge the typed query would
      // never reach SQL: the records.list/aggregate/group calls below
      // only consume `filter`, never `search`.
      const tableFields = await gridsService.field.listByTable(tableId);
      const effectiveFilter = query.search?.q
        ? mergeSearchIntoFilter(
            query.filter ?? null,
            query.search.q,
            query.search.fieldIds ?? [],
            tableFields,
          )
        : query.filter ?? null;

      // Group-mode dispatch. The contract's AggregateKind is wider than
      // the group compiler's AggKindForGroup (no median/earliest/latest
      // in group-by mode — those are SQL-only on the flat aggregate
      // endpoint). Filter to the supported subset before dispatching.
      if (query.groupBy && query.groupBy.length > 0) {
        const groupAggregations: GroupAggregationSpec[] = (query.aggregations ?? []).filter(
          (a): a is GroupAggregationSpec =>
            a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
        );
        const result = await gridsService.record.group({
          tableId,
          groupBy: query.groupBy,
          aggregations: groupAggregations,
          filter: effectiveFilter,
          cursor: cursor ?? null,
          limit: query.limit,
          includeDeleted: query.includeDeleted,
        });
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        // Resolve presentable labels for relation-typed group keys so
        // the UI doesn't render raw UUIDs in the bucket-key column.
        // Same labelling rules as the row-mode relation cell renderer
        // (see service/relations.ts → buildRelationLabelCache).
        const relationLabels = await gridsService.relations.buildLabelCacheForGroupedKeys(
          result.data.buckets,
          query.groupBy.map((g) => g.fieldId),
          tableFields,
        );
        return c.json({
          buckets: result.data.buckets,
          nextCursor: result.data.nextCursor,
          explode: result.data.explode,
          relationLabels,
        });
      }

      // List-mode (with optional aggregates side-channel).
      const listResult = await gridsService.record.list({
        tableId,
        cursor: cursor ?? null,
        limit: query.limit,
        includeDeleted: query.includeDeleted,
        filter: effectiveFilter,
        sort: query.sort,
      });
      if (!listResult.ok) return c.json({ message: listResult.error.message }, listResult.error.status);

      // Footer-row semantics: when the user has aggregations defined,
      // run them on the same filter as the list. The compiler now handles
      // "*" (COUNT(*)) so we pass everything through unchanged.
      let aggregates: Record<string, unknown> | undefined;
      if (query.aggregations && query.aggregations.length > 0) {
        const aggResult = await gridsService.record.aggregate({
          tableId,
          filter: effectiveFilter,
          requests: query.aggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
        });
        if (aggResult.ok) aggregates = aggResult.data;
      }

      return c.json({
        items: listResult.data.items,
        aggregates,
        nextCursor: listResult.data.nextCursor,
      });
    },
  )

  // Relation-picker search. Returns up to N records of the target table,
  // pre-labelled, so the client doesn't need to know about `presentable`.
  // Permission: needs `read` on the target table — same as listing it.
  .get(
    "/:tableId/lookup",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Search records of this table for the relation picker",
      responses: {
        200: jsonResponse(RelationLookupResponseSchema, "Lookup results"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Table not found"),
      },
    }),
    // Validated query schema. Prior code parsed every param manually
    // (limit=abc → NaN, excludeIds split into unchecked strings cast as
    // uuid[] → 500 instead of 400). Zod coerces / validates up front so
    // bad inputs surface as clean 400s.
    v(
      "query",
      z.object({
        q: z.string().optional().default(""),
        limit: z.coerce.number().int().min(1).max(50).optional().default(10),
        excludeIds: z
          .string()
          .optional()
          .default("")
          .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
          .pipe(z.array(z.string().uuid())),
      }),
    ),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { q, limit, excludeIds } = c.req.valid("query");

      const result = await gridsService.relations.lookup({
        targetTableId: tableId,
        q,
        limit,
        excludeIds,
      });
      return c.json(result);
    },
  );

export default app;
