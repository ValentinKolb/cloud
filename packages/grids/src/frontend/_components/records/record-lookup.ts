import { apiClient } from "@/api/client";
import type { RelationLookupItem } from "../../../contracts";

export type RecordLookupItem = RelationLookupItem;

export const fetchRecordLookup = async (params: {
  tableId: string;
  query: string;
  excludeIds?: string[];
  limit?: number;
  signal: AbortSignal;
}): Promise<RecordLookupItem[]> => {
  const res = await apiClient.tables[":tableId"].lookup.$get(
    {
      param: { tableId: params.tableId },
      query: {
        q: params.query,
        excludeIds: (params.excludeIds ?? []).join(","),
        limit: String(params.limit ?? 10),
      },
    },
    { init: { signal: params.signal } },
  );
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("You do not have permission to choose records from this table.");
    }
    throw new Error("Could not load records.");
  }
  const data = await res.json();
  return data.items;
};
