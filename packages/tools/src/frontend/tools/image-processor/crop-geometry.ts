import type { CropAspect, CropRect } from "./types";

export type CropHandle = "nw" | "ne" | "sw" | "se";
type PixelCropRect = { x: number; y: number; w: number; h: number };

const DEFAULT_INSET = 0.1;
export const MIN_CROP_SIZE = 0.05;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const aspectRatio = (aspect: CropAspect, sourceWidth = 1, sourceHeight = 1): number | null => {
  if (aspect === "free") return null;
  const [width, height] = aspect.split(":").map(Number) as [number, number];
  const sourceRatio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  return width / height / sourceRatio;
};

export const createCropRect = (aspect: CropAspect, sourceWidth = 1, sourceHeight = 1): CropRect => {
  const ratio = aspectRatio(aspect, sourceWidth, sourceHeight);
  const maxSize = 1 - DEFAULT_INSET * 2;
  if (ratio === null) return { x: DEFAULT_INSET, y: DEFAULT_INSET, w: maxSize, h: maxSize };

  const w = ratio >= 1 ? maxSize : maxSize * ratio;
  const h = ratio >= 1 ? maxSize / ratio : maxSize;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
};

export const moveCropRect = (rect: CropRect, dx: number, dy: number): CropRect => ({
  x: clamp(rect.x + dx, 0, 1 - rect.w),
  y: clamp(rect.y + dy, 0, 1 - rect.h),
  w: rect.w,
  h: rect.h,
});

export const toPixelCropRect = (rect: CropRect, sourceWidth: number, sourceHeight: number): PixelCropRect => {
  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  const x = clamp(Math.floor(rect.x * width), 0, width - 1);
  const y = clamp(Math.floor(rect.y * height), 0, height - 1);
  const right = clamp(Math.ceil((rect.x + rect.w) * width), x + 1, width);
  const bottom = clamp(Math.ceil((rect.y + rect.h) * height), y + 1, height);
  return { x, y, w: right - x, h: bottom - y };
};

export const resizeCropRect = (
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: CropAspect,
  sourceWidth = 1,
  sourceHeight = 1,
): CropRect => {
  const east = handle.endsWith("e");
  const south = handle.startsWith("s");
  const anchorX = east ? rect.x : rect.x + rect.w;
  const anchorY = south ? rect.y : rect.y + rect.h;
  const cornerX = east ? rect.x + rect.w : rect.x;
  const cornerY = south ? rect.y + rect.h : rect.y;
  const maxWidth = east ? 1 - anchorX : anchorX;
  const maxHeight = south ? 1 - anchorY : anchorY;
  const targetX = cornerX + dx;
  const targetY = cornerY + dy;
  const desiredWidth = clamp(east ? targetX - anchorX : anchorX - targetX, MIN_CROP_SIZE, maxWidth);
  const desiredHeight = clamp(south ? targetY - anchorY : anchorY - targetY, MIN_CROP_SIZE, maxHeight);
  const ratio = aspectRatio(aspect, sourceWidth, sourceHeight);

  let width = desiredWidth;
  let height = desiredHeight;
  if (ratio !== null) {
    const projectedWidth = (desiredWidth + desiredHeight / ratio) / (1 + 1 / ratio ** 2);
    const minWidth = Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * ratio);
    const maxConstrainedWidth = Math.min(maxWidth, maxHeight * ratio);
    width = clamp(projectedWidth, Math.min(minWidth, maxConstrainedWidth), maxConstrainedWidth);
    height = width / ratio;
  }

  return {
    x: east ? anchorX : anchorX - width,
    y: south ? anchorY : anchorY - height,
    w: width,
    h: height,
  };
};
