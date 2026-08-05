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
import { parseJsonbRow } from "./jsonb";
import { insertWithShortId } from "./short-id";

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
  draftCapabilities: CustomAppCapabilitiesSchema.parse(parseJsonbRow(row.draft_capabilities, { views: [] })),
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

const recordsBlocks = (definition: CustomAppDefinition) =>
  definition.pages[0]!.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.filter((block) => block.type === "records")));

export const compile = async (input: unknown, client: SqlClient = sql): Promise<CustomAppCompilation> => {
  const parsed = CustomAppDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, diagnostics: zodDiagnostics(parsed.error) };
  const definition = parsed.data;
  const blocks = recordsBlocks(definition);
  if (blocks.length > 4) {
    return { ok: false, diagnostics: [{ path: ["pages", 0, "rows"], message: "A Custom App may contain at most 4 Records blocks" }] };
  }

  const [base] = await client<Array<{ id: string }>>`
    SELECT id FROM grids.bases WHERE id = ${definition.baseId}::uuid AND deleted_at IS NULL
  `;
  if (!base) return { ok: false, diagnostics: [{ path: ["baseId"], message: "Base not found" }] };

  const diagnostics: CustomAppDiagnostic[] = [];
  const views: CustomAppCapabilities["views"] = [];
  for (const block of blocks) {
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
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const capabilities = CustomAppCapabilitiesSchema.parse({
    views: [...new Map(views.map((view) => [view.viewId, view])).values()].sort((left, right) => left.viewId.localeCompare(right.viewId)),
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
