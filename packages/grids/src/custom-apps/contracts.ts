import { z } from "zod";
import { SHORT_ID_REGEX } from "../service/short-id";

const LocalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "Use a lowercase local id");

export const CustomAppMarkdownBlockSchema = z
  .object({
    id: LocalIdSchema,
    type: z.literal("markdown"),
    title: z.string().trim().min(1).max(160).optional(),
    markdown: z.string().max(20_000),
  })
  .strict();

export const CustomAppRecordsBlockSchema = z
  .object({
    id: LocalIdSchema,
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
  })
  .strict();

export const CustomAppBlockSchema = z.discriminatedUnion("type", [CustomAppMarkdownBlockSchema, CustomAppRecordsBlockSchema]);

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
    startPageId: LocalIdSchema,
    pages: z
      .array(
        z
          .object({
            id: LocalIdSchema,
            title: z.string().trim().min(1).max(200),
            rows: z
              .array(
                z
                  .object({
                    id: LocalIdSchema,
                    columns: z
                      .array(
                        z
                          .object({
                            id: LocalIdSchema,
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
          .strict(),
      )
      .length(1),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.startPageId !== definition.pages[0]?.id) {
      ctx.addIssue({ code: "custom", message: "startPageId must reference the single page", path: ["startPageId"] });
    }
    const ids = new Set<string>();
    for (const [rowIndex, row] of (definition.pages[0]?.rows ?? []).entries()) {
      for (const [columnIndex, column] of row.columns.entries()) {
        for (const [blockIndex, block] of column.blocks.entries()) {
          if (ids.has(block.id)) {
            ctx.addIssue({
              code: "custom",
              message: `Duplicate block id "${block.id}"`,
              path: ["pages", 0, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex, "id"],
            });
          }
          ids.add(block.id);
          if (block.type === "records") {
            const columnIds = new Set<string>();
            for (const [fieldIndex, fieldId] of block.display.columnIds.entries()) {
              if (columnIds.has(fieldId)) {
                ctx.addIssue({
                  code: "custom",
                  message: `Duplicate field id "${fieldId}"`,
                  path: ["pages", 0, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex, "display", "columnIds", fieldIndex],
                });
              }
              columnIds.add(fieldId);
            }
          }
        }
      }
    }
  });

export const CustomAppCapabilitiesSchema = z
  .object({
    views: z.array(z.object({ viewId: z.string().uuid(), tableId: z.string().uuid() }).strict()).max(4),
  })
  .strict();

export const CustomAppDefinitionInputSchema = z.object({ definition: z.unknown() }).strict();

export type CustomAppDefinition = z.infer<typeof CustomAppDefinitionSchema>;
export type CustomAppCapabilities = z.infer<typeof CustomAppCapabilitiesSchema>;
export type CustomAppBlock = z.infer<typeof CustomAppBlockSchema>;

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
  limits: { pages: 1, rows: 24, columnsPerRow: 12, blocksPerColumn: 24, recordsBlocks: 4, recordsPerBlock: 100 },
  blocks: {
    markdown: { required: ["id", "type", "markdown"] },
    records: {
      required: ["id", "type", "source", "display"],
      source: { kind: "view", viewId: "view UUID" },
      display: { kind: "table", columnIds: ["field UUID"] },
    },
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
