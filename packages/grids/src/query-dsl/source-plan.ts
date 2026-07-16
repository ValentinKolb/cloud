import { normalizeRefKey } from "../ref-syntax";
import type { DslResolvedSqlQueryPlan, DslTableSource, DslViewSource } from "./resolver";
import type { DslQueryAst, DslSourceRef } from "./types";

export const needsDslViewCatalog = (ast: DslQueryAst): boolean =>
  ast.source?.kind === "view" || ast.joins.some((join) => join.source.kind !== "table");

const matchingTables = (tables: DslTableSource[], source: DslSourceRef): DslTableSource[] => {
  if (source.kind === "view") return [];
  const ref = normalizeRefKey(source.ref);
  return tables.filter((table) => [table.shortId, table.id, table.name].some((value) => normalizeRefKey(value) === ref));
};

const matchingViewTableIds = (views: DslViewSource[], source: DslSourceRef): string[] => {
  if (source.kind === "table") return [];
  const ref = normalizeRefKey(source.ref);
  return views
    .filter((view) => [view.shortId, view.id, view.name].some((value) => normalizeRefKey(value) === ref))
    .map((view) => view.tableId);
};

export const collectDslFieldTableIds = (params: {
  ast: DslQueryAst;
  currentTableId?: string;
  tables: DslTableSource[];
  views?: DslViewSource[];
}): string[] => {
  const tableIds = new Set<string>();
  const views = params.views ?? [];
  const addSource = (source: DslSourceRef | undefined) => {
    if (!source) return;
    for (const table of matchingTables(params.tables, source)) tableIds.add(table.id);
    for (const tableId of matchingViewTableIds(views, source)) tableIds.add(tableId);
  };

  if (params.ast.source) addSource(params.ast.source);
  else if (params.currentTableId && params.tables.some((table) => table.id === params.currentTableId)) tableIds.add(params.currentTableId);

  for (const join of params.ast.joins) addSource(join.source);

  return [...tableIds];
};

export const collectDslPlanExtraFieldTableIds = (plan: DslResolvedSqlQueryPlan): string[] => {
  const tableIds = new Set<string>();
  const derived = plan.derivedViewSource;
  if (!derived?.search) return [];
  const readableTableIds = new Set(plan.readableTableIds);

  for (const column of derived.search.columns) {
    if (column.type === "relation" && column.targetTableId && readableTableIds.has(column.targetTableId)) {
      tableIds.add(column.targetTableId);
    }
  }

  return [...tableIds];
};
