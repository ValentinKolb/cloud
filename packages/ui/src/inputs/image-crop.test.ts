import { describe, expect, test } from "bun:test";
import {
  clampImageCropRect,
  getInitialImageCropRect,
  imageCropRectToPixels,
  normalizeImageCropRotation,
  resizeImageCropAroundCenter,
  rotateImageCropRight,
} from "./image-crop";

/**
 * The first six cases are a verbatim port of Cloud's `ui/input/image-crop.test.ts`;
 * the package implementation is a reformatted copy of Cloud's, so its numbers must
 * still land exactly on Cloud's expectations. The remaining cases lock the
 * boundaries Cloud never asserted (empty/degenerate image sizes, MIN_CROP_SIZE
 * floors, rotation rounding, and the clamp order in `imageCropRectToPixels`).
 */
describe("image crop helpers", () => {
  test("normalizes rotate-right steps", () => {
    expect(rotateImageCropRight(0)).toBe(90);
    expect(rotateImageCropRight(270)).toBe(0);
    expect(normalizeImageCropRotation(-90)).toBe(270);
  });

  test("creates a centered fixed-aspect crop", () => {
    const crop = getInitialImageCropRect({ width: 1600, height: 900 }, { width: 1, height: 1 });

    expect(crop.width).toBeLessThan(crop.height);
    expect(Math.round(crop.x * 100)).toBe(26);
    expect(Math.round(crop.y * 100)).toBe(7);
    expect(Math.round(((crop.width * 1600) / (crop.height * 900)) * 100)).toBe(100);
  });

  test("clamps free crops inside the image", () => {
    const crop = clampImageCropRect({ x: 0.9, y: -0.2, width: 0.5, height: 1.4 }, { width: 800, height: 600 }, "free");

    expect(crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  test("resizes around the current crop center", () => {
    const crop = resizeImageCropAroundCenter(
      { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      { width: 1000, height: 1000 },
      { width: 1, height: 1 },
      2,
    );

    expect(crop).toEqual({ x: 0.35, y: 0.35, width: 0.3, height: 0.3 });
  });

  test("converts normalized crops to pixels", () => {
    expect(imageCropRectToPixels({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 }, { width: 400, height: 300 })).toEqual({
      x: 100,
      y: 30,
      width: 200,
      height: 240,
    });
  });

  test("keeps out-of-range pixel crops inside the image", () => {
    expect(imageCropRectToPixels({ x: 2, y: -1, width: 0.5, height: 2 }, { width: 100, height: 100 })).toEqual({
      x: 92,
      y: 0,
      width: 8,
      height: 100,
    });
  });

  test("rounds arbitrary rotations onto the four quarter turns", () => {
    expect(normalizeImageCropRotation(0)).toBe(0);
    expect(normalizeImageCropRotation(44)).toBe(0);
    expect(normalizeImageCropRotation(45)).toBe(90);
    expect(normalizeImageCropRotation(360)).toBe(0);
    expect(normalizeImageCropRotation(450)).toBe(90);
    expect(normalizeImageCropRotation(-360)).toBe(0);
    expect(normalizeImageCropRotation(-450)).toBe(270);
    expect(rotateImageCropRight(90)).toBe(180);
    expect(rotateImageCropRight(180)).toBe(270);
  });

  test("falls back to a square image ratio for degenerate sizes", () => {
    // width/height of 0 must not produce NaN or Infinity: the helpers treat the
    // source as 1:1 instead of dividing by zero.
    const zero = getInitialImageCropRect({ width: 0, height: 0 }, { width: 1, height: 1 });
    expect(zero).toEqual({ x: 0.07, y: 0.07, width: 0.86, height: 0.86 });

    const zeroHeight = clampImageCropRect({ x: 0, y: 0, width: 0.5, height: 0.5 }, { width: 100, height: 0 }, { width: 2, height: 1 });
    expect(Number.isFinite(zeroHeight.width)).toBe(true);
    expect(Number.isFinite(zeroHeight.height)).toBe(true);
    expect(zeroHeight).toEqual({ x: 0, y: 0, width: 0.5, height: 0.25 });
  });

  test("treats a zero aspect as 1:1 rather than dividing by zero", () => {
    const crop = getInitialImageCropRect({ width: 100, height: 100 }, { width: 0, height: 0 });
    expect(crop).toEqual({ x: 0.07, y: 0.07, width: 0.86, height: 0.86 });
  });

  test("omitting the aspect argument yields the free-form default crop", () => {
    expect(getInitialImageCropRect({ width: 1600, height: 900 })).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(clampImageCropRect({ x: 0.9, y: -0.2, width: 0.5, height: 1.4 }, { width: 800, height: 600 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  test("floors free crops at the minimum crop size", () => {
    const crop = clampImageCropRect({ x: 0.5, y: 0.5, width: 0, height: -1 }, { width: 100, height: 100 }, "free");
    expect(crop.width).toBeCloseTo(0.08, 10);
    expect(crop.height).toBeCloseTo(0.08, 10);
    expect(crop.x).toBeCloseTo(0.5, 10);
    expect(crop.y).toBeCloseTo(0.5, 10);
  });

  test("clamps the resize scale to the supported 0.2x-5x band", () => {
    const rect = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    const size = { width: 1000, height: 1000 };

    // Anything below 0.2x behaves exactly like 0.2x, anything above 5x like 5x.
    expect(resizeImageCropAroundCenter(rect, size, "free", 0.01)).toEqual(resizeImageCropAroundCenter(rect, size, "free", 0.2));
    expect(resizeImageCropAroundCenter(rect, size, "free", 1000)).toEqual(resizeImageCropAroundCenter(rect, size, "free", 5));

    // 5x shrinks 0.6 to 0.12, still above the 0.08 floor, and stays centered.
    const zoomedIn = resizeImageCropAroundCenter(rect, size, "free", 5);
    expect(zoomedIn.width).toBeCloseTo(0.12, 10);
    expect(zoomedIn.x + zoomedIn.width / 2).toBeCloseTo(0.5, 10);
  });

  test("keeps a resized crop inside the frame instead of overflowing", () => {
    // 0.2x scale wants a 1.5-wide crop; the result must be clamped to the frame.
    const crop = resizeImageCropAroundCenter({ x: 0.4, y: 0.4, width: 0.3, height: 0.3 }, { width: 800, height: 800 }, "free", 0.2);
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });

  test("never emits a zero-pixel crop for sub-pixel rectangles", () => {
    // Math.round would floor these to 0 without the Math.max(1, …) guard.
    expect(imageCropRectToPixels({ x: 0, y: 0, width: 0.08, height: 0.08 }, { width: 4, height: 4 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  test("caps pixel width against the clamped origin, not the raw origin", () => {
    // x clamps to 1 - MIN_CROP_SIZE = 0.92, so the width budget is 0.08 even
    // though the caller asked for 0.5 starting past the right edge.
    expect(imageCropRectToPixels({ x: 0.95, y: 0.95, width: 0.5, height: 0.5 }, { width: 200, height: 200 })).toEqual({
      x: 184,
      y: 184,
      width: 16,
      height: 16,
    });
  });
});
