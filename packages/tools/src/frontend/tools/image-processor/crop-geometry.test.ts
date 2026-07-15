import { describe, expect, test } from "bun:test";
import { type CropHandle, createCropRect, MIN_CROP_SIZE, moveCropRect, resizeCropRect, toPixelCropRect } from "./crop-geometry";
import type { CropAspect, CropRect } from "./types";

const expectBounded = (rect: CropRect) => {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.w).toBeLessThanOrEqual(1);
  expect(rect.y + rect.h).toBeLessThanOrEqual(1);
  expect(rect.w).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
  expect(rect.h).toBeGreaterThanOrEqual(MIN_CROP_SIZE);
};

describe("crop geometry", () => {
  test.each(["free", "1:1", "4:3", "16:9", "3:2"] satisfies CropAspect[])("creates a centered bounded %s crop", (aspect) => {
    const rect = createCropRect(aspect);
    expectBounded(rect);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5);
    expect(rect.y + rect.h / 2).toBeCloseTo(0.5);

    if (aspect !== "free") {
      const [width, height] = aspect.split(":").map(Number) as [number, number];
      expect(rect.w / rect.h).toBeCloseTo(width / height);
    }
  });

  test.each(["1:1", "4:3", "16:9", "3:2"] satisfies CropAspect[])("creates a true %s pixel crop for a wide image", (aspect) => {
    const sourceWidth = 1920;
    const sourceHeight = 1080;
    const rect = createCropRect(aspect, sourceWidth, sourceHeight);
    const [width, height] = aspect.split(":").map(Number) as [number, number];
    expect((rect.w * sourceWidth) / (rect.h * sourceHeight)).toBeCloseTo(width / height);
  });

  test("clamps moves to every image edge", () => {
    const rect = { x: 0.2, y: 0.3, w: 0.4, h: 0.5 };
    expect(moveCropRect(rect, -2, -2)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.5 });
    expect(moveCropRect(rect, 2, 2)).toEqual({ x: 0.6, y: 0.5, w: 0.4, h: 0.5 });
  });

  test.each(["nw", "ne", "sw", "se"] satisfies CropHandle[])("keeps free resize from %s bounded and anchored", (handle) => {
    const start = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    const anchorX = handle.endsWith("e") ? start.x : start.x + start.w;
    const anchorY = handle.startsWith("s") ? start.y : start.y + start.h;
    const rect = resizeCropRect(start, handle, handle.endsWith("e") ? 2 : -2, handle.startsWith("s") ? 2 : -2, "free");
    expectBounded(rect);
    expect(handle.endsWith("e") ? rect.x + rect.w : rect.x).toBe(handle.endsWith("e") ? 1 : 0);
    expect(handle.startsWith("s") ? rect.y + rect.h : rect.y).toBe(handle.startsWith("s") ? 1 : 0);
    expect(handle.endsWith("e") ? rect.x : rect.x + rect.w).toBeCloseTo(anchorX);
    expect(handle.startsWith("s") ? rect.y : rect.y + rect.h).toBeCloseTo(anchorY);
  });

  test.each(["nw", "ne", "sw", "se"] satisfies CropHandle[])("preserves a fixed ratio while resizing from %s", (handle) => {
    const start = createCropRect("16:9");
    const anchorX = handle.endsWith("e") ? start.x : start.x + start.w;
    const anchorY = handle.startsWith("s") ? start.y : start.y + start.h;
    const rect = resizeCropRect(start, handle, 0.07, -0.13, "16:9");

    expectBounded(rect);
    expect(rect.w / rect.h).toBeCloseTo(16 / 9);
    expect(handle.endsWith("e") ? rect.x : rect.x + rect.w).toBeCloseTo(anchorX);
    expect(handle.startsWith("s") ? rect.y : rect.y + rect.h).toBeCloseTo(anchorY);
  });

  test("preserves the requested pixel ratio while resizing a wide image", () => {
    const start = createCropRect("1:1", 1920, 1080);
    const rect = resizeCropRect(start, "se", 0.1, 0.05, "1:1", 1920, 1080);
    expect((rect.w * 1920) / (rect.h * 1080)).toBeCloseTo(1);
  });

  test("enforces a usable minimum crop size", () => {
    const rect = resizeCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, "se", -10, -10, "free");
    expect(rect.w).toBeCloseTo(MIN_CROP_SIZE);
    expect(rect.h).toBeCloseTo(MIN_CROP_SIZE);
    expectBounded(rect);
  });

  test("keeps rounded pixel coordinates inside the source image", () => {
    expect(toPixelCropRect({ x: 0.333, y: 0.333, w: 0.667, h: 0.667 }, 101, 77)).toEqual({
      x: 33,
      y: 25,
      w: 68,
      h: 52,
    });
    expect(toPixelCropRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, 10, 10)).toEqual({
      x: 9,
      y: 9,
      w: 1,
      h: 1,
    });
  });
});
