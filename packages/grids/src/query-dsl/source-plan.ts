import type { DslQueryAst, DslSourceRef } from "./types";
import type { DslTableSource, DslViewSource } from "./resolver";

export const needsDslViewCatalog = (ast: DslQueryAst): boolean =>
  ast.source?.kind === "view" || ast.source?.kind === "unknown" || ast.joins.some((join) => join.source.kind !== "table");

const matchingTables = (tables: DslTableSource[], source: DslSourceRef): DslTableSource[] => {
  if (source.kind === "view") return [];
  return tables.filter((table) => table.shortId === source.ref || table.id === source.ref);
};

const matchingViewTableIds = (views: DslViewSource[], source: DslSourceRef): string[] => {
  if (source.kind === "table") return [];
  return views.filter((view) => view.shortId === source.ref || view.id === source.ref).map((view) => view.tableId);
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
