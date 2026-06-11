import { type ImgData, images as imageTools } from "@valentinkolb/stdlib/browser";
import { PREVIEW_MAX } from "./constants";
import type { ImageEntry } from "./types";

export const makePreviewSource = async (source: ImgData): Promise<ImgData> => {
  const maxDim = Math.max(source.width, source.height);
  if (maxDim <= PREVIEW_MAX) return source;

  const scale = PREVIEW_MAX / maxDim;
  return imageTools.resize(Math.round(source.width * scale), Math.round(source.height * scale), "fill")(source);
};

export const buildImagePipeline = (entry: ImageEntry, maxW?: number, maxH?: number) => {
  const a = entry.adj;
  let pipeline: Promise<ImgData> = Promise.resolve(entry.source);

  if (maxW || maxH) {
    pipeline = pipeline.then(async (data) => {
      const mw = maxW ?? Infinity;
      const mh = maxH ?? Infinity;
      if (data.width <= mw && data.height <= mh) return data;

      const scale = Math.min(mw / data.width, mh / data.height);
      return imageTools.resize(Math.round(data.width * scale), Math.round(data.height * scale), "fill")(data);
    });
  }

  if (a.freeRotation !== 0) {
    pipeline = pipeline.then(
      imageTools.apply((ctx, canvas) => {
        const rad = (a.freeRotation * Math.PI) / 180;
        const tmp = document.createElement("canvas");
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const tmpCtx = tmp.getContext("2d");
        if (!tmpCtx) return;

        tmpCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rad);
        ctx.drawImage(tmp, -canvas.width / 2, -canvas.height / 2);
      }),
    );
  }

  if (a.flipH || a.flipV) {
    pipeline = pipeline.then(imageTools.flip(a.flipH, a.flipV));
  }

  const filterParts: string[] = [];
  if (a.brightness !== 1) filterParts.push(`brightness(${a.brightness})`);
  if (a.contrast !== 1) filterParts.push(`contrast(${a.contrast})`);
  if (a.saturation !== 1) filterParts.push(`saturate(${a.saturation})`);
  if (a.hueRotate !== 0) filterParts.push(`hue-rotate(${a.hueRotate}deg)`);
  if (a.blur > 0) filterParts.push(`blur(${a.blur}px)`);
  if (a.sepia > 0) filterParts.push(`sepia(${a.sepia})`);
  const filterStr = filterParts.join(" ");
  if (filterStr) {
    pipeline = pipeline.then(imageTools.filter(filterStr));
  }

  if (a.vignette > 0) {
    pipeline = pipeline.then(
      imageTools.apply((ctx, canvas) => {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const r = Math.max(cx, cy);
        const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, `rgba(0,0,0,${a.vignette})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }),
    );
  }

  if (a.grain > 0) {
    pipeline = pipeline.then(
      imageTools.apply((ctx, canvas) => {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const intensity = a.grain * 255;
        for (let i = 0; i < data.length; i += 4) {
          const noise = (Math.random() - 0.5) * intensity;
          data[i] = Math.min(255, Math.max(0, data[i]! + noise));
          data[i + 1] = Math.min(255, Math.max(0, data[i + 1]! + noise));
          data[i + 2] = Math.min(255, Math.max(0, data[i + 2]! + noise));
        }
        ctx.putImageData(imageData, 0, 0);
      }),
    );
  }

  return pipeline;
};
