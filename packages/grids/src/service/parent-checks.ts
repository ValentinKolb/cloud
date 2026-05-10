import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";

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

/** Verify the table is alive AND its base is alive. */
export const requireTableAlive = async (tableId: string): Promise<Result<void>> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM grids.tables t
      JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
      WHERE t.id = ${tableId}::uuid AND t.deleted_at IS NULL
    ) AS exists
  `;
  return row?.exists
    ? ok()
    : fail(err.conflict("parent table or base is trashed; restore the parent first"));
};
