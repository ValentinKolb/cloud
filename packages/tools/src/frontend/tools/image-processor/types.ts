import type { ImgData } from "@valentinkolb/stdlib/browser";

export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  hueRotate: number;
  blur: number;
  sepia: number;
  vignette: number;
  grain: number;
  freeRotation: number;
  flipH: boolean;
  flipV: boolean;
};

export type ImageEntry = {
  id: string;
  file: File;
  source: ImgData;
  previewSource: ImgData;
  originalSource: ImgData;
  originalPreviewSource: ImgData;
  thumbUrl: string;
  name: string;
  adj: Adjustments;
  cropped: boolean;
};

export type CropAspect = "free" | "1:1" | "4:3" | "16:9" | "3:2";
export type CropRect = { x: number; y: number; w: number; h: number };
export type ExportFormat = "webp" | "jpeg" | "png";
export type Preset = { label: string } & Omit<Adjustments, "freeRotation" | "flipH" | "flipV">;
