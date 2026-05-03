import { z } from "zod";

export {
  PaginationQuerySchema,
  PaginationResponseSchema,
  ErrorResponseSchema,
  parsePagination,
  createPagination,
} from "@valentinkolb/cloud/contracts";

// ── Base ──────────────────────────────────────────────────────────────────
export const BaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Base = z.infer<typeof BaseSchema>;

export const CreateBaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});
export type CreateBaseInput = z.infer<typeof CreateBaseSchema>;

export const UpdateBaseSchema = CreateBaseSchema.partial();
export type UpdateBaseInput = z.infer<typeof UpdateBaseSchema>;

// ── Table ─────────────────────────────────────────────────────────────────
export const TableSchema = z.object({
  id: z.string().uuid(),
  baseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  primaryFieldId: z.string().uuid().nullable(),
  position: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Table = z.infer<typeof TableSchema>;

export const CreateTableSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});

export const UpdateTableSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  primaryFieldId: z.string().uuid().nullable().optional(),
});

// ── Field ─────────────────────────────────────────────────────────────────
export const FieldSchema = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
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
const StringBoolSchema = z.preprocess(
  (v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v),
  z.boolean(),
);

// Filter and sort arrive as URL-encoded JSON strings; the schema parses
// the JSON before validating its shape.
const JsonStringSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    },
    inner,
  );

const FilterLeafSchema = z.object({
  fieldId: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
  caseInsensitive: z.boolean().optional(),
});

export type FilterTree =
  | z.infer<typeof FilterLeafSchema>
  | { op: "AND" | "OR"; filters: FilterTree[] };

export const FilterTreeSchema: z.ZodType<FilterTree> = z.lazy(() =>
  z.union([
    FilterLeafSchema,
    z.object({
      op: z.enum(["AND", "OR"]),
      filters: z.array(FilterTreeSchema),
    }),
  ]),
);

export const SortSpecSchema = z.object({
  fieldId: z.string(),
  direction: z.enum(["asc", "desc"]),
  nullsFirst: z.boolean().optional(),
});

export const RecordListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  includeDeleted: StringBoolSchema.optional(),
  filter: JsonStringSchema(FilterTreeSchema).optional(),
  sort: JsonStringSchema(z.array(SortSpecSchema)).optional(),
});

export const AggregateKindSchema = z.enum([
  "count", "countEmpty", "countUnique",
  "sum", "avg", "min", "max", "median",
  "earliest", "latest",
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
  // Cursor is now a JSON-encoded {sortValues, id} token, not a bare uuid.
  nextCursor: z.string().nullable(),
});

// ── Audit ─────────────────────────────────────────────────────────────────
export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  baseId: z.string().uuid().nullable(),
  tableId: z.string().uuid().nullable(),
  recordId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  action: z.enum(["created", "updated", "deleted", "restored", "imported"]),
  diff: z.record(z.string(), z.object({ old: z.unknown(), new: z.unknown() })).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ── Lists ─────────────────────────────────────────────────────────────────
export const BaseListSchema = z.array(BaseSchema);
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

// ── ACL ───────────────────────────────────────────────────────────────────
export {
  PrincipalSchema,
  PermissionLevelSchema,
  AccessEntrySchema,
  GrantAccessSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
