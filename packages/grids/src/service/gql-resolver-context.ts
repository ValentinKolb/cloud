import { sql } from "bun";
import { ViewQuerySchema } from "../contracts";
import type { DslResolverContext, DslTableSource, DslViewSource } from "../query-dsl/resolver";
import { collectDslFieldTableIds, needsDslViewCatalog } from "../query-dsl/source-plan";
import type { DslQueryAst } from "../query-dsl/types";
import * as fields from "./fields";
import { parseJsonbRow } from "./jsonb";
import * as tables from "./tables";
import type { Field } from "./types";

type DbRow = Record<string, unknown>;

export const loadBaseGqlDslViews = async (baseId: string): Promise<DslViewSource[]> => {
  const rows = await sql<DbRow[]>`
    SELECT v.id, v.short_id, v.name, v.table_id, v.query
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid
      AND v.deleted_at IS NULL
    ORDER BY v.position, v.created_at
  `;
  return rows.map((row) => {
    const rawQuery = parseJsonbRow<unknown>(row.query, {});
    const parsed = ViewQuerySchema.safeParse(rawQuery);
    return {
      kind: "view" as const,
      id: row.id as string,
      shortId: row.short_id as string,
      name: row.name as string,
      tableId: row.table_id as string,
      query: parsed.success ? parsed.data : {},
    };
  });
};

export const buildBaseGqlResolverContext = async (params: {
  baseId: string;
  currentTableId?: string;
  ast: DslQueryAst;
}): Promise<DslResolverContext> => {
  const baseTables = await tables.listByBase(params.baseId);
  const dslTables: DslTableSource[] = baseTables.map((table) => ({
    kind: "table",
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  }));
  const viewsCatalog = needsDslViewCatalog(params.ast) ? await loadBaseGqlDslViews(params.baseId) : [];
  const currentTable = params.currentTableId ? dslTables.find((table) => table.id === params.currentTableId) : undefined;
  const fieldTableIds = collectDslFieldTableIds({
    ast: params.ast,
    currentTableId: params.currentTableId,
    tables: dslTables,
    views: viewsCatalog,
  });
  const fieldGroups = await Promise.all(
    fieldTableIds.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })),
  );

  return {
    ...(currentTable ? { currentTable } : {}),
    tables: dslTables,
    views: viewsCatalog,
    fieldsByTableId: Object.fromEntries(fieldGroups.map((group) => [group.tableId, group.fields])) as Record<string, Field[]>,
  };
};
