import { sql } from "bun";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import type { DslResolverContext, DslTableSource, DslViewSource } from "../query-dsl/resolver";
import { resolveDslQueryToRecordQuery } from "../query-dsl/resolver";
import { collectDslFieldTableIds, needsDslViewCatalog } from "../query-dsl/source-plan";
import type { DslQueryAst } from "../query-dsl/types";
import * as fields from "./fields";
import * as tables from "./tables";
import type { Field } from "./types";

type DbRow = Record<string, unknown>;

const loadBaseGqlDslViews = async (baseId: string): Promise<DslViewSource[]> => {
  const rows = await sql<DbRow[]>`
    SELECT v.id, v.short_id, v.name, v.table_id, v.source
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid
      AND v.deleted_at IS NULL
    ORDER BY v.position, v.created_at
  `;
  return rows.map((row) => ({
    kind: "view" as const,
    id: row.id as string,
    shortId: row.short_id as string,
    name: row.name as string,
    tableId: row.table_id as string,
    source: row.source as string,
    query: {},
  }));
};

export const hydrateDslViewQueries = (params: {
  tables: DslTableSource[];
  views: DslViewSource[];
  fieldsByTableId: Record<string, Field[]>;
}): DslViewSource[] =>
  params.views.map((view) => {
    if (!view.source) return view;
    const parsed = parseGridsQueryDsl(view.source);
    if (!parsed.ok) return view;
    const currentTable = params.tables.find((table) => table.id === view.tableId);
    const resolved = resolveDslQueryToRecordQuery(parsed.ast, {
      ...(currentTable ? { currentTable } : {}),
      tables: params.tables,
      views: [],
      fieldsByTableId: params.fieldsByTableId,
    });
    return resolved.ok ? { ...view, query: resolved.plan.query } : view;
  });

export const buildTrustedGqlResolverContext = async (params: {
  baseId: string;
  currentTableId?: string;
  ast: DslQueryAst;
  purpose: "dashboard-widget-render" | "document-template-render";
}): Promise<DslResolverContext> => {
  void params.purpose;
  const baseTables = await tables.listByBase(params.baseId);
  const dslTables: DslTableSource[] = baseTables.map((table) => ({
    kind: "table",
    id: table.id,
    shortId: table.shortId,
    name: table.name,
  }));
  const viewsCatalog = needsDslViewCatalog(params.ast) ? await loadBaseGqlDslViews(params.baseId) : [];
  const currentTable = params.currentTableId ? dslTables.find((table) => table.id === params.currentTableId) : undefined;
  const fieldTableIds =
    viewsCatalog.length > 0
      ? dslTables.map((table) => table.id)
      : collectDslFieldTableIds({
          ast: params.ast,
          currentTableId: params.currentTableId,
          tables: dslTables,
          views: viewsCatalog,
        });
  const fieldGroups = await Promise.all(fieldTableIds.map(async (tableId) => ({ tableId, fields: await fields.listByTable(tableId) })));
  const fieldsByTableId = Object.fromEntries(fieldGroups.map((group) => [group.tableId, group.fields])) as Record<string, Field[]>;
  const views = hydrateDslViewQueries({ tables: dslTables, views: viewsCatalog, fieldsByTableId });

  return {
    ...(currentTable ? { currentTable } : {}),
    tables: dslTables,
    views,
    fieldsByTableId,
  };
};
