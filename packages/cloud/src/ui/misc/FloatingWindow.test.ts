import { describe, expect, test } from "bun:test";
import { fitFloatingWindowRect } from "./floating-window-geometry";

describe("fitFloatingWindowRect", () => {
  test("keeps a utility window fully inside the viewport", () => {
    expect(fitFloatingWindowRect({ x: 900, y: -40, width: 500, height: 700 }, 360, 320, { width: 1024, height: 768 })).toEqual({
      x: 508,
      y: 16,
      width: 500,
      height: 700,
    });
  });

  test("shrinks oversized windows without violating minimums", () => {
    expect(fitFloatingWindowRect({ x: 0, y: 0, width: 1200, height: 900 }, 360, 320, { width: 800, height: 600 })).toEqual({
      x: 16,
      y: 16,
      width: 768,
      height: 568,
    });
  });
});
