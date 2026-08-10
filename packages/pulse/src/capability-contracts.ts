import { CapabilitySemanticLinkSchema } from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import { METRIC_TYPES, SOURCE_KINDS } from "./contracts";

const TimestampSchema = z.string().datetime({ offset: true });
const CursorSchema = z.string().min(1).max(256).optional().describe("Opaque cursor returned by the previous page.");
const LimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return.");
const QuerySchema = z.string().trim().max(500).optional().describe("Optional text search.");
const PageInputShape = { cursor: CursorSchema, limit: LimitSchema };
const ResourceLinksSchema = z.array(CapabilitySemanticLinkSchema).min(1).max(10).optional();

export const BaseDataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(1_000).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    links: ResourceLinksSchema,
  })
  .strict();
export const BaseListDataSchema = z.array(BaseDataSchema).max(100);
export const BaseListInputSchema = z.object({ query: QuerySchema, ...PageInputShape }).strict();
export const BaseReadInputSchema = z.object({ id: z.uuid().describe("Stable readable Pulse Base UUID.") }).strict();

export const SourceDataSchema = z
  .object({
    id: z.uuid(),
    baseId: z.uuid(),
    kind: z.enum(SOURCE_KINDS),
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    lastSeenAt: TimestampSchema.nullable(),
    lastError: z.string().max(2_000).nullable(),
    lastErrorAt: TimestampSchema.nullable(),
    updatedAt: TimestampSchema,
    links: ResourceLinksSchema,
  })
  .strict();
export const SourceListDataSchema = z.array(SourceDataSchema).max(100);
export const SourceListInputSchema = z
  .object({ baseId: z.uuid().describe("Readable Pulse Base UUID."), query: QuerySchema, ...PageInputShape })
  .strict();
export const SourceReadInputSchema = z.object({ id: z.uuid().describe("Stable readable Pulse Source UUID.") }).strict();

export const ResourceDataSchema = z
  .object({
    id: z.uuid(),
    baseId: z.uuid(),
    baseName: z.string().min(1).max(120),
    key: z.string().min(1).max(500),
    resourceId: z.string().min(1).max(500),
    label: z.string().min(1).max(500),
    type: z.string().max(120).nullable(),
    lastSeenAt: TimestampSchema.nullable(),
    links: ResourceLinksSchema,
  })
  .strict();
export const ResourceReadInputSchema = z.object({ id: z.uuid().describe("Stable observed-resource UUID.") }).strict();

const MetricDataSchema = z
  .object({
    name: z.string().min(1).max(240),
    unit: z.string().max(120).nullable(),
    type: z.enum(METRIC_TYPES),
    seriesCount: z.number().int().nonnegative(),
    lastSeenAt: TimestampSchema.nullable(),
    links: ResourceLinksSchema,
  })
  .strict();
export const MetricSearchDataSchema = z.array(MetricDataSchema).max(100);
export const MetricSearchInputSchema = z
  .object({
    baseId: z.uuid().describe("Readable Pulse Base UUID."),
    query: QuerySchema,
    type: z.enum(METRIC_TYPES).optional().describe("Optional metric type filter."),
    ...PageInputShape,
  })
  .strict();

const FieldDataSchema = z
  .object({
    sourceId: z.uuid(),
    scope: z.enum(["metric", "event", "state"]),
    signalName: z.string().min(1).max(240),
    role: z.enum(["dimension", "attribute"]),
    key: z.string().min(1).max(80),
    valueType: z.enum(["null", "string", "number", "boolean", "object", "array", "mixed"]),
    observedCount: z.number().int().nonnegative(),
    firstSeenAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    links: ResourceLinksSchema,
  })
  .strict();
export const FieldSearchDataSchema = z.array(FieldDataSchema).max(100);
export const FieldSearchInputSchema = z
  .object({
    baseId: z.uuid().describe("Readable Pulse Base UUID."),
    query: QuerySchema,
    scope: z.enum(["metric", "event", "state"]).optional().describe("Optional signal kind filter."),
    role: z.enum(["dimension", "attribute"]).default("dimension").describe("Field role to discover; sensitive fields are excluded."),
    ...PageInputShape,
  })
  .strict();

export const QueryTextInputSchema = z
  .object({
    baseId: z.uuid().describe("Readable Pulse Base UUID."),
    query: z.string().trim().min(1).max(2_000).describe("Pulse query DSL text."),
  })
  .strict();

const DiagnosticDataSchema = z.object({ severity: z.enum(["error", "info"]), message: z.string().min(1).max(1_000) }).strict();
export const QueryCompileDataSchema = z
  .object({
    valid: z.boolean(),
    kind: z.enum(["metric", "events", "states"]).nullable(),
    diagnostics: z.array(DiagnosticDataSchema).max(20),
  })
  .strict();

const DimensionsDataSchema = z.record(z.string().min(1).max(80), z.string().max(500));
const PointDataSchema = z
  .object({ bucket: TimestampSchema, value: z.number().finite().nullable(), group: DimensionsDataSchema.optional() })
  .strict();
const EventDataSchema = z
  .object({
    id: z.uuid(),
    kind: z.string().min(1).max(240),
    ts: TimestampSchema,
    value: z.number().finite().nullable(),
    sourceId: z.uuid().nullable(),
    entityId: z.string().max(500).nullable(),
    entityType: z.string().max(120).nullable(),
    dimensions: DimensionsDataSchema,
  })
  .strict();
const StateValueSchema = z.union([z.string().max(1_000), z.number().finite(), z.boolean(), z.null()]);
const StateDataSchema = z
  .object({
    key: z.string().min(1).max(240),
    value: StateValueSchema,
    sourceId: z.uuid().nullable(),
    entityId: z.string().max(500),
    entityType: z.string().max(120).nullable(),
    dimensions: DimensionsDataSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const QueryExecutionDataSchema = z
  .object({
    kind: z.enum(["metric", "events", "states"]),
    query: z.string().min(1).max(2_000),
    points: z.array(PointDataSchema).max(500),
    events: z.array(EventDataSchema).max(100),
    states: z.array(StateDataSchema).max(100),
    limitApplied: z.number().int().min(1).max(500),
    truncated: z.boolean(),
  })
  .strict();

export const SavedQueryDataSchema = z
  .object({
    id: z.uuid(),
    baseId: z.uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(1_000).nullable(),
    query: z.string().min(1).max(2_000),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const SavedQueryListDataSchema = z.array(SavedQueryDataSchema).max(100);
export const SavedQueryListInputSchema = z
  .object({ baseId: z.uuid().describe("Readable Pulse Base UUID."), query: QuerySchema, ...PageInputShape })
  .strict();
export const SavedQueryReadInputSchema = z.object({ id: z.uuid().describe("Stable saved-query UUID.") }).strict();
export const SavedQueryExecuteInputSchema = z
  .object({
    baseId: z.uuid().describe("Readable Pulse Base UUID."),
    queryId: z.uuid().describe("Stable saved-query UUID returned by saved_query.list."),
  })
  .strict();
