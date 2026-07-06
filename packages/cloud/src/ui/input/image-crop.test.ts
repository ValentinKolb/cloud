import { describe, expect, test } from "bun:test";
import {
  clampImageCropRect,
  getInitialImageCropRect,
  imageCropRectToPixels,
  normalizeImageCropRotation,
  resizeImageCropAroundCenter,
  rotateImageCropRight,
} from "./image-crop";

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
});
