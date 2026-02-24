import { createSignal, createMemo, createEffect, Show, For, on, onMount, onCleanup, batch } from "solid-js";
import { images as imageTools, files as fileTools, mutation as mutations, type ImgData } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { Dropdown, Select, Slider, Switch } from "@valentinkolb/cloud/lib/ui";

// ====================================
// Types & Constants
// ====================================

const PREVIEW_MAX = 800;

type Adjustments = {
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

const DEFAULT_ADJ: Adjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hueRotate: 0,
  blur: 0,
  sepia: 0,
  vignette: 0,
  grain: 0,
  freeRotation: 0,
  flipH: false,
  flipV: false,
};

type ImageEntry = {
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

type CropAspect = "free" | "1:1" | "4:3" | "16:9" | "3:2";
type CropRect = { x: number; y: number; w: number; h: number };
type ExportFormat = "webp" | "jpeg" | "png";

type Preset = { label: string } & Omit<Adjustments, "freeRotation" | "flipH" | "flipV">;

const PRESETS: Record<string, Preset> = {
  none: {
    label: "None",
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hueRotate: 0,
    blur: 0,
    sepia: 0,
    vignette: 0,
    grain: 0,
  },
  vintage: {
    label: "Vintage",
    brightness: 1.1,
    contrast: 1.1,
    saturation: 1.3,
    hueRotate: 0,
    blur: 0,
    sepia: 0.3,
    vignette: 0.3,
    grain: 0.1,
  },
  grayscale: {
    label: "B&W",
    brightness: 1,
    contrast: 1.1,
    saturation: 0,
    hueRotate: 0,
    blur: 0,
    sepia: 0,
    vignette: 0,
    grain: 0,
  },
  dramatic: {
    label: "Dramatic",
    brightness: 0.9,
    contrast: 1.4,
    saturation: 1.2,
    hueRotate: 0,
    blur: 0,
    sepia: 0,
    vignette: 0.2,
    grain: 0,
  },
  soft: {
    label: "Soft",
    brightness: 1.05,
    contrast: 0.95,
    saturation: 0.9,
    hueRotate: 0,
    blur: 0.5,
    sepia: 0,
    vignette: 0,
    grain: 0,
  },
  warm: {
    label: "Warm",
    brightness: 1.05,
    contrast: 1.05,
    saturation: 1.1,
    hueRotate: 15,
    blur: 0,
    sepia: 0.15,
    vignette: 0,
    grain: 0,
  },
  cool: {
    label: "Cool",
    brightness: 1,
    contrast: 1.05,
    saturation: 0.9,
    hueRotate: 200,
    blur: 0,
    sepia: 0,
    vignette: 0,
    grain: 0,
  },
  faded: {
    label: "Faded",
    brightness: 1.1,
    contrast: 0.85,
    saturation: 0.7,
    hueRotate: 0,
    blur: 0,
    sepia: 0.1,
    vignette: 0.15,
    grain: 0.05,
  },
};

let nextId = 0;
const uid = () => `images-${++nextId}`;

// ====================================
// Component
// ====================================

export default function ImageProcessor() {
  // --- Image list ---
  const [images, setImages] = createSignal<ImageEntry[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [basePreview, setBasePreview] = createSignal("");

  // --- Clipboard for copy/paste edits ---
  const [clipboard, setClipboard] = createSignal<Adjustments | null>(null);

  // --- Crop ---
  const [cropActive, setCropActive] = createSignal(false);
  const [cropAspect, setCropAspect] = createSignal<CropAspect>("free");
  const [cropRect, setCropRect] = createSignal<CropRect>({
    x: 0.1,
    y: 0.1,
    w: 0.8,
    h: 0.8,
  });
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [dragStart, setDragStart] = createSignal<{
    mx: number;
    my: number;
    rect: CropRect;
  } | null>(null);

  // --- Derived ---
  const activeImage = createMemo(() => images()[activeIndex()] ?? null);
  const hasImages = createMemo(() => images().length > 0);
  const adj = createMemo(() => activeImage()?.adj ?? DEFAULT_ADJ);

  // Helper to update adj for the active image
  const setAdj = (key: keyof Adjustments, value: number | boolean) => {
    setImages((prev) => prev.map((e, i) => (i === activeIndex() ? { ...e, adj: { ...e.adj, [key]: value } } : e)));
  };

  // CSS filter — reactive, instant preview
  const cssFilter = createMemo(() => {
    const a = adj();
    const parts: string[] = [];
    if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
    if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
    if (a.saturation !== 1) parts.push(`saturate(${a.saturation})`);
    if (a.hueRotate !== 0) parts.push(`hue-rotate(${a.hueRotate}deg)`);
    if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
    if (a.sepia > 0) parts.push(`sepia(${a.sepia})`);
    return parts.join(" ") || "none";
  });

  const cssTransform = createMemo(() => {
    const a = adj();
    const parts: string[] = [];
    if (a.flipH) parts.push("scaleX(-1)");
    if (a.flipV) parts.push("scaleY(-1)");
    if (a.freeRotation !== 0) parts.push(`rotate(${a.freeRotation}deg)`);
    return parts.join(" ") || "none";
  });

  // ====================================
  // File Loading
  // ====================================

  const makePreviewSource = async (source: ImgData): Promise<ImgData> => {
    const maxDim = Math.max(source.width, source.height);
    if (maxDim <= PREVIEW_MAX) return source;
    const scale = PREVIEW_MAX / maxDim;
    return imageTools.resize(Math.round(source.width * scale), Math.round(source.height * scale), "fill")(source);
  };

  const loadMutation = mutations.create<void, File[]>({
    mutation: async (files) => {
      const entries: ImageEntry[] = [];
      for (const file of files) {
        const source = await imageTools.create(file);
        const previewSource = await makePreviewSource(source);
        const thumbUrl = await imageTools.presets.thumbnail(file, 64, "#000", "jpeg");
        entries.push({
          id: uid(),
          file,
          source,
          previewSource,
          originalSource: source,
          originalPreviewSource: previewSource,
          thumbUrl,
          name: file.name,
          adj: { ...DEFAULT_ADJ },
          cropped: false,
        });
      }
      const wasEmpty = images().length === 0;
      setImages((prev) => [...prev, ...entries]);
      if (wasEmpty && entries.length > 0) setActiveIndex(0);
      await rebuildBasePreview();
    },
    onError: (err) => {
      if (err.message !== "File dialog cancelled") setError(err.message);
    },
  });

  const selectFiles = async () => {
    try {
      const files = await fileTools.showFileDialog({ accept: "image/*", multiple: true });
      loadMutation.mutate(files);
    } catch (_) {
      // file dialog cancelled
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (activeIndex() >= images().length) setActiveIndex(Math.max(0, images().length - 1));
    if (images().length === 0) setBasePreview("");
    else rebuildBasePreview();
  };

  const switchImage = (index: number) => {
    setActiveIndex(index);
    setCropActive(false);
    rebuildBasePreview();
  };

  // ====================================
  // Base Preview (just the raw image — no transforms)
  // ====================================

  const rebuildBasePreview = async () => {
    const entry = activeImage();
    if (!entry) return;
    setLoading(true);
    try {
      const result = await imageTools.toBase64("jpeg", 0.85)(entry.previewSource);
      setBasePreview(result);
      setError("");
    } catch (e: any) {
      setError(e?.message || "Processing failed");
    } finally {
      setLoading(false);
    }
  };

  // ====================================
  // Full Pipeline (for export only)
  // ====================================

  const buildPipeline = (entry: ImageEntry, maxW?: number, maxH?: number) => {
    const a = entry.adj;
    let p: Promise<ImgData> = Promise.resolve(entry.source);

    // Resize
    if (maxW || maxH) {
      p = p.then(async (d) => {
        const mw = maxW ?? Infinity;
        const mh = maxH ?? Infinity;
        if (d.width <= mw && d.height <= mh) return d;
        const scale = Math.min(mw / d.width, mh / d.height);
        return imageTools.resize(Math.round(d.width * scale), Math.round(d.height * scale), "fill")(d);
      });
    }

    // Free rotation
    if (a.freeRotation !== 0) {
      p = p.then(
        imageTools.apply((ctx, canvas) => {
          const rad = (a.freeRotation * Math.PI) / 180;
          const tmp = document.createElement("canvas");
          tmp.width = canvas.width;
          tmp.height = canvas.height;
          const tCtx = tmp.getContext("2d")!;
          tCtx.drawImage(canvas, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(rad);
          ctx.drawImage(tmp, -canvas.width / 2, -canvas.height / 2);
        }),
      );
    }

    // Flip
    if (a.flipH || a.flipV) p = p.then(imageTools.flip(a.flipH, a.flipV));

    // CSS Filters
    const filterParts: string[] = [];
    if (a.brightness !== 1) filterParts.push(`brightness(${a.brightness})`);
    if (a.contrast !== 1) filterParts.push(`contrast(${a.contrast})`);
    if (a.saturation !== 1) filterParts.push(`saturate(${a.saturation})`);
    if (a.hueRotate !== 0) filterParts.push(`hue-rotate(${a.hueRotate}deg)`);
    if (a.blur > 0) filterParts.push(`blur(${a.blur}px)`);
    if (a.sepia > 0) filterParts.push(`sepia(${a.sepia})`);
    const filterStr = filterParts.join(" ");
    if (filterStr) p = p.then(imageTools.filter(filterStr));

    // Vignette
    if (a.vignette > 0) {
      p = p.then(
        imageTools.apply((ctx, canvas) => {
          const cx = canvas.width / 2,
            cy = canvas.height / 2;
          const r = Math.max(cx, cy);
          const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
          grad.addColorStop(0, "transparent");
          grad.addColorStop(1, `rgba(0,0,0,${a.vignette})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }),
      );
    }

    // Grain
    if (a.grain > 0) {
      p = p.then(
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

    return p;
  };

  // ====================================
  // Crop
  // ====================================

  const initCropRect = (): CropRect => {
    const aspect = cropAspect();
    if (aspect === "free") return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const [aw, ah] = aspect.split(":").map(Number) as [number, number];
    const ratio = aw / ah;
    let w = 0.8,
      h = 0.8;
    if (ratio > 1) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    if (h > 0.8) {
      h = 0.8;
      w = h * ratio;
    }
    if (w > 0.8) {
      w = 0.8;
      h = w / ratio;
    }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };

  const startCrop = () => {
    setCropRect(initCropRect());
    setCropActive(true);
  };

  const applyCrop = async () => {
    const entry = activeImage();
    if (!entry) return;
    const r = cropRect();
    const sx = Math.round(r.x * entry.source.width),
      sy = Math.round(r.y * entry.source.height);
    const sw = Math.round(r.w * entry.source.width),
      sh = Math.round(r.h * entry.source.height);
    const cropped = await imageTools.crop(sx, sy, sw, sh)(entry.source);
    const psx = Math.round(r.x * entry.previewSource.width),
      psy = Math.round(r.y * entry.previewSource.height);
    const psw = Math.round(r.w * entry.previewSource.width),
      psh = Math.round(r.h * entry.previewSource.height);
    const croppedPreview = await imageTools.crop(psx, psy, psw, psh)(entry.previewSource);
    const thumbUrl = await imageTools.presets.thumbnail(croppedPreview.canvas, 64, "#000", "jpeg");
    setImages((prev) =>
      prev.map((e, i) =>
        i === activeIndex()
          ? {
              ...e,
              source: cropped,
              previewSource: croppedPreview,
              thumbUrl,
              cropped: true,
            }
          : e,
      ),
    );
    setCropActive(false);
    setCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    await rebuildBasePreview();
  };

  const resetCrop = async () => {
    const entry = activeImage();
    if (!entry || !entry.cropped) return;
    const thumbUrl = await imageTools.presets.thumbnail(entry.originalPreviewSource.canvas, 64, "#000", "jpeg");
    setImages((prev) =>
      prev.map((e, i) =>
        i === activeIndex()
          ? {
              ...e,
              source: e.originalSource,
              previewSource: e.originalPreviewSource,
              thumbUrl,
              cropped: false,
            }
          : e,
      ),
    );
    await rebuildBasePreview();
  };

  let imgRef: HTMLImageElement | undefined;

  const getCropMousePos = (e: MouseEvent) => {
    if (!imgRef) return { mx: 0, my: 0 };
    const rect = imgRef.getBoundingClientRect();
    return {
      mx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      my: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const startCropDrag = (handle: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    setDragStart({ ...getCropMousePos(e), rect: { ...cropRect() } });
  };

  const onCropMouseMove = (e: MouseEvent) => {
    const handle = dragging(),
      start = dragStart();
    if (!handle || !start) return;
    const pos = getCropMousePos(e);
    const dx = pos.mx - start.mx,
      dy = pos.my - start.my;
    const r = start.rect;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    if (handle === "move") {
      setCropRect({
        x: clamp(r.x + dx, 0, 1 - r.w),
        y: clamp(r.y + dy, 0, 1 - r.h),
        w: r.w,
        h: r.h,
      });
    } else {
      let nx = r.x,
        ny = r.y,
        nw = r.w,
        nh = r.h;
      if (handle.includes("w")) {
        nx = clamp(r.x + dx, 0, r.x + r.w - 0.05);
        nw = r.w - (nx - r.x);
      }
      if (handle.includes("e")) {
        nw = clamp(r.w + dx, 0.05, 1 - r.x);
      }
      if (handle.includes("n")) {
        ny = clamp(r.y + dy, 0, r.y + r.h - 0.05);
        nh = r.h - (ny - r.y);
      }
      if (handle.includes("s")) {
        nh = clamp(r.h + dy, 0.05, 1 - r.y);
      }
      const aspect = cropAspect();
      if (aspect !== "free") {
        const [aw, ah] = aspect.split(":").map(Number) as [number, number];
        const ratio = aw / ah;
        if (handle.includes("e") || handle.includes("w")) {
          nh = nw / ratio;
        } else {
          nw = nh * ratio;
        }
      }
      setCropRect({
        x: nx,
        y: ny,
        w: Math.min(nw, 1 - nx),
        h: Math.min(nh, 1 - ny),
      });
    }
  };

  const onCropMouseUp = () => {
    setDragging(null);
    setDragStart(null);
  };

  // ====================================
  // Copy / Paste Edits
  // ====================================

  const copyEdits = () => setClipboard({ ...adj() });

  const pasteEdits = () => {
    const c = clipboard();
    if (!c) return;
    setImages((prev) => prev.map((e, i) => (i === activeIndex() ? { ...e, adj: { ...c } } : e)));
  };

  const pasteEditsAll = () => {
    const c = clipboard();
    if (!c) return;
    setImages((prev) => prev.map((e) => ({ ...e, adj: { ...c } })));
  };

  // ====================================
  // Export Modal
  // ====================================

  const showExportModal = async (mode: "single" | "all") => {
    const count = mode === "all" ? images().length : 1;

    await prompts.dialog<void>(
      (close) => {
        const [fmt, setFmt] = createSignal<ExportFormat>("webp");
        const [qual, setQual] = createSignal(0.8);
        const [mw, setMw] = createSignal<number | undefined>(undefined);
        const [mh, setMh] = createSignal<number | undefined>(undefined);
        const [progress, setProgress] = createSignal<number | null>(null);
        const [exporting, setExporting] = createSignal(false);

        const doExport = async () => {
          setExporting(true);
          const entries = mode === "all" ? images() : [activeImage()!];
          setProgress(0);
          for (let i = 0; i < entries.length; i++) {
            setProgress((i + 0.5) / entries.length);
            const entry = entries[i]!;
            const blob = await buildPipeline(entry, mw(), mh()).then(imageTools.toBlob(fmt(), qual()));
            const name = entry.name.replace(/\.[^.]+$/, "") + `.${fmt()}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
            setProgress((i + 1) / entries.length);
            if (entries.length > 1) await new Promise((r) => setTimeout(r, 200));
          }
          close();
        };

        return (
          <div class="flex flex-col gap-4 min-w-70">
            <Select
              label="Format"
              icon="ti ti-file-type-jpg"
              value={fmt}
              onChange={(v) => setFmt(v as ExportFormat)}
              options={[
                { id: "webp", label: "WebP" },
                { id: "jpeg", label: "JPEG" },
                { id: "png", label: "PNG" },
              ]}
            />
            <Slider
              label="Quality"
              value={qual}
              onChange={setQual}
              min={0.1}
              max={1}
              step={0.05}
              showValue
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-1">
                <label class="text-xs text-secondary" for="image-export-max-width">
                  Max Width
                </label>
                <input
                  id="image-export-max-width"
                  type="number"
                  class="input-border w-full text-center font-mono text-sm"
                  placeholder="auto"
                  value={mw() ?? ""}
                  min={1}
                  onInput={(e) => {
                    const v = parseInt(e.currentTarget.value);
                    setMw(isNaN(v) || v <= 0 ? undefined : v);
                  }}
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-secondary" for="image-export-max-height">
                  Max Height
                </label>
                <input
                  id="image-export-max-height"
                  type="number"
                  class="input-border w-full text-center font-mono text-sm"
                  placeholder="auto"
                  value={mh() ?? ""}
                  min={1}
                  onInput={(e) => {
                    const v = parseInt(e.currentTarget.value);
                    setMh(isNaN(v) || v <= 0 ? undefined : v);
                  }}
                />
              </div>
            </div>
            <p class="text-xs text-dimmed">Leave empty to keep original size</p>

            <Show when={progress() !== null}>
              <div class="flex flex-col gap-1">
                <div class="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div
                    class="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }}
                  />
                </div>
                <p class="text-xs text-dimmed text-center">{Math.round((progress() ?? 0) * 100)}%</p>
              </div>
            </Show>

            <div class="flex gap-2 justify-end">
              <button class="btn-secondary btn-sm" onClick={() => close()} disabled={exporting()}>
                Cancel
              </button>
              <button class="btn-primary btn-sm" onClick={doExport} disabled={exporting()}>
                <i class={`ti ${exporting() ? "ti-loader-2 animate-spin" : "ti-download"}`} />
                {mode === "all" ? `Export ${count}` : "Export"}
              </button>
            </div>
          </div>
        );
      },
      {
        title: mode === "all" ? `Export ${count} Images` : "Export Image",
        icon: "ti ti-download",
      },
    );
  };

  // ====================================
  // Presets
  // ====================================

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setImages((prev) =>
      prev.map((e, i) =>
        i === activeIndex()
          ? {
              ...e,
              adj: {
                ...e.adj,
                brightness: p.brightness,
                contrast: p.contrast,
                saturation: p.saturation,
                hueRotate: p.hueRotate,
                blur: p.blur,
                sepia: p.sepia,
                vignette: p.vignette,
                grain: p.grain,
              },
            }
          : e,
      ),
    );
  };

  const resetAdjustments = () => {
    setImages((prev) => prev.map((e, i) => (i === activeIndex() ? { ...e, adj: { ...DEFAULT_ADJ } } : e)));
  };

  // ====================================
  // Drag & Drop + Keyboard
  // ====================================

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) loadMutation.mutate(files);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (cropActive()) {
      if (e.key === "Escape") {
        setCropActive(false);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowLeft" && activeIndex() > 0) {
      switchImage(activeIndex() - 1);
      e.preventDefault();
    }
    if (e.key === "ArrowRight" && activeIndex() < images().length - 1) {
      switchImage(activeIndex() + 1);
      e.preventDefault();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && hasImages()) {
      removeImage(activeIndex());
      e.preventDefault();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousemove", onCropMouseMove);
    document.addEventListener("mouseup", onCropMouseUp);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("mousemove", onCropMouseMove);
    document.removeEventListener("mouseup", onCropMouseUp);
  });

  const SectionLabel = (props: { label: string }) => <span class="section-label mb-0">{props.label}</span>;

  // ====================================
  // Render
  // ====================================

  return (
    <div
      class="flex flex-col flex-1 min-h-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      role="region"
      aria-label="Image processor"
    >
      {error() && (
        <div class="info-block-danger flex items-center gap-2 m-2">
          <i class="ti ti-alert-circle" /> {error()}
        </div>
      )}

      <div class="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Left column: preview + filmstrip */}
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Preview */}
          <div class="flex-1 min-w-0 flex flex-col items-center justify-center p-4 relative bg-zinc-50 dark:bg-zinc-900/50 min-h-75">
            {/* Top-left actions */}
            <Show when={hasImages()}>
              <div class="absolute top-2 left-2 z-20 flex items-center gap-1">
                <button class="btn-secondary btn-sm" onClick={() => showExportModal("single")} title="Export current image">
                  <i class="ti ti-download" /> Export
                </button>
                <Show when={images().length > 1}>
                  <button class="btn-secondary btn-sm" onClick={() => showExportModal("all")} title="Export all images">
                    <i class="ti ti-download" /> All ({images().length})
                  </button>
                </Show>
              </div>
            </Show>

            {/* Loading overlay */}
            <Show when={loadMutation.loading()}>
              <div class="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-black/50 z-10">
                <i class="ti ti-loader-2 animate-spin text-2xl text-dimmed" />
              </div>
            </Show>

            {/* Empty state — upload placeholder */}
            <Show when={!hasImages() && !loadMutation.loading()}>
              <button
                type="button"
                class="flex flex-col items-center gap-3 p-8 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors cursor-pointer"
                onClick={selectFiles}
              >
                <i class="ti ti-photo-up text-4xl text-dimmed" />
                <p class="text-sm text-dimmed">Click or drag & drop images</p>
                <p class="text-xs text-dimmed">Supports multiple files</p>
              </button>
            </Show>

            <Show when={basePreview()}>
              <div class="flex flex-col items-center gap-1 max-w-full max-h-full">
                <div class="relative">
                  <img
                    ref={imgRef}
                    src={basePreview()}
                    alt="Preview"
                    class="max-w-full max-h-[calc(100vh-16rem)] object-contain thumbnail block"
                    draggable={false}
                    style={{ filter: cssFilter(), transform: cssTransform() }}
                  />

                  <Show when={adj().vignette > 0}>
                    <div
                      class="absolute inset-0 pointer-events-none rounded"
                      style={{
                        background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${adj().vignette}) 100%)`,
                      }}
                    />
                  </Show>

                  <Show when={adj().grain > 0}>
                    <div
                      class="absolute inset-0 pointer-events-none rounded mix-blend-overlay"
                      style={{
                        opacity: adj().grain * 2,
                        "background-image": `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                        "background-size": "128px 128px",
                      }}
                    />
                  </Show>

                  {/* Crop overlay */}
                  <Show when={cropActive()}>
                    <div class="absolute inset-0">
                      {/* Dark mask with hole via clip-path */}
                      <div
                        class="absolute inset-0 bg-black/50"
                        style={{
                          "clip-path": `polygon(
                          0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                          ${cropRect().x * 100}% ${cropRect().y * 100}%,
                          ${cropRect().x * 100}% ${(cropRect().y + cropRect().h) * 100}%,
                          ${(cropRect().x + cropRect().w) * 100}% ${(cropRect().y + cropRect().h) * 100}%,
                          ${(cropRect().x + cropRect().w) * 100}% ${cropRect().y * 100}%,
                          ${cropRect().x * 100}% ${cropRect().y * 100}%
                        )`,
                        }}
                      />
                      {/* Crop border + handles */}
                      <div
                        class="absolute border-2 border-white cursor-move"
                        style={{
                          left: `${cropRect().x * 100}%`,
                          top: `${cropRect().y * 100}%`,
                          width: `${cropRect().w * 100}%`,
                          height: `${cropRect().h * 100}%`,
                        }}
                        onMouseDown={(e) => startCropDrag("move", e)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                          }
                        }}
                      >
                        <div class="absolute inset-0 pointer-events-none">
                          <div class="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                          <div class="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                          <div class="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                          <div class="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                        </div>
                        {(["nw", "ne", "sw", "se"] as const).map((h) => (
                          <div
                            class={`absolute w-3 h-3 bg-white border border-zinc-400 rounded-sm ${
                              h.includes("n") ? "-top-1.5" : "-bottom-1.5"
                            } ${h.includes("w") ? "-left-1.5" : "-right-1.5"} cursor-${
                              h === "nw" || h === "se" ? "nwse" : "nesw"
                            }-resize z-10`}
                            onMouseDown={(e) => startCropDrag(h, e)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                              }
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </Show>
                </div>
                <p class="text-[10px] text-dimmed">Low-res preview — full resolution on export</p>
              </div>
            </Show>

            <Show when={images().length > 1}>
              <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 rounded-full px-4 py-1.5 text-white text-xs">
                <button
                  class="hover:text-blue-300 disabled:opacity-30 disabled:cursor-default"
                  onClick={() => switchImage(activeIndex() - 1)}
                  disabled={activeIndex() === 0}
                >
                  <i class="ti ti-chevron-left" />
                </button>
                <span class="tabular-nums">
                  {activeIndex() + 1} / {images().length}
                </span>
                <button
                  class="hover:text-blue-300 disabled:opacity-30 disabled:cursor-default"
                  onClick={() => switchImage(activeIndex() + 1)}
                  disabled={activeIndex() === images().length - 1}
                >
                  <i class="ti ti-chevron-right" />
                </button>
              </div>
            </Show>
          </div>

          {/* Filmstrip */}
          <Show when={hasImages()}>
            <div class="shrink-0">
              <div class="flex items-center gap-1 p-2 overflow-x-auto scrollbar">
                <For each={images()}>
                  {(entry, index) => (
                    <div
                      role="button"
                      tabIndex={0}
                      class={`relative shrink-0 w-14 h-14 thumbnail border-2 transition-colors ${
                        index() === activeIndex()
                          ? "border-blue-500"
                          : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
                      }`}
                      onClick={() => switchImage(index())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          switchImage(index());
                        }
                      }}
                      title={entry.name}
                    >
                      <img src={entry.thumbUrl} alt={entry.name} class="w-full h-full object-cover" draggable={false} />
                      <button
                        type="button"
                        class="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white flex items-center justify-center rounded-bl opacity-0 hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(index());
                        }}
                        aria-label={`Remove ${entry.name}`}
                      >
                        <i class="ti ti-x text-[10px]" />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  class="shrink-0 w-14 h-14 thumbnail border-2 border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500 flex items-center justify-center text-dimmed transition-colors"
                  onClick={selectFiles}
                  title="Add images"
                >
                  <i class="ti ti-plus" />
                </button>
              </div>
            </div>
          </Show>
        </div>
        {/* end left column */}

        {/* Settings panel */}
        <div
          class="w-full md:w-72 lg:w-80 shrink-0 overflow-y-auto scrollbar flex flex-col"
          classList={{ "opacity-50 pointer-events-none": !hasImages() }}
        >
          <div class="p-3 flex flex-col gap-4 flex-1">
            {/* Image Info */}
            <div class="flex flex-col gap-1">
              <SectionLabel label="Image" />
              <div class="text-xs text-dimmed truncate">{activeImage()?.name}</div>
              <div class="text-xs text-dimmed">
                {activeImage()?.source.width} &times; {activeImage()?.source.height} px
                {activeImage()?.file && ` · ${(activeImage()!.file.size / 1024).toFixed(0)} KB`}
              </div>
              <button class="btn-secondary btn-sm mt-1" onClick={() => removeImage(activeIndex())}>
                <i class="ti ti-trash" /> Remove
              </button>
            </div>

            {/* Crop */}
            <div class="flex flex-col gap-2">
              <SectionLabel label="Crop" />
              <Show
                when={cropActive()}
                fallback={
                  <div class="flex gap-2">
                    <button class="btn-secondary btn-sm flex-1" onClick={startCrop}>
                      <i class="ti ti-crop" /> Crop
                    </button>
                    <Dropdown
                      trigger={
                        <span class="btn-secondary btn-sm">
                          {cropAspect() === "free" ? "Free" : cropAspect()} <i class="ti ti-chevron-down text-[10px]" />
                        </span>
                      }
                      position="bottom-left"
                      elements={(
                        [
                          ["free", "Free"],
                          ["1:1", "1:1"],
                          ["4:3", "4:3"],
                          ["16:9", "16:9"],
                          ["3:2", "3:2"],
                        ] as const
                      ).map(([id, label]) => ({
                        label,
                        icon: cropAspect() === id ? "ti ti-check" : undefined,
                        action: () => setCropAspect(id as CropAspect),
                      }))}
                    />
                    <Show when={activeImage()?.cropped}>
                      <button class="btn-secondary btn-sm" onClick={resetCrop} title="Reset crop">
                        <i class="ti ti-arrow-back-up" />
                      </button>
                    </Show>
                  </div>
                }
              >
                <div class="flex gap-2">
                  <button class="btn-primary btn-sm flex-1" onClick={applyCrop}>
                    <i class="ti ti-check" /> Apply
                  </button>
                  <button class="btn-secondary btn-sm flex-1" onClick={() => setCropActive(false)}>
                    Cancel
                  </button>
                </div>
              </Show>
            </div>

            {/* Transform */}
            <div class="flex flex-col gap-2">
              <SectionLabel label="Transform" />
              <Slider
                label="Rotation"
                value={() => adj().freeRotation}
                onChange={(v) => setAdj("freeRotation", v)}
                min={-180}
                max={180}
                step={0.5}
                center
                showValue
                formatValue={(v) => `${v > 0 ? "+" : ""}${v}\u00b0`}
              />
              <div class="grid grid-cols-2 gap-2">
                <Switch label="Flip H" value={() => adj().flipH} onChange={(v) => setAdj("flipH", v)} />
                <Switch label="Flip V" value={() => adj().flipV} onChange={(v) => setAdj("flipV", v)} />
              </div>
            </div>

            {/* Adjustments */}
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <SectionLabel label="Adjustments" />
                <button class="text-xs text-dimmed hover:text-secondary transition-colors" onClick={resetAdjustments}>
                  Reset
                </button>
              </div>
              <Slider
                label="Brightness"
                value={() => adj().brightness}
                onChange={(v) => setAdj("brightness", v)}
                min={0.5}
                max={1.5}
                step={0.01}
                center
                showValue
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Contrast"
                value={() => adj().contrast}
                onChange={(v) => setAdj("contrast", v)}
                min={0.5}
                max={2}
                step={0.01}
                center
                showValue
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Saturation"
                value={() => adj().saturation}
                onChange={(v) => setAdj("saturation", v)}
                min={0}
                max={2}
                step={0.01}
                center
                showValue
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Hue"
                value={() => adj().hueRotate}
                onChange={(v) => setAdj("hueRotate", v)}
                min={0}
                max={360}
                step={1}
                showValue
                formatValue={(v) => `${v}\u00b0`}
              />
              <Slider
                label="Blur"
                value={() => adj().blur}
                onChange={(v) => setAdj("blur", v)}
                min={0}
                max={10}
                step={0.1}
                showValue
                formatValue={(v) => `${v.toFixed(1)}px`}
              />
              <Slider
                label="Sepia"
                value={() => adj().sepia}
                onChange={(v) => setAdj("sepia", v)}
                min={0}
                max={1}
                step={0.01}
                showValue
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Vignette"
                value={() => adj().vignette}
                onChange={(v) => setAdj("vignette", v)}
                min={0}
                max={1}
                step={0.01}
                showValue
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Grain"
                value={() => adj().grain}
                onChange={(v) => setAdj("grain", v)}
                min={0}
                max={0.5}
                step={0.01}
                showValue
                formatValue={(v) => `${Math.round(v * 200)}%`}
              />
            </div>

            {/* Presets */}
            <div class="flex flex-col gap-2">
              <SectionLabel label="Presets" />
              <div class="grid grid-cols-4 gap-1">
                <For each={Object.entries(PRESETS)}>
                  {([key, preset]) => (
                    <button class="btn-secondary btn-sm" onClick={() => applyPreset(key)}>
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Copy / Paste Edits */}
            <div class="flex flex-col gap-2">
              <SectionLabel label="Edits" />
              <div class="grid grid-cols-3 gap-1">
                <button class="btn-secondary btn-sm" onClick={copyEdits} title="Copy adjustments from this image">
                  <i class="ti ti-copy" /> Copy
                </button>
                <button class="btn-secondary btn-sm" onClick={pasteEdits} disabled={!clipboard()} title="Paste adjustments to this image">
                  <i class="ti ti-clipboard" /> Paste
                </button>
                <button
                  class="btn-secondary btn-sm"
                  onClick={pasteEditsAll}
                  disabled={!clipboard()}
                  title="Paste adjustments to all images"
                >
                  <i class="ti ti-clipboard-check" /> All
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
