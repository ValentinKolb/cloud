import { describe, expect, test } from "bun:test";
import { resolveByteRange } from "./byte-range";

describe("mail attachment byte ranges", () => {
  test("parses bounded, open, and suffix ranges", () => {
    expect(resolveByteRange("bytes=10-19", 100)).toEqual({ start: 10, endExclusive: 20 });
    expect(resolveByteRange("bytes=90-", 100)).toEqual({ start: 90, endExclusive: 100 });
    expect(resolveByteRange("bytes=-10", 100)).toEqual({ start: 90, endExclusive: 100 });
    expect(resolveByteRange("bytes=90-999", 100)).toEqual({ start: 90, endExclusive: 100 });
  });

  test("rejects multiple, reversed, empty, and out-of-bounds ranges", () => {
    for (const value of ["bytes=0-1,4-5", "bytes=20-10", "bytes=-0", "bytes=100-", "items=0-1"]) {
      expect(resolveByteRange(value, 100), value).toBe("unsatisfiable");
    }
    expect(resolveByteRange("bytes=0-0", 0)).toBe("unsatisfiable");
    expect(resolveByteRange(null, 100)).toBeNull();
  });
});
