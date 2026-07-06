export type ImageCropAspect = "free" | { width: number; height: number };
export type ImageCropRotation = 0 | 90 | 180 | 270;

export type ImageCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageCropState = {
  crop: ImageCropRect;
  rotation: ImageCropRotation;
};

export type ImageCropSource = File | Blob | HTMLImageElement | HTMLCanvasElement | string;

export type ImageCropOutput = {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: "webp" | "jpeg" | "png";
  quality?: number;
};

export type ImageCropSize = {
  width: number;
  height: number;
};

const MIN_CROP_SIZE = 0.08;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const aspectRatio = (aspect: Exclude<ImageCropAspect, "free">): number =>
  aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : 1;

export const normalizeImageCropRotation = (rotation: number): ImageCropRotation => {
  const normalized = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  return normalized as ImageCropRotation;
};

export const rotateImageCropRight = (rotation: ImageCropRotation): ImageCropRotation => normalizeImageCropRotation(rotation + 90);

export const getInitialImageCropRect = (imageSize: ImageCropSize, aspect: ImageCropAspect = "free"): ImageCropRect => {
  if (aspect === "free") {
    return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  }

  const targetRatio = aspectRatio(aspect);
  const imageRatio = imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  let width = 0.86;
  let height = (width * imageRatio) / targetRatio;

  if (height > 0.86) {
    height = 0.86;
    width = (height * targetRatio) / imageRatio;
  }

  width = clamp(width, MIN_CROP_SIZE, 1);
  height = clamp(height, MIN_CROP_SIZE, 1);
  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
};

export const clampImageCropRect = (rect: ImageCropRect, imageSize: ImageCropSize, aspect: ImageCropAspect = "free"): ImageCropRect => {
  if (aspect === "free") {
    const width = clamp(rect.width, MIN_CROP_SIZE, 1);
    const height = clamp(rect.height, MIN_CROP_SIZE, 1);
    return {
      x: clamp(rect.x, 0, 1 - width),
      y: clamp(rect.y, 0, 1 - height),
      width,
      height,
    };
  }

  const targetRatio = aspectRatio(aspect);
  const imageRatio = imageSize.width > 0 && imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  let width = clamp(rect.width, MIN_CROP_SIZE, 1);
  let height = (width * imageRatio) / targetRatio;

  if (height > 1) {
    height = 1;
    width = (height * targetRatio) / imageRatio;
  }

  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
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
  const nextWidth = clamp(rect.width / safeScale, MIN_CROP_SIZE, 1);
  const nextHeight =
    aspect === "free"
      ? clamp(rect.height / safeScale, MIN_CROP_SIZE, 1)
      : (nextWidth * (imageSize.width / Math.max(1, imageSize.height))) / aspectRatio(aspect);

  return clampImageCropRect(
    {
      x: centerX - nextWidth / 2,
      y: centerY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    },
    imageSize,
    aspect,
  );
};

export const imageCropRectToPixels = (rect: ImageCropRect, imageSize: ImageCropSize) => {
  const safeX = clamp(rect.x, 0, 1 - MIN_CROP_SIZE);
  const safeY = clamp(rect.y, 0, 1 - MIN_CROP_SIZE);
  const x = Math.round(safeX * imageSize.width);
  const y = Math.round(safeY * imageSize.height);
  const width = Math.max(1, Math.round(clamp(rect.width, MIN_CROP_SIZE, 1 - safeX) * imageSize.width));
  const height = Math.max(1, Math.round(clamp(rect.height, MIN_CROP_SIZE, 1 - safeY) * imageSize.height));
  return { x, y, width, height };
};

const createCroppedImageData = async (source: ImageCropSource, state: ImageCropState, output: ImageCropOutput = {}) => {
  const { img } = await import("@valentinkolb/stdlib/browser");
  let data = await img.create(source);
  if (state.rotation !== 0) {
    data = await img.rotate(state.rotation)(data);
  }

  const crop = imageCropRectToPixels(state.crop, { width: data.width, height: data.height });
  data = await img.crop(crop.x, crop.y, crop.width, crop.height)(data);

  if (output.width || output.height) {
    data = await img.resize(output.width, output.height, "fill")(data);
  } else if (output.maxWidth || output.maxHeight) {
    const maxWidth = output.maxWidth ?? data.width;
    const maxHeight = output.maxHeight ?? data.height;
    const ratio = Math.min(1, maxWidth / data.width, maxHeight / data.height);
    if (ratio < 1) {
      data = await img.resize(Math.round(data.width * ratio), Math.round(data.height * ratio), "fill")(data);
    }
  }

  return { img, data };
};

export const createCroppedImageCanvas = async (
  source: ImageCropSource,
  state: ImageCropState,
  output: ImageCropOutput = {},
): Promise<HTMLCanvasElement> => {
  const { img, data } = await createCroppedImageData(source, state, output);
  return img.toCanvas(data);
};

export const createCroppedImageDataUrl = async (
  source: ImageCropSource,
  state: ImageCropState,
  output: ImageCropOutput = {},
): Promise<string> => {
  const { img, data } = await createCroppedImageData(source, state, output);
  return img.toBase64(output.format ?? "webp", output.quality ?? 0.86)(data);
};
