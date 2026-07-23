import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { runBoundedQuery } from "./bounded-query";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

describe("bounded query", () => {
  postgresTest("releases the connection after success and timeout", async () => {
    const rows = await runBoundedQuery<{ answer: number }>(sql`SELECT 42::int AS answer`, 1_000);
    expect(rows).toEqual([{ answer: 42 }]);

    await expect(runBoundedQuery(sql`SELECT pg_sleep(0.05)`, 5)).rejects.toThrow(/statement timeout|canceling statement/i);

    const recovered = await Promise.all(
      Array.from({ length: 20 }, () => runBoundedQuery<{ answer: number }>(sql`SELECT 42::int AS answer`, 1_000)),
    );
    expect(recovered.every(([row]) => row?.answer === 42)).toBe(true);
  });
});
