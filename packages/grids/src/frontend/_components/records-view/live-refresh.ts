import type { TableQueryResult, ViewQuery } from "../../../contracts";
import type { GridRecord } from "../../../service";

export type LiveRecordEvent = {
  v: 1;
  type: "record.created" | "record.updated" | "record.deleted" | "record.restored";
  baseId: string;
  tableId: string;
  recordId: string;
  version: number | null;
  changedFieldIds: string[];
  actorId: string | null;
  occurredAt: string;
};

const TERMINAL_LIVE_ERROR_CODES = new Set(["login_required", "access_denied", "not_found"]);

export const isTerminalLiveErrorCode = (code: unknown): code is string => typeof code === "string" && TERMINAL_LIVE_ERROR_CODES.has(code);

export const isLiveRecordEventForTable = (event: unknown, tableId: string): event is LiveRecordEvent => {
  if (!event || typeof event !== "object") return false;
  const candidate = event as Partial<LiveRecordEvent>;
  return (
    candidate.v === 1 &&
    (candidate.type === "record.created" ||
      candidate.type === "record.updated" ||
      candidate.type === "record.deleted" ||
      candidate.type === "record.restored") &&
    candidate.tableId === tableId &&
    typeof candidate.recordId === "string"
  );
};

export const visibleIdsFromResult = (result: TableQueryResult | undefined): string[] =>
  ((result?.items ?? []) as GridRecord[]).map((record) => record.id);

export const highlightedIdsForLiveRefresh = (params: {
  eventRecordIds: Iterable<string>;
  previousVisibleIds: Iterable<string>;
  nextVisibleIds: Iterable<string>;
}): string[] => {
  const eventIds = new Set(params.eventRecordIds);
  const previous = new Set(params.previousVisibleIds);
  const next = new Set(params.nextVisibleIds);
  const highlighted = new Set<string>();

  for (const id of eventIds) {
    if (next.has(id)) highlighted.add(id);
  }
  for (const id of next) {
    if (!previous.has(id)) highlighted.add(id);
  }
  return [...highlighted];
};

export const mergeLiveRefreshItems = <T extends GridRecord>(params: { currentItems: T[]; nextItems: T[] }): T[] => {
  if (params.currentItems.length <= params.nextItems.length) return params.nextItems;
  const nextIds = new Set(params.nextItems.map((record) => record.id));
  const preservedTail = params.currentItems.slice(params.nextItems.length).filter((record) => !nextIds.has(record.id));
  return [...params.nextItems, ...preservedTail];
};

export const liveRefreshQuery = (query: ViewQuery, visibleCount: number): ViewQuery => {
  const currentLimit = typeof query.limit === "number" && Number.isFinite(query.limit) ? query.limit : 100;
  const limit = Math.min(Math.max(currentLimit, visibleCount, 1), 500);
  return { ...query, limit };
};

export const shouldOptimisticallyRemoveDeletedRecord = (query: Pick<ViewQuery, "includeDeleted" | "deletedOnly">): boolean =>
  !query.includeDeleted && !query.deletedOnly;
