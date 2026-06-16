import type { RecordQuery } from "../../../contracts";

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
