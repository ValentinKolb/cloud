import { describe, expect, test } from "bun:test";
import { adjacentInsertionIndex, adjacentRowCellTarget, moveItemByInsertionIndex } from "./dashboard-reorder";

describe("adjacentInsertionIndex", () => {
  test("maps keyboard directions to pointer-compatible insertion indexes", () => {
    expect(adjacentInsertionIndex(2, -1, 4)).toBe(1);
    expect(adjacentInsertionIndex(1, 1, 4)).toBe(3);
  });

  test("rejects moves beyond either boundary", () => {
    expect(adjacentInsertionIndex(0, -1, 4)).toBeNull();
    expect(adjacentInsertionIndex(3, 1, 4)).toBeNull();
    expect(adjacentInsertionIndex(-1, 1, 4)).toBeNull();
  });
});

describe("adjacentRowCellTarget", () => {
  test("preserves the widget column where the adjacent row has space", () => {
    expect(adjacentRowCellTarget([3, 4], 0, 2, 1)).toEqual({ rowIdx: 1, cellIdx: 2 });
  });

  test("appends when the adjacent row is shorter", () => {
    expect(adjacentRowCellTarget([4, 1], 0, 3, 1)).toEqual({ rowIdx: 1, cellIdx: 1 });
    expect(adjacentRowCellTarget([1, 4], 1, 3, -1)).toEqual({ rowIdx: 0, cellIdx: 1 });
  });

  test("rejects missing, full, and invalid targets", () => {
    expect(adjacentRowCellTarget([2], 0, 0, -1)).toBeNull();
    expect(adjacentRowCellTarget([2, 12], 0, 0, 1)).toBeNull();
    expect(adjacentRowCellTarget([2, 1], 0, 2, 1)).toBeNull();
  });
});

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
