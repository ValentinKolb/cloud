import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateTableSchema,
  type FederatedRevision,
  type FederatedRevisionView,
  FederatedRevisionViewSchema,
  FederatedSourceCandidatePageSchema,
  FederatedSourceCandidateQuerySchema,
  FederatedSourcePublicationListSchema,
  FederatedTableConfigSchema,
  FederatedValidationSchema,
  RecordActorListResponseSchema,
  RecordMetaUserKeySchema,
  RelationLookupResponseSchema,
  TableListSchema,
  TableSchema,
  UpdateFederatedDraftSchema,
  UpdateTableSchema,
  ValidateFederatedDraftSchema,
} from "../contracts";
import { gridsService } from "../service";
import { currentAccessSubject, currentActorUserId, currentCredentialPermission, currentResourceBoundBaseId, gateAt } from "./permissions";
import { requireUuidParam } from "./route-params";
import { tableQueryRoutes } from "./table-query-routes";

const requireSourceBaseAdmins = async (c: Parameters<typeof gateAt>[0], sourceTableIds: string[]) => {
  const administered = await Promise.all(
    [...new Set(sourceTableIds)].map(async (sourceTableId) => {
      const source = await gridsService.table.get(sourceTableId);
      if (!source || source.kind !== "stored") return false;
      return (await gateAt(c, { baseId: source.baseId }, "admin")).ok;
    }),
  );
  if (administered.some((allowed) => !allowed)) {
    return { response: c.json({ message: "One or more source tables are unavailable or not administrable." }, 403) };
  }
  return { response: null };
};

const publicationAuthorization = (c: Parameters<typeof gateAt>[0]) => ({
  subject: currentAccessSubject(c),
  permissionCap: currentCredentialPermission(c),
  resourceBoundBaseId: currentResourceBoundBaseId(c),
});

const sourceTablesAdministeredByActor = async (
  c: Parameters<typeof gateAt>[0],
  revisions: Array<FederatedRevision | null>,
): Promise<Set<string>> => {
  const sourceTableIds = [...new Set(revisions.flatMap((revision) => revision?.sources.map((source) => source.sourceTableId) ?? []))];
  const checks = await Promise.all(
    sourceTableIds.map(async (sourceTableId) => {
      const source = await gridsService.table.get(sourceTableId, { includeDeleted: true });
      if (!source) return null;
      const gate = await gateAt(c, { baseId: source.baseId }, "admin");
      return gate.ok ? sourceTableId : null;
    }),
  );
  return new Set(checks.filter((sourceTableId): sourceTableId is string => sourceTableId !== null));
};

const diagnosticsForManagement = (diagnostics: FederatedRevision["diagnostics"], administeredSourceTableIds: Set<string>) =>
  diagnostics.map((diagnostic) =>
    diagnostic.sourceTableId && !administeredSourceTableIds.has(diagnostic.sourceTableId)
      ? {
          code: diagnostic.code,
          message: diagnostic.message,
          ...(diagnostic.targetFieldId ? { targetFieldId: diagnostic.targetFieldId } : {}),
        }
      : diagnostic,
  );

const revisionForManagement = (
  revision: FederatedRevision & { revisionToken: string },
  administeredSourceTableIds: Set<string>,
): FederatedRevisionView => ({
  id: revision.id,
  tableId: revision.tableId,
  revision: revision.revision,
  status: revision.status,
  diagnostics: diagnosticsForManagement(revision.diagnostics, administeredSourceTableIds),
  revisionToken: revision.revisionToken,
  createdBy: revision.createdBy,
  publishedBy: revision.publishedBy,
  createdAt: revision.createdAt,
  updatedAt: revision.updatedAt,
  publishedAt: revision.publishedAt,
  sources: revision.sources.map((source) => ({
    id: source.id,
    sourceTableId: administeredSourceTableIds.has(source.sourceTableId) ? source.sourceTableId : null,
    position: source.position,
    authorizedAt: source.authorizedAt,
    revokedAt: source.revokedAt,
  })),
  mappings: revision.mappings
    .filter((mapping) => administeredSourceTableIds.has(mapping.sourceTableId))
    .map(({ revisionId: _revisionId, ...mapping }) => mapping),
});

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/:tableId/federation/publications",
    requireUuidParam("tableId", "Source table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "List combined-table publications of a source table",
      responses: {
        200: jsonResponse(FederatedSourcePublicationListSchema, "Combined-table publications"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const source = await gridsService.table.get(tableId);
      if (!source || source.kind !== "stored") return c.json({ message: "Source table not found" }, 404);
      const gate = await gateAt(c, { baseId: source.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.table.federation.listPublicationsForSource(tableId));
    },
  )

  .get(
    "/:tableId/federation",
    requireUuidParam("tableId", "Combined table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Get combined table configuration",
      responses: {
        200: jsonResponse(FederatedTableConfigSchema, "Combined table configuration"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table || table.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const [draft, current] = await Promise.all([
        gridsService.table.federation.getDraft(tableId),
        gridsService.table.federation.getCurrent(tableId),
      ]);
      if (!draft) return c.json({ message: "Combined table draft not found" }, 404);
      const administeredSources = await sourceTablesAdministeredByActor(c, [draft, current]);
      return c.json({
        current: current ? revisionForManagement(current, administeredSources) : null,
        draft: revisionForManagement(draft, administeredSources),
      });
    },
  )

  .get(
    "/:tableId/federation/source-candidates",
    requireUuidParam("tableId", "Combined table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "List source tables available for a combined table",
      responses: {
        200: jsonResponse(FederatedSourceCandidatePageSchema, "Source candidates"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("query", FederatedSourceCandidateQuerySchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const target = await gridsService.table.get(tableId);
      if (!target || target.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const targetGate = await gateAt(c, { baseId: target.baseId }, "admin");
      if (!targetGate.ok) return respond(c, () => Promise.resolve(targetGate));

      const query = c.req.valid("query");
      return c.json(
        await gridsService.table.federation.listSourceCandidates({
          targetTableId: tableId,
          authorization: publicationAuthorization(c),
          q: query.q,
          limit: query.limit,
          offset: query.offset,
        }),
      );
    },
  )

  .put(
    "/:tableId/federation/draft",
    requireUuidParam("tableId", "Combined table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Update combined table draft",
      responses: {
        200: jsonResponse(FederatedRevisionViewSchema, "Updated draft"),
        400: jsonResponse(ErrorResponseSchema, "Invalid draft"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Configuration changed"),
      },
    }),
    v("json", UpdateFederatedDraftSchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const target = await gridsService.table.get(tableId);
      if (!target || target.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const targetGate = await gateAt(c, { baseId: target.baseId }, "admin");
      if (!targetGate.ok) return respond(c, () => Promise.resolve(targetGate));
      const body = c.req.valid("json");
      const sourceGate = await requireSourceBaseAdmins(c, body.sourceTableIds);
      if (sourceGate.response) return sourceGate.response;
      const { draftToken, ...input } = body;
      const result = await gridsService.table.federation.updateDraft(
        tableId,
        input,
        draftToken,
        currentActorUserId(c),
        publicationAuthorization(c),
      );
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      const administeredSources = await sourceTablesAdministeredByActor(c, [result.data]);
      return c.json(revisionForManagement(result.data, administeredSources));
    },
  )

  .post(
    "/:tableId/federation/validate",
    requireUuidParam("tableId", "Combined table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Validate a combined table draft without saving it",
      responses: {
        200: jsonResponse(FederatedValidationSchema, "Draft validation"),
        400: jsonResponse(ErrorResponseSchema, "Invalid draft"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", ValidateFederatedDraftSchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const target = await gridsService.table.get(tableId);
      if (!target || target.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const targetGate = await gateAt(c, { baseId: target.baseId }, "admin");
      if (!targetGate.ok) return respond(c, () => Promise.resolve(targetGate));
      const body = c.req.valid("json");
      const sourceGate = await requireSourceBaseAdmins(c, body.sourceTableIds);
      if (sourceGate.response) return sourceGate.response;
      const validation = await gridsService.table.federation.validateDraft(tableId, body);
      const draft = await gridsService.table.federation.getDraft(tableId);
      const administeredSources = await sourceTablesAdministeredByActor(c, [draft]);
      return c.json({ ...validation, diagnostics: diagnosticsForManagement(validation.diagnostics, administeredSources) });
    },
  )

  .post(
    "/:tableId/federation/publish",
    requireUuidParam("tableId", "Combined table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Publish combined table draft",
      responses: {
        200: jsonResponse(FederatedRevisionViewSchema, "Published revision"),
        400: jsonResponse(ErrorResponseSchema, "Invalid draft"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Configuration changed"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const target = await gridsService.table.get(tableId);
      if (!target || target.kind !== "federated") return c.json({ message: "Combined table not found" }, 404);
      const targetGate = await gateAt(c, { baseId: target.baseId }, "admin");
      if (!targetGate.ok) return respond(c, () => Promise.resolve(targetGate));
      const draft = await gridsService.table.federation.getDraft(tableId);
      if (!draft) return c.json({ message: "Combined table draft not found" }, 404);
      const current = await gridsService.table.federation.getCurrent(tableId);
      const sourceGate = await requireSourceBaseAdmins(
        c,
        gridsService.table.federation.sourceIdsRequiringAuthorization(current, {
          sourceTableIds: draft.sources.map((source) => source.sourceTableId),
          mappings: draft.mappings.map((mapping) => ({
            targetFieldId: mapping.targetFieldId,
            sourceTableId: mapping.sourceTableId,
            sourceFieldId: mapping.sourceFieldId,
            config: mapping.config,
          })),
        }),
      );
      if (sourceGate.response) return sourceGate.response;
      const result = await gridsService.table.federation.publishDraft(tableId, currentActorUserId(c), publicationAuthorization(c), {
        draftId: draft.id,
        draftToken: draft.revisionToken,
        currentId: current?.id ?? null,
        currentToken: current?.revisionToken ?? null,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      const administeredSources = await sourceTablesAdministeredByActor(c, [result.data]);
      return c.json(revisionForManagement(result.data, administeredSources));
    },
  )

  .post(
    "/:tableId/federation/sources/:sourceTableId/revoke",
    requireUuidParam("tableId", "Combined table"),
    requireUuidParam("sourceTableId", "Source table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Revoke a published combined table source",
      responses: {
        204: { description: "Source access revoked" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
        409: jsonResponse(ErrorResponseSchema, "Configuration changed"),
      },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const sourceTableId = c.req.param("sourceTableId")!;
      const source = await gridsService.table.get(sourceTableId, { includeDeleted: true });
      if (!source) return c.json({ message: "Source table not found" }, 404);
      const sourceGate = await gateAt(c, { baseId: source.baseId }, "admin");
      if (!sourceGate.ok) return respond(c, () => Promise.resolve(sourceGate));
      const result = await gridsService.table.federation.revokeSource(
        tableId,
        sourceTableId,
        currentActorUserId(c),
        publicationAuthorization(c),
      );
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  // List tables of a base.
  .get(
    "/by-base/:baseId",
    requireUuidParam("baseId", "Base"),
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
    requireUuidParam("baseId", "Base"),
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
              kind: body.kind,
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
    requireUuidParam("tableId", "Table"),
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
    requireUuidParam("tableId", "Table"),
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
    requireUuidParam("tableId", "Table"),
    describeRoute({
      tags: ["Grids:Table"],
      summary: "Move a table to trash",
      responses: { 204: { description: "Moved to trash" } },
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
    requireUuidParam("tableId", "Table"),
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

  .route("/", tableQueryRoutes)

  .get(
    "/:tableId/record-actors",
    requireUuidParam("tableId", "Table"),
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
    requireUuidParam("tableId", "Table"),
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
        includeDeleted: z.enum(["true"]).optional(),
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

      const { q, limit, excludeIds, includeDeleted } = c.req.valid("query");

      const result = await gridsService.relations.lookup({
        targetTableId: tableId,
        q,
        limit,
        excludeIds,
        includeDeleted: includeDeleted === "true",
      });
      return c.json(result);
    },
  );

export default app;
