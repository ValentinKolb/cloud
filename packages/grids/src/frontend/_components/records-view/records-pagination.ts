import type { RecordQuery } from "../../../contracts";

const RECORDS_PAGE_SIZE = 100;

export const nextCursorWithinLimit = (nextCursor: string | null, loadedCount: number, absoluteLimit: number | undefined): string | null =>
  absoluteLimit !== undefined && loadedCount >= absoluteLimit ? null : nextCursor;

export const queryForRecordsPage = (query: RecordQuery, loadedCount: number): RecordQuery => {
  const remaining = query.limit === undefined ? RECORDS_PAGE_SIZE : Math.max(query.limit - loadedCount, 1);
  return { ...query, limit: Math.min(RECORDS_PAGE_SIZE, remaining) };
};
