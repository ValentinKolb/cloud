import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { type DocumentTemplate, FieldColumnSpecSchema, RecordDisplayConfigSchema, type View, ViewUiSettingsSchema } from "../contracts";
import { listForBase as listDashboardsForBase } from "./dashboards";
import { type Form, normalizeFormConfig, toRenderableForm } from "./forms";
import { parseJsonbRow } from "./jsonb";
import { withLookupTargetMetadata } from "./lookup-display";
import type { Field, Table } from "./types";

type DbRow = Record<string, unknown>;

type RankedTable = Table & { level: PermissionLevel };

type BaseCatalog = {
  dashboards: Awaited<ReturnType<typeof listDashboardsForBase>>;
  tables: RankedTable[];
  tableLevels: Record<string, PermissionLevel>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  formLevels: Record<string, PermissionLevel>;
  formTables: Table[];
  sidebarForms: Array<{ form: Form; tableId: string }>;
  documentTemplatesByTable: Record<string, DocumentTemplate[]>;
  documentTemplateLevels: Record<string, PermissionLevel>;
  documentTemplateTables: Table[];
  sidebarDocumentTemplates: Array<{ template: DocumentTemplate; tableId: string }>;
};

const LEVEL_BY_RANK: PermissionLevel[] = ["none", "read", "write", "admin"];

const levelFromRank = (rank: unknown): PermissionLevel => {
  const n = typeof rank === "number" ? rank : Number(rank);
  return LEVEL_BY_RANK[Math.max(0, Math.min(3, Number.isFinite(n) ? n : 0))] ?? "none";
};

const parseColumns = (raw: unknown) => {
  const parsed = FieldColumnSpecSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
};

const parseDisplayConfig = (raw: unknown) => {
  const parsed = RecordDisplayConfigSchema.safeParse(parseJsonbRow<unknown>(raw, { mode: "table" }));
  return parsed.success ? parsed.data : { mode: "table" as const };
};

const parseViewUi = (raw: unknown) => {
  const parsed = ViewUiSettingsSchema.safeParse(parseJsonbRow<unknown>(raw, {}));
  return parsed.success ? parsed.data : {};
};

const mapTable = (row: DbRow): Table => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
  columns: parseColumns(row.columns),
  displayConfig: parseDisplayConfig(row.display_config),
  position: row.position as number,
  disableDirectInsert: (row.disable_direct_insert as boolean | null) ?? false,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const mapField = (row: DbRow): Field => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
  type: row.type as string,
  config: parseJsonbRow<Record<string, unknown>>(row.config, {}),
  position: row.position as number,
  required: row.required as boolean,
  presentable: (row.presentable as boolean | null) ?? false,
  hideInTable: (row.hide_in_table as boolean | null) ?? false,
  defaultValue: parseJsonbRow<unknown>(row.default_value, null),
  indexed: row.indexed as boolean,
  uniqueConstraint: row.unique_constraint as boolean,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const mapView = (row: DbRow): View => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
  source: row.source as string,
  ui: parseViewUi(row.ui),
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const mapForm = (row: DbRow): Form => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  config: normalizeFormConfig(row.config),
  publicToken: (row.public_token as string | null) ?? null,
  isActive: row.is_active as boolean,
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  isDefault: false,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const mapDocumentTemplate = (row: DbRow): DocumentTemplate => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  source: row.source as string,
  html: row.html as string,
  headerHtml: (row.header_html as string | null) ?? null,
  footerHtml: (row.footer_html as string | null) ?? null,
  pageCss: (row.page_css as string | null) ?? null,
  filenameTemplate: (row.filename_template as string | null) ?? "{{ document.number }}.pdf",
  enabled: row.enabled as boolean,
  position: row.position as number,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const principalWhere = (principal: "user" | "group" | "authenticated" | "public", userId: string, groups: unknown) =>
  principal === "user"
    ? sql`a.user_id = ${userId}::uuid`
    : principal === "group"
      ? sql`a.group_id = ANY(${groups}::uuid[])`
      : principal === "authenticated"
        ? sql`a.authenticated_only = TRUE AND ${userId}::uuid IS NOT NULL`
        : sql`a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = FALSE`;

const rankFor = (
  tableName: string,
  alias: string,
  resourceColumn: string,
  resourceExpr: unknown,
  principal: "user" | "group" | "authenticated" | "public",
  userId: string,
  groups: unknown,
) => sql`(
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN bool_or(a.permission = 'none') THEN 0
    ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
  END
  FROM ${sql.unsafe(tableName)} ${sql.unsafe(alias)}
  JOIN auth.access a ON a.id = ${sql.unsafe(`${alias}.access_id`)}
  WHERE ${sql.unsafe(`${alias}.${resourceColumn}`)} = ${resourceExpr}
    AND ${principalWhere(principal, userId, groups)}
)`;

const resourceRanks = (
  tableName: string,
  alias: string,
  resourceColumn: string,
  resourceExpr: unknown,
  userId: string,
  groups: unknown,
) => [
  rankFor(tableName, alias, resourceColumn, resourceExpr, "user", userId, groups),
  rankFor(tableName, alias, resourceColumn, resourceExpr, "group", userId, groups),
  rankFor(tableName, alias, resourceColumn, resourceExpr, "authenticated", userId, groups),
  rankFor(tableName, alias, resourceColumn, resourceExpr, "public", userId, groups),
];

const byTable = <T extends { tableId: string }>(items: T[]): Record<string, T[]> => {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const tableItems = out[item.tableId] ?? [];
    tableItems.push(item);
    out[item.tableId] = tableItems;
  }
  return out;
};

export const listForBase = async (params: { baseId: string; userId: string; userGroups: string[] }): Promise<BaseCatalog> => {
  const groups = toPgUuidArray(params.userGroups);
  const tableRanks = resourceRanks("grids.table_access", "ta", "table_id", sql`t.id`, params.userId, groups);
  const baseRanks = resourceRanks("grids.base_access", "ba", "base_id", sql`t.base_id`, params.userId, groups);
  const tableLevelExpr = sql`COALESCE(${tableRanks[0]}, ${tableRanks[1]}, ${tableRanks[2]}, ${tableRanks[3]}, ${baseRanks[0]}, ${baseRanks[1]}, ${baseRanks[2]}, ${baseRanks[3]}, 0)`;

  const [dashboards, tableRows] = await Promise.all([
    listDashboardsForBase({ baseId: params.baseId, userId: params.userId, userGroups: params.userGroups }),
    sql<(DbRow & { level_rank: number })[]>`
      WITH ranked AS (
        SELECT t.*, ${tableLevelExpr} AS level_rank
        FROM grids.tables t
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.base_id = ${params.baseId}::uuid AND t.deleted_at IS NULL
      )
      SELECT *
      FROM ranked
      WHERE level_rank >= 1
      ORDER BY position, created_at
    `,
  ]);

  const tables = tableRows.map((row) => ({ ...mapTable(row), level: levelFromRank(row.level_rank) }));
  const tableLevels = Object.fromEntries(tables.map((table) => [table.id, table.level]));
  const formRanks = resourceRanks("grids.form_access", "fa", "form_id", sql`f.id`, params.userId, groups);
  const formTableRanks = resourceRanks("grids.table_access", "fta", "table_id", sql`f.table_id`, params.userId, groups);
  const formBaseRanks = resourceRanks("grids.base_access", "fba", "base_id", sql`t.base_id`, params.userId, groups);
  const formLevelExpr = sql`COALESCE(${formRanks[0]}, ${formRanks[1]}, ${formRanks[2]}, ${formRanks[3]}, ${formTableRanks[0]}, ${formTableRanks[1]}, ${formTableRanks[2]}, ${formTableRanks[3]}, ${formBaseRanks[0]}, ${formBaseRanks[1]}, ${formBaseRanks[2]}, ${formBaseRanks[3]}, 0)`;

  const templateRanks = resourceRanks("grids.document_template_access", "dta", "template_id", sql`dt.id`, params.userId, groups);
  const templateTableRanks = resourceRanks("grids.table_access", "dtta", "table_id", sql`dt.table_id`, params.userId, groups);
  const templateBaseRanks = resourceRanks("grids.base_access", "dtba", "base_id", sql`t.base_id`, params.userId, groups);
  const templateLevelExpr = sql`COALESCE(${templateRanks[0]}, ${templateRanks[1]}, ${templateRanks[2]}, ${templateRanks[3]}, ${templateTableRanks[0]}, ${templateTableRanks[1]}, ${templateTableRanks[2]}, ${templateTableRanks[3]}, ${templateBaseRanks[0]}, ${templateBaseRanks[1]}, ${templateBaseRanks[2]}, ${templateBaseRanks[3]}, 0)`;

  const viewRanks = resourceRanks("grids.view_access", "va", "view_id", sql`v.id`, params.userId, groups);
  const viewWinning = sql`COALESCE(${viewRanks[0]}, ${viewRanks[1]}, ${viewRanks[2]}, ${viewRanks[3]})`;

  const [formRows, documentTemplateRows] = await Promise.all([
    sql<(DbRow & { level_rank: number; sidebar_visible: boolean })[]>`
      WITH ranked AS (
        SELECT f.*, ${formLevelExpr} AS level_rank
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.base_id = ${params.baseId}::uuid AND f.deleted_at IS NULL
      )
      SELECT *, (is_active = TRUE AND level_rank >= 2) AS sidebar_visible
      FROM ranked
      WHERE level_rank >= 2
      ORDER BY table_id, position, created_at
    `,
    sql<(DbRow & { level_rank: number; sidebar_visible: boolean })[]>`
      WITH ranked AS (
        SELECT dt.*, ${templateLevelExpr} AS level_rank
        FROM grids.document_templates dt
        JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.base_id = ${params.baseId}::uuid AND dt.deleted_at IS NULL
      )
      SELECT *, (enabled = TRUE AND level_rank >= 1) AS sidebar_visible
      FROM ranked
      WHERE level_rank >= 1
      ORDER BY table_id, position, created_at
    `,
  ]);

  const readableTableIds = tables.map((table) => table.id);
  const formTableIds = [...new Set(formRows.map((row) => row.table_id as string))];
  const documentTemplateTableIds = [...new Set(documentTemplateRows.map((row) => row.table_id as string))];
  const fieldTableIds = [...new Set([...readableTableIds, ...formTableIds])];
  const readableTableIdArray = () => sql.array(readableTableIds, "UUID");
  const fieldTableIdArray = () => sql.array(fieldTableIds, "UUID");

  const [formOnlyTableRows, fieldRows, viewRows] = await Promise.all([
    [...new Set([...formTableIds, ...documentTemplateTableIds])].filter((id) => !tableLevels[id]).length === 0
      ? Promise.resolve([] as DbRow[])
      : sql<DbRow[]>`
          SELECT t.*
          FROM grids.tables t
          JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
          WHERE t.id = ANY(${sql.array(
            [...new Set([...formTableIds, ...documentTemplateTableIds])].filter((id) => !tableLevels[id]),
            "UUID",
          )}) AND t.deleted_at IS NULL
          ORDER BY position, created_at
        `,
    fieldTableIds.length === 0
      ? Promise.resolve([] as DbRow[])
      : sql<DbRow[]>`
          SELECT f.*
          FROM grids.fields f
          JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
          JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
          WHERE f.table_id = ANY(${fieldTableIdArray()}) AND f.deleted_at IS NULL
          ORDER BY f.table_id, f.position, f.created_at
        `,
    readableTableIds.length === 0
      ? Promise.resolve([] as DbRow[])
      : sql<DbRow[]>`
          WITH ranked AS (
            SELECT v.*, ${viewWinning} AS winning_rank
            FROM grids.views v
            JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
            JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
            WHERE v.table_id = ANY(${readableTableIdArray()}) AND v.deleted_at IS NULL
          )
          SELECT *
          FROM ranked
          WHERE winning_rank >= 1
             OR (winning_rank IS NULL AND (owner_user_id IS NULL OR owner_user_id = ${params.userId}::uuid))
          ORDER BY table_id, position, created_at
        `,
  ]);

  const auxiliaryTables = formOnlyTableRows.map((row) => ({ ...mapTable(row), level: "none" as const }));
  const formOnlyTables = auxiliaryTables.filter((table) => formTableIds.includes(table.id));
  const documentTemplateOnlyTables = auxiliaryTables.filter((table) => documentTemplateTableIds.includes(table.id));
  const tablesById = new Map([...tables, ...auxiliaryTables].map((table) => [table.id, table]));
  const fieldsByTable = byTable(await withLookupTargetMetadata(fieldRows.map(mapField)));
  const viewsByTable = byTable(viewRows.map(mapView));
  const forms = formRows.map((row) => {
    const form = mapForm(row);
    return levelFromRank(row.level_rank) === "admin" ? form : toRenderableForm(form);
  });
  const formsByTable = byTable(forms);
  const formLevels: Record<string, PermissionLevel> = {};
  const formsById = new Map(forms.map((form) => [form.id, form]));
  const sidebarForms: Array<{ form: Form; tableId: string }> = [];
  for (const row of formRows) {
    formLevels[row.id as string] = levelFromRank(row.level_rank);
    if (row.sidebar_visible) {
      const form = formsById.get(row.id as string);
      if (form && tablesById.has(form.tableId)) sidebarForms.push({ form, tableId: form.tableId });
    }
  }
  const documentTemplates = documentTemplateRows.map(mapDocumentTemplate);
  const documentTemplatesByTable = byTable(documentTemplates);
  const documentTemplateLevels: Record<string, PermissionLevel> = {};
  const documentTemplatesById = new Map(documentTemplates.map((template) => [template.id, template]));
  const sidebarDocumentTemplates: Array<{ template: DocumentTemplate; tableId: string }> = [];
  for (const row of documentTemplateRows) {
    documentTemplateLevels[row.id as string] = levelFromRank(row.level_rank);
    if (row.sidebar_visible) {
      const template = documentTemplatesById.get(row.id as string);
      if (template && tablesById.has(template.tableId)) sidebarDocumentTemplates.push({ template, tableId: template.tableId });
    }
  }

  return {
    dashboards,
    tables,
    tableLevels,
    fieldsByTable,
    viewsByTable,
    formsByTable,
    formLevels,
    formTables: formOnlyTables,
    sidebarForms,
    documentTemplatesByTable,
    documentTemplateLevels,
    documentTemplateTables: documentTemplateOnlyTables,
    sidebarDocumentTemplates,
  };
};
