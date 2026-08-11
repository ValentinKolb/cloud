import { z } from "zod";
import { SHORT_ID_REGEX } from "../service/short-id";

export const CustomAppValueFormatSchema = z
  .object({
    style: z.enum(["number", "integer", "percent"]),
    decimalPlaces: z.number().int().min(0).max(20).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    unitPosition: z.enum(["prefix", "suffix"]).optional(),
  })
  .superRefine((format, ctx) => {
    if (format.style === "integer" && format.decimalPlaces !== undefined) {
      ctx.addIssue({ code: "custom", path: ["decimalPlaces"], message: "integer format cannot set decimal places" });
    }
    if (format.style !== "number" && (format.unit !== undefined || format.unitPosition !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: `${format.style} format cannot set a custom unit` });
    }
    if (format.unit === undefined && format.unitPosition !== undefined) {
      ctx.addIssue({ code: "custom", path: ["unitPosition"], message: "unit position requires a unit" });
    }
  });
export type CustomAppValueFormat = z.infer<typeof CustomAppValueFormatSchema>;

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

const CustomAppParamValueSchema = z.object({ source: z.literal("PARAMS"), path: CustomAppParameterIdSchema }).strict();

const CustomAppGqlSourceSchema = z
  .object({
    kind: z.literal("gql"),
    query: z.string().trim().min(1).max(20_000),
    maxRows: z.number().int().min(1).max(100),
  })
  .strict();

const CustomAppRecordIdValueSchema = z.object({ source: z.literal("RECORD"), path: z.literal("id") }).strict();
const CustomAppRowIdValueSchema = z.object({ source: z.literal("ROW"), path: z.literal("id") }).strict();

export const CustomAppAvailabilitySchema = z.object({ query: z.string().trim().min(1).max(20_000) }).strict();
export type CustomAppAvailability = z.infer<typeof CustomAppAvailabilitySchema>;

const CustomAppAvailabilityShape = {
  availableWhen: CustomAppAvailabilitySchema.optional(),
};

export const CustomAppValueBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("LITERAL"), value: z.json() }).strict(),
  CustomAppParamValueSchema,
  CustomAppRecordIdValueSchema,
]);

export const CustomAppRowValueBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("LITERAL"), value: z.json() }).strict(),
  CustomAppParamValueSchema,
  CustomAppRecordIdValueSchema,
  CustomAppRowIdValueSchema,
]);

const CustomAppActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: CustomAppLocalIdSchema,
      label: z.string().trim().min(1).max(120),
      icon: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9-]+$/, "Use a Tabler icon slug")
        .optional(),
      kind: z.literal("navigate"),
      pageId: CustomAppLocalIdSchema,
      history: z.enum(["push", "replace"]).default("push"),
      params: z.record(CustomAppParameterIdSchema, z.union([CustomAppParamValueSchema, CustomAppRecordIdValueSchema])),
      ...CustomAppAvailabilityShape,
    })
    .strict(),
  z
    .object({
      id: CustomAppLocalIdSchema,
      label: z.string().trim().min(1).max(120),
      icon: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9-]+$/, "Use a Tabler icon slug")
        .optional(),
      kind: z.literal("workflow"),
      launcherId: z.string().uuid(),
      inputs: z.record(z.string().trim().min(1).max(120), CustomAppValueBindingSchema).default({}),
      confirm: z.string().trim().min(1).max(240).optional(),
      ...CustomAppAvailabilityShape,
    })
    .strict(),
]);

export const CustomAppRowActionSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    label: z.string().trim().min(1).max(120),
    icon: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "Use a Tabler icon slug")
      .optional(),
    showLabel: z.boolean().default(true),
    kind: z.literal("workflow"),
    launcherId: z.string().uuid(),
    inputs: z.record(z.string().trim().min(1).max(120), CustomAppRowValueBindingSchema).default({}),
    confirm: z.string().trim().min(1).max(240).optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict()
  .superRefine((action, ctx) => {
    if (!action.showLabel && !action.icon) {
      ctx.addIssue({ code: "custom", message: "Icon-only row actions require an icon", path: ["icon"] });
    }
  });

const CustomAppFormSuccessValueSchema = z.discriminatedUnion("source", [
  CustomAppParamValueSchema,
  z.object({ source: z.literal("RESULT"), path: z.literal("recordId") }).strict(),
]);

const CustomAppFormSuccessNavigationSchema = z
  .object({
    kind: z.literal("navigate"),
    pageId: CustomAppLocalIdSchema,
    params: z.record(CustomAppParameterIdSchema, CustomAppFormSuccessValueSchema),
  })
  .strict();

export const CustomAppMarkdownBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("markdown"),
    title: z.string().trim().min(1).max(160).optional(),
    markdown: z.string().max(20_000),
    ...CustomAppAvailabilityShape,
  })
  .strict();

export const CustomAppRecordsBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("records"),
    title: z.string().trim().min(1).max(160).optional(),
    emptyText: z.string().trim().min(1).max(240).optional(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("view"), viewId: z.string().uuid() }).strict(),
      CustomAppGqlSourceSchema,
    ]),
    display: z
      .object({
        kind: z.literal("table"),
        columnIds: z.array(z.string().uuid()).max(30),
      })
      .strict(),
    rowNavigate: CustomAppRowNavigationSchema.optional(),
    rowActions: z.array(CustomAppRowActionSchema).max(6).optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.source.kind === "view" && block.display.columnIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Saved-view Records blocks require at least one displayed column",
        path: ["display", "columnIds"],
      });
    }
    const actionIds = new Set<string>();
    for (const [index, action] of (block.rowActions ?? []).entries()) {
      if (actionIds.has(action.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate row action id "${action.id}"`, path: ["rowActions", index, "id"] });
      }
      actionIds.add(action.id);
    }
  });

export const CustomAppInsightSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view"), viewId: z.string().uuid() }).strict(),
  CustomAppGqlSourceSchema,
]);

export const CustomAppMetricsBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("metrics"),
    title: z.string().trim().min(1).max(160).optional(),
    source: CustomAppInsightSourceSchema,
    ...CustomAppAvailabilityShape,
  })
  .strict();

export const CustomAppChartBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("chart"),
    title: z.string().trim().min(1).max(160).optional(),
    subtitle: z.string().trim().min(1).max(200).optional(),
    chartType: z.enum(["donut", "bar", "line", "sparkline", "scatter"]),
    source: CustomAppInsightSourceSchema,
    limit: z.number().int().min(1).max(100).default(100),
    valueFormat: CustomAppValueFormatSchema.optional(),
    xAxisLabel: z.string().trim().min(1).max(60).optional(),
    yAxisLabel: z.string().trim().min(1).max(60).optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict();

export const CustomAppRecordBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("record"),
    title: z.string().trim().min(1).max(160).optional(),
    emptyText: z.string().trim().min(1).max(240).optional(),
    fieldIds: z.array(z.string().uuid()).min(1).max(30),
    editableFieldIds: z.array(z.string().uuid()).max(30).default([]),
    documents: z
      .object({
        templateIds: z.array(z.string().uuid()).min(1).max(12),
      })
      .strict()
      .optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict()
  .superRefine((block, ctx) => {
    const displayed = new Set(block.fieldIds);
    const editable = new Set<string>();
    for (const [index, fieldId] of block.editableFieldIds.entries()) {
      if (editable.has(fieldId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate editable field id "${fieldId}"`,
          path: ["editableFieldIds", index],
        });
      }
      editable.add(fieldId);
      if (!displayed.has(fieldId)) {
        ctx.addIssue({
          code: "custom",
          message: "Editable fields must also be displayed by the Record block",
          path: ["editableFieldIds", index],
        });
      }
    }
    const templateIds = new Set<string>();
    for (const [index, templateId] of (block.documents?.templateIds ?? []).entries()) {
      if (templateIds.has(templateId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate document template id "${templateId}"`,
          path: ["documents", "templateIds", index],
        });
      }
      templateIds.add(templateId);
    }
  });

export const CustomAppCommentsBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("comments"),
    title: z.string().trim().min(1).max(160).optional(),
    emptyText: z.string().trim().min(1).max(240).optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict();

export const CustomAppFormBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("form"),
    title: z.string().trim().min(1).max(160).optional(),
    formId: z.string().uuid(),
    fixedValues: z.record(z.string().uuid(), CustomAppValueBindingSchema).default({}),
    onSuccessNavigate: CustomAppFormSuccessNavigationSchema.optional(),
    ...CustomAppAvailabilityShape,
  })
  .strict();

export const CustomAppActionsBlockSchema = z
  .object({
    id: CustomAppLocalIdSchema,
    type: z.literal("actions"),
    title: z.string().trim().min(1).max(160).optional(),
    actions: z.array(CustomAppActionSchema).min(1).max(12),
    ...CustomAppAvailabilityShape,
  })
  .strict()
  .superRefine((block, ctx) => {
    const ids = new Set<string>();
    for (const [index, action] of block.actions.entries()) {
      if (ids.has(action.id))
        ctx.addIssue({ code: "custom", message: `Duplicate action id "${action.id}"`, path: ["actions", index, "id"] });
      ids.add(action.id);
    }
  });

export const CustomAppBlockSchema = z.discriminatedUnion("type", [
  CustomAppMarkdownBlockSchema,
  CustomAppRecordsBlockSchema,
  CustomAppMetricsBlockSchema,
  CustomAppChartBlockSchema,
  CustomAppRecordBlockSchema,
  CustomAppCommentsBlockSchema,
  CustomAppFormBlockSchema,
  CustomAppActionsBlockSchema,
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
    ...CustomAppAvailabilityShape,
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
    schemaVersion: z.literal(2),
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
            if (block.type === "comments" && !page.record) {
              ctx.addIssue({ code: "custom", message: "A Comments block requires a page record", path: [...blockPath, "type"] });
            }
            if (block.type === "form") {
              for (const [fieldId, value] of Object.entries(block.fixedValues)) {
                if (value.source === "PARAMS" && !page.parameters[value.path]) {
                  ctx.addIssue({
                    code: "custom",
                    message: "Form fixed values must reference a parameter declared by the current page",
                    path: [...blockPath, "fixedValues", fieldId, "path"],
                  });
                }
                if (value.source === "RECORD" && !page.record) {
                  ctx.addIssue({
                    code: "custom",
                    message: "RECORD Form fixed values require a page record",
                    path: [...blockPath, "fixedValues", fieldId],
                  });
                }
              }
            }
            if (block.type === "actions" || block.type === "records") {
              const actions =
                block.type === "actions" ? block.actions.filter((action) => action.kind === "workflow") : (block.rowActions ?? []);
              const segment = block.type === "actions" ? "actions" : "rowActions";
              for (const [actionIndex, action] of actions.entries()) {
                for (const [inputName, value] of Object.entries(action.inputs)) {
                  if (value.source === "PARAMS" && !page.parameters[value.path]) {
                    ctx.addIssue({
                      code: "custom",
                      message: "Workflow inputs must reference a parameter declared by the current page",
                      path: [...blockPath, segment, actionIndex, "inputs", inputName, "path"],
                    });
                  }
                  if (value.source === "RECORD" && !page.record) {
                    ctx.addIssue({
                      code: "custom",
                      message: "RECORD workflow inputs require a page record",
                      path: [...blockPath, segment, actionIndex, "inputs", inputName],
                    });
                  }
                }
              }
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
      } else if (Object.keys(page.parameters).length > 0 && page.navigation.visible) {
        ctx.addIssue({
          code: "custom",
          message: "Pages with required parameters must be route-only navigation targets",
          path: ["pages", pageIndex, "navigation", "visible"],
        });
      }
    }

    if (!pageIds.has(definition.startPageId)) {
      ctx.addIssue({ code: "custom", message: "startPageId must reference a page", path: ["startPageId"] });
    } else if (Object.keys(definition.pages.find((page) => page.id === definition.startPageId)?.parameters ?? {}).length > 0) {
      ctx.addIssue({ code: "custom", message: "startPageId must reference a page without required parameters", path: ["startPageId"] });
    }

    for (const [pageIndex, page] of definition.pages.entries()) {
      for (const [rowIndex, row] of page.rows.entries()) {
        for (const [columnIndex, column] of row.columns.entries()) {
          for (const [blockIndex, block] of column.blocks.entries()) {
            const navigations = [
              ...(block.type === "records" && block.rowNavigate ? [{ navigation: block.rowNavigate, key: "rowNavigate" }] : []),
              ...(block.type === "form" && block.onSuccessNavigate
                ? [{ navigation: block.onSuccessNavigate, key: "onSuccessNavigate" }]
                : []),
              ...(block.type === "actions"
                ? block.actions.flatMap((action, actionIndex) =>
                    action.kind === "navigate" ? [{ navigation: action, key: `actions.${actionIndex}` }] : [],
                  )
                : []),
            ];
            for (const { navigation, key } of navigations) {
              const path = ["pages", pageIndex, "rows", rowIndex, "columns", columnIndex, "blocks", blockIndex, ...key.split(".")] as const;
              const targetPage = definition.pages.find((candidate) => candidate.id === navigation.pageId);
              if (!targetPage) {
                ctx.addIssue({ code: "custom", message: `${key}.pageId must reference a page`, path: [...path, "pageId"] });
                continue;
              }
              const expectedParams = Object.keys(targetPage.parameters).sort();
              const suppliedParams = Object.keys(navigation.params).sort();
              if (expectedParams.join("\0") !== suppliedParams.join("\0")) {
                ctx.addIssue({
                  code: "custom",
                  message: `${key}.params must provide every target page parameter exactly once`,
                  path: [...path, "params"],
                });
              }
              if (block.type !== "records") {
                for (const [parameterId, value] of Object.entries(navigation.params)) {
                  const targetParameter = targetPage.parameters[parameterId];
                  if (value.source === "PARAMS") {
                    const sourceParameter = page.parameters[value.path];
                    if (!sourceParameter) {
                      ctx.addIssue({
                        code: "custom",
                        message: "Navigation must reference a parameter declared by the current page",
                        path: [...path, "params", parameterId, "path"],
                      });
                    } else if (targetParameter?.tableId !== sourceParameter.tableId) {
                      ctx.addIssue({
                        code: "custom",
                        message: "Navigation parameter tables must match",
                        path: [...path, "params", parameterId],
                      });
                    }
                  }
                  if (value.source === "RECORD" && (!page.record || targetParameter?.tableId !== page.record.tableId)) {
                    ctx.addIssue({
                      code: "custom",
                      message: "RECORD navigation must target a parameter for the current record table",
                      path: [...path, "params", parameterId],
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  });

export const CustomAppCapabilitiesSchema = z
  .object({
    availability: z
      .array(
        z.discriminatedUnion("target", [
          z
            .object({
              target: z.literal("page"),
              pageId: CustomAppLocalIdSchema,
              sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
              planHash: z.string().regex(/^[a-f0-9]{64}$/),
              tableIds: z.array(z.string().uuid()).min(1).max(24),
            })
            .strict(),
          z
            .object({
              target: z.literal("block"),
              pageId: CustomAppLocalIdSchema,
              blockId: CustomAppLocalIdSchema,
              sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
              planHash: z.string().regex(/^[a-f0-9]{64}$/),
              tableIds: z.array(z.string().uuid()).min(1).max(24),
            })
            .strict(),
          z
            .object({
              target: z.literal("action"),
              pageId: CustomAppLocalIdSchema,
              blockId: CustomAppLocalIdSchema,
              actionId: CustomAppLocalIdSchema,
              sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
              planHash: z.string().regex(/^[a-f0-9]{64}$/),
              tableIds: z.array(z.string().uuid()).min(1).max(24),
            })
            .strict(),
        ]),
      )
      .max(256)
      .default([]),
    views: z
      .array(
        z
          .object({
            viewId: z.string().uuid(),
            tableId: z.string().uuid(),
            sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
            planHash: z.string().regex(/^[a-f0-9]{64}$/),
            tableIds: z.array(z.string().uuid()).min(1).max(24),
          })
          .strict(),
      )
      .max(4),
    insights: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            blockType: z.enum(["metrics", "chart"]),
            source: z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("view"),
                  viewId: z.string().uuid(),
                  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
                  planHash: z.string().regex(/^[a-f0-9]{64}$/),
                  tableIds: z.array(z.string().uuid()).min(1).max(24),
                })
                .strict(),
              z
                .object({
                  kind: z.literal("gql"),
                  planHash: z.string().regex(/^[a-f0-9]{64}$/),
                  tableIds: z.array(z.string().uuid()).min(1).max(24),
                })
                .strict(),
            ]),
          })
          .strict(),
      )
      .max(24)
      .default([]),
    recordQueries: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            primaryTableId: z.string().uuid(),
            planHash: z.string().regex(/^[a-f0-9]{64}$/),
            tableIds: z.array(z.string().uuid()).min(1).max(24),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    records: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            tableId: z.string().uuid(),
            fieldIds: z.array(z.string().uuid()).min(1).max(30),
            editableFieldIds: z.array(z.string().uuid()).max(30).default([]),
            relationLabels: z
              .array(
                z
                  .object({
                    fieldId: z.string().uuid(),
                    targetTableId: z.string().uuid(),
                    labelFieldIds: z.array(z.string().uuid()).max(200),
                  })
                  .strict(),
              )
              .max(30),
          })
          .strict()
          .superRefine((record, ctx) => {
            const relationFieldIds = new Set<string>();
            for (const [index, relation] of record.relationLabels.entries()) {
              if (!record.fieldIds.includes(relation.fieldId)) {
                ctx.addIssue({
                  code: "custom",
                  message: "Relation label fields must belong to the published Record field allowlist",
                  path: ["relationLabels", index, "fieldId"],
                });
              }
              if (relationFieldIds.has(relation.fieldId)) {
                ctx.addIssue({
                  code: "custom",
                  message: "Relation label field capabilities must be unique",
                  path: ["relationLabels", index, "fieldId"],
                });
              }
              relationFieldIds.add(relation.fieldId);
              if (new Set(relation.labelFieldIds).size !== relation.labelFieldIds.length) {
                ctx.addIssue({
                  code: "custom",
                  message: "Relation label field IDs must be unique",
                  path: ["relationLabels", index, "labelFieldIds"],
                });
              }
            }
          }),
      )
      .max(12)
      .default([]),
    forms: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            formId: z.string().uuid(),
            tableId: z.string().uuid(),
            userInputFieldIds: z.array(z.string().uuid()).max(100),
            fixedFieldIds: z.array(z.string().uuid()).max(30),
            fieldHash: z.string().regex(/^[a-f0-9]{64}$/),
            formSecurityHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(24)
      .default([]),
    comments: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            tableId: z.string().uuid(),
          })
          .strict(),
      )
      .max(24)
      .default([]),
    documents: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            tableId: z.string().uuid(),
            templateIds: z.array(z.string().uuid()).min(1).max(12),
          })
          .strict(),
      )
      .max(288)
      .default([]),
    workflowLaunchers: z
      .array(
        z
          .object({
            pageId: CustomAppLocalIdSchema,
            blockId: CustomAppLocalIdSchema,
            actionId: CustomAppLocalIdSchema,
            launcherId: z.string().uuid(),
            workflowId: z.string().uuid(),
            revision: z.number().int().positive(),
          })
          .strict(),
      )
      .max(288)
      .default([]),
  })
  .strict();

export const CustomAppDefinitionInputSchema = z.object({ definition: z.unknown() }).strict();

export type CustomAppDefinition = z.infer<typeof CustomAppDefinitionSchema>;
export type CustomAppCapabilities = z.infer<typeof CustomAppCapabilitiesSchema>;
export type CustomAppBlock = z.infer<typeof CustomAppBlockSchema>;
export type CustomAppPage = CustomAppDefinition["pages"][number];
export type CustomAppRowNavigation = NonNullable<Extract<CustomAppBlock, { type: "records" }>["rowNavigate"]>;
export type CustomAppRecordsBlock = Extract<CustomAppBlock, { type: "records" }>;
export type CustomAppFormBlock = Extract<CustomAppBlock, { type: "form" }>;
export type CustomAppCommentsBlock = Extract<CustomAppBlock, { type: "comments" }>;
export type CustomAppActionsBlock = Extract<CustomAppBlock, { type: "actions" }>;
export type CustomAppAction = CustomAppActionsBlock["actions"][number];
export type CustomAppValueBinding = z.infer<typeof CustomAppValueBindingSchema>;
export type CustomAppRowValueBinding = z.infer<typeof CustomAppRowValueBindingSchema>;
export type CustomAppRowAction = z.infer<typeof CustomAppRowActionSchema>;

export type CustomAppDiagnostic = { path: Array<string | number>; message: string };

export const parseStoredCustomAppDefinition = (raw: unknown, version: "draft" | "published") => {
  const parsed = CustomAppDefinitionSchema.safeParse(raw);
  if (parsed.success) return { definition: parsed.data, diagnostics: [] };
  const schemaVersion = raw && typeof raw === "object" && "schemaVersion" in raw ? raw.schemaVersion : undefined;
  const recovery =
    schemaVersion === 1
      ? `Stored ${version} uses unsupported Grids App schemaVersion 1; replace it with a schemaVersion 2 definition${
          version === "draft" ? " or restore a valid published version" : ""
        }.`
      : `Stored ${version} is not a valid Grids App schemaVersion 2 definition; replace it with a valid definition${
          version === "draft" ? " or restore a valid published version" : ""
        }.`;
  const diagnostics: CustomAppDiagnostic[] = [
    { path: [version, "schemaVersion"], message: recovery },
    ...parsed.error.issues.map((issue) => ({
      path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
      message: issue.message,
    })),
  ];
  return { definition: null, diagnostics };
};

export const CUSTOM_APP_REFERENCE = {
  schemaVersion: 2,
  kind: "grids.custom-app",
  identity: {
    id: "Stable UUID chosen by the author",
    baseId: "Owning Base UUID",
    shortId: "Omit on create; Grids assigns and preserves it",
    icon: "Optional Tabler icon slug, for example app-window",
  },
  limits: {
    pages: 12,
    rowsPerPage: 24,
    columnsPerRow: 12,
    blocksPerColumn: 24,
    recordsBlocks: 4,
    recordsPerBlock: 100,
    rowActionsPerRecordsBlock: 6,
    insightBlocks: 24,
    metricsPerBlock: 12,
    chartGroupsPerBlock: 100,
  },
  pages: {
    navigation: "Set visible to false for route-only parameterized pages",
    parameters: "This release supports required same-base record parameters",
    record: "Bind one authorized page record from PARAMS",
  },
  availability: {
    availableWhen: "Optional bounded GQL query on pages, blocks, and individual actions",
    semantics: "Available only when the server-side query returns at least one row; errors fail closed",
    context: ["@auth.id", "@auth.name", "@auth.username", "@auth.email", "@params.*", "@page.*", "@app.*", "@base.*", "@time.*"],
  },
  blocks: {
    markdown: { required: ["id", "type", "markdown"] },
    records: {
      required: ["id", "type", "source", "display"],
      source: "Saved view or bounded inline GQL with implicit typed request context",
      display: "Saved views require explicit field UUIDs; GQL displays its selected result columns",
      rowNavigate: "Optionally navigate a row id into a target page record parameter",
      rowActions: "Optionally invoke plural workflow actions with ROW.id and accessible label/icon presentation",
    },
    metrics: {
      required: ["id", "type", "source"],
      source: "Saved view or inline GQL with maxRows from 1 to 100",
      note: "Renders up to 12 named scalar aggregations from one bounded source row",
    },
    chart: {
      required: ["id", "type", "chartType", "source"],
      chartTypes: ["donut", "bar", "line", "sparkline", "scatter"],
      source: "Grouped aggregate saved view or inline GQL with maxRows from 1 to 100",
      note: "Renders grouped, aggregated output with at most 100 buckets",
    },
    record: {
      required: ["id", "type", "fieldIds"],
      editableFieldIds: "Optional writable subset of fieldIds",
      documents: "Optionally show existing generated documents from an exact template allowlist",
      note: "Displays allowlisted fields from the current page record and may edit an explicit writable subset",
    },
    comments: { required: ["id", "type"], note: "Shows the bounded comment thread for the current page record" },
    form: {
      required: ["id", "type", "formId"],
      fixedValues: "Optionally supply trusted typed LITERAL values or compatible PARAMS and page RECORD relations",
      onSuccessNavigate: "Optionally replace-navigate using PARAMS and RESULT.recordId",
    },
    actions: {
      required: ["id", "type", "actions"],
      note: "Navigate inside the app or invoke an exact published workflow launcher and follow its scoped result",
    },
  },
  example: {
    schemaVersion: 2,
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
                    id: "apply",
                    type: "form",
                    formId: "00000000-0000-4000-8000-000000000006",
                    fixedValues: {},
                    onSuccessNavigate: {
                      kind: "navigate",
                      pageId: "request",
                      params: { request_id: { source: "RESULT", path: "recordId" } },
                    },
                  },
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
                    documents: { templateIds: ["00000000-0000-4000-8000-000000000007"] },
                  },
                  { id: "request-comments", type: "comments", emptyText: "No messages yet." },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
} as const;
