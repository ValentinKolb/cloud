import { fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { SqlClient } from "./audit";

/**
 * Live-parent invariant helpers. The grids service contract is:
 *
 *   non-trash reads return only resources whose entire parent chain is
 *   alive. Restore paths require parent-chain alive; otherwise restore
 *   the parent first (top-down).
 *
 * Most read paths enforce this by JOINing the parent chain in their
 * SELECT. Mutating paths (restore, soft-delete) do a separate
 * preflight via these helpers because UPDATE ... FROM ... is more
 * verbose than a one-liner SELECT EXISTS.
 *
 * All checks return `Result<void>`: `ok()` when the parent chain is
 * alive, or `err.conflict(...)` when something in the parent chain is
 * trashed (the API layer translates conflict to 409).
 */

/**
 * Verify the table and base are alive. Inside a transaction, the row locks
 * keep both parents alive until the caller's write commits.
 */
export const requireTableAlive = async (tableId: string, client: SqlClient = sql): Promise<Result<void>> => {
  const [row] = await client<{ id: string }[]>`
    SELECT t.id::text AS id
    FROM grids.tables t
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.id = ${tableId}::uuid AND t.deleted_at IS NULL
    FOR SHARE OF t, b
  `;
  return row
    ? ok()
    : fail({
        code: "CONFLICT",
        message: "Parent table or base is trashed; restore the parent first",
        status: 409,
      });
};

/**
 * JOIN fragment for target-record reads that must obey the same live-parent
 * invariant as records.list/get. Aliases are internal constants at call sites;
 * keep this helper private to service SQL assembly, never pass user input.
 */
export const liveRecordParentJoinSql = (recordAlias: string, tableAlias: string, baseAlias: string) =>
  sql.unsafe(`
  JOIN grids.tables ${tableAlias} ON ${tableAlias}.id = ${recordAlias}.table_id AND ${tableAlias}.deleted_at IS NULL
  JOIN grids.bases ${baseAlias} ON ${baseAlias}.id = ${tableAlias}.base_id AND ${baseAlias}.deleted_at IS NULL
`);
