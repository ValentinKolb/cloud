import { describe, expect, test } from "bun:test";
import { compareStreamCursor, fromBase64, maxStreamCursor, parseStreamCursor, toBase64 } from "./yjs-sync";

describe("notebook Yjs stream helpers", () => {
  test("parses and orders valid stream cursors", () => {
    expect(parseStreamCursor("100-2")).toEqual({ ms: 100, seq: 2 });
    expect(parseStreamCursor("invalid")).toBeNull();
    expect(compareStreamCursor("100-2", "100-3")).toBeLessThan(0);
    expect(maxStreamCursor("100-2", "101-0")).toBe("101-0");
  });

  test("round-trips base64 and rejects malformed updates", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(() => fromBase64("not base64!")).toThrow(TypeError);
  });
});
