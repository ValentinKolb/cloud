import { describe, expect, test } from "bun:test";
import { type DashboardTextQuery, prepareDashboardTextQueries } from "./query-management";

describe("Pulse dashboard query preparation", () => {
  test("resolves all distinct Source short IDs in one scoped batch and preserves public compiled IDs", async () => {
    const calls: Array<{ table: string; baseId: string; sourceIds: readonly string[] }> = [];
    const requests: DashboardTextQuery[] = [
      { kind: "query", query: "metric cpu.usage avg every 5m since 1h source Src001" },
      { kind: "query", query: "events deploy.finished since 1h source Src001 limit 20" },
      { kind: "query", query: "states service.online since 1h source Src002 limit 20" },
    ];

    const results = await prepareDashboardTextQueries("base-uuid", requests, async (table, baseId, sourceIds) => {
      calls.push({ table, baseId, sourceIds });
      return new Map([
        ["Src001", "source-uuid-1"],
        ["Src002", "source-uuid-2"],
      ]);
    });

    expect(calls).toEqual([{ table: "sources", baseId: "base-uuid", sourceIds: ["Src001", "Src002"] }]);
    expect(results.every((result) => result.ok)).toBe(true);
    if (results.every((result) => result.ok)) {
      expect(results.map((result) => result.data.publicQuery.sourceId)).toEqual(["Src001", "Src001", "Src002"]);
      expect(results.map((result) => result.data.internalQuery.sourceId)).toEqual(["source-uuid-1", "source-uuid-1", "source-uuid-2"]);
    }
  });

  test("fails source-filtered queries closed when the scoped batch cannot resolve every Source", async () => {
    const results = await prepareDashboardTextQueries(
      "base-uuid",
      [
        { kind: "query", query: "metric cpu.usage avg every 5m since 1h source Src001" },
        { kind: "query", query: "metric memory.usage avg every 5m since 1h" },
      ],
      async () => null,
    );

    expect(results[0]).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(results[1]).toMatchObject({ ok: true, data: { publicQuery: { sourceId: null }, internalQuery: { sourceId: null } } });
  });
});
