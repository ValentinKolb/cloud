import { describe, expect, test } from "bun:test";
import { moveItemByInsertionIndex } from "./dashboard-reorder";

describe("moveItemByInsertionIndex", () => {
  test("moves an item right into the last position", () => {
    expect(moveItemByInsertionIndex(["a", "b", "c", "d"], 2, 4)).toEqual(["a", "b", "d", "c"]);
  });

  test("moves an item right by one", () => {
    expect(moveItemByInsertionIndex(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "b", "d"]);
  });

  test("moves an item left by one", () => {
    expect(moveItemByInsertionIndex(["a", "b", "c", "d"], 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  test("moves the last item to the first position", () => {
    expect(moveItemByInsertionIndex(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  test("ignores invalid source indexes", () => {
    const items = ["a", "b"];
    expect(moveItemByInsertionIndex(items, -1, 1)).toBe(items);
    expect(moveItemByInsertionIndex(items, 2, 1)).toBe(items);
  });
});
