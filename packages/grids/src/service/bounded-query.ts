import { sql } from "bun";

/**
 * Runs a read query with a server-side timeout without opening a transaction.
 * A reserved connection keeps SET, query, and RESET on the same session while
 * preventing Bun's transaction context from leaking into caller-side hydration.
 */
export const runBoundedQuery = async <T>(query: unknown, timeoutMs: number): Promise<T[]> => {
  const connection = await sql.reserve();
  try {
    await connection`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, false)`;
    const rows = await connection<T[]>`${query}`;
    return [...rows];
  } finally {
    try {
      await connection`RESET statement_timeout`;
    } finally {
      connection.release();
    }
  }
};
