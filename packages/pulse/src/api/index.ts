import { auth, err, fail, jsonResponse, rateLimit, respond, respondMessage, v, type AuthContext } from "@valentinkolb/cloud/server";
import { AccessEntrySchema, PermissionLevelSchema, PrincipalSchema } from "@valentinkolb/cloud/contracts";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { AGGREGATIONS, METRIC_TYPES, PANEL_VISUALS, SOURCE_KINDS } from "../contracts";
import { pulseService } from "../service";

const DimensionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const DimensionsSchema = z.record(z.string(), DimensionValueSchema).optional();

const MetricSchema = z.object({
  name: z.string().trim().min(1),
  value: z.number().finite(),
  ts: z.string().datetime().optional(),
  unit: z.string().trim().min(1).nullable().optional(),
  type: z.enum(METRIC_TYPES).optional(),
  sourceId: z.string().uuid().nullable().optional(),
  entityId: z.string().trim().min(1).nullable().optional(),
  entityType: z.string().trim().min(1).nullable().optional(),
  dimensions: DimensionsSchema,
});

const EventSchema = z.object({
  kind: z.string().trim().min(1),
  ts: z.string().datetime().optional(),
  value: z.number().finite().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  entityId: z.string().trim().min(1).nullable().optional(),
  entityType: z.string().trim().min(1).nullable().optional(),
  actorId: z.string().trim().min(1).nullable().optional(),
  sessionId: z.string().trim().min(1).nullable().optional(),
  correlationId: z.string().trim().min(1).nullable().optional(),
  dimensions: DimensionsSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});

const StateSchema = z.object({
  key: z.string().trim().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ts: z.string().datetime().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  entityId: z.string().trim().min(1).nullable().optional(),
  entityType: z.string().trim().min(1).nullable().optional(),
  dimensions: DimensionsSchema,
});

const IngestBatchSchema = z.object({
  metrics: z.array(MetricSchema).max(500).optional(),
  events: z.array(EventSchema).max(500).optional(),
  states: z.array(StateSchema).max(500).optional(),
});

const CreateBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).nullable().optional(),
});

const UpdateBaseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1_000).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

const GrantBaseAccessSchema = z.object({
  principal: PrincipalSchema,
  permission: PermissionLevelSchema.exclude(["none"]),
});

const UpdateBaseAccessSchema = z.object({
  permission: PermissionLevelSchema.exclude(["none"]),
});

const CreateSourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  name: z.string().trim().min(1).max(120),
  endpointUrl: z.string().trim().min(1).max(2_000).nullable().optional(),
  bearerToken: z.string().trim().min(1).nullable().optional(),
  scrapeIntervalSeconds: z.number().int().min(10).max(86_400).nullable().optional(),
});

const CreateSourceTokenSchema = z.object({
  label: z.string().trim().min(1).max(120),
});

const UpdateSourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  endpointUrl: z.string().trim().min(1).max(2_000).nullable().optional(),
  bearerToken: z.string().trim().min(1).nullable().optional(),
  scrapeIntervalSeconds: z.number().int().min(10).max(86_400).nullable().optional(),
});

const DashboardPanelSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  metric: z.string().trim().min(1).max(240),
  visual: z.enum(PANEL_VISUALS),
  aggregation: z.enum(AGGREGATIONS),
  bucket: z
    .string()
    .trim()
    .regex(/^\d+[mhd]$/),
  since: z
    .string()
    .trim()
    .regex(/^\d+[mhd]$/),
  sourceId: z.string().uuid().nullable().optional(),
  dimensions: DimensionsSchema,
});

const DashboardMetricWidgetSchema = DashboardPanelSchema.extend({
  kind: z.literal("metric"),
  description: z.string().trim().max(500).nullable().optional(),
  span: z.number().int().min(1).max(12).optional(),
});

const DashboardMarkdownWidgetSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.literal("markdown"),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  markdown: z.string().trim().max(8_000),
  span: z.number().int().min(1).max(12).optional(),
});

type DashboardWidgetInput =
  | z.infer<typeof DashboardMetricWidgetSchema>
  | z.infer<typeof DashboardMarkdownWidgetSchema>
  | {
      id: string;
      kind: "card";
      title: string;
      description?: string | null;
      rows: DashboardRowInput[];
      span?: number;
    };
type DashboardRowInput = {
  id: string;
  kind: "row";
  height: "sm" | "md" | "lg";
  cells: DashboardWidgetInput[];
};
const DashboardWidgetSchema: z.ZodType<DashboardWidgetInput> = z.lazy(() =>
  z.union([
    DashboardMetricWidgetSchema,
    DashboardMarkdownWidgetSchema,
    z.object({
      id: z.string().trim().min(1).max(80),
      kind: z.literal("card"),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(500).nullable().optional(),
      rows: z.array(DashboardRowSchema).max(24),
      span: z.number().int().min(1).max(12).optional(),
    }),
  ]),
);
const DashboardRowSchema: z.ZodType<DashboardRowInput> = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("row"),
    height: z.enum(["sm", "md", "lg"]),
    cells: z.array(DashboardWidgetSchema).max(12),
  }),
);
type DashboardSectionInput = {
  id: string;
  kind: "section";
  title: string;
  description?: string | null;
  rows: z.infer<typeof DashboardRowSchema>[];
  sections?: DashboardSectionInput[];
};
const DashboardSectionSchema: z.ZodType<DashboardSectionInput> = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("section"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(500).nullable().optional(),
    rows: z.array(DashboardRowSchema).max(24),
    sections: z.array(DashboardSectionSchema).max(12).optional(),
  }),
);
const DashboardLayoutSchema = z.object({
  version: z.literal(1),
  description: z.string().trim().max(1_000).nullable().optional(),
  sections: z.array(DashboardSectionSchema).max(24),
});

const DashboardConfigSchema = z.object({
  panels: z.array(DashboardPanelSchema).max(24).default([]),
  layout: DashboardLayoutSchema.nullable().optional(),
  dsl: z.string().trim().max(40_000).nullable().optional(),
  refreshIntervalSeconds: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(60)]).nullable().optional(),
});

const CreateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  config: DashboardConfigSchema.optional(),
});

const UpdateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: DashboardConfigSchema.optional(),
});

const MetricQuerySchema = z.object({
  baseId: z.string().uuid(),
  metric: z.string().trim().min(1),
  aggregation: z.enum(AGGREGATIONS),
  bucket: z
    .string()
    .trim()
    .regex(/^\d+[mhd]$/),
  since: z
    .string()
    .trim()
    .regex(/^\d+[mhd]$/),
  sourceId: z.string().uuid().nullable().optional(),
  dimensions: DimensionsSchema,
});
const CompiledMetricQuerySchema = MetricQuerySchema.extend({ kind: z.literal("metric") });
const EventQuerySchema = z.object({
  kind: z.literal("events"),
  baseId: z.string().uuid(),
  event: z.string().nullable(),
  since: z.string().trim().regex(/^\d+[mhd]$/),
  sourceId: z.string().uuid().nullable().optional(),
  entityId: z.string().nullable().optional(),
  entityType: z.string().nullable().optional(),
  dimensions: DimensionsSchema,
  limit: z.number().int().positive().max(1_000),
});
const StateQuerySchema = z.object({
  kind: z.literal("states"),
  baseId: z.string().uuid(),
  state: z.string().nullable(),
  since: z.string().trim().regex(/^\d+[mhd]$/).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  entityId: z.string().nullable().optional(),
  entityType: z.string().nullable().optional(),
  dimensions: DimensionsSchema,
  limit: z.number().int().positive().max(1_000),
});
const ExplorerQuerySchema = z.discriminatedUnion("kind", [CompiledMetricQuerySchema, EventQuerySchema, StateQuerySchema]);

const QueryTextSchema = z.object({
  baseId: z.string().uuid(),
  query: z.string().trim().min(1).max(2_000),
});
const CompileTextQuerySchema = QueryTextSchema;
const DashboardDslCompileSchema = z.object({
  baseId: z.string().uuid(),
  text: z.string().trim().min(1).max(40_000),
});
const CreateSavedQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).nullable().optional(),
  query: z.string().trim().min(1).max(2_000),
});

const MetricSeriesQuerySchema = z.object({
  metric: z.string().trim().min(1).max(240),
  sourceId: z.string().uuid().optional(),
});
const ActivitySearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});
const MetricsQuerySchema = ActivitySearchQuerySchema.extend({
  type: z.enum(METRIC_TYPES).optional(),
});

const MessageSchema = z.object({ message: z.string() });
const BaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  retentionDays: z.number(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const SourceSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  kind: z.enum(SOURCE_KINDS),
  name: z.string(),
  enabled: z.boolean(),
  endpointUrl: z.string().nullable(),
  bearerTokenConfigured: z.boolean(),
  scrapeIntervalSeconds: z.number().nullable(),
  lastSeenAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const SourceScrapeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
  metrics: z.number(),
  events: z.number(),
  states: z.number(),
  errorMessage: z.string().nullable(),
});
const SourceTokenSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
const DashboardSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  config: DashboardConfigSchema,
  publicEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const StreamPointSchema = z.object({ bucket: z.string(), value: z.number().nullable() });
const PublicDashboardPanelSchema = DashboardPanelSchema.omit({
  sourceId: true,
  dimensions: true,
});
const PublicDashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: z.object({
    panels: z.array(PublicDashboardPanelSchema),
    refreshIntervalSeconds: z.number().nullable().optional(),
  }),
});
const SavedQuerySchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  query: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const DashboardDslDiagnosticSchema = z.object({
  severity: z.literal("error"),
  message: z.string(),
  line: z.number(),
  column: z.number(),
});
const DashboardDslCompileResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(DashboardDslDiagnosticSchema),
  config: DashboardConfigSchema.nullable(),
});
const DashboardSnapshotSchema = z.object({
  dashboard: PublicDashboardSchema,
  points: z.record(z.string(), z.array(StreamPointSchema)),
});
const MetricSeriesSchema = z.object({
  id: z.string(),
  metric: z.string(),
  sourceId: z.string().nullable(),
  entityId: z.string().nullable(),
  entityType: z.string().nullable(),
  dimensions: z.record(z.string(), z.string()),
  lastSeenAt: z.string().nullable(),
});
const RecordedEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  ts: z.string(),
  value: z.number().nullable(),
  sourceId: z.string().nullable(),
  entityId: z.string().nullable(),
  entityType: z.string().nullable(),
  dimensions: z.record(z.string(), z.string()),
  payload: z.record(z.string(), z.unknown()),
  recordedAt: z.string(),
});
const CurrentStateSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  sourceId: z.string().nullable(),
  entityId: z.string(),
  entityType: z.string().nullable(),
  dimensions: z.record(z.string(), z.string()),
  updatedAt: z.string(),
});
const MetricQueryResultSchema = z.object({
  compiled: ExplorerQuerySchema,
  points: z.array(StreamPointSchema),
  events: z.array(RecordedEventSchema),
  states: z.array(CurrentStateSchema),
});
const QueryCompileResultSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(z.object({ severity: z.enum(["error", "info"]), message: z.string() })),
  compiled: ExplorerQuerySchema.nullable(),
});

const requireParam = (value: string | undefined, label: string) =>
  value ? { ok: true as const, value } : { ok: false as const, result: fail(err.badInput(`Missing ${label}`)) };

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .post(
    "/ingest/:token",
    describeRoute({
      tags: ["Pulse"],
      summary: "Ingest Pulse metrics, events, and states by source token",
      responses: {
        200: jsonResponse(z.object({ metrics: z.number(), events: z.number(), states: z.number() }), "Ingest counts"),
        404: jsonResponse(MessageSchema, "Unknown ingest source"),
      },
    }),
    v("json", IngestBatchSchema),
    async (c) => {
      const token = requireParam(c.req.param("token"), "ingest token");
      if (!token.ok) return respond(c, token.result);
      return respond(c, pulseService.ingest.byToken({ token: token.value, batch: c.req.valid("json") }));
    },
  )
  .get(
    "/public-dashboard/:token",
    describeRoute({
      tags: ["Pulse"],
      summary: "Get a public Pulse dashboard snapshot",
      responses: { 200: jsonResponse(DashboardSnapshotSchema, "Public dashboard snapshot") },
    }),
    async (c) => {
      const token = requireParam(c.req.param("token"), "public dashboard token");
      if (!token.ok) return respond(c, token.result);
      return respond(c, pulseService.dashboard.publicSnapshot(token.value));
    },
  )
  .use(auth.requireRole("authenticated"))
  .get(
    "/capabilities",
    describeRoute({
      tags: ["Pulse"],
      summary: "Get Pulse deployment capabilities",
      responses: {
        200: jsonResponse(
          z.object({ timescaleEnabled: z.boolean(), timeBucketAvailable: z.boolean(), continuousAggregatesAvailable: z.boolean() }),
          "Capabilities",
        ),
      },
    }),
    async (c) => respond(c, pulseService.capabilities()),
  )
  .get(
    "/bases",
    describeRoute({
      tags: ["Pulse"],
      summary: "List accessible Pulse bases",
      responses: { 200: jsonResponse(z.array(BaseSchema), "Pulse bases") },
    }),
    async (c) => respond(c, pulseService.base.list(c.get("user"))),
  )
  .post(
    "/bases",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse base",
      responses: { 201: jsonResponse(BaseSchema, "Created Pulse base") },
    }),
    v("json", CreateBaseSchema),
    async (c) => respond(c, pulseService.base.create({ ...c.req.valid("json"), user: c.get("user") }), 201),
  )
  .get("/bases/:baseId", async (c) => {
    const baseId = requireParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    return respond(c, pulseService.base.get(baseId.value, c.get("user")));
  })
  .patch(
    "/bases/:baseId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update a Pulse base",
      responses: { 200: jsonResponse(BaseSchema, "Updated Pulse base") },
    }),
    v("json", UpdateBaseSchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.update({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .get(
    "/bases/:baseId/access",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse base access entries",
      responses: { 200: jsonResponse(z.array(AccessEntrySchema), "Pulse base access entries") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.access.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/access",
    describeRoute({
      tags: ["Pulse"],
      summary: "Grant Pulse base access",
      responses: { 201: jsonResponse(AccessEntrySchema, "Created access entry") },
    }),
    v("json", GrantBaseAccessSchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.access.grant({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }), 201);
    },
  )
  .patch(
    "/access/:accessId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update Pulse access level",
      responses: { 200: jsonResponse(MessageSchema, "Access updated") },
    }),
    v("json", UpdateBaseAccessSchema),
    async (c) => {
      const accessId = requireParam(c.req.param("accessId"), "access ID");
      if (!accessId.ok) return respond(c, accessId.result);
      return respondMessage(
        c,
        pulseService.base.access.update({ accessId: accessId.value, user: c.get("user"), ...c.req.valid("json") }),
        "Access updated",
      );
    },
  )
  .delete("/access/:accessId", async (c) => {
    const accessId = requireParam(c.req.param("accessId"), "access ID");
    if (!accessId.ok) return respond(c, accessId.result);
    return respondMessage(c, pulseService.base.access.revoke({ accessId: accessId.value, user: c.get("user") }), "Access revoked");
  })
  .get(
    "/bases/:baseId/sources",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse sources for a base",
      responses: { 200: jsonResponse(z.array(SourceSchema), "Pulse sources") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.source.list(baseId.value, c.get("user")));
    },
  )
  .get(
    "/bases/:baseId/metrics",
    v("query", MetricsQuerySchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.metrics(baseId.value, c.get("user"), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/recent-events",
    describeRoute({
      tags: ["Pulse"],
      summary: "List recent Pulse events for a base",
      responses: { 200: jsonResponse(z.array(RecordedEventSchema), "Recent events") },
    }),
    v("query", ActivitySearchQuerySchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.recentEvents(baseId.value, c.get("user"), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/states",
    describeRoute({
      tags: ["Pulse"],
      summary: "List current Pulse states for a base",
      responses: { 200: jsonResponse(z.array(CurrentStateSchema), "Current states") },
    }),
    v("query", ActivitySearchQuerySchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.currentStates(baseId.value, c.get("user"), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/series",
    describeRoute({
      tags: ["Pulse"],
      summary: "List metric series for a Pulse base",
      responses: { 200: jsonResponse(z.array(MetricSeriesSchema), "Metric series") },
    }),
    v("query", MetricSeriesQuerySchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.series(baseId.value, c.get("user"), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/dashboards",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse dashboards for a base",
      responses: { 200: jsonResponse(z.array(DashboardSchema), "Pulse dashboards") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.dashboard.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/dashboards",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse dashboard",
      responses: { 201: jsonResponse(DashboardSchema, "Created Pulse dashboard") },
    }),
    v("json", CreateDashboardSchema),
    async (c) =>
      respond(
        c,
        (() => {
          const baseId = requireParam(c.req.param("baseId"), "base ID");
          if (!baseId.ok) return baseId.result;
          return pulseService.dashboard.create({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") });
        })(),
        201,
      ),
  )
  .post(
    "/bases/:baseId/sources",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse source",
      responses: { 201: jsonResponse(SourceSchema, "Created Pulse source") },
    }),
    v("json", CreateSourceSchema),
    async (c) =>
      respond(
        c,
        (() => {
          const baseId = requireParam(c.req.param("baseId"), "base ID");
          if (!baseId.ok) return baseId.result;
          return pulseService.source.create({
            baseId: baseId.value,
            user: c.get("user"),
            ...c.req.valid("json"),
          });
        })(),
        201,
      ),
  )
  .post("/bases/:baseId/sources/:sourceId/scrape", async (c) => {
    const baseId = requireParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const sourceId = requireParam(c.req.param("sourceId"), "source ID");
    if (!sourceId.ok) return respond(c, sourceId.result);
    return respond(c, pulseService.source.scrape({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user") }));
  })
  .get(
    "/bases/:baseId/sources/:sourceId/scrapes",
    describeRoute({
      tags: ["Pulse"],
      summary: "List recent Pulse source scrape attempts",
      responses: { 200: jsonResponse(z.array(SourceScrapeSchema), "Recent source scrape attempts") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const sourceId = requireParam(c.req.param("sourceId"), "source ID");
      if (!sourceId.ok) return respond(c, sourceId.result);
      return respond(c, pulseService.source.scrapes({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user") }));
    },
  )
  .get(
    "/bases/:baseId/sources/:sourceId/tokens",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse HTTP ingest source tokens",
      responses: { 200: jsonResponse(z.array(SourceTokenSchema), "Pulse source tokens") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const sourceId = requireParam(c.req.param("sourceId"), "source ID");
      if (!sourceId.ok) return respond(c, sourceId.result);
      return respond(c, pulseService.source.tokens.list({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user") }));
    },
  )
  .post(
    "/bases/:baseId/sources/:sourceId/tokens",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse HTTP ingest source token",
      responses: { 201: jsonResponse(z.object({ source: SourceSchema, token: SourceTokenSchema, ingestToken: z.string() }), "Created source token") },
    }),
    v("json", CreateSourceTokenSchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const sourceId = requireParam(c.req.param("sourceId"), "source ID");
      if (!sourceId.ok) return respond(c, sourceId.result);
      return respond(
        c,
        pulseService.source.tokens.create({
          baseId: baseId.value,
          sourceId: sourceId.value,
          user: c.get("user"),
          ...c.req.valid("json"),
        }),
        201,
      );
    },
  )
  .delete("/bases/:baseId/sources/:sourceId/tokens/:tokenId", async (c) => {
    const baseId = requireParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const sourceId = requireParam(c.req.param("sourceId"), "source ID");
    if (!sourceId.ok) return respond(c, sourceId.result);
    const tokenId = requireParam(c.req.param("tokenId"), "token ID");
    if (!tokenId.ok) return respond(c, tokenId.result);
    return respond(
      c,
      pulseService.source.tokens.remove({
        baseId: baseId.value,
        sourceId: sourceId.value,
        tokenId: tokenId.value,
        user: c.get("user"),
      }),
    );
  })
  .patch(
    "/bases/:baseId/sources/:sourceId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update a Pulse source",
      responses: { 200: jsonResponse(SourceSchema, "Updated Pulse source") },
    }),
    v("json", UpdateSourceSchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const sourceId = requireParam(c.req.param("sourceId"), "source ID");
      if (!sourceId.ok) return respond(c, sourceId.result);
      return respond(
        c,
        pulseService.source.update({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user"), ...c.req.valid("json") }),
      );
    },
  )
  .get(
    "/bases/:baseId/saved-queries",
    describeRoute({
      tags: ["Pulse"],
      summary: "List saved Pulse queries",
      responses: { 200: jsonResponse(z.array(SavedQuerySchema), "Saved Pulse queries") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.savedQuery.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/saved-queries",
    describeRoute({
      tags: ["Pulse"],
      summary: "Save a Pulse query",
      responses: { 201: jsonResponse(SavedQuerySchema, "Saved Pulse query") },
    }),
    v("json", CreateSavedQuerySchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.savedQuery.create({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .post(
    "/bases/:baseId/sources/:sourceId/ingest-token",
    describeRoute({
      tags: ["Pulse"],
      summary: "Rotate a Pulse ingest source token",
      responses: { 200: jsonResponse(z.object({ source: SourceSchema, ingestToken: z.string() }), "New ingest token") },
    }),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const sourceId = requireParam(c.req.param("sourceId"), "source ID");
      if (!sourceId.ok) return respond(c, sourceId.result);
      return respond(c, pulseService.source.rotateIngestToken({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user") }));
    },
  )
  .delete("/bases/:baseId/sources/:sourceId", async (c) => {
    const baseId = requireParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const sourceId = requireParam(c.req.param("sourceId"), "source ID");
    if (!sourceId.ok) return respond(c, sourceId.result);
    return respond(c, pulseService.source.remove({ baseId: baseId.value, sourceId: sourceId.value, user: c.get("user") }));
  })
  .post(
    "/bases/:baseId/ingest",
    describeRoute({
      tags: ["Pulse"],
      summary: "Ingest Pulse data through authenticated internal API",
      responses: { 200: jsonResponse(z.object({ metrics: z.number(), events: z.number(), states: z.number() }), "Ingest counts") },
    }),
    v("json", IngestBatchSchema),
    async (c) => {
      const baseId = requireParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const gate = await pulseService.base.access.require(baseId.value, c.get("user"), "write");
      if (!gate.ok) return respond(c, gate);
      return respond(c, pulseService.ingest.batch({ baseId: baseId.value, batch: c.req.valid("json") }));
    },
  )
  .patch(
    "/dashboards/:dashboardId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update a Pulse dashboard",
      responses: { 200: jsonResponse(DashboardSchema, "Updated Pulse dashboard") },
    }),
    v("json", UpdateDashboardSchema),
    async (c) => {
      const dashboardId = requireParam(c.req.param("dashboardId"), "dashboard ID");
      if (!dashboardId.ok) return respond(c, dashboardId.result);
      return respond(c, pulseService.dashboard.update({ dashboardId: dashboardId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .delete("/dashboards/:dashboardId", async (c) => {
    const dashboardId = requireParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respondMessage(c, pulseService.dashboard.remove({ dashboardId: dashboardId.value, user: c.get("user") }), "Dashboard removed");
  })
  .post("/dashboards/:dashboardId/public-token", async (c) => {
    const dashboardId = requireParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respond(c, pulseService.dashboard.enablePublic({ dashboardId: dashboardId.value, user: c.get("user") }));
  })
  .delete("/dashboards/:dashboardId/public-token", async (c) => {
    const dashboardId = requireParam(c.req.param("dashboardId"), "dashboard ID");
    if (!dashboardId.ok) return respond(c, dashboardId.result);
    return respond(c, pulseService.dashboard.disablePublic({ dashboardId: dashboardId.value, user: c.get("user") }));
  })
  .delete("/bases/:baseId/saved-queries/:queryId", async (c) => {
    const baseId = requireParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const queryId = requireParam(c.req.param("queryId"), "saved query ID");
    if (!queryId.ok) return respond(c, queryId.result);
    return respondMessage(c, pulseService.savedQuery.remove({ baseId: baseId.value, queryId: queryId.value, user: c.get("user") }), "Query removed");
  })
  .post(
    "/query/metric",
    describeRoute({
      tags: ["Pulse"],
      summary: "Run a Pulse metric query",
      responses: { 200: jsonResponse(z.array(z.object({ bucket: z.string(), value: z.number().nullable() })), "Query points") },
    }),
    v("json", MetricQuerySchema),
    async (c) => respond(c, pulseService.query.metric({ kind: "metric", ...c.req.valid("json") }, c.get("user"))),
  )
  .post(
    "/query/metric-text",
    describeRoute({
      tags: ["Pulse"],
      summary: "Run a Pulse query from text DSL",
      responses: { 200: jsonResponse(MetricQueryResultSchema, "Compiled query and results") },
    }),
    v("json", QueryTextSchema),
    async (c) => respond(c, pulseService.query.metricText({ ...c.req.valid("json"), user: c.get("user") })),
  )
  .post(
    "/query/compile-text",
    describeRoute({
      tags: ["Pulse"],
      summary: "Compile a Pulse query without running it",
      responses: { 200: jsonResponse(QueryCompileResultSchema, "Query diagnostics") },
    }),
    v("json", CompileTextQuerySchema),
    async (c) => respond(c, pulseService.query.compileText({ ...c.req.valid("json"), user: c.get("user") })),
  )
  .post(
    "/dashboard-dsl/compile",
    describeRoute({
      tags: ["Pulse"],
      summary: "Compile a Pulse dashboard DSL document without saving it",
      responses: { 200: jsonResponse(DashboardDslCompileResultSchema, "Dashboard DSL diagnostics and config") },
    }),
    v("json", DashboardDslCompileSchema),
    async (c) => respond(c, pulseService.dashboard.compileDsl({ ...c.req.valid("json"), user: c.get("user") })),
  );

export default app;
export type ApiType = typeof app;
