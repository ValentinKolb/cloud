import type { ImgData } from "@valentinkolb/stdlib/browser";
import type { CropRect, MarkupElement, MarkupPoint } from "./types";

export const FULL_CROP_BOUNDS: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const mapElement = (element: MarkupElement, mapPoint: (point: MarkupPoint) => MarkupPoint, sizeScale: number): MarkupElement => {
  if (element.kind === "stroke") {
    return { ...element, points: element.points.map(mapPoint), size: element.size * sizeScale };
  }
  if (element.kind === "text") {
    return { ...element, position: mapPoint(element.position), size: element.size * sizeScale };
  }
  if (element.kind === "shape") {
    return { ...element, start: mapPoint(element.start), end: mapPoint(element.end), size: element.size * sizeScale };
  }
  return { ...element, start: mapPoint(element.start), end: mapPoint(element.end) };
};

export const transformMarkupForCrop = (elements: MarkupElement[], crop: CropRect, sizeScale: number): MarkupElement[] => {
  const mapPoint = (point: MarkupPoint): MarkupPoint => ({
    x: (point.x - crop.x) / crop.w,
    y: (point.y - crop.y) / crop.h,
  });
  // Keep off-canvas elements so resetting the crop restores every annotation.
  return elements.map((element) => mapElement(element, mapPoint, sizeScale));
};

export const restoreMarkupFromCrop = (elements: MarkupElement[], cropBounds: CropRect, sizeScale: number): MarkupElement[] => {
  const mapPoint = (point: MarkupPoint): MarkupPoint => ({
    x: cropBounds.x + point.x * cropBounds.w,
    y: cropBounds.y + point.y * cropBounds.h,
  });
  return elements.map((element) => mapElement(element, mapPoint, sizeScale));
};

export const composeCropBounds = (current: CropRect, next: CropRect): CropRect => ({
  x: current.x + next.x * current.w,
  y: current.y + next.y * current.h,
  w: current.w * next.w,
  h: current.h * next.h,
});

const normalizedRect = (start: MarkupPoint, end: MarkupPoint, width: number, height: number) => ({
  x: Math.min(start.x, end.x) * width,
  y: Math.min(start.y, end.y) * height,
  w: Math.abs(end.x - start.x) * width,
  h: Math.abs(end.y - start.y) * height,
});

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  start: MarkupPoint,
  end: MarkupPoint,
  width: number,
  height: number,
  lineWidth: number,
) => {
  const startX = start.x * width;
  const startY = start.y * height;
  const endX = end.x * width;
  const endY = end.y * height;
  const angle = Math.atan2(endY - startY, endX - startX);
  const head = Math.max(lineWidth * 4, Math.min(width, height) * 0.018);

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
};

export const renderMarkupCanvas = (ctx: CanvasRenderingContext2D, elements: MarkupElement[], width: number, height: number) => {
  const minDimension = Math.min(width, height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const element of elements) {
    ctx.save();
    ctx.globalAlpha = element.kind === "stroke" ? element.opacity : 1;
    ctx.fillStyle = element.color;
    ctx.strokeStyle = element.color;

    if (element.kind === "stroke") {
      const lineWidth = Math.max(1, element.size * minDimension);
      ctx.lineWidth = lineWidth;
      const first = element.points[0];
      if (first) {
        if (element.points.length === 1) {
          ctx.beginPath();
          ctx.arc(first.x * width, first.y * height, lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(first.x * width, first.y * height);
          for (let index = 1; index < element.points.length; index++) {
            const point = element.points[index]!;
            ctx.lineTo(point.x * width, point.y * height);
          }
          ctx.stroke();
        }
      }
    } else if (element.kind === "redaction") {
      const rect = normalizedRect(element.start, element.end, width, height);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    } else if (element.kind === "shape") {
      const lineWidth = Math.max(1, element.size * minDimension);
      const rect = normalizedRect(element.start, element.end, width, height);
      ctx.lineWidth = lineWidth;
      if (element.shape === "rectangle") ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      else if (element.shape === "circle") {
        const startX = element.start.x * width;
        const startY = element.start.y * height;
        const radius = Math.hypot((element.end.x - element.start.x) * width, (element.end.y - element.start.y) * height);
        ctx.beginPath();
        ctx.arc(startX, startY, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else drawArrow(ctx, element.start, element.end, width, height, lineWidth);
    } else {
      ctx.font = `600 ${Math.max(1, element.size * minDimension)}px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(element.text, element.position.x * width, element.position.y * height);
    }
    ctx.restore();
  }
  ctx.restore();
};

export const applyMarkupToImage = async (data: ImgData, elements: MarkupElement[]): Promise<ImgData> => {
  if (elements.length === 0) return data;
  const canvas = Object.assign(document.createElement("canvas"), { width: data.width, height: data.height });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a canvas for image markup");
  ctx.drawImage(data.canvas, 0, 0);
  renderMarkupCanvas(ctx, elements, data.width, data.height);
  return { canvas, ctx, width: data.width, height: data.height };
};
