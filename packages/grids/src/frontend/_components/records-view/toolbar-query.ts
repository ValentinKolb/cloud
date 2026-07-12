import type { AggregationSpec, RecordQuery } from "../../../contracts";
import type { AggKindUI, AggregationRow } from "../toolbar/AggregationsPanel";
import type { FilterLeaf } from "../toolbar/FilterPanel";

const UI_AGG_KINDS: ReadonlySet<AggKindUI> = new Set(["count", "countEmpty", "countUnique", "sum", "avg", "min", "max"]);

export type ToolbarQueryPatch = {
  filter?: RecordQuery["filter"];
  sort?: RecordQuery["sort"];
  groupBy?: RecordQuery["groupBy"];
  aggregations?: RecordQuery["aggregations"];
};

export const applyToolbarQueryPatch = (previous: RecordQuery, patch: ToolbarQueryPatch): RecordQuery => {
  const groupShapeChanged = patch.groupBy !== undefined || patch.aggregations !== undefined;
  return {
    ...previous,
    filter: patch.filter,
    sort: patch.sort,
    groupBy: patch.groupBy,
    aggregations: patch.aggregations,
    groupSort: groupShapeChanged ? undefined : previous.groupSort,
  };
};

export const aggregationRowsFromQuery = (specs: AggregationSpec[] | undefined): AggregationRow[] =>
  (specs ?? [])
    .filter((spec): spec is AggregationSpec & { agg: AggKindUI } => UI_AGG_KINDS.has(spec.agg as AggKindUI))
    .map((spec) => ({ fieldId: spec.fieldId, agg: spec.agg, label: spec.label }));

export const filterRowsFromQuery = (filter: RecordQuery["filter"]): FilterLeaf[] => {
  if (!filter || typeof filter !== "object" || (filter as { op?: string }).op !== "AND") return [];
  const filters = (filter as { filters?: unknown[] }).filters;
  if (!Array.isArray(filters)) return [];
  return filters.filter((leaf): leaf is FilterLeaf => typeof leaf === "object" && leaf !== null && "fieldId" in leaf && "op" in leaf);
};
