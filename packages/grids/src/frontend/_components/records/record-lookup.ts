import { apiClient } from "@/api/client";
import type { RelationLookupItem } from "../../../contracts";

export type RecordLookupItem = RelationLookupItem;

export const fetchRecordLookup = async (params: {
  tableId: string;
  templateId?: string;
  query: string;
  excludeIds?: string[];
  limit?: number;
  signal: AbortSignal;
}): Promise<RecordLookupItem[]> => {
  if (params.templateId) {
    const url = new URL(`/api/grids/documents/templates/${encodeURIComponent(params.templateId)}/records/lookup`, window.location.origin);
    url.searchParams.set("q", params.query);
    url.searchParams.set("excludeIds", (params.excludeIds ?? []).join(","));
    url.searchParams.set("limit", String(params.limit ?? 10));
    const res = await fetch(url, { signal: params.signal });
    if (!res.ok) {
      if (res.status === 403) throw new Error("You do not have permission to choose records for this document template.");
      throw new Error("Could not load records.");
    }
    const data = (await res.json()) as { items: RecordLookupItem[] };
    return data.items;
  }
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
