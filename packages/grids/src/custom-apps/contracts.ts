import { z } from "zod";
import { SHORT_ID_REGEX } from "../service/short-id";

export const CustomAppLocalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "Use a lowercase local id");

const CustomAppParameterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "Use a lowercase parameter id");

const CustomAppRecordParameterSchema = z
  .object({
    type: z.literal("record"),
    tableId: z.string().uuid(),
    required: z.literal(true),
  })
  .strict();

const CustomAppPageRecordSchema = z
  .object({
    tableId: z.string().uuid(),
    id: z.object({ source: z.literal("PARAMS"), path: CustomAppParameterIdSchema }).strict(),
  })
  .strict();

const CustomAppRowNavigationSchema = z
  .object({
    kind: z.literal("navigate"),
    pageId: CustomAppLocalIdSchema,
    history: z.enum(["push", "replace"]).default("push"),
    params: z.record(CustomAppParameterIdSchema, z.object({ source: z.literal("ROW"), path: z.literal("id") }).strict()),
  })
  .strict();

export const CustomAppMarkdownBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("markdown"),
    title: z.string().trim().min(1).max(160).optional(),
    markdown: z.string().max(20_000),
  })
  .strict();

export const CustomAppRecordsBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("records"),
    title: z.string().trim().min(1).max(160).optional(),
    emptyText: z.string().trim().min(1).max(240).optional(),
    source: z.object({ kind: z.literal("view"), viewId: z.string().uuid() }).strict(),
    display: z
      .object({
        kind: z.literal("table"),
        columnIds: z.array(z.string().uuid()).min(1).max(30),
      })
      .strict(),
    rowNavigate: CustomAppRowNavigationSchema.optional(),
  })
  .strict();

export const CustomAppRecordBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("record"),
    title: z.string().trim().min(1).max(160).optional(),
    emptyText: z.string().trim().min(1).max(240).optional(),
    fieldIds: z.array(z.string().uuid()).min(1).max(30),
  })
  .strict();

export const CustomAppBlockSchema = z.discriminatedUnion("type", [
  CustomAppMarkdownBlockSchema,
  CustomAppRecordsBlockSchema,
  CustomAppRecordBlockSchema,
]);

const CustomAppPageSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    title: z.string().trim().min(1).max(200),
    navigation: z
      .object({
        visible: z.boolean().default(true),
        order: z.number().int().min(-1_000).max(1_000).default(0),
      })
      .strict()
      .default({ visible: true, order: 0 }),
    parameters: z.record(CustomAppParameterIdSchema, CustomAppRecordParameterSchema).default({}),
    record: CustomAppPageRecordSchema.optional(),
    rows: z
      .array(
        z
          .object({
            id: CustomAppLocalIdSchema,
            columns: z
              .array(
                z
                  .object({
                    id: CustomAppLocalIdSchema,
                    span: z.number().int().min(1).max(12),
                    blocks: z.array(CustomAppBlockSchema).min(1).max(24),
                  })
                  .strict(),
              )
              .min(1)
              .max(12),
          })
          .strict()
          .superRefine((row, ctx) => {
            if (row.columns.reduce((total, column) => total + column.span, 0) > 12) {
              ctx.addIssue({ code: "custom", message: "Column spans in one row must total at most 12", path: ["columns"] });
            }
          }),
      )
      .min(1)
      .max(24),
  })
  .strict();

export const CustomAppDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("grids.custom-app"),
    id: z.string().uuid(),
    baseId: z.string().uuid(),
    shortId: z.string().regex(SHORT_ID_REGEX).optional(),
    name: z.string().trim().min(1).max(200),
    icon: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "Use a Tabler icon slug")
      .optional(),
    startPageId: CustomAppLocalIdSchema,
    pages: z.array(CustomAppPageSchema).min(1).max(12),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const pageIds = new Set<string>();
    for (const [pageIndex, page] of definition.pages.entries()) {
      if (pageIds.has(page.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate page id "${page.id}"`, path: ["pages", pageIndex, "id"] });
      }
      pageIds.add(page.id);

      const rowIds = new Set<string>();
      const blockIds = new Set<string>();
      for (const [rowIndex, row] of page.rows.entries()) {
        if (rowIds.has(row.id)) {
          ctx.addIssue({ code: "custom", message: `Duplicate row id "${row.id}"`, path: ["pages", pageIndex, "rows", rowIndex, "id"] });
        }
        rowIds.add(row.id);
        const columnIds = new Set<string>();
        for (const [columnIndex, column] of row.columns.entries()) {
          if (columnIds.has(column.id)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate column id "${column.id}"`,
              path: ["pages", pageIndex, "rows", rowIndex, "columns", columnIndex, "id"],
            });
          }
          columnIds.add(column.id);
          for (const [blockIndex, block] of column.blocks.entries()) {
            const blockPath = ["pages", pageIndex, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex] as const;
            if (blockIds.has(block.id)) {
              ctx.addIssue({ code: "custom", message: `Duplicate block id "${block.id}"`, path: [...blockPath, "id"] });
            }
            blockIds.add(block.id);
            const fieldIds = block.type === "record" ? block.fieldIds : block.type === "records" ? block.display.columnIds : [];
            const seenFieldIds = new Set<string>();
            for (const [fieldIndex, fieldId] of fieldIds.entries()) {
              if (seenFieldIds.has(fieldId)) {
                const fieldPath = block.type === "record" ? ["fieldIds", fieldIndex] : ["display", "columnIds", fieldIndex];
                ctx.addIssue({ code: "custom", message: `Duplicate field id "${fieldId}"`, path: [...blockPath, ...fieldPath] });
              }
              seenFieldIds.add(fieldId);
            }
            if (block.type === "record" && !page.record) {
              ctx.addIssue({ code: "custom", message: "A Record block requires a page record", path: [...blockPath, "type"] });
            }
          }
        }
      }

      if (page.record) {
        const hasRecordBlock = page.rows.some((row) =>
          row.columns.some((column) => column.blocks.some((block) => block.type === "record")),
        );
        if (!hasRecordBlock) {
          ctx.addIssue({
            code: "custom",
            message: "A page record requires at least one Record block",
            path: ["pages", pageIndex, "record"],
          });
        }
        const parameter = page.parameters[page.record.id.path];
        if (!parameter || parameter.type !== "record") {
          ctx.addIssue({
            code: "custom",
            message: "Page record must reference a declared record parameter",
            path: ["pages", pageIndex, "record", "id", "path"],
          });
        } else if (parameter.tableId !== page.record.tableId) {
          ctx.addIssue({
            code: "custom",
            message: "Page record and parameter must reference the same table",
            path: ["pages", pageIndex, "record", "tableId"],
          });
        }
        if (Object.keys(page.parameters).length !== 1) {
          ctx.addIssue({
            code: "custom",
            message: "A record page must declare exactly its bound record parameter",
            path: ["pages", pageIndex, "parameters"],
          });
        }
        if (page.navigation.visible) {
          ctx.addIssue({
            code: "custom",
            message: "Record pages must be route-only navigation targets",
            path: ["pages", pageIndex, "navigation", "visible"],
          });
        }
      } else if (Object.keys(page.parameters).length > 0) {
        ctx.addIssue({
          code: "custom",
          message: "Page parameters require a page record in this release",
          path: ["pages", pageIndex, "parameters"],
        });
      }
    }

    if (!pageIds.has(definition.startPageId)) {
      ctx.addIssue({ code: "custom", message: "startPageId must reference a page", path: ["startPageId"] });
    } else if (definition.pages.find((page) => page.id === definition.startPageId)?.record) {
      ctx.addIssue({ code: "custom", message: "startPageId must reference a page without required parameters", path: ["startPageId"] });
    }

    for (const [pageIndex, page] of definition.pages.entries()) {
      for (const [rowIndex, row] of page.rows.entries()) {
        for (const [columnIndex, column] of row.columns.entries()) {
          for (const [blockIndex, block] of column.blocks.entries()) {
            if (block.type !== "records" || !block.rowNavigate) continue;
            const path = ["pages", pageIndex, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex, "rowNavigate"] as const;
            const targetPage = definition.pages.find((candidate) => candidate.id === block.rowNavigate!.pageId);
            if (!targetPage) {
              ctx.addIssue({ code: "custom", message: "rowNavigate.pageId must reference a page", path: [...path, "pageId"] });
              continue;
            }
            const expectedParams = Object.keys(targetPage.parameters).sort();
            const suppliedParams = Object.keys(block.rowNavigate.params).sort();
            if (expectedParams.join("\0") !== suppliedParams.join("\0")) {
              ctx.addIssue({
                code: "custom",
                message: "rowNavigate.params must provide every target page parameter exactly once",
                path: [...path, "params"],
              });
            }
          }
        }
      }
    }
  });

export const CustomAppCapabilitiesSchema = z
  .object({
    views: z.array(z.object({ viewId: z.string().uuid(), tableId: z.string().uuid() }).strict()).max(4),
    records: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            tableId: z.string().uuid(),
            fieldIds: z.array(z.string().uuid()).min(1).max(30),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();

export const CustomAppDefinitionInputSchema = z.object({ definition: z.unknown() }).strict();

export type CustomAppDefinition = z.infer<typeof CustomAppDefinitionSchema>;
export type CustomAppCapabilities = z.infer<typeof CustomAppCapabilitiesSchema>;
export type CustomAppBlock = z.infer<typeof CustomAppBlockSchema>;
export type CustomAppPage = CustomAppDefinition["pages"][number];
export type CustomAppRowNavigation = NonNullable<Extract<CustomAppBlock, { type: "records" }>["rowNavigate"]>;

export type CustomAppDiagnostic = { path: Array<string | number>; message: string };

export const CUSTOM_APP_REFERENCE = {
  schemaVersion: 1,
  kind: "grids.custom-app",
  identity: {
    id: "Stable UUID chosen by the author",
    baseId: "Owning Base UUID",
    shortId: "Omit on create; Grids assigns and preserves it",
    icon: "Optional Tabler icon slug, for example app-window",
  },
  limits: { pages: 12, rowsPerPage: 24, columnsPerRow: 12, blocksPerColumn: 24, recordsBlocks: 4, recordsPerBlock: 100 },
  pages: {
    navigation: "Set visible to false for route-only detail pages",
    parameters: "This release supports required same-base record parameters",
    record: "Bind one authorized page record from PARAMS",
  },
  blocks: {
    markdown: { required: ["id", "type", "markdown"] },
    records: {
      required: ["id", "type", "source", "display"],
      source: { kind: "view", viewId: "view UUID" },
      display: { kind: "table", columnIds: ["field UUID"] },
      rowNavigate: "Optionally navigate a row id into a target page record parameter",
    },
    record: { required: ["id", "type", "fieldIds"], note: "Displays allowlisted fields from the current page record" },
  },
  example: {
    schemaVersion: 1,
    kind: "grids.custom-app",
    id: "00000000-0000-4000-8000-000000000001",
    baseId: "00000000-0000-4000-8000-000000000002",
    name: "Request overview",
    icon: "app-window",
    startPageId: "home",
    pages: [
      {
        id: "home",
        title: "My requests",
        navigation: { visible: true, order: 10 },
        rows: [
          {
            id: "content",
            columns: [
              {
                id: "main",
                span: 12,
                blocks: [
                  { id: "intro", type: "markdown", markdown: "# My requests" },
                  {
                    id: "requests",
                    type: "records",
                    source: { kind: "view", viewId: "00000000-0000-4000-8000-000000000003" },
                    display: { kind: "table", columnIds: ["00000000-0000-4000-8000-000000000004"] },
                    rowNavigate: {
                      kind: "navigate",
                      pageId: "request",
                      history: "push",
                      params: { request_id: { source: "ROW", path: "id" } },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "request",
        title: "Request detail",
        navigation: { visible: false, order: 20 },
        parameters: {
          request_id: { type: "record", tableId: "00000000-0000-4000-8000-000000000005", required: true },
        },
        record: {
          tableId: "00000000-0000-4000-8000-000000000005",
          id: { source: "PARAMS", path: "request_id" },
        },
        rows: [
          {
            id: "detail",
            columns: [
              {
                id: "main",
                span: 12,
                blocks: [
                  {
                    id: "request-details",
                    type: "record",
                    fieldIds: ["00000000-0000-4000-8000-000000000004"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
} as const;
