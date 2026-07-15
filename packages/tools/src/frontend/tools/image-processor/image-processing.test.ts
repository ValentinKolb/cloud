import { describe, expect, test } from "bun:test";
import { rotatedImageDimensions } from "./image-processing";

describe("image processing", () => {
  test("expands rotated image bounds instead of clipping corners", () => {
    expect(rotatedImageDimensions(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(rotatedImageDimensions(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedImageDimensions(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotatedImageDimensions(400, 300, 45)).toEqual({ width: 495, height: 495 });
  });
});
