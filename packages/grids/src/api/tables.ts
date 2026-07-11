import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  type ComputedColumnSpec,
  CreateTableSchema,
  RecordActorListResponseSchema,
  RecordMetaUserKeySchema,
  type RecordQuery,
  RelationLookupResponseSchema,
  TableListSchema,
  TableQueryBodySchema,
  TableQueryResponseSchema,
  TableSchema,
  UpdateTableSchema,
} from "../contracts";
import { gridsService } from "../service";
import type { GroupAggregationSpec } from "../service/group-compiler";
import { validateRecordQueryForTable } from "../service/query-validation";
import { compileGqlToRecordQuery } from "./gql-runtime";
import { currentActorUserId, currentActorViewer, gateAt, hasExplicitGrant, resolveWithGrants } from "./permissions";

const viewUiPresentation = (view: {
  ui?: { columns?: RecordQuery["columns"]; groupedColumnOrder?: string[]; hiddenGroupedColumns?: string[] };
}): RecordQuery => ({
  ...(view.ui?.columns ? { columns: view.ui.columns } : {}),
  ...(view.ui?.groupedColumnOrder ? { groupedColumnOrder: view.ui.groupedColumnOrder } : {}),
  ...(view.ui?.hiddenGroupedColumns ? { hiddenGroupedColumns: view.ui.hiddenGroupedColumns } : {}),
});

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
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const tables = await gridsService.table.listByBase(baseId);
      const visible = [];
      for (const table of tables) {
        const tableGate = await gateAt(c, { baseId, tableId: table.id }, "read");
        if (tableGate.ok) visible.push(table);
      }
      return c.json(visible);
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
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const body = c.req.valid("json");
      return respond(
        c,
        () =>
          gridsService.table.create(
            {
              baseId,
              name: body.name,
              description: body.description ?? null,
              icon: body.icon ?? null,
              columns: body.columns,
              displayConfig: body.displayConfig,
            },
            currentActorUserId(c),
          ),
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
      const tableId = c.req.param("tableId")!;
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.table.update(tableId, c.req.valid("json"), currentActorUserId(c)));
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.table.remove(tableId, currentActorUserId(c));
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId, { includeDeleted: true });
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.table.restore(tableId, currentActorUserId(c)));
    },
  )

  // ── Unified query endpoint ──────────────────────────────────────────
  // Body: { query: RecordQuery, cursor? }. Response shape depends on what
  // the RecordQuery asked for — see TableQueryResponseSchema.
  // This is the only table-read path so saved views, ad-hoc queries,
  // exports, and dashboards share one contract.
  .post(
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const body = c.req.valid("json");
      const view = body.viewId ? await gridsService.view.get(body.viewId) : null;
      if (body.viewId && (!view || view.tableId !== tableId)) return c.json({ message: "View not found" }, 404);

      const tableGate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (view) {
        const target = { baseId: table.baseId, tableId, viewId: view.id };
        const { level, grants } = await resolveWithGrants(c, target);
        if (!gridsService.permission.hasAtLeast(level, "read")) {
          return c.json({ message: "You do not have permission to access this resource." }, 403);
        }
        const viewer = currentActorViewer(c);
        const isOwner = view.ownerUserId === viewer.userId;
        const explicitGrant = hasExplicitGrant(grants, "view", view.id);
        if (view.ownerUserId !== null && !isOwner && !explicitGrant) {
          return c.json({ message: "View not found" }, 404);
        }
      }
      if (!tableGate.ok) {
        if (!view) return respond(c, () => Promise.resolve(tableGate));
      }

      const trustedView = view && !tableGate.ok ? view : null;
      const compiled =
        body.source !== undefined || trustedView
          ? await compileGqlToRecordQuery(c, {
              baseId: table.baseId,
              tableId,
              source: trustedView ? trustedView.source : (body.source ?? view?.source ?? `from table {${tableId}}`),
              ...(trustedView
                ? { presentation: viewUiPresentation(trustedView), trustedAllSources: true }
                : body.query
                  ? { presentation: body.query }
                  : {}),
            })
          : null;
      if (compiled && !compiled.ok) {
        const message = compiled.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source";
        return c.json({ message }, 400);
      }

      const query = compiled?.ok ? compiled.query : body.query;
      if (!query) return c.json({ message: "source or query is required" }, 400);
      const { cursor, filePreviewFieldIds } = body;
      const queryValid = await validateRecordQueryForTable(tableId, query);
      if (!queryValid.ok) return c.json({ message: queryValid.error.message }, queryValid.error.status);

      // Free-text search stays separate from the structured FilterTree.
      // The records service compiles it into a SQL clause so relation
      // label search and select-label search don't get forced through
      // the direct-field filter DSL.
      const tableFields = await gridsService.field.listByTable(tableId);
      const dateConfig = await getDateConfig(c);
      const viewer = currentActorViewer(c);

      // Group-mode dispatch. The contract's AggregateKind is wider than
      // the group compiler's AggKindForGroup (no median/earliest/latest
      // in group-by mode). Reject unsupported group aggregations instead
      // of silently dropping them from a saved view.
      if (query.groupBy && query.groupBy.length > 0) {
        const unsupported = (query.aggregations ?? []).filter((a) => a.agg === "median" || a.agg === "earliest" || a.agg === "latest");
        if (unsupported.length > 0) {
          return c.json({ message: "grouped queries support count, countEmpty, countUnique, sum, avg, min, and max only" }, 400);
        }
        const groupAggregations = (query.aggregations ?? []) as GroupAggregationSpec[];
        const result = await gridsService.record.group({
          tableId,
          groupBy: query.groupBy,
          aggregations: groupAggregations,
          groupSort: query.groupSort,
          filter: query.filter ?? null,
          search: query.search ?? null,
          recordMeta: query.recordMeta ?? null,
          cursor: cursor ?? null,
          limit: query.limit,
          includeDeleted: query.includeDeleted,
          deletedOnly: query.deletedOnly,
          viewer,
          dateConfig,
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
          viewer,
        );
        return c.json({
          buckets: result.data.buckets,
          nextCursor: result.data.nextCursor,
          explode: result.data.explode,
          relationLabels,
        });
      }

      // List-mode (with optional aggregates side-channel).
      // includeRelations + viewer attach `.expanded` to each record
      // server-side. The records-view island consumes that via
      // <DatabaseTable> (relations render as clickable RecordLinks).
      // Per-target-table read perm gating means records the viewer
      // can't reach contribute UUIDs that fall back to a UUID prefix
      // rather than leaking presentable values.
      const listResult = await gridsService.record.list({
        tableId,
        cursor: cursor ?? null,
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
        filePreviewFieldIds,
      });
      if (!listResult.ok) return c.json({ message: listResult.error.message }, listResult.error.status);

      // Footer-row semantics: when the user has aggregations defined,
      // run them on the same filter as the list. The compiler now handles
      // "*" (COUNT(*)) so we pass everything through unchanged.
      let aggregates: Record<string, unknown> | undefined = listResult.data.aggregates;
      if (query.aggregations && query.aggregations.length > 0) {
        const aggResult = await gridsService.record.aggregate({
          tableId,
          filter: query.filter ?? null,
          search: query.search ?? null,
          recordMeta: query.recordMeta ?? null,
          includeDeleted: query.includeDeleted,
          deletedOnly: query.deletedOnly,
          requests: query.aggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
          viewer,
          dateConfig,
        });
        if (aggResult.ok) aggregates = { ...aggregates, ...aggResult.data };
      }

      return c.json({
        items: listResult.data.items,
        aggregates,
        nextCursor: listResult.data.nextCursor,
        filePreviews: listResult.data.filePreviews,
      });
    },
  )

  .get(
    "/:tableId/record-actors",
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Search users available for record metadata filters",
      responses: {
        200: jsonResponse(RecordActorListResponseSchema, "Record actors"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Table not found"),
      },
    }),
    v(
      "query",
      z.object({
        kind: z
          .union([RecordMetaUserKeySchema, z.literal("any")])
          .optional()
          .default("any"),
        q: z.string().optional().default(""),
        ids: z
          .string()
          .optional()
          .default("")
          .transform((s) =>
            s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          )
          .pipe(z.array(z.string().uuid()).max(50)),
        limit: z.coerce.number().int().min(1).max(50).optional().default(12),
      }),
    ),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { kind, q, ids, limit } = c.req.valid("query");
      const items = await gridsService.record.listActors({ tableId, kind, q, ids, limit });
      return c.json({ items });
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
    // Zod coerces and validates lookup params up front so invalid
    // limits and UUID lists surface as clean 400s.
    v(
      "query",
      z.object({
        q: z.string().optional().default(""),
        limit: z.coerce.number().int().min(1).max(50).optional().default(10),
        excludeIds: z
          .string()
          .optional()
          .default("")
          .transform((s) =>
            s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          )
          .pipe(z.array(z.string().uuid())),
      }),
    ),
    async (c) => {
      const tableId = c.req.param("tableId")!;
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
