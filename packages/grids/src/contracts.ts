import { z } from "zod";

export {
  createPagination,
  ErrorResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  parsePagination,
} from "@valentinkolb/cloud/contracts";

/**
 * Persisted slug for grids resources: 5-character base62 alphanumeric.
 * Mirrors the DB CHECK constraint (`slug ~ '^[A-Za-z0-9]{5}$'`) so the
 * contract layer and the storage layer cannot disagree. Service mappers
 * read `row.slug` directly; if a row lacks the column the throw bubbles
 * up rather than getting silently coerced to "" (we hit that bug once).
 */
export const ShortIdSchema = z.string().regex(/^[A-Za-z0-9]{5}$/);
const IconNameSchema = z.string().max(200).nullable().optional();

export const DocumentProfileSchema = z
  .object({
    legalName: z.string().max(200).optional(),
    senderLine: z.string().max(500).optional(),
    address: z.string().max(1_000).optional(),
    department: z.string().max(200).optional(),
    contactEmail: z.string().max(320).optional(),
    phone: z.string().max(100).optional(),
    url: z.string().max(500).optional(),
    taxId: z.string().max(100).optional(),
    registration: z.string().max(300).optional(),
    bankName: z.string().max(200).optional(),
    iban: z.string().max(100).optional(),
    bic: z.string().max(100).optional(),
    paymentTerms: z.string().max(500).optional(),
    footerText: z.string().max(1_000).optional(),
  })
  .default({});
export type DocumentProfile = z.infer<typeof DocumentProfileSchema>;

// ── Record display ────────────────────────────────────────────────────────
//
// Presentation-only settings for records surfaces. Kept deliberately
// separate from RecordQuery: filters, sort, grouping, search and aggregations
// remain the SQL source of truth; this only decides how the returned records
// are rendered.
export const RecordDisplayModeSchema = z.enum(["table", "cards", "calendar"]);
export type RecordDisplayMode = z.infer<typeof RecordDisplayModeSchema>;

export const RecordDisplayConfigSchema = z
  .object({
    mode: RecordDisplayModeSchema.default("table"),
    cards: z
      .object({
        imageFieldId: z.string().uuid().nullable().optional(),
        fieldIds: z.array(z.string().uuid()).max(50).optional(),
      })
      .optional(),
    calendar: z
      .object({
        dateFieldId: z.string().uuid().nullable().optional(),
      })
      .optional(),
  })
  .default({ mode: "table" });
export type RecordDisplayConfig = z.infer<typeof RecordDisplayConfigSchema>;

// ── Base ──────────────────────────────────────────────────────────────────
export const BaseSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  documentProfile: DocumentProfileSchema,
  createdBy: z.string().uuid().nullable(),
  /** When set, opening `/grids/<base>` with no ?table or ?dashboard query
   *  param renders this dashboard. Service layer treats stale ids
   *  (referenced dashboard soft-deleted) as null. Settable via the
   *  base settings page; surfaced as a read-only "Currently base default"
   *  badge on the dashboard render/edit pages. */
  defaultDashboardId: z.string().uuid().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Base = z.infer<typeof BaseSchema>;

export const CreateBaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});
export type CreateBaseInput = z.infer<typeof CreateBaseSchema>;

export const UpdateBaseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  documentProfile: DocumentProfileSchema.optional(),
  /** Set/unset the default dashboard for this base. Pass null to clear.
   *  Caller must hold base-admin (gate enforced in api/bases.ts). */
  defaultDashboardId: z.string().uuid().nullable().optional(),
});
export type UpdateBaseInput = z.infer<typeof UpdateBaseSchema>;

// ── Table ─────────────────────────────────────────────────────────────────
export const TableSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  baseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: IconNameSchema,
  columns: z.array(z.lazy(() => FieldColumnSpecSchema)),
  displayConfig: RecordDisplayConfigSchema,
  position: z.number().int(),
  disableDirectInsert: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Table = z.infer<typeof TableSchema>;

export const CreateTableSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  icon: IconNameSchema,
  columns: z.array(z.lazy(() => FieldColumnSpecSchema)).optional(),
  displayConfig: RecordDisplayConfigSchema.optional(),
});

export const UpdateTableSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  icon: IconNameSchema,
  columns: z.array(z.lazy(() => FieldColumnSpecSchema)).optional(),
  displayConfig: RecordDisplayConfigSchema.optional(),
  disableDirectInsert: z.boolean().optional(),
});

// ── Field ─────────────────────────────────────────────────────────────────
export const FieldSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  tableId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().max(200).nullable().optional(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.number().int(),
  required: z.boolean(),
  presentable: z.boolean(),
  hideInTable: z.boolean(),
  defaultValue: z.unknown().nullable(),
  indexed: z.boolean(),
  uniqueConstraint: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Field = z.infer<typeof FieldSchema>;

export const CreateFieldSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(200).nullable().optional(),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().optional(),
  required: z.boolean().optional(),
  presentable: z.boolean().optional(),
  hideInTable: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  indexed: z.boolean().optional(),
  uniqueConstraint: z.boolean().optional(),
});

export const UpdateFieldSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(200).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().optional(),
  required: z.boolean().optional(),
  presentable: z.boolean().optional(),
  hideInTable: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  indexed: z.boolean().optional(),
  uniqueConstraint: z.boolean().optional(),
});

/** Reorder payload — list of field ids in the new desired order. */
export const ReorderFieldsSchema = z.object({
  fieldIds: z.array(z.string().uuid()).min(1),
});

// ── Record ────────────────────────────────────────────────────────────────
export const GridRecordSchema = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  deletedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GridRecord = z.infer<typeof GridRecordSchema>;

export const RecordPayloadSchema = z.record(z.string(), z.unknown());

// `z.coerce.boolean()` treats any non-empty string as true (so "false"
// parses to true). Use an explicit string-to-boolean map to honor the
// expected REST query semantics: ?includeDeleted=true vs =false.
const StringBoolSchema = z.preprocess((v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v), z.boolean());

// Filter and sort arrive as URL-encoded JSON strings; the schema parses
// the JSON before validating its shape.
const JsonStringSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, inner);

const FilterLeafSchema = z.object({
  fieldId: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
  caseInsensitive: z.boolean().optional(),
});

export type FilterTree = z.infer<typeof FilterLeafSchema> | { op: "AND" | "OR"; filters: FilterTree[] };

export const FilterTreeSchema: z.ZodType<FilterTree> = z.lazy(() =>
  z.union([
    FilterLeafSchema,
    z.object({
      op: z.enum(["AND", "OR"]),
      filters: z.array(FilterTreeSchema),
    }),
  ]),
);

export const RecordMetaSortKeySchema = z.enum(["createdAt", "updatedAt", "deletedAt"]);
export type RecordMetaSortKey = z.infer<typeof RecordMetaSortKeySchema>;

const FieldSortSpecSchema = z.object({
  source: z.literal("field").optional(),
  fieldId: z.string(),
  direction: z.enum(["asc", "desc"]),
  nullsFirst: z.boolean().optional(),
});

const RecordSortSpecSchema = z.object({
  source: z.literal("record"),
  key: RecordMetaSortKeySchema,
  direction: z.enum(["asc", "desc"]),
  nullsFirst: z.boolean().optional(),
});

export const SortSpecSchema = z.union([RecordSortSpecSchema, FieldSortSpecSchema]);
export type SortSpec = z.infer<typeof SortSpecSchema>;

export const RecordListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  includeDeleted: StringBoolSchema.optional(),
  filter: JsonStringSchema(FilterTreeSchema).optional(),
  sort: JsonStringSchema(z.array(SortSpecSchema)).optional(),
});

export const AggregateKindSchema = z.enum([
  "count",
  "countEmpty",
  "countUnique",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "earliest",
  "latest",
]);
export const GroupAggregateKindSchema = z.enum([
  "count",
  "countEmpty",
  "countUnique",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "earliest",
  "latest",
]);

export const AggregateRequestSchema = z.object({
  fieldId: z.string(),
  agg: AggregateKindSchema,
});

export const AggregateBodySchema = z.object({
  filter: FilterTreeSchema.optional(),
  requests: z.array(AggregateRequestSchema).min(1).max(50),
});

export const AggregateResponseSchema = z.object({
  results: z.record(z.string(), z.unknown()),
});

export const RecordListResponseSchema = z.object({
  items: z.array(GridRecordSchema),
  aggregates: z.record(z.string(), z.unknown()).optional(),
  // Cursor is now a JSON-encoded {sortValues, id} token, not a bare uuid.
  nextCursor: z.string().nullable(),
});

// ── Group-by + aggregations endpoint (v3 Slice 8) ─────────────────────────
// Request: same FilterTree shape as records.list, plus groupBy and
// aggregations from RecordQuery. Response: an array of buckets where
// each bucket has its key tuple and the aggregated values.

export const GroupByRequestSchema = z.object({
  fieldId: z.string().uuid(),
  direction: z.enum(["asc", "desc"]).optional(),
  granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
});

export const GroupAggregationRequestSchema = z.object({
  fieldId: z.union([z.string().uuid(), z.literal("*")]),
  agg: z.enum(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]),
});

export const GroupBodySchema = z.object({
  filter: FilterTreeSchema.optional(),
  groupBy: z.array(GroupByRequestSchema).min(1).max(3),
  aggregations: z.array(GroupAggregationRequestSchema).max(20).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  includeDeleted: z.boolean().optional(),
});

export const GroupBucketSchema = z.object({
  keys: z.array(z.unknown()),
  values: z.record(z.string(), z.unknown()),
});

export const GroupResponseSchema = z.object({
  buckets: z.array(GroupBucketSchema),
  nextCursor: z.string().nullable(),
  /**
   * Explode-mode flag. True when one or more `groupBy` dimensions is
   * a relation or select field — a record with N linked/selected
   * values contributes to N buckets, so `*__count` counts contributions,
   * not distinct records.
   */
  explode: z.boolean(),
});

// ── Unified /tables/:id/query endpoint (v3 Slice 5) ────────────────────────
// The canonical "ask this table for data" endpoint. Body carries a
// RecordQuery (filter/sort/columns/limit/groupBy/aggregations from the
// canonical type defined below); response is a discriminated envelope
// whose populated fields depend on what the query asked for:
//
//   groupBy non-empty                        → { buckets, nextCursor, explode }
//   groupBy empty + aggregations non-empty   → { items, aggregates, nextCursor }
//   groupBy empty + aggregations empty       → { items, nextCursor }
//
// Old per-action read routes (/by-table/:id, /aggregate/:id, /group/:id)
// were removed in alpha. Record writes and exports keep their dedicated
// endpoints; table reads go through this query endpoint.

// ── RecordQuery (canonical "how to query this table") ───────────────────────
// One shape, used by views (saved presets), records list, export, and
// future group/aggregate endpoints. Replaces the old loose `ViewConfig`
// blob whose `filter: unknown` typing meant saved views were untyped
// garbage bags and the speculative `kind:"join"` ViewColumn variant that
// no renderer actually implemented.

/**
 * Per-column display override. `kind` distinguishes format families
 * (date / decimal / percent / barcode). Renderer is lenient:
 * if the format kind doesn't match the field's actual type, it's a
 * no-op (a `percent` format on a text field renders as plain text).
 */
export const FormatSpecSchema: z.ZodType<
  | { kind: "date"; format: "iso" | "short" | "long" | "relative"; includeTime?: boolean }
  | { kind: "decimal"; precision?: number; thousandsSeparator?: boolean }
  | { kind: "percent"; precision?: number }
  | { kind: "progress"; label?: "value" | "percent" | "none" }
  | { kind: "barcode"; bcid: string; showText?: boolean }
> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("date"),
    format: z.enum(["iso", "short", "long", "relative"]),
    includeTime: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("decimal"),
    precision: z.number().int().min(0).max(10).optional(),
    thousandsSeparator: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("percent"),
    precision: z.number().int().min(0).max(10).optional(),
  }),
  z.object({
    kind: z.literal("progress"),
    label: z.enum(["value", "percent", "none"]).optional(),
  }),
  z.object({
    kind: z.literal("barcode"),
    bcid: z
      .string()
      .regex(/^[a-z0-9]+$/)
      .min(1)
      .max(80),
    showText: z.boolean().optional(),
  }),
]);
export type FormatSpec = z.infer<typeof FormatSpecSchema>;

/**
 * One rendered column in a view. v3 has a single shape — just a
 * fieldId with optional format. The previous `kind: "field"` /
 * `kind: "join"` discriminator was speculative: only `field` was ever
 * implemented and `join` was silently skipped by the renderer.
 * Cross-table data is served by lookup/rollup field types instead
 * (which become real SQL JOINs in Slice 4).
 */
export const FieldColumnSpecSchema = z.object({
  fieldId: z.string().uuid(),
  /** Optional per-view header label. Empty labels are not persisted by
   *  the UI; the renderer falls back to the field name. */
  label: z.string().trim().min(1).max(120).optional(),
  format: FormatSpecSchema.optional(),
});
export type FieldColumnSpec = z.infer<typeof FieldColumnSpecSchema>;

export const ComputedColumnSpecSchema = z.object({
  kind: z.literal("computed"),
  id: z.string().regex(/^computed_[A-Za-z0-9]{5,32}$/),
  label: z.string().trim().min(1).max(120),
  expression: z.string().trim().min(1).max(5000),
  format: FormatSpecSchema.optional(),
});
export type ComputedColumnSpec = z.infer<typeof ComputedColumnSpecSchema>;

export const ColumnSpecSchema = z.union([FieldColumnSpecSchema, ComputedColumnSpecSchema]);
export type ColumnSpec = z.infer<typeof ColumnSpecSchema>;

/**
 * Group-by dimension. Stored in RecordQuery so saved views, URL state,
 * dashboard charts, and exports use the same query contract.
 */
export const GroupBySpecSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().trim().min(1).max(120).optional(),
  format: FormatSpecSchema.optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  /** date-field grouping bucket. Backend uses `date_trunc(<granularity>, …)`. */
  granularity: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
});
export type GroupBySpec = z.infer<typeof GroupBySpecSchema>;

export const AggregationSpecSchema = z.object({
  /** "*" is shorthand for COUNT(*) — count of records in the group. */
  fieldId: z.union([z.string().uuid(), z.literal("*")]),
  agg: AggregateKindSchema,
  label: z.string().optional(),
  format: FormatSpecSchema.optional(),
});
export type AggregationSpec = z.infer<typeof AggregationSpecSchema>;

export const GroupSortSpecSchema = z.object({
  fieldId: z.union([z.string().uuid(), z.literal("*")]),
  agg: GroupAggregateKindSchema,
  direction: z.enum(["asc", "desc"]).optional(),
});
export type GroupSortSpec = z.infer<typeof GroupSortSpecSchema>;

/**
 * Optional per-query free-text search. Server compiles it as its own
 * SQL clause across the listed fieldIds (or a default set when fieldIds
 * is empty/undefined). Kept separate from `filter` so users can layer
 * search on top of structured view filters.
 */
export const SearchSpecSchema = z.object({
  q: z.string().min(1),
  fieldIds: z.array(z.string().uuid()).optional(),
});
export type SearchSpec = z.infer<typeof SearchSpecSchema>;

export const RecordMetaUserKeySchema = z.enum(["createdBy", "updatedBy", "deletedBy"]);
export type RecordMetaUserKey = z.infer<typeof RecordMetaUserKeySchema>;

export const RecordMetaQuerySchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  users: z
    .object({
      createdBy: z.array(z.string().uuid()).max(50).optional(),
      updatedBy: z.array(z.string().uuid()).max(50).optional(),
      deletedBy: z.array(z.string().uuid()).max(50).optional(),
    })
    .optional(),
});
export type RecordMetaQuery = z.infer<typeof RecordMetaQuerySchema>;

export const RecordActorSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  subtitle: z.string().nullable(),
});
export type RecordActor = z.infer<typeof RecordActorSchema>;

export const RecordActorListResponseSchema = z.object({
  items: z.array(RecordActorSchema),
});
export type RecordActorListResponse = z.infer<typeof RecordActorListResponseSchema>;

/**
 * Transient structured query shape for table execution and toolbar patches.
 * Persisted Views store canonical GQL in `view.source`; when the records UI
 * needs this shape, it derives it from the GQL source at the service boundary.
 *
 * Used by:
 *  - `POST /tables/:id/query`
 *  - URL serialization on the records page (`?filter=...&groupBy=...`)
 *  - export endpoint
 *
 * Do not persist this object as the View definition.
 */
export const RecordQuerySchema = z.object({
  filter: FilterTreeSchema.optional(),
  search: SearchSpecSchema.optional(),
  /** Record/system metadata criteria. Kept separate from field filters
   *  because these predicates target `records.*` columns, not table data. */
  recordMeta: RecordMetaQuerySchema.optional(),
  sort: z.array(SortSpecSchema).optional(),
  groupBy: z.array(GroupBySpecSchema).max(3).optional(),
  /** Bucket ordering for grouped queries. When set, groups are ordered
   *  by aggregate value first, then by group keys for deterministic ties.
   *  Used for Top-N views such as "top customers by revenue". */
  groupSort: z.array(GroupSortSpecSchema).max(3).optional(),
  aggregations: z.array(AggregationSpecSchema).optional(),
  columns: z.array(ColumnSpecSchema).optional(),
  /** Visual order for grouped view columns. Group and aggregate specs keep
   *  their semantic order; this only controls the rendered table order. */
  groupedColumnOrder: z.array(z.string().min(1)).optional(),
  /** Hidden visual columns in grouped views. This never changes groupBy
   *  or aggregations; it only suppresses rendered columns. */
  hiddenGroupedColumns: z.array(z.string().min(1)).optional(),
  /** Hard cap on returned rows. Applied after filter+sort, before
   *  pagination. nextCursor becomes null once it would advance past
   *  the cap. */
  limit: z.number().int().min(1).max(10_000).optional(),
  /** When true, soft-deleted records are included in the result. */
  includeDeleted: z.boolean().optional(),
  /** Trash-mode query: only soft-deleted records are returned. */
  deletedOnly: z.boolean().optional(),
});
export type RecordQuery = z.infer<typeof RecordQuerySchema>;

/** Body for POST /tables/:id/query.
 *
 * `source` is the canonical GQL read shape for the records surface. `query`
 * remains accepted while the existing toolbar builder still emits structured
 * patches for UI-only cases that do not have GQL syntax yet.
 */
export const TableQueryBodySchema = z
  .object({
    source: z.string().trim().min(1).max(20_000).optional(),
    query: RecordQuerySchema.optional(),
    viewId: z.string().uuid().optional(),
    cursor: z.string().optional(),
    filePreviewFieldIds: z.array(z.string().uuid()).max(3).optional(),
  })
  .refine((body) => body.source !== undefined || body.query !== undefined, { message: "source or query is required" });

export const ExportRelationModeSchema = z.enum(["ids", "labels", "fields"]);
export type ExportRelationMode = z.infer<typeof ExportRelationModeSchema>;

export const ExportFieldSpecSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().trim().min(1).max(120).optional(),
  relation: z
    .object({
      mode: ExportRelationModeSchema,
      fieldIds: z.array(z.string().uuid()).max(20).optional(),
    })
    .optional(),
});
export type ExportFieldSpec = z.infer<typeof ExportFieldSpecSchema>;

export const ExportBodySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  query: RecordQuerySchema.optional().default({}),
  fields: z.array(ExportFieldSpecSchema).max(200).optional(),
  csv: z
    .object({
      delimiter: z.enum([",", ";", "\t", "|"]).default(","),
    })
    .optional()
    .default({ delimiter: "," }),
  markdown: z.enum(["raw", "html"]).default("raw"),
});
export type ExportBody = z.infer<typeof ExportBodySchema>;

/**
 * Discriminated response envelope. Fields are populated based on what
 * the RecordQuery asked for (see comment block above).
 */
export const TableQueryResponseSchema = z.object({
  items: z.array(GridRecordSchema).optional(),
  aggregates: z.record(z.string(), z.unknown()).optional(),
  buckets: z.array(GroupBucketSchema).optional(),
  nextCursor: z.string().nullable(),
  /** Group-mode flag (only set when groupBy is non-empty). */
  explode: z.boolean().optional(),
  /** UUID → presentable label for relation-typed bucket keys (group
   *  mode) or relation-cell values (list mode). The UI reads this map
   *  before falling back to UUID-prefix or "—" so a grouped relation
   *  column doesn't show raw ids the way it would without a label
   *  resolver step on the response side. */
  relationLabels: z.record(z.string(), z.string()).optional(),
  /** recordId → fieldId → first image file metadata for card covers. */
  filePreviews: z
    .record(
      z.string().uuid(),
      z.record(
        z.string().uuid(),
        z.object({
          fileId: z.string().uuid(),
          fieldId: z.string().uuid(),
          recordId: z.string().uuid(),
          filename: z.string(),
          mimeType: z.string(),
          sizeBytes: z.number().int(),
        }),
      ),
    )
    .optional(),
});
export type TableQueryBody = z.infer<typeof TableQueryBodySchema>;
export type TableQueryResult = z.infer<typeof TableQueryResponseSchema>;

// ── GQL preview / execution ──────────────────────────────────────────────
//
// Generic tabular response for the query workspace. This is intentionally
// not GridRecord-shaped: GQL can select aliases, formula columns,
// joined fields, or grouped buckets that do not map to one editable record.

const DslQueryCurrentSourceSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("table"), tableId: z.string().uuid() }),
    z.object({ kind: z.literal("view"), viewId: z.string().uuid() }),
  ])
  .optional();

export const DslQueryPreviewBodySchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  /** Optional table scope for table/view pages where `from` is implicit. */
  currentTableId: z.string().uuid().optional(),
  currentSource: DslQueryCurrentSourceSchema,
  limit: z.number().int().min(1).max(500).optional(),
});
export type DslQueryPreviewBody = z.infer<typeof DslQueryPreviewBodySchema>;

export const DslQueryExecuteBodySchema = DslQueryPreviewBodySchema.extend({
  limit: z.number().int().min(1).max(10_000).optional(),
  cursor: z.string().optional(),
  filePreviewFieldIds: z.array(z.string().uuid()).max(3).optional(),
});
export type DslQueryExecuteBody = z.infer<typeof DslQueryExecuteBodySchema>;

export const DslQueryCompileViewBodySchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  /** Optional table scope for table/view pages where `from` is implicit. */
  currentTableId: z.string().uuid().optional(),
  currentSource: DslQueryCurrentSourceSchema,
});
export type DslQueryCompileViewBody = z.infer<typeof DslQueryCompileViewBodySchema>;

const DslQueryAutocompleteBaseBodySchema = z.object({
  query: z.string().max(20_000),
  /** UTF-16 offset in `query`; defaults to the end of the text. */
  caret: z.number().int().min(0).max(20_000).optional(),
  /** Optional table scope for table/view pages where `from` is implicit. */
  currentTableId: z.string().uuid().optional(),
  currentSource: DslQueryCurrentSourceSchema,
});

export const DslQueryAutocompleteBodySchema = DslQueryAutocompleteBaseBodySchema.refine(
  (body) => body.caret === undefined || body.caret <= body.query.length,
  { message: "caret must be inside query", path: ["caret"] },
);
export type DslQueryAutocompleteBody = z.infer<typeof DslQueryAutocompleteBodySchema>;

export const DslQueryPreviewDiagnosticSchema = z.object({
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  length: z.number().int().min(1).optional(),
  message: z.string(),
});
export type DslQueryPreviewDiagnostic = z.infer<typeof DslQueryPreviewDiagnosticSchema>;

export const DslQueryPreviewColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  tableId: z.string().uuid().optional(),
  fieldId: z.string().uuid().optional(),
  joinAlias: z.string().optional(),
  type: z.string(),
  sqlType: z.string(),
});
export type DslQueryPreviewColumn = z.infer<typeof DslQueryPreviewColumnSchema>;

export const DslQueryPreviewSuccessSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["rows", "groups"]),
  columns: z.array(DslQueryPreviewColumnSchema),
  rows: z.array(
    z.object({
      recordId: z.string().uuid().optional(),
      tableId: z.string().uuid().optional(),
      values: z.record(z.string(), z.unknown()),
    }),
  ),
  limit: z.number().int(),
  truncated: z.boolean().optional(),
  /** Grouped result where one record can contribute to several buckets
   *  (multi-select / relation group keys). Bucket counts can exceed the
   *  record count; the UI should label this. */
  explode: z.boolean().optional(),
});

export const DslQueryPreviewFailureSchema = z.object({
  ok: z.literal(false),
  diagnostics: z.array(DslQueryPreviewDiagnosticSchema),
});

export const DslQueryPreviewResponseSchema = z.union([DslQueryPreviewSuccessSchema, DslQueryPreviewFailureSchema]);
export type DslQueryPreviewResponse = z.infer<typeof DslQueryPreviewResponseSchema>;
export const DslQueryExecuteResponseSchema = DslQueryPreviewResponseSchema;
export type DslQueryExecuteResponse = z.infer<typeof DslQueryExecuteResponseSchema>;

export const DslQueryCompletionKindSchema = z.enum(["keyword", "source", "field", "column", "alias", "function", "modifier", "literal"]);
export type DslQueryCompletionKind = z.infer<typeof DslQueryCompletionKindSchema>;

export const DslQueryTextRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});
export type DslQueryTextRange = z.infer<typeof DslQueryTextRangeSchema>;

export const DslQueryCompletionTextEditSchema = DslQueryTextRangeSchema.extend({
  text: z.string(),
});
export type DslQueryCompletionTextEdit = z.infer<typeof DslQueryCompletionTextEditSchema>;

export const DslQueryCompletionItemSchema = z.object({
  label: z.string(),
  kind: DslQueryCompletionKindSchema,
  detail: z.string().optional(),
  insertText: z.string(),
  textEdit: DslQueryCompletionTextEditSchema,
  commitCharacters: z.array(z.string()).optional(),
});
export type DslQueryCompletionItem = z.infer<typeof DslQueryCompletionItemSchema>;

export const DslQueryAutocompleteResponseSchema = z.object({
  ok: z.literal(true),
  diagnostics: z.array(DslQueryPreviewDiagnosticSchema),
  items: z.array(DslQueryCompletionItemSchema),
});
export type DslQueryAutocompleteResponse = z.infer<typeof DslQueryAutocompleteResponseSchema>;

export const DslQueryCompileViewSuccessSchema = z.object({
  ok: z.literal(true),
  tableId: z.string().uuid(),
  source: z.string().trim().min(1).max(20_000),
});
export const DslQueryCompileViewResponseSchema = z.union([DslQueryCompileViewSuccessSchema, DslQueryPreviewFailureSchema]);
export type DslQueryCompileViewResponse = z.infer<typeof DslQueryCompileViewResponseSchema>;

// ── View entity ───────────────────────────────────────────────────────────
export const ViewUiSettingsSchema = z.object({
  displayConfig: RecordDisplayConfigSchema.optional(),
  columns: z.array(ColumnSpecSchema).optional(),
  groupedColumnOrder: z.array(z.string().min(1)).optional(),
  hiddenGroupedColumns: z.array(z.string().min(1)).optional(),
});
export type ViewUiSettings = z.infer<typeof ViewUiSettingsSchema>;

export const ViewSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  tableId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: IconNameSchema,
  /** Canonical data query for this view. */
  source: z.string().trim().min(1).max(20_000),
  /** View-owned presentation settings. Data semantics live in `source`. */
  ui: ViewUiSettingsSchema,
  /** null = shared (visible to all table-readers); else owner's user id. */
  ownerUserId: z.string().uuid().nullable(),
  position: z.number().int(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type View = z.infer<typeof ViewSchema>;

export const CreateViewSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).nullable().optional(),
  icon: IconNameSchema,
  source: z.string().trim().min(1).max(20_000).optional(),
  ui: ViewUiSettingsSchema.optional(),
  shared: z.boolean().optional(),
});
export type CreateViewInput = z.infer<typeof CreateViewSchema>;

export const UpdateViewSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  icon: IconNameSchema,
  source: z.string().trim().min(1).max(20_000).optional(),
  ui: ViewUiSettingsSchema.optional(),
  position: z.number().int().optional(),
  shared: z.boolean().optional(),
});
export type UpdateViewInput = z.infer<typeof UpdateViewSchema>;

export const ViewListSchema = z.array(ViewSchema);

// ── Documents ─────────────────────────────────────────────────────────────
export const DocumentTemplateSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  tableId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.string().trim().min(1).max(20_000),
  html: z.string().trim().min(1).max(200_000),
  headerHtml: z.string().trim().max(50_000).nullable(),
  footerHtml: z.string().trim().max(50_000).nullable(),
  pageCss: z.string().trim().max(50_000).nullable(),
  enabled: z.boolean(),
  position: z.number().int(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;

export const DocumentTemplateListSchema = z.array(DocumentTemplateSchema);

export const CreateDocumentTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).nullable().optional(),
  source: z.string().trim().min(1).max(20_000),
  html: z.string().trim().min(1).max(200_000),
  headerHtml: z.string().trim().max(50_000).nullable().optional(),
  footerHtml: z.string().trim().max(50_000).nullable().optional(),
  pageCss: z.string().trim().max(50_000).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type CreateDocumentTemplateInput = z.infer<typeof CreateDocumentTemplateSchema>;

export const UpdateDocumentTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  source: z.string().trim().min(1).max(20_000).optional(),
  html: z.string().trim().min(1).max(200_000).optional(),
  headerHtml: z.string().trim().max(50_000).nullable().optional(),
  footerHtml: z.string().trim().max(50_000).nullable().optional(),
  pageCss: z.string().trim().max(50_000).nullable().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().optional(),
});
export type UpdateDocumentTemplateInput = z.infer<typeof UpdateDocumentTemplateSchema>;

export const DocumentTemplateDraftPreviewSchema = z.object({
  source: z.string().trim().min(1).max(20_000),
  html: z.string().trim().min(1).max(200_000),
  headerHtml: z.string().trim().max(50_000).nullable().optional(),
  footerHtml: z.string().trim().max(50_000).nullable().optional(),
  pageCss: z.string().trim().max(50_000).nullable().optional(),
  recordId: z.string().uuid(),
});
export type DocumentTemplateDraftPreviewInput = z.infer<typeof DocumentTemplateDraftPreviewSchema>;

export const RecordSnapshotSchema = z.object({
  id: z.string().uuid(),
  baseId: z.string().uuid(),
  tableId: z.string().uuid(),
  recordId: z.string().uuid(),
  root: z.record(z.string(), z.unknown()),
  graph: z.record(z.string(), z.unknown()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type RecordSnapshot = z.infer<typeof RecordSnapshotSchema>;

export const RecordSnapshotSummarySchema = RecordSnapshotSchema.pick({
  id: true,
  baseId: true,
  tableId: true,
  recordId: true,
  createdBy: true,
  createdAt: true,
});
export type RecordSnapshotSummary = z.infer<typeof RecordSnapshotSummarySchema>;

export const RecordSnapshotListResponseSchema = z.object({
  items: z.array(RecordSnapshotSummarySchema),
});
export type RecordSnapshotListResponse = z.infer<typeof RecordSnapshotListResponseSchema>;

export const DocumentRunSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  templateId: z.string().uuid().nullable(),
  snapshotId: z.string().uuid(),
  baseId: z.string().uuid(),
  tableId: z.string().uuid(),
  recordId: z.string().uuid(),
  documentNumber: z.string(),
  templateSnapshot: z.record(z.string(), z.unknown()),
  renderData: z.record(z.string(), z.unknown()),
  generatedBy: z.string().uuid().nullable(),
  generatedAt: z.string().datetime(),
});
export type DocumentRun = z.infer<typeof DocumentRunSchema>;

export const DocumentRunListSchema = z.object({
  items: z.array(DocumentRunSchema),
});
export type DocumentRunList = z.infer<typeof DocumentRunListSchema>;

export const DocumentRecordBodySchema = z.object({
  recordId: z.string().uuid(),
});
export type DocumentRecordBody = z.infer<typeof DocumentRecordBodySchema>;

export const DocumentPreviewResponseSchema = z.object({
  html: z.string(),
  source: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type DocumentPreviewResponse = z.infer<typeof DocumentPreviewResponseSchema>;

export const CreateRecordSnapshotResponseSchema = z.object({
  snapshot: RecordSnapshotSchema,
});
export type CreateRecordSnapshotResponse = z.infer<typeof CreateRecordSnapshotResponseSchema>;

// ── Forms ────────────────────────────────────────────────────────────────
//
// Stored form config is JSONB. Keep the write contract here so API and
// service boundaries validate the same shape before anything reaches DB.
export const InlineCreateFormFieldSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
});

export const InlineCreateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  fields: z.array(InlineCreateFormFieldSchema).optional(),
});

export const UserInputFormFieldEntrySchema = z.object({
  kind: z.literal("user_input"),
  fieldId: z.string().uuid(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  inlineCreate: InlineCreateConfigSchema.optional(),
});

export const FormValueFieldEntrySchema = z.object({
  kind: z.literal("form_value"),
  fieldId: z.string().uuid(),
  value: z.unknown(),
});

export const FormFieldEntrySchema = z.discriminatedUnion("kind", [UserInputFormFieldEntrySchema, FormValueFieldEntrySchema]);
export type FormFieldEntry = z.infer<typeof FormFieldEntrySchema>;

export const FormConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldEntrySchema),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  redirectUrl: z.string().nullable().optional(),
  // Optional title image (base64 data-URL). Frontend caps source
  // dimensions before emitting; the server still enforces a hard cap.
  titleImage: z.string().max(1_000_000).optional(),
});
export type FormConfig = z.infer<typeof FormConfigSchema>;

// ── Dashboards ────────────────────────────────────────────────────────────
//
// A dashboard is a per-base composition of widgets that pull data from
// any table in the base. Widget kinds:
//
//   - "stat"  : single number from a saved View's GQL result — e.g.
//               "1,247 orders this month". The view owns the query.
//   - "chart" : multi-bucket data from a grouped saved View.
//   - "view"  : embedded saved View — mounts records from a fixed
//               view id with pagesize 25.
//   - "view-stats": derives compact stat cells from a saved View.
//   - "form"  : embeds a saved Form for inline record creation.
//   - "automation-button": runs one manual Automation from a button.
//
// Dashboard widgets do not carry filter/sort/aggregate semantics.
// Query semantics live in saved Views (`view.source` GQL); widgets are
// only "view reference + presentation hint".
//
// Layout: `rows × cells` on a 12-column grid. Each widget owns a
// `span` (1..12), so editors can make a chart wider than a stat
// without introducing a freeform pixel canvas.

/** Format hint for stat-card rendering. `plain` = the number as-is,
 *  `currency` / `percent` use existing format-cell helpers, `integer`
 *  forces no decimals (e.g. for counts). The chart-render layer will
 *  consume the same enum so axis ticks format consistently. */
export const WidgetFormatSchema = z.enum(["plain", "currency", "percent", "integer"]);
export type WidgetFormat = z.infer<typeof WidgetFormatSchema>;

export const StatToneSchema = z.enum(["neutral", "blue", "green", "amber", "red"]);
export type StatTone = z.infer<typeof StatToneSchema>;

/**
 * Optional trend view attached to a stat widget. The trend view must
 * be a saved grouped GQL query; the first aggregate column of each
 * bucket becomes the sparkline value. This keeps dashboard config free
 * of table/filter/aggregate semantics.
 */
export const StatTrendSchema = z.object({
  viewId: z.string().uuid(),
  windowSize: z.number().int().min(2).max(60).default(12),
});
export type StatTrend = z.infer<typeof StatTrendSchema>;

// Per-kind widget schemas. `id` is client-generated so DnD can track
// widgets across reorders without server round-trips. `span` is the
// widget's width in the dashboard's 12-column layout; when omitted,
// the renderer falls back to equal-width cells for older configs.
export const StatWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("stat"),
  span: z.number().int().min(1).max(12).optional(),
  title: z.string().max(200).optional(),
  /** Saved view that supplies the scalar value. The first aggregate
   *  column from its GQL result is rendered. */
  viewId: z.string().uuid(),
  /** Optional inline trend — see {@link StatTrendSchema}. */
  trend: StatTrendSchema.optional(),
  icon: z.string().max(60).optional(),
  format: WidgetFormatSchema.optional(),
  /** Pure presentation hint for the value colour. No KPI semantics. */
  tone: StatToneSchema.optional(),
  /** Optional small-text sub-line under the value. Mirrors the
   *  ui-lab "Small grid only" reference (`9·12 admin`, `last 24h`,
   *  `providers`). Plain text only, no icons. */
  sub: z.string().max(60).optional(),
});

/**
 * Chart widget — visualizes a saved view's bucketed output as a
 * donut, bar, line, sparkline, or scatter SVG via the `<Chart>` primitive from
 * `cloud/ui`.
 *
 * **Source: a viewId.** The view supplies the filter, sort, groupBy
 * (with optional granularity), and aggregations. The widget just
 * says HOW to render. This mirrors the symmetry with `view-stats`
 * cells (also viewId-based) and means a single configured view —
 * "Orders per month" — can be reused as a stat strip, a chart, and
 * an embedded table without duplicating its query.
 *
 * **chartType → expected view shape:**
 *  - `donut`/`bar`: view with 1 groupBy + ≥1 aggregation (first wins).
 *  - `line`:        view with 1 groupBy + N aggregations (one series each).
 *  - `sparkline`:   view with 1 groupBy + ≥1 aggregation (first wins).
 *  - `scatter`:     view with 1 groupBy + ≥2 aggregations (agg1=x, agg2=y).
 *
 * **`limit`** caps the most-recent N buckets — handy when a view holds
 * a long history but the chart should only show e.g. "last 12 months".
 * Applied after the view's own filter/sort, so it's a renderer trim,
 * not a query change.
 */
export const ChartWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("chart"),
  span: z.number().int().min(1).max(12).optional(),
  title: z.string().max(200).optional(),
  /** Small grey line under the title in the chart frame. */
  subtitle: z.string().max(200).optional(),
  chartType: z.enum(["donut", "bar", "line", "sparkline", "scatter"]),
  /** Saved view that supplies the buckets (filter / groupBy / aggs). */
  viewId: z.string().uuid(),
  /** Optional cap on bucket count — keeps the most-recent N. */
  limit: z.number().int().min(1).max(1000).optional(),
  /** Y-axis / value format. Defaults inferred from the primary aggregation. */
  format: WidgetFormatSchema.optional(),
  /** Optional axis labels — passed through to the chart renderer. */
  xAxisLabel: z.string().max(60).optional(),
  yAxisLabel: z.string().max(60).optional(),
});

/**
 * View-stats widget — derives a tiny 2×N stat-grid from a saved view's
 * first row (ungrouped) or first bucket (grouped). Same auto-derivation
 * as the deprecated view-stats row type, but now lives as a CELL inside
 * a unified row, so it can sit next to other cell kinds in a single
 * horizontal strip.
 *
 * Internal layout: when the cell renders, the auto-derived stats are
 * arranged as a 2-column hairline grid within the cell's paper slot.
 * Width comes from the widget's optional 12-column span; height fits
 * the row slot.
 */
export const ViewStatsWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("view-stats"),
  span: z.number().int().min(1).max(12).optional(),
  viewId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

/**
 * Form widget — embeds a form for inline data entry on the dashboard.
 * The form's submit POSTs through the existing form-submission path
 * and invalidates the dashboard so every other widget re-resolves
 * with the freshly written record. No optimistic widget math in v1:
 * SQL remains the source of truth for stats, charts, and views.
 *
 * Permission: when the viewer can't submit the form, the cell renders
 * a dimmed "no access" placeholder so the dashboard layout stays
 * stable across users with different permission sets.
 */
export const FormWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("form"),
  span: z.number().int().min(1).max(12).optional(),
  formId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

/**
 * Markdown widget — static dashboard content for instructions,
 * explanations, checklists, or lightweight documentation.
 */
export const MarkdownWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("markdown"),
  span: z.number().int().min(1).max(12).optional(),
  title: z.string().max(200).optional(),
  markdown: z.string().max(20_000).default(""),
});

export const LinkWidgetTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard"), dashboardId: z.string().uuid() }),
  z.object({ kind: z.literal("table"), tableId: z.string().uuid() }),
  z.object({ kind: z.literal("view"), viewId: z.string().uuid() }),
  z.object({ kind: z.literal("form"), formId: z.string().uuid() }),
  z.object({ kind: z.literal("url"), url: z.string().trim().url().max(2000) }),
]);
export type LinkWidgetTarget = z.infer<typeof LinkWidgetTargetSchema>;

export const LinkWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("link"),
  span: z.number().int().min(1).max(12).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  icon: z.string().max(200).optional(),
  target: LinkWidgetTargetSchema,
});

/**
 * Automation button widget — explicit dashboard-scoped capability to
 * trigger one manual automation. Dashboard readers may press this
 * button, but this does not grant general automation list/edit/run
 * access. The backend re-checks the saved dashboard config before each
 * run.
 */
export const AutomationButtonWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("automation-button"),
  span: z.number().int().min(1).max(12).optional(),
  automationId: z.string().uuid(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  buttonLabel: z.string().max(80).optional(),
});

export const ViewWidgetSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("view"),
  span: z.number().int().min(1).max(12).optional(),
  viewId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

export const WidgetSchema = z.discriminatedUnion("kind", [
  StatWidgetSchema,
  ChartWidgetSchema,
  ViewWidgetSchema,
  ViewStatsWidgetSchema,
  FormWidgetSchema,
  MarkdownWidgetSchema,
  LinkWidgetSchema,
  AutomationButtonWidgetSchema,
]);
export type Widget = z.infer<typeof WidgetSchema>;
export type StatWidget = z.infer<typeof StatWidgetSchema>;
export type ChartWidget = z.infer<typeof ChartWidgetSchema>;
export type ViewWidget = z.infer<typeof ViewWidgetSchema>;
export type ViewStatsWidget = z.infer<typeof ViewStatsWidgetSchema>;
export type FormWidget = z.infer<typeof FormWidgetSchema>;
export type MarkdownWidget = z.infer<typeof MarkdownWidgetSchema>;
export type LinkWidget = z.infer<typeof LinkWidgetSchema>;
export type AutomationButtonWidget = z.infer<typeof AutomationButtonWidgetSchema>;

// Unified row — one type with any mix of cell kinds. Replaces the
// previous three-row-type discriminated union (stats / view-stats /
// widgets) that forced a user to pick a row type up-front.
//
// Layout rules (applied by the renderer, not the schema):
//
//   - All cells of kind="stat" → render the row as one paper with
//     hairline dividers between cells (the dense ui-lab "small grid"
//     pattern). Stats belong together visually.
//   - Anything else (mixed, or pure view/chart/view-stats/form) →
//     each cell renders as its own paper-card; the row's `height`
//     tier dictates the slot height; cells stretch to fill.
//   - view-stats cells render as an internal 2-column hairline grid
//     within their single paper slot.
//   - Form cells render the form; viewer without submit perm sees a
//     dimmed "no access" placeholder.
//
// A row may be empty while editing so it can act as a drop target.
// Read-only rendering skips empty rows.
export const DashboardRowSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("row"),
  height: z.enum(["sm", "md", "lg"]),
  cells: z.array(WidgetSchema).max(12),
});
export type DashboardRow = z.infer<typeof DashboardRowSchema>;

export const DashboardConfigSchema = z.object({
  rows: z.array(DashboardRowSchema),
});
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

// Dashboard entity — same row shape as views, scoped per-base.
export const DashboardSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  baseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: IconNameSchema,
  config: DashboardConfigSchema,
  /** null = shared (visible to anyone with base-read); else owner's
   *  user id. Same model as views. */
  ownerUserId: z.string().uuid().nullable(),
  position: z.number().int(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const CreateDashboardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  icon: IconNameSchema,
  config: DashboardConfigSchema.optional(),
  shared: z.boolean().optional(),
});
export type CreateDashboardInput = z.infer<typeof CreateDashboardSchema>;

export const UpdateDashboardSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  icon: IconNameSchema,
  config: DashboardConfigSchema.optional(),
  position: z.number().int().optional(),
  shared: z.boolean().optional(),
});
export type UpdateDashboardInput = z.infer<typeof UpdateDashboardSchema>;

export const DashboardListSchema = z.array(DashboardSchema);

// ── Automations ───────────────────────────────────────────────────────────
const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use http or https");

export const AutomationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
  }),
  z.object({
    kind: z.literal("schedule"),
    cron: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    kind: z.literal("record"),
    event: z.enum(["created", "updated", "deleted"]),
    tableId: z.string().uuid().optional(),
    filter: FilterTreeSchema.optional(),
  }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

export const AutomationActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("webhook"),
    url: HttpUrlSchema,
    timeoutMs: z.number().int().min(1000).max(60_000).optional(),
  }),
  z.object({
    kind: z.literal("document"),
    templateId: z.string().uuid(),
  }),
]);
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

export const AutomationPayloadConfigSchema = z.object({
  includeRecord: z.boolean().optional(),
  fieldIds: z.array(z.string().uuid()).max(200).optional(),
});
export type AutomationPayloadConfig = z.infer<typeof AutomationPayloadConfigSchema>;

export const AutomationSchema = z.object({
  id: z.string().uuid(),
  shortId: ShortIdSchema,
  baseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  payload: AutomationPayloadConfigSchema,
  enabled: z.boolean(),
  position: z.number().int().min(0),
  ownerUserId: z.string().uuid().nullable(),
  webhookSecretSet: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  payload: AutomationPayloadConfigSchema.optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  // Plaintext by design: the executor needs the original value for HMAC signing.
  webhookSecret: z.string().min(8).max(512).nullable().optional(),
});
export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;

export const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  trigger: AutomationTriggerSchema.optional(),
  action: AutomationActionSchema.optional(),
  payload: AutomationPayloadConfigSchema.optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  webhookSecret: z.string().min(8).max(512).nullable().optional(),
});
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;

export const AutomationSubjectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("base"),
  }),
  z.object({
    type: z.literal("record"),
    tableId: z.string().uuid(),
    recordId: z.string().uuid(),
  }),
]);
export type AutomationSubject = z.infer<typeof AutomationSubjectSchema>;

export const RunAutomationSchema = z.object({
  input: z.unknown().nullable().optional(),
  subject: AutomationSubjectSchema.optional(),
  reason: z.string().trim().min(1).max(120).optional(),
});
export type RunAutomationInput = z.infer<typeof RunAutomationSchema>;

export const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  baseId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  recordId: z.string().uuid().nullable(),
  event: z.string(),
  trigger: z.record(z.string(), z.unknown()),
  subject: AutomationSubjectSchema,
  input: z.unknown().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  targetHost: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const AutomationListSchema = z.array(AutomationSchema);
export const AutomationRunListSchema = z.object({
  items: z.array(AutomationRunSchema),
});

// ── Audit ─────────────────────────────────────────────────────────────────
export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  baseId: z.string().uuid().nullable(),
  tableId: z.string().uuid().nullable(),
  recordId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  action: z.enum([
    "created",
    "updated",
    "deleted",
    "restored",
    "imported",
    "automation.webhook.sent",
    "automation.webhook.failed",
    "automation.document.generated",
    "automation.document.failed",
  ]),
  diff: z.record(z.string(), z.object({ old: z.unknown(), new: z.unknown() })).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ── Lists ─────────────────────────────────────────────────────────────────
export const BaseListSchema = z.object({
  items: z.array(BaseSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export const TableListSchema = z.array(TableSchema);
export const FieldListSchema = z.array(FieldSchema);

// ── Field-dependents preflight ────────────────────────────────────────────
export const FieldDependentSchema = z.object({
  type: z.enum(["view", "form", "formula", "lookup", "rollup", "relation_display"]),
  resourceId: z.string().uuid(),
  resourceName: z.string(),
  context: z.string().optional(),
  blocking: z.boolean(),
});
export const FieldDependentsResponseSchema = z.object({
  dependents: z.array(FieldDependentSchema),
  hasBlocking: z.boolean(),
});

// ── Relation lookup ───────────────────────────────────────────────────────
// Backs `GET /api/grids/tables/:tableId/lookup` — the search endpoint
// the RelationPicker uses to populate its dropdown. Each item is a
// pre-formatted label so the client doesn't need to know about
// `presentable` field rules.
export const RelationLookupItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
});
export const RelationLookupResponseSchema = z.object({
  items: z.array(RelationLookupItemSchema),
});
export type RelationLookupItem = z.infer<typeof RelationLookupItemSchema>;
export type RelationLookupResponse = z.infer<typeof RelationLookupResponseSchema>;

// ── ACL ───────────────────────────────────────────────────────────────────
export {
  AccessEntrySchema,
  GrantAccessSchema,
  PermissionLevelSchema,
  PrincipalSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
