import { expect, test } from "bun:test";
import { listForTables } from "./views";

test("an empty authorized table set has no views", async () => {
  expect(await listForTables({ tableIds: [], userId: null })).toEqual([]);
});
