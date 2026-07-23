import { describe, expect, test } from "bun:test";
import { recordCountText } from "./record-count";

describe("recordCountText", () => {
  test("reports exact terminal counts", () => {
    expect(recordCountText(0, "record", false)).toBe("No records");
    expect(recordCountText(1, "record", false)).toBe("1 record");
    expect(recordCountText(3, "group", false)).toBe("3 groups");
  });

  test("marks partial pages as loaded counts", () => {
    expect(recordCountText(1, "group", true)).toBe("1 group loaded");
    expect(recordCountText(100, "record", true)).toBe("100 records loaded");
  });
});
