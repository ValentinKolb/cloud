import { err, fail, ok, type Result } from "@k2b/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import {
  type CustomAppCapabilities,
  CustomAppCapabilitiesSchema,
  type CustomAppDefinition,
  CustomAppDefinitionSchema,
  type CustomAppDiagnostic,
} from "../custom-apps/contracts";
import { logAudit, type SqlClient } from "./audit";
import { normalizeFormConfig } from "./forms";
import { getWorkflow } from "./workflow-definitions";
import { getLauncher } from "./workflow-launchers";
import { workflowInputShapeError } from "./workflow-values";
import { parseJsonbRow } from "./jsonb";
import { insertWithShortId } from "./short-id";
import { isRecordWritableFieldType } from "../field-types";

type DbRow = Record<string, unknown>;

export type CustomApp = {
  id: string;
  shortId: string;
  baseId: string;
  name: string;
  icon: string | null;
  draftDefinition: CustomAppDefinition;
  draftCapabilities: CustomAppCapabilities;
  publishedDefinition: CustomAppDefinition | null;
  publishedCapabilities: CustomAppCapabilities | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompiledCustomApp = { definition: CustomAppDefinition; capabilities: CustomAppCapabilities };
export type CustomAppCompilation = { ok: true; compiled: CompiledCustomApp } | { ok: false; diagnostics: CustomAppDiagnostic[] };
export type CustomAppPlan = {
  valid: boolean;
  diagnostics: CustomAppDiagnostic[];
  action: "create" | "update" | "noop" | "invalid";
  changes: string[];
};

const mapRow = (row: DbRow): CustomApp => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  icon: (row.icon as string | null) ?? null,
  draftDefinition: CustomAppDefinitionSchema.parse(parseJsonbRow(row.draft_definition, {})),
  draftCapabilities: CustomAppCapabilitiesSchema.parse(
    parseJsonbRow(row.draft_capabilities, { views: [], records: [], forms: [], comments: [], documents: [], workflowLaunchers: [] }),
  ),
  publishedDefinition: row.published_definition ? CustomAppDefinitionSchema.parse(parseJsonbRow(row.published_definition, {})) : null,
  publishedCapabilities: row.published_capabilities
    ? CustomAppCapabilitiesSchema.parse(parseJsonbRow(row.published_capabilities, {}))
    : null,
  publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
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

const blocksByType = <T extends "actions" | "comments" | "form" | "record" | "records">(definition: CustomAppDefinition, type: T) =>
  definition.pages.flatMap((page) =>
    page.rows.flatMap((row) =>
      row.columns.flatMap((column) =>
        column.blocks
          .filter((block): block is Extract<(typeof column.blocks)[number], { type: T }> => block.type === type)
          .map((block) => ({ page, block })),
      ),
    ),
  );

export const compile = async (input: unknown, client: SqlClient = sql): Promise<CustomAppCompilation> => {
  const parsed = CustomAppDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, diagnostics: zodDiagnostics(parsed.error) };
  const definition = parsed.data;
  const recordsBlocks = blocksByType(definition, "records");
  const formBlocks = blocksByType(definition, "form");
  const commentBlocks = blocksByType(definition, "comments");
  const actionBlocks = blocksByType(definition, "actions");
  if (recordsBlocks.length > 4) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Custom App may contain at most 4 Records blocks" }] };
  }
  if (formBlocks.length > 24) {
    return { ok: false, diagnostics: [{ path: ["pages"], message: "A Custom App may contain at most 24 Form blocks" }] };
  }

  const [base] = await client<Array<{ id: string }>>`
    SELECT id FROM grids.bases WHERE id = ${definition.baseId}::uuid AND deleted_at IS NULL
  `;
  if (!base) return { ok: false, diagnostics: [{ path: ["baseId"], message: "Base not found" }] };

  const diagnostics: CustomAppDiagnostic[] = [];
  const views: CustomAppCapabilities["views"] = [];
  const pageRecords: CustomAppCapabilities["records"] = [];
  const forms: CustomAppCapabilities["forms"] = [];
  const comments: CustomAppCapabilities["comments"] = [];
  const documents: CustomAppCapabilities["documents"] = [];
  const workflowLaunchers: CustomAppCapabilities["workflowLaunchers"] = [];
  const tableBaseIds = new Map<string, string | null>();
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
    const fieldIds = [...new Set(recordBlocks.flatMap((block) => block.fieldIds))].sort();
    const editableFieldIds = [...new Set(recordBlocks.flatMap((block) => block.editableFieldIds))].sort();
    if ((await resolveTableBaseId(page.record.tableId)) !== definition.baseId) {
      diagnostics.push({
        path: ["pages", pageIndex, "record", "tableId"],
        message: "Page record table is missing or belongs to another base",
      });
      continue;
    }
    if (fieldIds.length > 0) {
      const fields = await client<Array<{ id: string; type: string }>>`
        SELECT id, type FROM grids.fields
        WHERE table_id = ${page.record.tableId}::uuid AND deleted_at IS NULL
          AND id = ANY(${toPgUuidArray(fieldIds)}::uuid[])
      `;
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
    }
    pageRecords.push({ pageId: page.id, tableId: page.record.tableId, fieldIds, editableFieldIds });
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
    const [view] = await client<Array<{ view_id: string; table_id: string; base_id: string }>>`
      SELECT v.id AS view_id, v.table_id, t.base_id
      FROM grids.views v
      JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
      WHERE v.id = ${block.source.viewId}::uuid AND v.deleted_at IS NULL
    `;
    if (!view || view.base_id !== definition.baseId) {
      diagnostics.push({ path: ["blocks", block.id, "source", "viewId"], message: "View is missing or belongs to another base" });
      continue;
    }
    if (block.rowNavigate) {
      const targetPage = definition.pages.find((candidate) => candidate.id === block.rowNavigate!.pageId)!;
      for (const parameterId of Object.keys(block.rowNavigate.params)) {
        if (targetPage.parameters[parameterId]?.tableId !== view.table_id) {
          diagnostics.push({
            path: ["pages", page.id, "blocks", block.id, "rowNavigate", "params", parameterId],
            message: "Row record ids may only populate parameters for the source view table",
          });
        }
      }
    }
    const fields = await client<Array<{ id: string }>>`
      SELECT id FROM grids.fields
      WHERE table_id = ${view.table_id}::uuid AND deleted_at IS NULL
        AND id = ANY(${toPgUuidArray(block.display.columnIds)}::uuid[])
    `;
    const found = new Set(fields.map((field) => field.id));
    for (const fieldId of block.display.columnIds) {
      if (!found.has(fieldId))
        diagnostics.push({
          path: ["blocks", block.id, "display", "columnIds"],
          message: `Field ${fieldId} is missing or belongs to another table`,
        });
    }
    views.push({ viewId: view.view_id, tableId: view.table_id });
  }

  for (const { page, block } of formBlocks) {
    const [formRow] = await client<Array<{ table_id: string; base_id: string; config: unknown; is_active: boolean }>>`
      SELECT f.table_id, t.base_id, f.config, f.is_active
      FROM grids.forms f
      JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
      WHERE f.id = ${block.formId}::uuid AND f.deleted_at IS NULL
    `;
    if (!formRow || formRow.base_id !== definition.baseId || !formRow.is_active) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "formId"],
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
        path: ["pages", page.id, "blocks", block.id, "formId"],
        message: "A Custom App Form may expose at most 100 input fields",
      });
      continue;
    }
    if (fixedFieldIds.length > 30) {
      diagnostics.push({
        path: ["pages", page.id, "blocks", block.id, "fixedValues"],
        message: "A Custom App Form may bind at most 30 fixed fields",
      });
      continue;
    }
    const fieldIds = [...new Set([...userInputFieldIds, ...fixedFieldIds])];
    const fields =
      fieldIds.length === 0
        ? []
        : await client<Array<{ id: string; type: string; config: unknown }>>`
            SELECT id, type, config
            FROM grids.fields
            WHERE table_id = ${formRow.table_id}::uuid AND deleted_at IS NULL
              AND id = ANY(${toPgUuidArray(fieldIds)}::uuid[])
          `;
    const fieldsById = new Map(fields.map((field) => [field.id, field]));
    for (const fieldId of userInputFieldIds) {
      if (!fieldsById.has(fieldId)) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "formId"],
          message: `Form field ${fieldId} is missing or belongs to another table`,
        });
      }
    }
    for (const [fieldId, value] of Object.entries(block.fixedValues)) {
      const field = fieldsById.get(fieldId);
      const parameter = page.parameters[value.path];
      if (!userInputFieldIdSet.has(fieldId)) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "fixedValues", fieldId],
          message: "A dynamic fixed value must target a user-input field in the referenced Form",
        });
        continue;
      }
      const fieldConfig = parseJsonbRow<{ targetTableId?: unknown }>(field?.config, {});
      if (field?.type !== "relation" || typeof fieldConfig.targetTableId !== "string") {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "fixedValues", fieldId],
          message: "Record parameters may only bind compatible relation fields",
        });
      } else if (!parameter || fieldConfig.targetTableId !== parameter.tableId) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "fixedValues", fieldId],
          message: "Fixed relation field and page parameter must reference the same table",
        });
      }
    }

    if (block.onSuccessNavigate) {
      const targetPage = definition.pages.find((candidate) => candidate.id === block.onSuccessNavigate!.pageId)!;
      for (const [parameterId, value] of Object.entries(block.onSuccessNavigate.params)) {
        if (value.source === "RESULT" && targetPage.parameters[parameterId]?.tableId !== formRow.table_id) {
          diagnostics.push({
            path: ["pages", page.id, "blocks", block.id, "onSuccessNavigate", "params", parameterId],
            message: "RESULT.recordId may only populate a record parameter for the Form table",
          });
        }
      }
    }

    forms.push({ pageId: page.id, blockId: block.id, formId: block.formId, tableId: formRow.table_id, userInputFieldIds, fixedFieldIds });
  }

  for (const { page, block } of actionBlocks) {
    for (const action of block.actions) {
      if (action.kind !== "workflow") continue;
      const launcher = await getLauncher(action.launcherId, client);
      if (
        !launcher ||
        launcher.baseId !== definition.baseId ||
        launcher.deletedAt !== null ||
        !launcher.enabled ||
        launcher.diagnostics.some((item) => item.severity === "error") ||
        launcher.config.kind !== "dashboard"
      ) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "actions", action.id, "launcherId"],
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
          path: ["pages", page.id, "blocks", block.id, "actions", action.id, "launcherId"],
          message: "Workflow launcher does not reference a ready workflow revision",
        });
        continue;
      }
      if (launcher.config.inputMode === "fixed" && Object.keys(action.inputs).length > 0) {
        diagnostics.push({
          path: ["pages", page.id, "blocks", block.id, "actions", action.id, "inputs"],
          message: "Fixed workflow launchers do not accept Custom App inputs",
        });
        continue;
      }
      if (launcher.config.inputMode === "prompt") {
        const inputsByName = new Map(workflow.plan.inputs.map((input) => [input.name, input]));
        for (const inputName of Object.keys(action.inputs)) {
          if (!inputsByName.has(inputName)) {
            diagnostics.push({
              path: ["pages", page.id, "blocks", block.id, "actions", action.id, "inputs", inputName],
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
                path: ["pages", page.id, "blocks", block.id, "actions", action.id, "inputs", input.name],
                message: `Workflow input "${input.name}" ${message}`,
              });
            }
            continue;
          }
          if (value.source === "LITERAL") {
            const message = workflowInputShapeError(input, value.value);
            if (message) {
              diagnostics.push({
                path: ["pages", page.id, "blocks", block.id, "actions", action.id, "inputs", input.name],
                message: `Workflow input "${input.name}" ${message}`,
              });
            }
            continue;
          }
          const sourceTableId = value.source === "PARAMS" ? page.parameters[value.path]?.tableId : page.record?.tableId;
          const boundTableId = workflow.plan.bindings[`inputs.${input.name}.table`];
          if (input.type !== "record" || typeof boundTableId !== "string" || sourceTableId !== boundTableId) {
            diagnostics.push({
              path: ["pages", page.id, "blocks", block.id, "actions", action.id, "inputs", input.name],
              message: `Workflow input "${input.name}" must be a record input bound to the referenced table`,
            });
          }
        }
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
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const capabilities = CustomAppCapabilitiesSchema.parse({
    views: [...new Map(views.map((view) => [view.viewId, view])).values()].sort((left, right) => left.viewId.localeCompare(right.viewId)),
    records: pageRecords.sort((left, right) => left.pageId.localeCompare(right.pageId)),
    forms: forms.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    comments: comments.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    documents: documents.sort((left, right) => left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId)),
    workflowLaunchers: workflowLaunchers.sort(
      (left, right) =>
        left.pageId.localeCompare(right.pageId) || left.blockId.localeCompare(right.blockId) || left.actionId.localeCompare(right.actionId),
    ),
  });
  return { ok: true, compiled: { definition, capabilities } };
};

export const get = async (id: string, client: SqlClient = sql): Promise<CustomApp | null> => {
  const [row] = await client<DbRow[]>`SELECT * FROM grids.custom_apps WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  return row ? mapRow(row) : null;
};

export const getPublishedByShortId = async (shortId: string): Promise<CustomApp | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT app.*
    FROM grids.custom_apps app
    JOIN grids.bases base ON base.id = app.base_id AND base.deleted_at IS NULL
    WHERE app.short_id = ${shortId} AND app.published_definition IS NOT NULL AND app.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

export const listByBase = async (baseId: string): Promise<CustomApp[]> => {
  const rows = await sql<DbRow[]>`SELECT * FROM grids.custom_apps WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL ORDER BY name, id`;
  return rows.map(mapRow);
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
        if (!created) throw err.internal("Failed to create Custom App");
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
    if (!existing) return fail(err.notFound("Custom App"));
    const definition = { ...parsed, shortId: existing.shortId };
    const [updated] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET name = ${definition.name}, icon = ${definition.icon ?? null}, draft_definition = ${definition}::jsonb,
          draft_capabilities = ${capabilities}::jsonb, updated_at = now()
      WHERE id = ${definition.id}::uuid AND deleted_at IS NULL
      RETURNING *
    `;
    if (!updated) return fail(err.notFound("Custom App"));
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
    if (!locked) return fail(err.notFound("Custom App"));
    const draft = mapRow(locked);
    const compilation = await compile(draft.draftDefinition, tx);
    if (!compilation.ok) return fail(err.badInput(compilation.diagnostics.map((item) => item.message).join("; ")));
    const [published] = await tx<DbRow[]>`
      UPDATE grids.custom_apps
      SET published_definition = draft_definition, published_capabilities = ${compilation.compiled.capabilities}::jsonb,
          published_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    if (!published) return fail(err.notFound("Custom App"));
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
