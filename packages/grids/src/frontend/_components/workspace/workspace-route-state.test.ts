import { describe, expect, test } from "bun:test";
import { tableForPublicRouteId } from "./workspace-route-state";

const table = { id: "11111111-1111-4111-8111-111111111111", shortId: "TABLE1" };

describe("tableForPublicRouteId", () => {
  test("accepts the public table ID", () => {
    expect(tableForPublicRouteId([table], "TABLE1")).toBe(table);
  });

  test("rejects an internal table UUID", () => {
    expect(tableForPublicRouteId([table], table.id)).toBeNull();
  });
});
