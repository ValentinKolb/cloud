import { sql } from "bun";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { ColumnSpecSchema, ViewQuerySchema, type View } from "../contracts";
import { listForBase as listDashboardsForBase } from "./dashboards";
import { parseJsonbRow } from "./jsonb";
import type { Form, FormConfig, FormFieldEntry } from "./forms";
import type { Field, Table } from "./types";

type DbRow = Record<string, unknown>;

type RankedTable = Table & { level: PermissionLevel };

export type BaseCatalog = {
  dashboards: Awaited<ReturnType<typeof listDashboardsForBase>>;
  tables: RankedTable[];
  tableLevels: Record<string, PermissionLevel>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  formLevels: Record<string, PermissionLevel>;
  sidebarForms: Array<{ form: Form; tableId: string }>;
};

const LEVEL_BY_RANK: PermissionLevel[] = ["none", "read", "write", "admin"];

const levelFromRank = (rank: unknown): PermissionLevel => {
  const n = typeof rank === "number" ? rank : Number(rank);
  return LEVEL_BY_RANK[Math.max(0, Math.min(3, Number.isFinite(n) ? n : 0))] ?? "none";
};

const parseColumns = (raw: unknown) => {
  const parsed = ColumnSpecSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
};

const mapTable = (row: DbRow): Table => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
  columns: parseColumns(row.columns),
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

const mapView = (row: DbRow): View => {
  const parsed = ViewQuerySchema.safeParse(parseJsonbRow<unknown>(row.query, {}));
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    tableId: row.table_id as string,
    name: row.name as string,
    icon: (row.icon as string | null) ?? null,
    query: parsed.success ? parsed.data : {},
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    position: row.position as number,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

const normalizeFieldEntry = (raw: unknown): FormFieldEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const fieldId = obj.fieldId;
  if (typeof fieldId !== "string") return null;
  if (obj.kind === "form_value") return { kind: "form_value", fieldId, value: obj.value };
  return {
    kind: "user_input",
    fieldId,
    label: typeof obj.label === "string" ? obj.label : undefined,
    helpText: typeof obj.helpText === "string" ? obj.helpText : undefined,
    required: typeof obj.required === "boolean" ? obj.required : undefined,
    defaultValue: obj.defaultValue,
  };
};

const normalizeFormConfig = (raw: unknown): FormConfig => {
  const cfg = parseJsonbRow<Partial<FormConfig> & { fields?: unknown[] }>(raw, {});
  return {
    title: cfg.title,
    description: cfg.description,
    fields: Array.isArray(cfg.fields) ? cfg.fields.map(normalizeFieldEntry).filter((e): e is FormFieldEntry => e !== null) : [],
    submitLabel: cfg.submitLabel,
    successMessage: cfg.successMessage,
    redirectUrl: cfg.redirectUrl,
    titleImage: typeof cfg.titleImage === "string" ? cfg.titleImage : undefined,
  };
};

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

const principalWhere = (
  principal: "user" | "group" | "authenticated" | "public",
  userId: string,
  groups: unknown,
) =>
  principal === "user"
    ? sql`a.user_id = ${userId}::uuid`
    : principal === "group"
      ? sql`a.group_id = ANY(${groups}::uuid[])`
      : principal === "authenticated"
        ? sql`a.authenticated_only = TRUE AND ${userId}::uuid IS NOT NULL`
        : sql`a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE`;

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
  for (const item of items) (out[item.tableId] ??= []).push(item);
  return out;
};

export const listForBase = async (params: {
  baseId: string;
  userId: string;
  userGroups: string[];
  isAdmin?: boolean;
}): Promise<BaseCatalog> => {
  const groups = toPgUuidArray(params.userGroups);
  const tableRanks = resourceRanks("grids.table_access", "ta", "table_id", sql`t.id`, params.userId, groups);
  const baseRanks = resourceRanks("grids.base_access", "ba", "base_id", sql`t.base_id`, params.userId, groups);
  const tableLevelExpr = params.isAdmin ? sql`3` : sql`COALESCE(${tableRanks[0]}, ${tableRanks[1]}, ${tableRanks[2]}, ${tableRanks[3]}, ${baseRanks[0]}, ${baseRanks[1]}, ${baseRanks[2]}, ${baseRanks[3]}, 0)`;

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
  const tableIds = tables.map((table) => table.id);
  if (tableIds.length === 0) {
    return { dashboards, tables, tableLevels, fieldsByTable: {}, viewsByTable: {}, formsByTable: {}, formLevels: {}, sidebarForms: [] };
  }

  const tableIdArray = () => sql.array(tableIds, "UUID");
  const formRanks = resourceRanks("grids.form_access", "fa", "form_id", sql`f.id`, params.userId, groups);
  const formTableRanks = resourceRanks("grids.table_access", "fta", "table_id", sql`f.table_id`, params.userId, groups);
  const formBaseRanks = resourceRanks("grids.base_access", "fba", "base_id", sql`t.base_id`, params.userId, groups);
  const formLevelExpr = params.isAdmin ? sql`3` : sql`COALESCE(${formRanks[0]}, ${formRanks[1]}, ${formRanks[2]}, ${formRanks[3]}, ${formTableRanks[0]}, ${formTableRanks[1]}, ${formTableRanks[2]}, ${formTableRanks[3]}, ${formBaseRanks[0]}, ${formBaseRanks[1]}, ${formBaseRanks[2]}, ${formBaseRanks[3]}, 0)`;

  const viewRanks = resourceRanks("grids.view_access", "va", "view_id", sql`v.id`, params.userId, groups);
  const viewWinning = sql`COALESCE(${viewRanks[0]}, ${viewRanks[1]}, ${viewRanks[2]}, ${viewRanks[3]})`;

  const [fieldRows, viewRows, formRows] = await Promise.all([
    sql<DbRow[]>`
      SELECT f.*
      FROM grids.fields f
      JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE f.table_id = ANY(${tableIdArray()}) AND f.deleted_at IS NULL
      ORDER BY f.table_id, f.position, f.created_at
    `,
    sql<DbRow[]>`
      WITH ranked AS (
        SELECT v.*, ${viewWinning} AS winning_rank
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE v.table_id = ANY(${tableIdArray()}) AND v.deleted_at IS NULL
      )
      SELECT *
      FROM ranked
      WHERE winning_rank >= 1
         OR (winning_rank IS NULL AND (owner_user_id IS NULL OR owner_user_id = ${params.userId}::uuid))
      ORDER BY table_id, position, created_at
    `,
    sql<(DbRow & { level_rank: number; sidebar_visible: boolean })[]>`
      WITH ranked AS (
        SELECT f.*, ${formLevelExpr} AS level_rank
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.table_id = ANY(${tableIdArray()}) AND f.deleted_at IS NULL
      )
      SELECT *, (is_active = TRUE AND (public_token IS NOT NULL OR level_rank >= 2)) AS sidebar_visible
      FROM ranked
      ORDER BY table_id, position, created_at
    `,
  ]);

  const fieldsByTable = byTable(fieldRows.map(mapField));
  const viewsByTable = byTable(viewRows.map(mapView));
  const forms = formRows.map(mapForm);
  const formsByTable = byTable(forms);
  const formLevels: Record<string, PermissionLevel> = {};
  const formsById = new Map(forms.map((form) => [form.id, form]));
  const sidebarForms: Array<{ form: Form; tableId: string }> = [];
  for (const row of formRows) {
    formLevels[row.id as string] = levelFromRank(row.level_rank);
    if (row.sidebar_visible) {
      const form = formsById.get(row.id as string);
      if (form) sidebarForms.push({ form, tableId: form.tableId });
    }
  }

  return { dashboards, tables, tableLevels, fieldsByTable, viewsByTable, formsByTable, formLevels, sidebarForms };
};
