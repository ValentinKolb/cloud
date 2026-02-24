/**
 * Functional image processing API for browser with chainable transforms
 *
 * @example
 * // Single image processing
 * const blob = await img
 *   .create(file)
 *   .then(img.resize(800, 600, "cover"))
 *   .then(img.filter(img.filters.vintage))
 *   .then(img.toBlob("webp"));
 *
 * @example
 * // Batch processing with progress
 * const blobs = await img.batch(
 *   files,
 *   (data) => data
 *     .then(img.resize(800, 600, "cover"))
 *     .then(img.filter(img.filters.vintage))
 *     .then(img.toBlob("webp")),
 *   ({ percent }) => console.log(`${Math.round(percent * 100)}%`)
 * );
 */

// ==========================
// Types
// ==========================

export type ImgData = Readonly<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}>;

type Fit = "cover" | "contain" | "fill";
type Format = "jpeg" | "webp" | "png";
type Source = File | Blob | HTMLImageElement | HTMLCanvasElement | string;
type Transform<T = ImgData> = (data: ImgData | Promise<ImgData>) => Promise<T>;
type Progress = { current: number; total: number; percent: number };

// ==========================
// Internal Helpers
// ==========================

/** Create canvas with specified dimensions */
const mkCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = Object.assign(document.createElement("canvas"), {
    width: w,
    height: h,
  });
  return [c, c.getContext("2d")!];
};

/** Create ImgData by drawing on a new canvas with given dimensions */
const draw = (w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void): ImgData => {
  const [canvas, ctx] = mkCanvas(w, h);
  fn(ctx);
  return { canvas, ctx, width: w, height: h };
};

/** Resolve image data from either direct value or promise */
const resolve = async (data: ImgData | Promise<ImgData>): Promise<ImgData> => data;

// ==========================
// Factory
// ==========================

/** Load image from various sources and create ImgData */
const create = async (source: Source): Promise<ImgData> => {
  // Canvas can be directly copied
  if (source instanceof HTMLCanvasElement) return draw(source.width, source.height, (ctx) => ctx.drawImage(source, 0, 0));

  // Load or use existing HTMLImageElement
  const img =
    source instanceof HTMLImageElement
      ? source
      : await (async () => {
          const i = Object.assign(new Image(), { crossOrigin: "anonymous" });
          const url = source instanceof Blob ? URL.createObjectURL(source) : source;
          i.src = url;
          await new Promise<void>((res, rej) => {
            i.onload = () => res();
            i.onerror = () => rej();
          });
          if (source instanceof Blob) URL.revokeObjectURL(url);
          return i;
        })();

  return draw(img.width, img.height, (ctx) => ctx.drawImage(img, 0, 0));
};

// ==========================
// Batch
// ==========================

/** Process multiple images with the same transform pipeline and optional progress callback */
const batch = async <T>(
  sources: Source[],
  transform: (data: Promise<ImgData>) => Promise<T>,
  opts: { onProgress?: (progress: Progress) => void } = {},
): Promise<T[]> => {
  const results: T[] = [];
  const total = sources.length;

  for (let i = 0; i < total; i++) {
    // Report progress before processing (show which image is being processed)
    opts.onProgress?.({ current: i, total, percent: (i + 0.5) / total });
    results.push(await transform(create(sources[i]!)));
    // Report progress after processing
    opts.onProgress?.({ current: i + 1, total, percent: (i + 1) / total });
  }

  return results;
};

// ==========================
// Transforms
// ==========================

/** Resize image to specified dimensions with optional fit mode */
const resize =
  (width?: number, height?: number, fit: Fit = "fill", letterboxColor: string = "#000"): Transform =>
  async (data) => {
    const d = await resolve(data);
    if (!width && !height) return d;

    // Calculate target dimensions maintaining aspect ratio if one dimension missing
    const ar = d.width / d.height;
    const [tw, th] = [width ?? height! * ar, height ?? width! / ar];

    // Fill mode: stretch to exact dimensions
    if (fit === "fill") return draw(tw, th, (ctx) => ctx.drawImage(d.canvas, 0, 0, tw, th));

    // Cover mode: crop to fill entire area
    if (fit === "cover") {
      const scale = Math.max(tw / d.width, th / d.height);
      const [sw, sh] = [tw / scale, th / scale];
      const [sx, sy] = [(d.width - sw) / 2, (d.height - sh) / 2];
      return draw(tw, th, (ctx) => ctx.drawImage(d.canvas, sx, sy, sw, sh, 0, 0, tw, th));
    }

    // Contain mode: fit with letterbox/pillarbox
    const scale = Math.min(tw / d.width, th / d.height);
    const [dw, dh] = [d.width * scale, d.height * scale];
    const [dx, dy] = [(tw - dw) / 2, (th - dh) / 2];
    return draw(tw, th, (ctx) => {
      ctx.fillStyle = letterboxColor;
      ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(d.canvas, dx, dy, dw, dh);
    });
  };

/** Crop image to specified rectangle */
const crop =
  (x: number, y: number, w: number, h: number): Transform =>
  async (data) => {
    const d = await resolve(data);
    return draw(w, h, (ctx) => ctx.drawImage(d.canvas, x, y, w, h, 0, 0, w, h));
  };

/** Apply CSS filter string to image */
const filter =
  (filterStr: string): Transform =>
  async (data) => {
    const d = await resolve(data);
    return draw(d.width, d.height, (ctx) => {
      ctx.filter = filterStr;
      ctx.drawImage(d.canvas, 0, 0);
    });
  };

/** Rotate image by 90, 180, or 270 degrees */
const rotate =
  (deg: 90 | 180 | 270): Transform =>
  async (data) => {
    const d = await resolve(data);
    const swap = deg % 180 !== 0;
    const [w, h] = swap ? [d.height, d.width] : [d.width, d.height];
    return draw(w, h, (ctx) => {
      ctx.translate(w / 2, h / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(d.canvas, -d.width / 2, -d.height / 2);
    });
  };

/** Flip image horizontally and/or vertically */
const flip =
  (horizontal = true, vertical = false): Transform =>
  async (data) => {
    const d = await resolve(data);
    return draw(d.width, d.height, (ctx) => {
      ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
      ctx.drawImage(d.canvas, horizontal ? -d.width : 0, vertical ? -d.height : 0);
    });
  };

/** Apply custom canvas operations to image */
const apply =
  (fn: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void): Transform =>
  async (data) => {
    const d = await resolve(data);
    const out = draw(d.width, d.height, (ctx) => ctx.drawImage(d.canvas, 0, 0));
    fn(out.ctx, out.canvas);
    return { ...out, width: out.canvas.width, height: out.canvas.height };
  };

// ==========================
// Output
// ==========================

/** Convert image to Blob with specified format and quality */
const toBlob =
  (format: Format = "webp", quality = 0.9): Transform<Blob> =>
  async (data) => {
    const d = await resolve(data);
    return new Promise((res, rej) => d.canvas.toBlob((b) => (b ? res(b) : rej(new Error("Blob failed"))), `image/${format}`, quality));
  };

/** Convert image to base64 data URL string */
const toBase64 =
  (format: Format = "webp", quality = 0.9): Transform<string> =>
  async (data) =>
    (await resolve(data)).canvas.toDataURL(`image/${format}`, quality);

/** Convert image to File object with specified name */
const toFile =
  (name: string, format: Format = "webp", quality = 0.9): Transform<File> =>
  async (data) =>
    new File([await toBlob(format, quality)(data)], name, {
      type: `image/${format}`,
    });

/** Get raw canvas element from image data */
const toCanvas = async (data: ImgData | Promise<ImgData>): Promise<HTMLCanvasElement> => (await resolve(data)).canvas;

// ==========================
// Filters & Presets
// ==========================

/** Predefined CSS filter strings and generators */
const filters = {
  vintage: "sepia(0.3) contrast(1.1) brightness(1.1) saturate(1.3)",
  grayscale: "grayscale(1) contrast(1.1)",
  dramatic: "contrast(1.4) brightness(0.9) saturate(1.2)",
  soft: "brightness(1.05) saturate(0.9) blur(0.5px)",
  blur: (px: number) => `blur(${px}px)`,
  brightness: (v: number) => `brightness(${v})`,
  contrast: (v: number) => `contrast(${v})`,
  saturate: (v: number) => `saturate(${v})`,
  hue: (deg: number) => `hue-rotate(${deg}deg)`,
} as const;

/** Ready-to-use image processing presets */
const presets = {
  /** Create square avatar with center crop and slight enhancement */
  avatar: (src: Source, size = 512, quality = 0.8, fmt: Format = "webp"): Promise<string> =>
    create(src)
      .then(resize(size, size, "cover"))
      .then(filter("contrast(1.05) saturate(1.1)"))
      .then(toBase64(fmt, quality)),

  /** Create optimized thumbnail with letterboxing */
  thumbnail: (src: Source, maxSize = 300, letterboxColor = "#000", fmt: Format = "webp"): Promise<string> =>
    create(src)
      .then(resize(maxSize, maxSize, "contain", letterboxColor))
      .then(toBase64(fmt, 0.8)),
} as const;

// ==========================
// Export
// ==========================

/** Image processing API with chainable transforms */
export const images = {
  create,
  batch,
  resize,
  crop,
  filter,
  rotate,
  flip,
  apply,
  toBlob,
  toBase64,
  toFile,
  toCanvas,
  filters,
  presets,
} as const;

export const img = images;
