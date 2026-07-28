export type ImageCropAspect = "free" | { width: number; height: number };
export type ImageCropRotation = 0 | 90 | 180 | 270;
export type ImageCropRect = { x: number; y: number; width: number; height: number };
export type ImageCropState = { crop: ImageCropRect; rotation: ImageCropRotation };
export type ImageCropSource = File | Blob | HTMLImageElement | HTMLCanvasElement | string;
export type ImageCropOutput = {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: "webp" | "jpeg" | "png";
  quality?: number;
};
export type ImageCropSize = { width: number; height: number };

const MIN_CROP_SIZE = 0.08;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const aspectRatio = (aspect: Exclude<ImageCropAspect, "free">) =>
  aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : 1;

export const normalizeImageCropRotation = (rotation: number): ImageCropRotation =>
  (((Math.round(rotation / 90) * 90) % 360 + 360) % 360) as ImageCropRotation;

export const rotateImageCropRight = (rotation: ImageCropRotation): ImageCropRotation =>
  normalizeImageCropRotation(rotation + 90);

export const getInitialImageCropRect = (
  imageSize: ImageCropSize,
  aspect: ImageCropAspect = "free",
): ImageCropRect => {
  if (aspect === "free") return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const target = aspectRatio(aspect);
  const source = imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  let width = 0.86;
  let height = (width * source) / target;
  if (height > 0.86) {
    height = 0.86;
    width = (height * target) / source;
  }
  width = clamp(width, MIN_CROP_SIZE, 1);
  height = clamp(height, MIN_CROP_SIZE, 1);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
};

export const clampImageCropRect = (
  rect: ImageCropRect,
  imageSize: ImageCropSize,
  aspect: ImageCropAspect = "free",
): ImageCropRect => {
  if (aspect === "free") {
    const width = clamp(rect.width, MIN_CROP_SIZE, 1);
    const height = clamp(rect.height, MIN_CROP_SIZE, 1);
    return { x: clamp(rect.x, 0, 1 - width), y: clamp(rect.y, 0, 1 - height), width, height };
  }
  const target = aspectRatio(aspect);
  const source = imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  let width = clamp(rect.width, MIN_CROP_SIZE, 1);
  let height = (width * source) / target;
  if (height > 1) {
    height = 1;
    width = (height * target) / source;
  }
  return { x: clamp(rect.x, 0, 1 - width), y: clamp(rect.y, 0, 1 - height), width, height };
};

export const resizeImageCropAroundCenter = (
  rect: ImageCropRect,
  imageSize: ImageCropSize,
  aspect: ImageCropAspect,
  scale: number,
): ImageCropRect => {
  const safeScale = clamp(scale, 0.2, 5);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const width = clamp(rect.width / safeScale, MIN_CROP_SIZE, 1);
  const height =
    aspect === "free"
      ? clamp(rect.height / safeScale, MIN_CROP_SIZE, 1)
      : (width * (imageSize.width / Math.max(1, imageSize.height))) / aspectRatio(aspect);
  return clampImageCropRect({ x: centerX - width / 2, y: centerY - height / 2, width, height }, imageSize, aspect);
};

export const imageCropRectToPixels = (rect: ImageCropRect, imageSize: ImageCropSize) => {
  const x = clamp(rect.x, 0, 1 - MIN_CROP_SIZE);
  const y = clamp(rect.y, 0, 1 - MIN_CROP_SIZE);
  return {
    x: Math.round(x * imageSize.width),
    y: Math.round(y * imageSize.height),
    width: Math.max(1, Math.round(clamp(rect.width, MIN_CROP_SIZE, 1 - x) * imageSize.width)),
    height: Math.max(1, Math.round(clamp(rect.height, MIN_CROP_SIZE, 1 - y) * imageSize.height)),
  };
};

const cropped = async (source: ImageCropSource, state: ImageCropState, output: ImageCropOutput) => {
  const { img } = await import("@k2b/stdlib/browser");
  let data = await img.create(source);
  if (state.rotation) data = await img.rotate(state.rotation)(data);
  const crop = imageCropRectToPixels(state.crop, { width: data.width, height: data.height });
  data = await img.crop(crop.x, crop.y, crop.width, crop.height)(data);
  if (output.width || output.height) {
    data = await img.resize(output.width, output.height, "fill")(data);
  } else if (output.maxWidth || output.maxHeight) {
    const ratio = Math.min(1, (output.maxWidth ?? data.width) / data.width, (output.maxHeight ?? data.height) / data.height);
    if (ratio < 1) data = await img.resize(Math.round(data.width * ratio), Math.round(data.height * ratio), "fill")(data);
  }
  return { img, data };
};

export const createCroppedImageCanvas = async (
  source: ImageCropSource,
  state: ImageCropState,
  output: ImageCropOutput = {},
): Promise<HTMLCanvasElement> => {
  const result = await cropped(source, state, output);
  return result.img.toCanvas(result.data);
};

export const createCroppedImageDataUrl = async (
  source: ImageCropSource,
  state: ImageCropState,
  output: ImageCropOutput = {},
): Promise<string> => {
  const result = await cropped(source, state, output);
  return result.img.toBase64(output.format ?? "webp", output.quality ?? 0.86)(result.data);
};
