import { describe, expect, test } from "bun:test";
import type { Field } from "../../../service";
import { normalizeFieldOrder } from "./records-admin-controller";

describe("normalizeFieldOrder", () => {
  test("writes deterministic positions without mutating the input", () => {
    const first = { id: "first", position: 8 } as Field;
    const second = { id: "second", position: 3 } as Field;
    const ordered = [first, second];

    expect(normalizeFieldOrder(ordered).map(({ id, position }) => ({ id, position }))).toEqual([
      { id: "first", position: 0 },
      { id: "second", position: 1 },
    ]);
    expect(ordered).toEqual([first, second]);
  });
});
