import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { templates, getTemplate, type GridTemplate, type TemplateRef } from "../templates";
import type { Base, Field } from "./types";
import type { FormConfig } from "./forms";
import * as bases from "./bases";
import * as dashboards from "./dashboards";
import * as fields from "./fields";
import * as forms from "./forms";
import * as records from "./records";
import * as tables from "./tables";
import * as views from "./views";

const log = logger("grids:templates");

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

export type InstantiateTemplateInput = {
  name?: string;
  withSampleData?: boolean;
};

type TemplateContext = {
  tables: Map<string, string>;
  fields: Map<string, Field>;
  records: Map<string, string>;
  views: Map<string, string>;
  forms: Map<string, string>;
  dashboards: Map<string, string>;
};

type ResultError = Extract<Result<unknown>, { ok: false }>["error"];

class TemplateError extends Error {
  constructor(public readonly resultError: ResultError) {
    super(resultError.message);
  }
}

export const list = (): TemplateSummary[] =>
  templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
  }));

export const get = (id: string): TemplateSummary | null => {
  const template = getTemplate(id);
  return template ? { id: template.id, name: template.name, description: template.description, icon: template.icon } : null;
};

const requireResult = <T>(result: Result<T>): T => {
  if (!result.ok) throw new TemplateError(result.error);
  return result.data;
};

const isRef = (value: unknown): value is TemplateRef =>
  !!value &&
  typeof value === "object" &&
  (value as Record<string, unknown>).$ref !== undefined &&
  typeof (value as Record<string, unknown>).key === "string";

const isFormulaExpression = (value: unknown): value is { $formula: Array<string | TemplateRef> } =>
  !!value &&
  typeof value === "object" &&
  Array.isArray((value as { $formula?: unknown }).$formula);

const resolveRef = (ref: TemplateRef, ctx: TemplateContext): string => {
  const value =
    ref.$ref === "table"
      ? ctx.tables.get(ref.key)
      : ref.$ref === "field"
        ? ctx.fields.get(ref.key)?.id
        : ref.$ref === "record"
          ? ctx.records.get(ref.key)
          : ref.$ref === "view"
            ? ctx.views.get(ref.key)
            : ref.$ref === "form"
              ? ctx.forms.get(ref.key)
              : ctx.dashboards.get(ref.key);

  if (!value) throw new TemplateError(err.badInput(`template reference not found: ${ref.$ref}:${ref.key}`));
  return value;
};

const resolveValue = (value: unknown, ctx: TemplateContext): unknown => {
  if (value === undefined) return undefined;
  if (isRef(value)) return resolveRef(value, ctx);
  if (isFormulaExpression(value)) {
    return value.$formula.map((part) => (typeof part === "string" ? part : `{${resolveRef(part, ctx)}}`)).join("");
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, ctx));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveValue(nested, ctx)]),
    );
  }
  return value;
};

const createTables = async (template: GridTemplate, baseId: string, actorId: string | null, ctx: TemplateContext) => {
  for (const table of template.tables) {
    const created = requireResult(
      await tables.create(
        {
          baseId,
          name: table.name,
          description: table.description ?? null,
        },
        actorId,
      ),
    );
    ctx.tables.set(table.key, created.id);
  }
};

const createFields = async (template: GridTemplate, actorId: string | null, ctx: TemplateContext) => {
  for (const table of template.tables) {
    const tableId = ctx.tables.get(table.key);
    if (!tableId) throw new TemplateError(err.badInput(`template table not found: ${table.key}`));

    for (const field of table.fields) {
      const created = requireResult(
        await fields.create(
          {
            tableId,
            name: field.name,
            type: field.type,
            description: field.description ?? null,
            icon: field.icon ?? null,
            config: (resolveValue(field.config, ctx) as Record<string, unknown> | undefined) ?? {},
            required: field.required,
            presentable: field.presentable,
            hideInTable: field.hideInTable,
            defaultValue: resolveValue(field.defaultValue, ctx),
            indexed: field.indexed,
            uniqueConstraint: field.uniqueConstraint,
          },
          actorId,
        ),
      );
      ctx.fields.set(`${table.key}.${field.key}`, created);
    }
  }
};

const createRecords = async (template: GridTemplate, actorId: string | null, ctx: TemplateContext) => {
  for (const record of template.records ?? []) {
    const tableId = ctx.tables.get(record.table);
    if (!tableId) throw new TemplateError(err.badInput(`template table not found: ${record.table}`));

    const data: Record<string, unknown> = {};
    for (const [fieldKey, value] of Object.entries(record.values)) {
      const field = ctx.fields.get(`${record.table}.${fieldKey}`);
      if (!field) {
        throw new TemplateError(err.badInput(`template field not found: ${record.table}.${fieldKey}`));
      }
      data[field.id] = resolveValue(value, ctx);
    }

    const created = requireResult(await records.create(tableId, data, actorId));
    ctx.records.set(record.key, created.id);
  }
};

const createViews = async (template: GridTemplate, actorId: string | null, ctx: TemplateContext) => {
  for (const view of template.views ?? []) {
    const tableId = ctx.tables.get(view.table);
    if (!tableId) throw new TemplateError(err.badInput(`template table not found: ${view.table}`));

    const created = requireResult(
      await views.create(
        {
          tableId,
          name: view.name,
          query: (resolveValue(view.query ?? {}, ctx) as Parameters<typeof views.create>[0]["query"]) ?? {},
          ownerUserId: view.shared === false ? actorId : null,
        },
        actorId,
      ),
    );
    ctx.views.set(view.key, created.id);
  }
};

const createForms = async (template: GridTemplate, actorId: string | null, ctx: TemplateContext) => {
  for (const form of template.forms ?? []) {
    const tableId = ctx.tables.get(form.table);
    if (!tableId) throw new TemplateError(err.badInput(`template table not found: ${form.table}`));

    const created = requireResult(
      await forms.create(
        {
          tableId,
          name: form.name,
          isPublic: form.isPublic,
          config: resolveValue(form.config, ctx) as FormConfig,
        },
        actorId,
      ),
    );
    ctx.forms.set(form.key, created.id);
  }
};

const createDashboards = async (template: GridTemplate, baseId: string, actorId: string | null, ctx: TemplateContext) => {
  for (const dashboard of template.dashboards ?? []) {
    const created = requireResult(
      await dashboards.create(
        {
          baseId,
          name: dashboard.name,
          description: dashboard.description ?? null,
          ownerUserId: dashboard.shared === false ? actorId : null,
          config: resolveValue(dashboard.config, ctx) as Parameters<typeof dashboards.create>[0]["config"],
        },
        actorId,
      ),
    );
    ctx.dashboards.set(dashboard.key, created.id);
  }
};

export const instantiate = async (
  templateId: string,
  input: InstantiateTemplateInput,
  actorId: string | null,
): Promise<Result<Base>> => {
  const template = getTemplate(templateId);
  if (!template) return fail(err.notFound("Template"));

  const name = input.name?.trim() || template.baseName;
  const baseResult = await bases.create(
    {
      name,
      description: template.baseDescription ?? template.description,
    },
    actorId,
  );
  if (!baseResult.ok) return baseResult;
  const base = baseResult.data;

  const ctx: TemplateContext = {
    tables: new Map(),
    fields: new Map(),
    records: new Map(),
    views: new Map(),
    forms: new Map(),
    dashboards: new Map(),
  };

  try {
    await createTables(template, base.id, actorId, ctx);
    await createFields(template, actorId, ctx);
    if (input.withSampleData !== false) await createRecords(template, actorId, ctx);
    await createViews(template, actorId, ctx);
    await createForms(template, actorId, ctx);
    await createDashboards(template, base.id, actorId, ctx);

    if (template.defaultDashboard) {
      const dashboardId = ctx.dashboards.get(template.defaultDashboard);
      if (!dashboardId) {
        throw new TemplateError(err.badInput(`template dashboard not found: ${template.defaultDashboard}`));
      }
      return bases.update(base.id, { defaultDashboardId: dashboardId }, actorId);
    }

    return ok(base);
  } catch (error) {
    await sql`DELETE FROM grids.bases WHERE id = ${base.id}::uuid`.catch(() => {});
    log.error("Template instantiation failed", {
      templateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(err.internal("Could not create base from template."));
  }
};
