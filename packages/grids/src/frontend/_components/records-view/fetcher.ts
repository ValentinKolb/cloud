/**
 * Typed wrapper around POST /api/grids/tables/:tableId/query — the
 * unified records-area endpoint from Slice 5. Returns whichever of
 * { items, aggregates, buckets, nextCursor, explode } the ViewQuery
 * asked for; consumers (RecordsView's createResource) react via Solid's
 * loading-state machinery.
 *
 * Threads an AbortSignal through so rapid query changes cancel
 * in-flight network calls instead of letting them race. createResource
 * already deduplicates UI commits by cancelling the *promise* — this
 * cancels the *fetch* on top of that, saving server work.
 */

import { apiClient } from "../../../api/client";
import type { TableQueryBody, TableQueryResult, ViewQuery } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

type FetchTableQueryArgs = {
  tableId: string;
  query: ViewQuery;
  cursor: string | null;
  filePreviewFieldIds?: string[];
};

/**
 * Custom error so callers can distinguish HTTP failures (server-side
 * rejection of the query) from network-level errors (offline,
 * AbortError). The status code is exposed for consumers that want to
 * surface 400-vs-500 differently in the UI.
 */
export class TableQueryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TableQueryError";
  }
}

export const fetchTableQuery = async (args: FetchTableQueryArgs, opts: { signal?: AbortSignal } = {}): Promise<TableQueryResult> => {
  const body: TableQueryBody = {
    query: args.query,
    cursor: args.cursor ?? undefined,
    filePreviewFieldIds: args.filePreviewFieldIds,
  };
  // Hono's RPC client takes RequestInit as the second positional arg —
  // signal lives there alongside any future header / credentials needs.
  const res = await apiClient.tables[":tableId"].query.$post(
    { param: { tableId: args.tableId }, json: body },
    { init: { signal: opts.signal } },
  );
  if (!res.ok) {
    throw new TableQueryError(res.status, await errorMessage(res, "Could not load records."));
  }
  return res.json();
};
