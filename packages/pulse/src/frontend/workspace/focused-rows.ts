import type { PulseCurrentState, PulseMetricSeries, PulseRecordedEvent } from "../../contracts";
import { jsonFetch } from "./helpers";
import type { WorkspaceView } from "./types";

export type FocusedRowsView = Extract<WorkspaceView, "metric-detail" | "state-detail" | "event-detail">;

export type FocusedRowsPage =
  | { hasMore: boolean; rows: PulseMetricSeries[]; view: "metric-detail" }
  | { hasMore: boolean; rows: PulseCurrentState[]; view: "state-detail" }
  | { hasMore: boolean; rows: PulseRecordedEvent[]; view: "event-detail" };

type FetchFocusedRowsPageInput = {
  baseId: string;
  offset: number;
  pageSize: number;
  search: string;
  signal?: AbortSignal;
  signalId: string;
  view: FocusedRowsView;
};

const focusedRowsParams = (input: FetchFocusedRowsPageInput) => {
  const params = new URLSearchParams({
    limit: String(input.pageSize + 1),
    offset: String(input.offset),
  });
  if (input.search) params.set("q", input.search);
  return params;
};

export const fetchFocusedRowsPage = async (input: FetchFocusedRowsPageInput): Promise<FocusedRowsPage> => {
  const params = focusedRowsParams(input);

  if (input.view === "metric-detail") {
    params.set("metric", input.signalId);
    const rows = await jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${input.baseId}/series?${params}`, { signal: input.signal });
    return { hasMore: rows.length > input.pageSize, rows: rows.slice(0, input.pageSize), view: input.view };
  }

  if (input.view === "state-detail") {
    params.set("key", input.signalId);
    const rows = await jsonFetch<PulseCurrentState[]>(`/api/pulse/bases/${input.baseId}/states?${params}`, { signal: input.signal });
    return { hasMore: rows.length > input.pageSize, rows: rows.slice(0, input.pageSize), view: input.view };
  }

  params.set("kind", input.signalId);
  const rows = await jsonFetch<PulseRecordedEvent[]>(`/api/pulse/bases/${input.baseId}/recent-events?${params}`, { signal: input.signal });
  return { hasMore: rows.length > input.pageSize, rows: rows.slice(0, input.pageSize), view: input.view };
};
