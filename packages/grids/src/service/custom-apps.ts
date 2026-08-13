import { err, fail, ok, type Result } from "@k2b/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { type Field, ViewUiSettingsSchema } from "../contracts";
import { customAppPageRecordFieldIds } from "../custom-apps/conditions";
import { customAppGlobalContextKeys } from "../custom-apps/context-keys";
import {
  type CustomAppBlock,
  type CustomAppCapabilities,
  CustomAppCapabilitiesSchema,
  type CustomAppDefinition,
  CustomAppDefinitionSchema,
  type CustomAppDiagnostic,
  parseStoredCustomAppDefinition,
} from "../custom-apps/contracts";
import {
  type CustomAppFormSecurityField,
  customAppFormFieldHash,
  customAppFormInlineTargetReferences,
  customAppFormSecurityHash,
} from "../custom-apps/form-capability";
import { customAppViewSourceHash } from "../custom-apps/insight-source";
import { customAppRecordsDisplayFieldHash } from "../custom-apps/records-display-capability";
import { customAppScannerConfigHash } from "../custom-apps/scanner-capability";
import { customAppBindingRecordTableId } from "../custom-apps/value-bindings";
import { getRecordWritableFieldType, isRecordWritableFieldType } from "../field-types";
import type { DslQueryContextValues } from "../query-dsl/parameters";
import { isDslAggregateOnlyPlan } from "../query-dsl/resolver";
import { collectDslPlanTableIds } from "../query-dsl/source-plan";
import { scannerLauncherInputSources } from "../workflows/contracts";
import { logAudit, type SqlClient } from "./audit";
import { compileCustomAppQuery } from "./custom-app-query";
import { customAppRecordRelationSnapshot } from "./custom-app-record-relations";
import { listByTable as listFields, listByTables as listFieldsByTables } from "./fields";
import { normalizeFormConfig } from "./forms";
import { parseJsonbRow } from "./jsonb";
import { insertWithShortId } from "./short-id";
import { getWorkflow } from "./workflow-definitions";
import { getLauncher } from "./workflow-launchers";
import { workflowInputShapeError } from "./workflow-values";

type DbRow = Record<string, unknown>;

export type CustomApp = {
  id: string;
  shortId: string;
  baseId: string;
  name: string;
  icon: string | null;
  draftDefinition: CustomAppDefinition | null;
  draftDefinitionRaw: unknown;
  draftDiagnostics: CustomAppDiagnostic[];
  draftCapabilities: CustomAppCapabilities | null;
  publishedDefinition: CustomAppDefinition | null;
  publishedDefinitionRaw: unknown | null;
  publishedDiagnostics: CustomAppDiagnostic[];
  publishedCapabilities: CustomAppCapabilities | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  draftValid: boolean;
  publishedValid: boolean;
  hasUnpublishedChanges: boolean;
};

export type CustomAppSummary = Pick<
  CustomApp,
  "id" | "shortId" | "baseId" | "name" | "icon" | "publishedAt" | "updatedAt" | "draftValid" | "publishedValid" | "hasUnpublishedChanges"
>;

export type CompiledCustomApp = { definition: CustomAppDefinition; capabilities: CustomAppCapabilities };
export type CustomAppCompilation = { ok: true; compiled: CompiledCustomApp } | { ok: false; diagnostics: CustomAppDiagnostic[] };
export type CustomAppPlan = {
  valid: boolean;
  diagnostics: CustomAppDiagnostic[];
  action: "create" | "update" | "noop" | "invalid";
  changes: string[];
};

const parseStoredCapabilities = (raw: unknown): CustomAppCapabilities | null => {
  if (raw === null || raw === undefined) return null;
  const parsed = CustomAppCapabilitiesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const mapRow = (row: DbRow): CustomApp => {
  const draftDefinitionRaw = parseJsonbRow(row.draft_definition, {});
  const publishedDefinitionRaw = row.published_definition ? parseJsonbRow(row.published_definition, {}) : null;
  const draft = parseStoredCustomAppDefinition(draftDefinitionRaw, "draft");
  const published = publishedDefinitionRaw ? parseStoredCustomAppDefinition(publishedDefinitionRaw, "published") : null;
  const draftCapabilities = parseStoredCapabilities(parseJsonbRow(row.draft_capabilities, null));
  const publishedCapabilities = parseStoredCapabilities(parseJsonbRow(row.published_capabilities, null));
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    baseId: row.base_id as string,
    name: row.name as string,
    icon: (row.icon as string | null) ?? null,
    draftDefinition: draft.definition,
    draftDefinitionRaw,
    draftDiagnostics: draft.diagnostics,
    draftCapabilities,
    publishedDefinition: published?.definition ?? null,
    publishedDefinitionRaw,
    publishedDiagnostics: published?.diagnostics ?? [],
    publishedCapabilities,
    publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    draftValid: draft.definition !== null && draftCapabilities !== null,
    publishedValid: published?.definition != null && publishedCapabilities !== null,
    hasUnpublishedChanges:
      publishedDefinitionRaw === null || stableStringify(draftDefinitionRaw) !== stableStringify(publishedDefinitionRaw),
  };
};

const mapSummaryRow = (row: DbRow): CustomAppSummary => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  icon: (row.icon as string | null) ?? null,
  publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
  updatedAt: (row.updated_at as Date).toISOString(),
  draftValid:
    CustomAppDefinitionSchema.safeParse(parseJsonbRow(row.draft_definition, {})).success &&
    CustomAppCapabilitiesSchema.safeParse(parseJsonbRow(row.draft_capabilities, null)).success,
  publishedValid:
    row.published_definition != null &&
    CustomAppDefinitionSchema.safeParse(parseJsonbRow(row.published_definition, {})).success &&
    CustomAppCapabilitiesSchema.safeParse(parseJsonbRow(row.published_capabilities, null)).success,
  hasUnpublishedChanges:
    !row.published_definition ||
    stableStringify(parseJsonbRow(row.draft_definition, {})) !== stableStringify(parseJsonbRow(row.published_definition, {})),
});

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const stableStringify = (value: unknown): string => JSON.stringify(stableValue(value));

const zodDiagnostics = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }): CustomAppDiagnostic[] =>
  error.issues.map((issue) => ({
    path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
    message: issue.message,
  }));

const blocksByType = <T extends CustomAppBlock["type"]>(definition: CustomAppDefinition, type: T) =>
  definition.pages.flatMap((page) =>
    page.rows.flatMap((row) =>
      row.columns.flatMap((column) =>
        column.blocks
          .filter((block): block is Extract<(typeof column.blocks)[number], { type: T }> => block.type === type)
          .map((block) => ({ page, block })),
      ),
    ),
  );

const representativeQueryContext = (
  definition: CustomAppDefinition,
  page: CustomAppDefinition["pages"][number],
  baseName: string,
): DslQueryContextValues => ({
  "auth.id": "00000000-0000-4000-8000-000000000001",
  "auth.name": "Reader",
  "auth.username": "reader",
  "auth.email": "reader@example.test",
  "auth.subjects": ["00000000-0000-4000-8000-000000000001"],
  "page.id": page.id,
  "page.title": page.title,
  "page.url": `/app/grids/custom/${definition.shortId ?? definition.id}/${page.id}`,
  "app.id": definition.id,
  "app.shortId": definition.shortId ?? "draft",
  "app.name": definition.name,
  "base.id": definition.baseId,
  "base.name": baseName,
  "time.now": "2000-01-01T00:00:00.000Z",
  "time.today": "2000-01-01",
  "time.timeZone": "UTC",
  ...Object.fromEntries(
    Object.keys(page.parameters).map((parameterId) => [`params.${parameterId}`, "00000000-0000-4000-8000-000000000000"]),
  ),
});

const representativeGlobalQueryContext = (definition: CustomAppDefinition, baseName: string): DslQueryContextValues => ({
  "auth.id": "00000000-0000-4000-8000-000000000001",
  "auth.name": "Reader",
  "auth.username": "reader",
  "auth.email": "reader@example.test",
  "auth.subjects": ["00000000-0000-4000-8000-000000000001"],
  "page.id": "global",
  "page.title": definition.name,
  "page.url": `/apps/${definition.shortId ?? definition.id}`,
  "app.id": definition.id,
  "app.shortId": definition.shortId ?? "draft",
  "app.name": definition.name,
  "base.id": definition.baseId,
  "base.name": baseName,
  "time.now": "2000-01-01T00:00:00.000Z",
  "time.today": "2000-01-01",
  "time.timeZone": "UTC",
});

export const compile = async (input: unknown, client: SqlClient = sql): Promise<CustomAppCompilation> => {
  const parsed = CustomAppDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, diagnostics: zodDiagnostics(parsed.error) };
  const definition = parsed.data;
  const recordsBlocks = blocksByType(definition, "records");
  const insightBlocks = [...blocksByType(definition, "metrics"), ...blocksByType(definition, "chart")];
  const formBlocks = blocksByType(definition, "form");
  const sidebarFormActions = (definition.sidebar?.actions ?? []).filter((action) => action.kind === "form");
  const sidebarWorkflowActions = (definition.sidebar?.actions ?? []).filter((action) => action.kind === "workflow");
  const commentBlocks = blocksByType(definition, "comments");
  const actionBlocks = blocksByType(definition, "actions");
  const scannerBlocks = blocksByType(definition, "scanner");
  if (recordsBlocks.length > 4) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Grids App may contain at most 4 Records blocks" }] };
  }
  if (formBlocks.length + sidebarFormActions.length > 24) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Grids App may contain at most 24 Form blocks" }] };
  }
  if (insightBlocks.length > 24) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Grids App may contain at most 24 Metrics and Chart blocks" }] };
  }
  if (scannerBlocks.length > 24) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Grids App may contain at most 24 Scanner blocks" }] };
  }

  const [base] = await client<Array<{ id: string; name: string }>>`
    SELECT id, name FROM grids.bases WHERE id = ${definition.baseId}::uuid AND deleted_at IS NULL
  `;
  if (!base) return { ok: false, diagnostics: [{ path: ["baseId"], message: "Base not found" }] };

  const diagnostics: CustomAppDiagnostic[] = [];
  const availability: CustomAppCapabilities["availability"] = [];
  const views: CustomAppCapabilities["views"] = [];
  const insights: CustomAppCapabilities["insights"] = [];
  const recordQueries: CustomAppCapabilities["recordQueries"] = [];
  const pageRecords: CustomAppCapabilities["records"] = [];
  const forms: CustomAppCapabilities["forms"] = [];
  const comments: CustomAppCapabilities["comments"] = [];
  const documents: CustomAppCapabilities["documents"] = [];
  const workflowLaunchers: CustomAppCapabilities["workflowLaunchers"] = [];
  const scannerLaunchers: CustomAppCapabilities["scannerLaunchers"] = [];
  const recordsPrimaryTableIds = new Map<string, string>();
  const tableBaseIds = new Map<string, string | null>();
  const fieldsByTableId = new Map<string, Field[]>();
  const resolveTableBaseId = async (tableId: string): Promise<string | null> => {
    const cached = tableBaseIds.get(tableId);
    if (cached !== undefined) return cached;
    const [table] = await client<Array<{ base_id: string }>>`
      SELECT base_id FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
    `;
    const resolved = table?.base_id ?? null;
    tableBaseIds.set(tableId, resolved);
    return resolved;
  };
  const resolveFields = async (tableId: string): Promise<Field[]> => {
    const cached = fieldsByTableId.get(tableId);
    if (cached) return cached;
    const fields = await listFields(tableId, false, client);
    fieldsByTableId.set(tableId, fields);
    return fields;
  };

  const availabilitySources = [
    ...(definition.sidebar?.actions ?? []).flatMap((action) =>
      action.availableWhen
        ? [
            {
              page: undefined,
              query: action.availableWhen.query,
              target: { target: "sidebarAction" as const, actionId: action.id },
            },
          ]
        : [],
    ),
    ...definition.pages.flatMap((page) => [
      ...(page.availableWhen ? [{ page, query: page.availableWhen.query, target: { target: "page" as const, pageId: page.id } }] : []),
      ...page.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column.blocks.flatMap((block) => [
            ...(block.availableWhen
              ? [
                  {
                    page,
                    query: block.availableWhen.query,
                    target: { target: "block" as const, pageId: page.id, blockId: block.id },
                  },
                ]
              : []),
            ...(block.type === "actions"
              ? block.actions.flatMap((action) =>
                  action.availableWhen
                    ? [
                        {
                          page,
                          query: action.availableWhen.query,
                          target: {
                            target: "action" as const,
                            pageId: page.id,
                            blockId: block.id,
                            actionId: action.id,
                          },
                        },
                      ]
                    : [],
                )
              : block.type === "records"
                ? (block.rowActions ?? []).flatMap((action) =>
                    action.availableWhen
                      ? [
                          {
                            page,
                            query: action.availableWhen.query,
                            target: {
                              target: "action" as const,
                              pageId: page.id,
                              blockId: block.id,
                              actionId: action.id,
                            },
                          },
                        ]
                      : [],
                  )
                : []),
          ]),
        ),
      ),
    ]),
  ];
  if (availabilitySources.length > 256) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Grids App may contain at most 256 availability queries" }] };
  }
  for (const source of availabilitySources) {
    const compiled = await compileCustomAppQuery({
      baseId: definition.baseId,
      source: source.query,
      context: source.page
        ? representativeQueryContext(definition, source.page, base.name)
        : representativeGlobalQueryContext(definition, base.name),
      ...(source.page ? {} : { allowedContextKeys: customAppGlobalContextKeys() }),
    });
    const targetPath =
      source.target.target === "sidebarAction"
        ? ["sidebar", "actions", source.target.actionId, "availableWhen"]
        : [
            "pages",
            source.target.pageId,
            ...(source.target.target === "page" ? [] : ["blocks", source.target.blockId]),
            ...(source.target.target === "action" ? ["actions", source.target.actionId] : []),
            "availableWhen",
          ];
    if (!compiled.ok) {
      diagnostics.push({ path: targetPath, message: compiled.error });
      continue;
    }
    const tableIds = collectDslPlanTableIds(compiled.data.plan, compiled.data.fieldsByTableId).sort();
    if (tableIds.length > 24) {
      diagnostics.push({ path: targetPath, message: "Availability query may reference at most 24 tables" });
      continue;
    }
    availability.push({
      ...source.target,
      sourceHash: customAppViewSourceHash(definition.baseId, source.query),
      planHash: compiled.data.planHash,
      tableIds,
    });
  }

  for (const [pageIndex, page] of definition.pages.entries()) {
    for (const [parameterId, parameter] of Object.entries(page.parameters)) {
      if ((await resolveTableBaseId(parameter.tableId)) !== definition.baseId) {
        diagnostics.push({
          path: ["pages", pageIndex, "parameters", parameterId, "tableId"],
          message: "Record parameter table is missing or belongs to another base",
        });
      }
    }
    if (!page.record) continue;
    const recordBlocks = page.rows.flatMap((row) =>
      row.columns.flatMap((column) => column.blocks.filter((block) => block.type === "record")),
    );
    const fieldIds = customAppPageRecordFieldIds(page);
    const editableFieldIds = [...new Set(recordBlocks.flatMap((block) => block.editableFieldIds))].sort();
    if ((await resolveTableBaseId(page.record.tableId)) !== definition.baseId) {
      diagnostics.push({
        path: ["pages", pageIndex, "record", "tableId"],
        message: "Page record table is missing or belongs to another base",
      });
      continue;
    }
    let relationLabels: CustomAppCapabilities["records"][number]["relationLabels"] = [];
    if (fieldIds.length > 0) {
      const fields = (await resolveFields(page.record.tableId)).filter((field) => fieldIds.includes(field.id));
      const found = new Set(fields.map((field) => field.id));
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      for (const fieldId of fieldIds) {
        if (!found.has(fieldId)) {
          diagnostics.push({
            path: ["pages", pageIndex, "record", "fieldIds"],
            message: `Field ${fieldId} is missing or belongs to another table`,
          });
        }
      }
      for (const fieldId of editableFieldIds) {
        const field = fieldsById.get(fieldId);
        if (field && !isRecordWritableFieldType(field.type)) {
          diagnostics.push({
            path: ["pages", pageIndex, "record", "editableFieldIds"],
            message: `Field ${fieldId} is not a writable record field`,
          });
        }
      }
      const targetTableIds = [
        ...new Set(
          fields.flatMap((field) => {
            if (field.type !== "relation") return [];
            const targetTableId = (field.config as { targetTableId?: unknown }).targetTableId;
            return typeof targetTableId === "string" ? [targetTableId] : [];
          }),
        ),
      ];
      const targetFieldsByTableId = new Map<string, Field[]>();
      for (const targetTableId of targetTableIds) {
        if ((await resolveTableBaseId(targetTableId)) !== definition.baseId) {
          diagnostics.push({
            path: ["pages", pageIndex, "record", "fieldIds"],
            message: `Relation target table ${targetTableId} is missing or belongs to another base`,
          });
          continue;
        }
        targetFieldsByTableId.set(targetTableId, await resolveFields(targetTableId));
      }
      relationLabels = customAppRecordRelationSnapshot(fields, targetFieldsByTableId);
    }
    pageRecords.push({ pageId: page.id, tableId: page.record.tableId, fieldIds, editableFieldIds, relationLabels });
    for (const { block } of commentBlocks.filter((candidate) => candidate.page.id === page.id)) {
      comments.push({ pageId: page.id, blockId: block.id, tableId: page.record.tableId });
    }
    const pageTemplateIds = [...new Set(recordBlocks.flatMap((block) => block.documents?.templateIds ?? []))].sort();
    const pageTemplates =
      pageTemplateIds.length === 0
        ? []
        : await client<Array<{ id: string; table_id: string }>>`
            SELECT id, table_id
            FROM grids.document_templates
            WHERE deleted_at IS NULL AND id = ANY(${toPgUuidArray(pageTemplateIds)}::uuid[])
          `;
    const templatesById = new Map(pageTemplates.map((template) => [template.id, template]));
    for (const block of recordBlocks) {
      const templateIds = [...(block.documents?.templateIds ?? [])].sort();
      if (templateIds.length === 0) continue;
      for (const templateId of templateIds) {
        const template = templatesById.get(templateId);
        if (!template || template.table_id !== page.record.tableId) {
          diagnostics.push({
            path: ["pages", page.id, "blocks", block.id, "documents", "templateIds"],
            message: `Document template ${templateId} is missing or belongs to another table`,
          });
        }
      }
      documents.push({ pageId: page.id, blockId: block.id, tableId: page.record.tableId, templateIds });
    }
  }

  for (const { page, block } of recordsBlocks) {
    const source =
      block.source.kind === "view"
        ? await client<Array<{ view_id: string; table_id: string; base_id: string; source: string; ui: unknown }>>`
            SELECT v.id AS view_id, v.table_id, t.base_id, v.source, v.ui
            FROM grids.views v
            JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
            WHERE v.id = ${block.source.viewId}::uuid AND v.deleted_at IS NULL
          `.then(([view]) => {
            if (!view || view.base_id !== definition.baseId) return null;
            const ui = ViewUiSettingsSchema.safeParse(parseJsonbRow(view.ui, {}));
            return {
              kind: "view" as const,
              query: view.source,
              currentTableId: view.table_id,
              viewId: view.view_id,
              ui: ui.success ? ui.data : {},
            };
          })
        : { kind: "gql" as const, query: block.source.query };
    if (!source) {
      diagnostics.push({ path: ["blocks", block.id, "source", "viewId"], message: "View is missing or belongs to another base" });
      continue;
    }
    const compiled = await compileCustomAppQuery({
      baseId: definition.baseId,
      source: source.query,
      context: representativeQueryContext(definition, page, base.name),
      ...(source.kind === "view" ? { currentTableId: source.currentTableId } : {}),
    });
    if (!compiled.ok) {
      diagnostics.push({ path: ["pages", page.id, "blocks", block.id, "source"], message: compiled.error });
      continue;
    }
    const plan = compiled.data.plan;
    const aggregationCount =
      (plan.query.aggregations?.length ?? 0) + (plan.sqlAggregations?.length ?? 0) + (plan.formulaAggregations?.length ?? 0);
    const groupCount = (plan.query.groupBy?.length ?? 0) + (plan.sqlGroupBy?.length ?? 0);
    if (aggregationCount > 0 || groupCount > 0) {
      diagnostics.push({ path: ["pages", page.id, "blocks", block.id, "source"], message: "Records source must return ordinary records" });
      continue;
    }
    const tableIds = collectDslPlanTableIds(plan, compiled.data.fieldsByTableId).sort();
    if (tableIds.length > 24) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "source"],
        message: "Records source may reference at most 24 tables",
      });
      continue;
    }
    const primaryTableId = plan.tableId;
    recordsPrimaryTableIds.set(`${page.id}\0${block.id}`, primaryTableId);
    if (block.rowNavigate) {
      const targetPage = definition.pages.find((candidate) => candidate.id === block.rowNavigate!.pageId)!;
      for (const parameterId of Object.keys(block.rowNavigate.params)) {
        if (targetPage.parameters[parameterId]?.tableId !== primaryTableId) {
          diagnostics.push({
            path: ["pages", page.id, "blocks", block.id, "rowNavigate", "params", parameterId],
            message: "Row record ids may only populate parameters for the source table",
          });
        }
      }
    }
    if (source.kind === "view") {
      const found = new Set(tableIds.flatMap((tableId) => (compiled.data.fieldsByTableId[tableId] ?? []).map((field) => field.id)));
      for (const fieldId of block.display.kind === "table" ? block.display.columnIds : []) {
        if (!found.has(fieldId))
          diagnostics.push({
            path: ["blocks", block.id, "display", "columnIds"],
            message: `Field ${fieldId} is missing or belongs to another table`,
          });
      }
      const primaryFields = compiled.data.fieldsByTableId[source.currentTableId] ?? [];
      const viewDisplayConfig = block.display.kind === "cards" ? source.ui.displayConfig : undefined;
      if (block.display.kind === "cards" && viewDisplayConfig?.mode !== "cards") {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "display"],
          message: "Cards display requires a saved View whose display is Cards",
        });
      }
      const configuredCardFieldIds = viewDisplayConfig?.cards?.fieldIds ?? [];
      const resolvedCardFieldIds =
        configuredCardFieldIds.length > 0
          ? configuredCardFieldIds
          : primaryFields
              .filter((field) => !field.deletedAt && !field.hideInTable && field.type !== "file")
              .sort((left, right) => left.position - right.position)
              .slice(0, 4)
              .map((field) => field.id);
      const displayConfig = viewDisplayConfig
        ? { ...viewDisplayConfig, cards: { ...viewDisplayConfig.cards, fieldIds: resolvedCardFieldIds } }
        : undefined;
      const displayFieldIds = [
        ...(displayConfig?.cards?.fieldIds ?? []),
        ...(displayConfig?.cards?.imageFieldId ? [displayConfig.cards.imageFieldId] : []),
      ];
      const primaryFieldsById = new Map(primaryFields.map((field) => [field.id, field]));
      for (const fieldId of displayFieldIds) {
        const field = primaryFieldsById.get(fieldId);
        if (!field || field.deletedAt) {
          diagnostics.push({ path: ["pages", page.id, "blocks", block.id, "display"], message: `Card field ${fieldId} is unavailable` });
        }
      }
      if (displayConfig?.cards?.imageFieldId && primaryFieldsById.get(displayConfig.cards.imageFieldId)?.type !== "file") {
        diagnostics.push({ path: ["pages", page.id, "blocks", block.id, "display"], message: "Card cover must use a file field" });
      }
      const cardFields = displayFieldIds.flatMap((fieldId) => {
        const field = primaryFieldsById.get(fieldId);
        return field ? [field] : [];
      });
      const relationTargetTableIds = [
        ...new Set(
          cardFields.flatMap((field) => {
            const targetTableId = field.type === "relation" ? (field.config as { targetTableId?: unknown }).targetTableId : null;
            return typeof targetTableId === "string" ? [targetTableId] : [];
          }),
        ),
      ];
      const relationLabels = customAppRecordRelationSnapshot(cardFields, await listFieldsByTables(relationTargetTableIds));
      views.push({
        viewId: source.viewId,
        tableId: primaryTableId,
        sourceHash: customAppViewSourceHash(source.currentTableId, source.query),
        planHash: compiled.data.planHash,
        tableIds,
        ...(displayConfig
          ? { displayConfig, displayFieldHash: customAppRecordsDisplayFieldHash(displayConfig, primaryFields), relationLabels }
          : {}),
      });
    } else recordQueries.push({ pageId: page.id, blockId: block.id, primaryTableId, planHash: compiled.data.planHash, tableIds });
  }

  for (const { page, block } of insightBlocks) {
    const source =
      block.source.kind === "view"
        ? await client<Array<{ view_id: string; table_id: string; base_id: string; source: string }>>`
            SELECT v.id AS view_id, v.table_id, t.base_id, v.source
            FROM grids.views v
            JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
            WHERE v.id = ${block.source.viewId}::uuid AND v.deleted_at IS NULL
          `.then(([view]) =>
            !view || view.base_id !== definition.baseId
              ? null
              : { kind: "view" as const, query: view.source, currentTableId: view.table_id, viewId: view.view_id },
          )
        : { kind: "gql" as const, query: block.source.query };
    if (!source) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "source", "viewId"],
        message: "View is missing or belongs to another base",
      });
      continue;
    }
    const compiled = await compileCustomAppQuery({
      baseId: definition.baseId,
      source: source.query,
      context: representativeQueryContext(definition, page, base.name),
      ...(source.kind === "view" ? { currentTableId: source.currentTableId } : {}),
    });
    if (!compiled.ok) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "source"],
        message: compiled.error,
      });
      continue;
    }
    const plan = compiled.data.plan;
    const aggregationCount =
      (plan.query.aggregations?.length ?? 0) + (plan.sqlAggregations?.length ?? 0) + (plan.formulaAggregations?.length ?? 0);
    const groupCount = (plan.query.groupBy?.length ?? 0) + (plan.sqlGroupBy?.length ?? 0);
    if (block.type === "metrics") {
      if (!isDslAggregateOnlyPlan(plan)) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "source"],
          message: "Metrics source must return ungrouped scalar aggregations",
        });
        continue;
      }
      if (aggregationCount > 12) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "source"],
          message: "Metrics source may return at most 12 aggregations",
        });
        continue;
      }
    } else {
      const minimumAggregations = block.chartType === "scatter" ? 2 : 1;
      if (groupCount === 0 || aggregationCount < minimumAggregations) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "source"],
          message:
            block.chartType === "scatter"
              ? "Scatter chart source must group rows and include at least two aggregations"
              : "Chart source must group rows and include at least one aggregation",
        });
        continue;
      }
    }
    const tableIds = collectDslPlanTableIds(plan, compiled.data.fieldsByTableId).sort();
    if (tableIds.length > 24) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "source"],
        message: "Metrics and Chart sources may reference at most 24 tables",
      });
      continue;
    }
    insights.push({
      pageId: page.id,
      blockId: block.id,
      blockType: block.type,
      source:
        source.kind === "view"
          ? {
              kind: "view",
              viewId: source.viewId,
              sourceHash: customAppViewSourceHash(source.currentTableId, source.query),
              planHash: compiled.data.planHash,
              tableIds,
            }
          : { kind: "gql", planHash: compiled.data.planHash, tableIds },
    });
  }

  const formOwners = [
    ...formBlocks.map(({ page, block }) => ({
      page,
      block,
      formPath: ["pages", page.id, "blocks", block.id] as Array<string | number>,
      capabilityIdentity: { pageId: page.id, blockId: block.id },
    })),
    ...sidebarFormActions.map((block) => ({
      page: undefined,
      block,
      formPath: ["sidebar", "actions", block.id] as Array<string | number>,
      capabilityIdentity: { sidebarActionId: block.id },
    })),
  ];
  for (const { page, block, formPath, capabilityIdentity } of formOwners) {
    const [formRow] = await client<Array<{ table_id: string; base_id: string; config: unknown; is_active: boolean }>>`
      SELECT f.table_id, t.base_id, f.config, f.is_active
      FROM grids.forms f
      JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
      WHERE f.id = ${block.formId}::uuid AND f.deleted_at IS NULL
    `;
    if (!formRow || formRow.base_id !== definition.baseId || !formRow.is_active) {
      diagnostics.push({
        path: [...formPath, "formId"],
        message: "Form is missing, inactive, or belongs to another base",
      });
      continue;
    }

    const config = normalizeFormConfig(formRow.config);
    const userInputFieldIds = config.fields
      .filter((entry) => entry.kind === "user_input")
      .map((entry) => entry.fieldId)
      .sort();
    const userInputFieldIdSet = new Set(userInputFieldIds);
    const fixedFieldIds = Object.keys(block.fixedValues).sort();
    if (userInputFieldIds.length > 100) {
      diagnostics.push({
        path: [...formPath, "formId"],
        message: "A Grids App Form may expose at most 100 input fields",
      });
      continue;
    }
    if (fixedFieldIds.length > 30) {
      diagnostics.push({
        path: [...formPath, "fixedValues"],
        message: "A Grids App Form may bind at most 30 fixed fields",
      });
      continue;
    }
    const fieldIds = [...new Set([...userInputFieldIds, ...fixedFieldIds])];
    const formFieldIds = [...new Set(config.fields.map((entry) => entry.fieldId))];
    const fields =
      formFieldIds.length === 0
        ? []
        : await client<
            Array<{
              id: string;
              table_id: string;
              type: string;
              config: unknown;
              required: boolean;
              default_value: unknown;
              deleted_at: Date | null;
            }>
          >`
            SELECT id, table_id, type, config, required, default_value, deleted_at
            FROM grids.fields
            WHERE table_id = ${formRow.table_id}::uuid
              AND id = ANY(${toPgUuidArray(formFieldIds)}::uuid[])
          `;
    const capabilityFields: CustomAppFormSecurityField[] = fields.map((field) => ({
      id: field.id,
      tableId: field.table_id,
      type: field.type,
      config: field.config,
      required: field.required,
      defaultValue: parseJsonbRow<unknown>(field.default_value, null),
      deletedAt: field.deleted_at?.toISOString() ?? null,
    }));
    const fieldsById = new Map(capabilityFields.map((field) => [field.id, field]));
    for (const fieldId of formFieldIds) {
      const field = fieldsById.get(fieldId);
      if (!field || field.deletedAt || !isRecordWritableFieldType(field.type)) {
        diagnostics.push({
          path: [...formPath, "formId"],
          message: `Form field ${fieldId} is missing, deleted, unwritable, or belongs to another table`,
        });
      }
    }
    for (const entry of config.fields) {
      if (entry.kind !== "user_input" || !entry.inlineCreate?.enabled) continue;
      const field = fieldsById.get(entry.fieldId);
      const targetTableId =
        field?.type === "relation" && field.config && typeof field.config === "object"
          ? (field.config as { targetTableId?: unknown }).targetTableId
          : null;
      if (typeof targetTableId !== "string" || (entry.inlineCreate.fields ?? []).length === 0) {
        diagnostics.push({
          path: [...formPath, "formId"],
          message: `Inline-create field ${entry.fieldId} has no valid relation target or target fields`,
        });
      }
    }
    const inlineTargetReferences = customAppFormInlineTargetReferences(config, capabilityFields);
    const inlineTargetFieldIds = [...new Set(inlineTargetReferences.map((reference) => reference.fieldId))];
    const inlineTargetFields =
      inlineTargetFieldIds.length === 0
        ? []
        : await client<
            Array<{
              id: string;
              table_id: string;
              type: string;
              config: unknown;
              required: boolean;
              default_value: unknown;
              deleted_at: Date | null;
            }>
          >`
            SELECT f.id, f.table_id, f.type, f.config, f.required, f.default_value, f.deleted_at
            FROM grids.fields f
            JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
            JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
            WHERE f.id = ANY(${toPgUuidArray(inlineTargetFieldIds)}::uuid[])
          `;
    const inlineCapabilityFields: CustomAppFormSecurityField[] = inlineTargetFields.map((field) => ({
      id: field.id,
      tableId: field.table_id,
      type: field.type,
      config: field.config,
      required: field.required,
      defaultValue: parseJsonbRow<unknown>(field.default_value, null),
      deletedAt: field.deleted_at?.toISOString() ?? null,
    }));
    const inlineFieldsByKey = new Map(inlineCapabilityFields.map((field) => [`${field.tableId}\0${field.id}`, field]));
    for (const reference of inlineTargetReferences) {
      const field = inlineFieldsByKey.get(`${reference.tableId}\0${reference.fieldId}`);
      if (!field || field.deletedAt || !isRecordWritableFieldType(field.type) || field.type === "relation") {
        diagnostics.push({
          path: [...formPath, "formId"],
          message: `Inline-create field ${reference.fieldId} is missing, deleted, unwritable, or belongs to another table`,
        });
      }
    }
    for (const [fieldId, value] of Object.entries(block.fixedValues)) {
      const field = fieldsById.get(fieldId);
      if (!userInputFieldIdSet.has(fieldId)) {
        diagnostics.push({
          path: [...formPath, "fixedValues", fieldId],
          message: "A fixed value must target a user-input field in the referenced Form",
        });
        continue;
      }
      if (!field) continue;
      if (value.source === "AUTH") {
        if (field.type !== "principal") {
          diagnostics.push({
            path: [...formPath, "fixedValues", fieldId],
            message: "The current user may only bind a People and groups field",
          });
        }
        continue;
      }
      if (value.source === "LITERAL") {
        const handler = getRecordWritableFieldType(field.type);
        const normalized = handler?.validate(value.value, field.config, field.required);
        if (!normalized?.ok || normalized.value === undefined) {
          diagnostics.push({
            path: [...formPath, "fixedValues", fieldId, "value"],
            message: `Fixed value is invalid for Form field ${fieldId}${normalized && !normalized.ok ? `: ${normalized.error}` : ""}`,
          });
        } else {
          value.value = normalized.value as typeof value.value;
        }
        continue;
      }
      const fieldConfig = parseJsonbRow<{ targetTableId?: unknown }>(field?.config, {});
      if (field?.type !== "relation" || typeof fieldConfig.targetTableId !== "string") {
        diagnostics.push({
          path: [...formPath, "fixedValues", fieldId],
          message: "Record sources may only bind compatible relation fields",
        });
      } else if (!page || fieldConfig.targetTableId !== customAppBindingRecordTableId(value, page)) {
        diagnostics.push({
          path: [...formPath, "fixedValues", fieldId],
          message: "Fixed relation field and record source must reference the same table",
        });
      }
    }

    if (block.onSuccessNavigate) {
      const targetPage = definition.pages.find((candidate) => candidate.id === block.onSuccessNavigate!.pageId)!;
      for (const [parameterId, value] of Object.entries(block.onSuccessNavigate.params)) {
        if (value.source === "RESULT" && targetPage.parameters[parameterId]?.tableId !== formRow.table_id) {
          diagnostics.push({
            path: [...formPath, "onSuccessNavigate", "params", parameterId],
            message: "RESULT.recordId may only populate a record parameter for the Form table",
          });
        }
      }
    }

    forms.push({
      ...capabilityIdentity,
      formId: block.formId,
      tableId: formRow.table_id,
      userInputFieldIds,
      fixedFieldIds,
      fieldHash: customAppFormFieldHash(fieldIds, capabilityFields),
      formSecurityHash: customAppFormSecurityHash({
        tableId: formRow.table_id,
        config,
        fields: [...capabilityFields, ...inlineCapabilityFields],
      }),
    });
  }

  const workflowActionOwners = [
    ...actionBlocks.flatMap(({ page, block }) =>
      block.actions
        .filter((action) => action.kind === "workflow")
        .map((action) => ({
          page,
          action,
          actionPath: ["pages", page.id, "blocks", block.id, "actions", action.id] as Array<string | number>,
          capabilityIdentity: { pageId: page.id, blockId: block.id, actionId: action.id },
          rowTableId: undefined,
        })),
    ),
    ...recordsBlocks.flatMap(({ page, block }) =>
      (block.rowActions ?? []).map((action) => ({
        page,
        action,
        actionPath: ["pages", page.id, "blocks", block.id, "rowActions", action.id] as Array<string | number>,
        capabilityIdentity: { pageId: page.id, blockId: block.id, actionId: action.id },
        rowTableId: recordsPrimaryTableIds.get(`${page.id}\0${block.id}`),
      })),
    ),
    ...sidebarWorkflowActions.map((action) => ({
      page: undefined,
      action,
      actionPath: ["sidebar", "actions", action.id] as Array<string | number>,
      capabilityIdentity: { sidebarActionId: action.id },
      rowTableId: undefined,
    })),
  ];
  for (const { page, action, actionPath, capabilityIdentity, rowTableId } of workflowActionOwners) {
    const launcher = await getLauncher(action.launcherId, client);
    if (
      !launcher ||
      launcher.baseId !== definition.baseId ||
      launcher.deletedAt !== null ||
      !launcher.enabled ||
      launcher.diagnostics.some((item) => item.severity === "error") ||
      launcher.config.kind !== "customApp"
    ) {
      diagnostics.push({
        path: [...actionPath, "launcherId"],
        message: "Workflow launcher is missing, disabled, invalid, unsupported, or belongs to another base",
      });
      continue;
    }
    const workflow = await getWorkflow(launcher.workflowId, false, client);
    if (
      !workflow ||
      workflow.baseId !== definition.baseId ||
      workflow.deletedAt !== null ||
      !workflow.enabled ||
      workflow.revision !== launcher.validatedRevision ||
      workflow.diagnostics.some((item) => item.severity === "error")
    ) {
      diagnostics.push({
        path: [...actionPath, "launcherId"],
        message: "Workflow launcher does not reference a ready workflow revision",
      });
      continue;
    }
    if (launcher.config.inputMode === "fixed" && Object.keys(action.inputs).length > 0) {
      diagnostics.push({
        path: [...actionPath, "inputs"],
        message: "Fixed workflow launchers do not accept Grids App inputs",
      });
      continue;
    }
    if (launcher.config.inputMode === "prompt") {
      const inputsByName = new Map(workflow.plan.inputs.map((input) => [input.name, input]));
      for (const inputName of Object.keys(action.inputs)) {
        if (!inputsByName.has(inputName)) {
          diagnostics.push({
            path: [...actionPath, "inputs", inputName],
            message: `Unknown workflow input "${inputName}"`,
          });
        }
      }
      for (const input of workflow.plan.inputs) {
        const value = action.inputs[input.name];
        if (!value) {
          const message = workflowInputShapeError(input, undefined);
          if (message) {
            diagnostics.push({
              path: [...actionPath, "inputs", input.name],
              message: `Workflow input "${input.name}" ${message}`,
            });
          }
          continue;
        }
        if (value.source === "LITERAL") {
          const message = workflowInputShapeError(input, value.value);
          if (message) {
            diagnostics.push({
              path: [...actionPath, "inputs", input.name],
              message: `Workflow input "${input.name}" ${message}`,
            });
          }
          continue;
        }
        const sourceTableId = page ? customAppBindingRecordTableId(value, page, rowTableId) : null;
        const boundTableId = workflow.plan.bindings[`inputs.${input.name}.table`];
        if (input.type !== "record" || typeof boundTableId !== "string" || sourceTableId !== boundTableId) {
          diagnostics.push({
            path: [...actionPath, "inputs", input.name],
            message: `Workflow input "${input.name}" must be a record input bound to the referenced table`,
          });
        }
      }
    }
    workflowLaunchers.push({
      ...capabilityIdentity,
      launcherId: launcher.id,
      workflowId: workflow.id,
      revision: workflow.revision,
    });
  }
  for (const { page, block } of recordsBlocks) {
    const tableId = recordsPrimaryTableIds.get(`${page.id}\0${block.id}`);
    for (const action of block.bulkActions ?? []) {
      const actionPath = ["pages", page.id, "blocks", block.id, "bulkActions", action.id] as Array<string | number>;
      const launcher = await getLauncher(action.launcherId, client);
      if (
        !tableId ||
        !launcher ||
        launcher.baseId !== definition.baseId ||
        launcher.deletedAt !== null ||
        !launcher.enabled ||
        launcher.diagnostics.some((item) => item.severity === "error") ||
        launcher.config.kind !== "bulk"
      ) {
        diagnostics.push({
          path: [...actionPath, "launcherId"],
          message: "Bulk launcher is missing, disabled, invalid, unsupported, or belongs to another base",
        });
        continue;
      }
      const workflow = await getWorkflow(launcher.workflowId, false, client);
      const inputTableId = workflow?.plan.bindings[`inputs.${launcher.config.input}.table`];
      if (
        !workflow ||
        workflow.baseId !== definition.baseId ||
        workflow.deletedAt !== null ||
        !workflow.enabled ||
        workflow.revision !== launcher.validatedRevision ||
        workflow.diagnostics.some((item) => item.severity === "error") ||
        inputTableId !== tableId
      ) {
        diagnostics.push({
          path: [...actionPath, "launcherId"],
          message: "Bulk launcher does not reference a ready record-list workflow for this Records source",
        });
        continue;
      }
      workflowLaunchers.push({
        pageId: page.id,
        blockId: block.id,
        actionId: action.id,
        launcherId: launcher.id,
        workflowId: workflow.id,
        revision: workflow.revision,
      });
    }
  }
  for (const { page, block } of scannerBlocks) {
    const launcher = await getLauncher(block.launcherId, client);
    if (
      !launcher ||
      launcher.baseId !== definition.baseId ||
      launcher.deletedAt !== null ||
      !launcher.enabled ||
      launcher.diagnostics.some((item) => item.severity === "error") ||
      launcher.config.kind !== "scanner"
    ) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "launcherId"],
        message: "Scanner launcher is missing, disabled, invalid, unsupported, or belongs to another base",
      });
      continue;
    }
    const workflow = await getWorkflow(launcher.workflowId, false, client);
    if (
      !workflow ||
      workflow.baseId !== definition.baseId ||
      workflow.deletedAt !== null ||
      !workflow.enabled ||
      workflow.revision !== launcher.validatedRevision ||
      workflow.diagnostics.some((item) => item.severity === "error")
    ) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "launcherId"],
        message: "Scanner launcher does not reference a ready workflow revision",
      });
      continue;
    }
    const sources = scannerLauncherInputSources(launcher.config);
    const promptRecordInput = workflow.plan.inputs.find((input) => {
      const source = sources[input.name];
      return (source?.kind === "session" || source?.kind === "afterScan") && (input.type === "record" || input.type === "recordList");
    });
    if (promptRecordInput) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "launcherId"],
        message: `Scanner Apps cannot prompt for record input "${promptRecordInput.name}"`,
      });
      continue;
    }
    scannerLaunchers.push({
      pageId: page.id,
      blockId: block.id,
      launcherId: launcher.id,
      workflowId: workflow.id,
      revision: workflow.revision,
      configHash: customAppScannerConfigHash(launcher.config),
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const viewsById = new Map<string, CustomAppCapabilities["views"][number]>();
  for (const view of views) {
    const existing = viewsById.get(view.viewId);
    viewsById.set(
      view.viewId,
      view.displayConfig || !existing || !existing.displayConfig
        ? view
        : {
            ...view,
            displayConfig: existing.displayConfig,
            displayFieldHash: existing.displayFieldHash,
            relationLabels: existing.relationLabels,
          },
    );
  }

  const capabilities = CustomAppCapabilitiesSchema.parse({
    availability: availability.sort(
      (left, right) =>
        ("pageId" in left ? left.pageId : "").localeCompare("pageId" in right ? right.pageId : "") ||
        ("blockId" in left ? left.blockId : "").localeCompare("blockId" in right ? right.blockId : "") ||
        ("actionId" in left ? left.actionId : "").localeCompare("actionId" in right ? right.actionId : ""),
    ),
    views: [...viewsById.values()].sort((left, right) => left.viewId.localeCompare(right.viewId)),
    insights: insights.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    recordQueries: recordQueries.sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId),
    ),
    records: pageRecords.sort((left, right) => left.pageId.localeCompare(right.pageId)),
    forms: forms.sort((left, right) =>
      ("pageId" in left ? `${left.pageId}\0${left.blockId}` : left.sidebarActionId).localeCompare(
        "pageId" in right ? `${right.pageId}\0${right.blockId}` : right.sidebarActionId,
      ),
    ),
    comments: comments.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    documents: documents.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    workflowLaunchers: workflowLaunchers.sort((left, right) =>
      ("pageId" in left ? `${left.pageId}\0${left.blockId}\0${left.actionId}` : left.sidebarActionId).localeCompare(
        "pageId" in right ? `${right.pageId}\0${right.blockId}\0${right.actionId}` : right.sidebarActionId,
      ),
    ),
    scannerLaunchers: scannerLaunchers.sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId),
    ),
  });
  return { ok: true, compiled: { definition, capabilities } };
};

export const get = async (id: string, client: SqlClient = sql): Promise<CustomApp | null> => {
  const [row] = await client<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  return row ? mapRow(row) : null;
};

export const getByIdOrShortId = async (baseId: string, idOrShortId: string, client: SqlClient = sql): Promise<CustomApp | null> => {
  const [row] = await client<DbRow[]>`
    SELECT *
    FROM grids.custom_apps
    WHERE base_id = ${baseId}::uuid AND (id::text = ${idOrShortId} OR short_id = ${idOrShortId}) AND deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

export const getPublishedByShortId = async (shortId: string): Promise<CustomApp | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT app.*
    FROM grids.custom_apps app
    JOIN grids.bases base ON base.id = app.base_id AND base.deleted_at IS NULL
    WHERE app.short_id = ${shortId} AND app.published_definition IS NOT NULL AND app.deleted_at IS NULL
  `;
  if (!row) return null;
  const app = mapRow(row);
  return app.publishedValid ? app : null;
};

export const listByBase = async (baseId: string): Promise<CustomApp[]> => {
  const rows = await sql<DbRow[]>`SELECT * FROM grids.custom_apps WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL ORDER BY name, id`;
  return rows.map(mapRow);
};

export const listSummariesByBase = async (baseId: string): Promise<CustomAppSummary[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, short_id, base_id, name, icon, draft_definition, draft_capabilities,
           published_definition, published_capabilities, published_at, updated_at
    FROM grids.custom_apps
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
    ORDER BY name, id
  `;
  return rows.map(mapSummaryRow);
};

export const plan = async (input: unknown): Promise<CustomAppPlan> => {
  const compilation = await compile(input);
  if (!compilation.ok) return { valid: false, diagnostics: compilation.diagnostics, action: "invalid", changes: [] };
  const { definition, capabilities } = compilation.compiled;
  const existing = await get(definition.id);
  if (!existing) {
    if (definition.shortId) {
      return {
        valid: false,
        diagnostics: [{ path: ["shortId"], message: "shortId is assigned by the server on first apply" }],
        action: "invalid",
        changes: [],
      };
    }
    return { valid: true, diagnostics: [], action: "create", changes: ["app"] };
  }
  const diagnostics: CustomAppDiagnostic[] = [];
  if (existing.baseId !== definition.baseId) diagnostics.push({ path: ["baseId"], message: "baseId is immutable" });
  if (definition.shortId !== undefined && definition.shortId !== existing.shortId) {
    diagnostics.push({ path: ["shortId"], message: "shortId is immutable after first apply" });
  }
  if (diagnostics.length > 0) return { valid: false, diagnostics, action: "invalid", changes: [] };
  const normalizedDefinition = { ...definition, shortId: existing.shortId };
  const changes: string[] = [];
  if (stableStringify(existing.draftDefinition) !== stableStringify(normalizedDefinition)) changes.push("definition");
  if (stableStringify(existing.draftCapabilities) !== stableStringify(capabilities)) changes.push("capabilities");
  return { valid: true, diagnostics: [], action: changes.length === 0 ? "noop" : "update", changes };
};

export type CustomAppDraftSave = {
  app: CustomApp;
  valid: boolean;
  diagnostics: CustomAppDiagnostic[];
};

export const saveDraft = async (id: string, input: unknown): Promise<Result<CustomAppDraftSave>> => {
  const parsed = CustomAppDefinitionSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      err.badInput(
        zodDiagnostics(parsed.error)
          .map((item) => item.message)
          .join("; "),
      ),
    );
  return sql.begin(async (tx): Promise<Result<CustomAppDraftSave>> => {
    const [locked] = await tx<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!locked) return fail(err.notFound("Grids App"));
    const existing = mapRow(locked);
    if (parsed.data.id !== existing.id || parsed.data.baseId !== existing.baseId)
      return fail(err.badInput("Grids App identity is immutable"));
    if (parsed.data.shortId !== undefined && parsed.data.shortId !== existing.shortId) return fail(err.badInput("shortId is immutable"));
    const definition = { ...parsed.data, shortId: existing.shortId };
    const compilation = await compile(definition, tx);
    const capabilities = compilation.ok ? compilation.compiled.capabilities : null;
    const diagnostics = compilation.ok ? [] : compilation.diagnostics;
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET name = ${definition.name}, icon = ${definition.icon ?? null}, draft_definition = ${definition}::jsonb,
          draft_capabilities = ${capabilities}::jsonb, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING *
    `;
    if (!updated) return fail(err.notFound("Grids App"));
    const app = mapRow(updated);
    return ok({ app, valid: compilation.ok, diagnostics });
  });
};

export const restoreDraft = async (id: string, actorId: string | null = null): Promise<Result<CustomApp>> =>
  sql.begin(async (tx): Promise<Result<CustomApp>> => {
    const [locked] = await tx<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!locked) return fail(err.notFound("Grids App"));
    if (!locked.published_definition || !locked.published_capabilities) return fail(err.badInput("Grids App has no live version"));
    const publishedRaw = parseJsonbRow(locked.published_definition, {});
    const published = parseStoredCustomAppDefinition(publishedRaw, "published");
    if (!published.definition) return fail(err.badInput(published.diagnostics.map((item) => item.message).join("; ")));
    const publishedDefinition = published.definition;
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET name = ${publishedDefinition.name}, icon = ${publishedDefinition.icon ?? null},
          draft_definition = published_definition, draft_capabilities = published_capabilities, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING *
    `;
    if (!updated) return fail(err.notFound("Grids App"));
    const app = mapRow(updated);
    await logAudit(
      {
        baseId: app.baseId,
        userId: actorId,
        action: "updated",
        diff: { customAppDraftRestore: { old: locked.updated_at, new: app.updatedAt } },
      },
      tx,
    );
    return ok(app);
  });

export const createBlank = async (baseId: string, name: string, actorId: string | null = null): Promise<Result<CustomApp>> => {
  const definition: CustomAppDefinition = {
    schemaVersion: 3,
    kind: "grids.custom-app",
    id: crypto.randomUUID(),
    baseId,
    name,
    startPageId: "home",
    pages: [
      {
        id: "home",
        title: "Home",
        navigation: { visible: true, order: 0 },
        parameters: {},
        rows: [
          {
            id: "row-1",
            columns: [{ id: "column-1", span: 12, blocks: [{ id: "welcome", type: "markdown", markdown: `# ${name}` }] }],
          },
        ],
      },
    ],
  };
  return apply(definition, actorId);
};

export const apply = async (input: unknown, actorId: string | null = null): Promise<Result<CustomApp>> => {
  const planned = await plan(input);
  if (!planned.valid)
    return fail(err.badInput(planned.diagnostics.map((diagnostic) => `${diagnostic.path.join(".")}: ${diagnostic.message}`).join("; ")));
  const parsed = CustomAppDefinitionSchema.parse(input);
  if (planned.action === "noop") return ok((await get(parsed.id))!);

  return sql.begin(async (tx): Promise<Result<CustomApp>> => {
    const compilation = await compile(parsed, tx);
    if (!compilation.ok) return fail(err.badInput(compilation.diagnostics.map((item) => item.message).join("; ")));
    const { capabilities } = compilation.compiled;
    if (planned.action === "create") {
      const row = await insertWithShortId(async (shortId) => {
        const definition = { ...parsed, shortId };
        const [created] = await tx<DbRow[]>`
          INSERT INTO grids.custom_apps (id, short_id, base_id, name, icon, draft_definition, draft_capabilities)
          VALUES (${definition.id}::uuid, ${shortId}, ${definition.baseId}::uuid, ${definition.name}, ${definition.icon ?? null}, ${definition}::jsonb, ${capabilities}::jsonb)
          RETURNING *
        `;
        if (!created) throw err.internal("Failed to create Grids App");
        return created;
      }, "idx_grids_custom_apps_short_id");
      const app = mapRow(row);
      await logAudit(
        {
          baseId: app.baseId,
          userId: actorId,
          action: "created",
          diff: { customApp: { old: null, new: { id: app.id, name: app.name, shortId: app.shortId } } },
        },
        tx,
      );
      return ok(app);
    }
    const existing = await get(parsed.id, tx);
    if (!existing) return fail(err.notFound("Grids App"));
    const definition = { ...parsed, shortId: existing.shortId };
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET name = ${definition.name}, icon = ${definition.icon ?? null}, draft_definition = ${definition}::jsonb,
          draft_capabilities = ${capabilities}::jsonb, updated_at = now()
      WHERE id = ${definition.id}::uuid AND deleted_at IS NULL
      RETURNING *
    `;
    if (!updated) return fail(err.notFound("Grids App"));
    const app = mapRow(updated);
    await logAudit(
      {
        baseId: app.baseId,
        userId: actorId,
        action: "updated",
        diff: { customApp: { old: existing.name, new: app.name } },
      },
      tx,
    );
    return ok(app);
  });
};

export const publish = async (id: string, actorId: string | null = null): Promise<Result<CustomApp>> =>
  sql.begin(async (tx): Promise<Result<CustomApp>> => {
    const [locked] = await tx<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!locked) return fail(err.notFound("Grids App"));
    const draft = mapRow(locked);
    if (!draft.draftDefinition) return fail(err.badInput(draft.draftDiagnostics.map((item) => item.message).join("; ")));
    const compilation = await compile(draft.draftDefinition, tx);
    if (!compilation.ok) return fail(err.badInput(compilation.diagnostics.map((item) => item.message).join("; ")));
    const [published] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET published_definition = draft_definition, published_capabilities = ${compilation.compiled.capabilities}::jsonb,
          published_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    if (!published) return fail(err.notFound("Grids App"));
    const app = mapRow(published);
    await logAudit(
      {
        baseId: app.baseId,
        userId: actorId,
        action: "updated",
        diff: { customAppPublication: { old: locked.published_at ?? null, new: app.publishedAt } },
      },
      tx,
    );
    return ok(app);
  });

export const unpublish = async (id: string, actorId: string | null = null): Promise<Result<CustomApp>> =>
  sql.begin(async (tx): Promise<Result<CustomApp>> => {
    const [locked] = await tx<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!locked) return fail(err.notFound("Grids App"));
    if (!locked.published_definition) return ok(mapRow(locked));
    const [unpublished] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET published_definition = NULL, published_capabilities = NULL, published_at = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING *
    `;
    if (!unpublished) return fail(err.notFound("Grids App"));
    const app = mapRow(unpublished);
    await logAudit(
      {
        baseId: app.baseId,
        userId: actorId,
        action: "updated",
        diff: { customAppPublication: { old: locked.published_at ?? null, new: null } },
      },
      tx,
    );
    return ok(app);
  });

export const remove = async (id: string, actorId: string | null = null): Promise<Result<void>> =>
  sql.begin(async (tx): Promise<Result<void>> => {
    const [deleted] = await tx<Array<{ base_id: string; name: string; short_id: string }>>`
      UPDATE grids.custom_apps
      SET deleted_at = now(), published_definition = NULL, published_capabilities = NULL, published_at = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING base_id, name, short_id
    `;
    if (!deleted) return fail(err.notFound("Grids App"));
    await logAudit(
      {
        baseId: deleted.base_id,
        userId: actorId,
        action: "deleted",
        diff: { customApp: { old: { id, name: deleted.name, shortId: deleted.short_id }, new: null } },
      },
      tx,
    );
    return ok(undefined);
  });
