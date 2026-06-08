import type { ViewQuery } from "../../../contracts";

export type ToolbarQueryPatch = {
  filter?: ViewQuery["filter"];
  sort?: ViewQuery["sort"];
  groupBy?: ViewQuery["groupBy"];
  aggregations?: ViewQuery["aggregations"];
};

export const applyToolbarQueryPatch = (previous: ViewQuery, patch: ToolbarQueryPatch): ViewQuery => {
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
