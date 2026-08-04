import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });
const CursorSchema = z.string().min(1).max(16_384).optional().describe("Opaque cursor returned by the previous page.");
const PageLimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of items to return.");

export const BaseCapabilityDataSchema = z
  .object({
    id: z.uuid(),
    shortId: z.string().min(1).max(6),
    name: z.string().min(1).max(200),
    description: z.string().max(1_000).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const BaseListDataSchema = z.array(BaseCapabilityDataSchema).max(100);

export const BaseListInputSchema = z
  .object({
    query: z.string().trim().max(500).optional().describe("Optional Base name, description, or short-ID search."),
    cursor: CursorSchema,
    limit: PageLimitSchema,
  })
  .strict();

export const BaseGetInputSchema = z.object({ baseId: z.uuid().describe("Stable readable Base UUID.") }).strict();

const ContextKindSchema = z.enum(["tables", "views", "fields", "options"]);
const GridsPermissionSchema = z.enum(["read", "write", "admin"]);

const TableContextItemSchema = z
  .object({
    kind: z.literal("table"),
    id: z.uuid(),
    shortId: z.string().min(1).max(6),
    baseId: z.uuid(),
    tableKind: z.enum(["stored", "federated"]),
    name: z.string().min(1).max(200),
    description: z.string().max(1_000).nullable(),
    icon: z.string().max(200).nullable(),
    permission: GridsPermissionSchema,
    canCreateRecords: z.boolean(),
    canUpdateRecords: z.boolean(),
  })
  .strict();

const ViewContextItemSchema = z
  .object({
    kind: z.literal("view"),
    id: z.uuid(),
    shortId: z.string().min(1).max(6),
    tableId: z.uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    icon: z.string().max(200).nullable(),
  })
  .strict();

const FieldContextItemSchema = z
  .object({
    kind: z.literal("field"),
    id: z.uuid(),
    shortId: z.string().min(1).max(6),
    tableId: z.uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    type: z.string().min(1).max(100),
    position: z.number().int(),
    required: z.boolean(),
    writable: z.boolean(),
    valueHint: z.string().min(1).max(500).nullable(),
    targetTableId: z.uuid().nullable(),
    relationCardinality: z.enum(["single", "multiple"]).nullable(),
  })
  .strict();

const OptionContextItemSchema = z
  .object({
    kind: z.literal("option"),
    id: z.string().min(1).max(10_000),
    fieldId: z.uuid(),
    label: z.string().min(1).max(500),
    description: z.string().max(1_000).nullable(),
  })
  .strict();

const AuditOptionSchema = z.object({ id: z.uuid(), label: z.string().min(1).max(200) }).strict();
const AuditQuestionBaseSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(200),
  description: z.string().max(1_000).nullable(),
  required: z.boolean(),
});
const AuditQuestionSchema = z.discriminatedUnion("type", [
  AuditQuestionBaseSchema.extend({ type: z.literal("text") }).strict(),
  AuditQuestionBaseSchema.extend({ type: z.literal("longtext") }).strict(),
  AuditQuestionBaseSchema.extend({ type: z.literal("select"), options: z.array(AuditOptionSchema).max(100) }).strict(),
]);
const RecordWriteContextSchema = z
  .object({
    tableId: z.uuid(),
    canCreateRecords: z.boolean(),
    canUpdateRecords: z.boolean(),
    updateAudit: z
      .object({
        scope: z.enum(["all", "selected"]),
        fieldIds: z.array(z.uuid()).max(200),
        questions: z.array(AuditQuestionSchema).max(20),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const GqlContextItemSchema = z.discriminatedUnion("kind", [
  TableContextItemSchema,
  ViewContextItemSchema,
  FieldContextItemSchema,
  OptionContextItemSchema,
]);

export const GqlContextDataSchema = z
  .object({
    base: BaseCapabilityDataSchema,
    kind: ContextKindSchema,
    items: z.array(GqlContextItemSchema).max(100),
    recordWrite: RecordWriteContextSchema.nullable(),
  })
  .strict();

export const GqlContextInputSchema = z
  .object({
    baseId: z.uuid().describe("Readable Base whose permission-shaped GQL context should be loaded."),
    kind: ContextKindSchema.default("tables").describe("Catalog section: tables, views, fields, or exact select option IDs."),
    tableId: z.uuid().optional().describe("Readable Table UUID; required for fields and options, optional for views."),
    fieldId: z.uuid().optional().describe("Readable Select Field UUID; required when kind is options."),
    cursor: CursorSchema,
    limit: PageLimitSchema,
  })
  .strict();

const CurrentSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("table").describe("Select a Table as the current source."),
      tableId: z.uuid().describe("Readable current Table UUID."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("view").describe("Select a View as the current source."),
      viewId: z.uuid().describe("Readable current View UUID."),
    })
    .strict(),
]);

const GqlInputShape = {
  baseId: z.uuid().describe("Readable Base in which the GQL source is resolved."),
  query: z.string().trim().min(1).max(20_000).describe("Grids Query Language source to execute."),
  currentTableId: z.uuid().optional().describe("Optional readable Table used when the source omits an explicit from clause."),
  currentSource: CurrentSourceSchema.optional().describe("Optional current Table or View source used when GQL omits from."),
  cursor: CursorSchema,
};

export const GqlPreviewInputSchema = z
  .object({
    ...GqlInputShape,
    pageSize: z.number().int().min(1).max(25).default(25).describe("Maximum preview rows to return."),
  })
  .strict();

export const GqlExecuteInputSchema = z
  .object({
    ...GqlInputShape,
    pageSize: z.number().int().min(1).max(100).default(100).describe("Maximum rows to return on this cursor page."),
    limit: z.number().int().min(1).max(1_000).optional().describe("Optional logical result cap across cursor pages."),
  })
  .strict();

export const GqlViewExecuteInputSchema = z
  .object({
    baseId: z.uuid().describe("Base containing the saved View."),
    viewId: z.uuid().describe("Readable saved View whose exact stored GQL should execute."),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Maximum rows to return on this cursor page."),
    cursor: CursorSchema,
  })
  .strict();

const GqlDiagnosticSchema = z
  .object({
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    length: z.number().int().positive().optional(),
    message: z.string().min(1).max(2_000),
  })
  .strict();

const GqlColumnSchema = z
  .object({
    key: z.string().min(1).max(500),
    label: z.string().max(500),
    tableId: z.uuid().optional(),
    fieldId: z.uuid().optional(),
    joinAlias: z.string().max(500).optional(),
    type: z.string().max(100),
    sqlType: z.string().max(100),
    aggregate: z.string().max(100).optional(),
  })
  .strict();

const RecordMetaSchema = z
  .object({
    version: z.number().int().positive(),
    deletedAt: TimestampSchema.nullable(),
    createdBy: z.uuid().nullable(),
    updatedBy: z.uuid().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

const GqlSuccessSchema = z
  .object({
    ok: z.literal(true),
    mode: z.enum(["rows", "groups"]),
    columns: z.array(GqlColumnSchema).max(100),
    rows: z
      .array(
        z
          .object({
            recordId: z.uuid().optional(),
            tableId: z.uuid().optional(),
            recordMeta: RecordMetaSchema.optional(),
            values: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(100),
    limit: z.number().int().min(1).max(1_000),
    truncated: z.boolean().optional(),
    explode: z.boolean().optional(),
  })
  .strict();

const GqlFailureSchema = z
  .object({
    ok: z.literal(false),
    diagnostics: z.array(GqlDiagnosticSchema).min(1).max(100),
  })
  .strict();

export const GqlResultDataSchema = z.discriminatedUnion("ok", [GqlSuccessSchema, GqlFailureSchema]);

export const RecordCapabilityDataSchema = z
  .object({
    id: z.uuid(),
    tableId: z.uuid(),
    version: z.number().int().positive(),
    deletedAt: TimestampSchema.nullable(),
    createdBy: z.uuid().nullable(),
    updatedBy: z.uuid().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const RecordGetInputSchema = z
  .object({
    tableId: z.uuid().describe("Readable Table containing the record."),
    recordId: z.uuid().describe("Stable live record UUID."),
  })
  .strict();

const RecordValuesSchema = z.record(z.string().uuid(), z.unknown());
const RecordAuditSchema = z
  .object({
    answers: z.record(z.string().uuid(), z.string().max(10_000)).default({}).describe("Audit question UUIDs mapped to their answers."),
  })
  .strict();

export const RecordCreateInputSchema = z
  .object({
    tableId: z.uuid().describe("Writable stored Table that should receive the record."),
    values: RecordValuesSchema.describe("Field UUIDs mapped to explicitly supplied values."),
  })
  .strict();

export const RecordUpdateInputSchema = z
  .object({
    tableId: z.uuid().describe("Writable stored Table containing the record."),
    recordId: z.uuid().describe("Stable live record UUID to update."),
    values: RecordValuesSchema.describe("Field UUIDs mapped to explicitly supplied replacement values."),
    ifVersion: z.number().int().positive().describe("Record version returned by record.get; stale versions are rejected."),
    audit: RecordAuditSchema.optional().describe("Answers required by the Table audit policy, when configured."),
  })
  .strict();
