import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  clampImageCropRect,
  getInitialImageCropRect,
  type ImageCropAspect,
  type ImageCropRect,
  type ImageCropRotation,
  type ImageCropSource,
  type ImageCropState,
  resizeImageCropAroundCenter,
  rotateImageCropRight,
} from "./image-crop";
import Slider from "./Slider";

type PreviewShape = "rect" | "circle";

export type ImageCropperProps = {
  source: ImageCropSource;
  aspect?: ImageCropAspect;
  previewShape?: PreviewShape;
  disabled?: boolean;
  onChange?: (state: ImageCropState | null) => void;
};

type PreviewState = {
  url: string;
  objectUrl: boolean;
  sourceWidth: number;
  sourceHeight: number;
};

type DragHandle = "move" | "nw" | "ne" | "sw" | "se";

type DragState = {
  handle: DragHandle;
  pointerId: number;
  startX: number;
  startY: number;
  startCrop: ImageCropRect;
};

const HANDLE_CLASS =
  "absolute h-4 w-4 rounded-full border-2 border-white bg-blue-500 shadow-[var(--theme-shadow-elevated)] transition-transform hover:scale-110 focus-ui";

const readPointerPosition = (event: PointerEvent, frame: HTMLDivElement | undefined) => {
  if (!frame) return { x: 0, y: 0 };
  const rect = frame.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / Math.max(1, rect.width),
    y: (event.clientY - rect.top) / Math.max(1, rect.height),
  };
};

const handlePositionClass: Record<Exclude<DragHandle, "move">, string> = {
  nw: "-left-2 -top-2 cursor-nwse-resize",
  ne: "-right-2 -top-2 cursor-nesw-resize",
  sw: "-bottom-2 -left-2 cursor-nesw-resize",
  se: "-bottom-2 -right-2 cursor-nwse-resize",
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const imageElementReady = async (image: HTMLImageElement): Promise<void> => {
  if (image.complete && image.naturalWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Failed to load image.")), { once: true });
  });
};

const loadPreviewState = async (source: ImageCropSource): Promise<PreviewState> => {
  const sourceImage =
    source instanceof HTMLImageElement
      ? source
      : Object.assign(new Image(), {
          crossOrigin: source instanceof Blob ? undefined : "anonymous",
          src:
            source instanceof HTMLCanvasElement
              ? source.toDataURL("image/png")
              : source instanceof Blob
                ? URL.createObjectURL(source)
                : source,
        });

  try {
    await imageElementReady(sourceImage);
    const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
    const url = source instanceof HTMLImageElement ? source.currentSrc || source.src : sourceImage.src;
    return {
      url,
      objectUrl: source instanceof Blob,
      sourceWidth,
      sourceHeight,
    };
  } catch (err) {
    if (source instanceof Blob) URL.revokeObjectURL(sourceImage.src);
    throw err;
  }
};

export default function ImageCropper(props: ImageCropperProps) {
  let frameRef: HTMLDivElement | undefined;
  let activePreview: PreviewState | null = null;
  const aspect = () => props.aspect ?? "free";
  const previewShape = () => props.previewShape ?? "rect";
  const disabled = () => props.disabled ?? false;
  const [preview, setPreview] = createSignal<PreviewState | null>(null);
  const [crop, setCrop] = createSignal<ImageCropRect | null>(null);
  const [rotation, setRotation] = createSignal<ImageCropRotation>(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<DragState | null>(null);

  const previewSize = (): { width: number; height: number } | null => {
    const currentPreview = preview();
    if (!currentPreview) return null;
    const swapsDimensions = rotation() === 90 || rotation() === 270;
    return {
      width: swapsDimensions ? currentPreview.sourceHeight : currentPreview.sourceWidth,
      height: swapsDimensions ? currentPreview.sourceWidth : currentPreview.sourceHeight,
    };
  };

  const replacePreview = (next: PreviewState | null) => {
    if (activePreview?.objectUrl) URL.revokeObjectURL(activePreview.url);
    activePreview = next;
    setPreview(next);
  };

  onCleanup(() => {
    if (activePreview?.objectUrl) URL.revokeObjectURL(activePreview.url);
  });

  createEffect(() => {
    props.source;
    setRotation(0);
    setCrop(null);
  });

  createEffect(() => {
    const source = props.source;
    let disposed = false;
    replacePreview(null);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextPreview = await loadPreviewState(source);
        if (disposed) {
          if (nextPreview.objectUrl) URL.revokeObjectURL(nextPreview.url);
          return;
        }
        replacePreview(nextPreview);
      } catch (err) {
        if (disposed) return;
        replacePreview(null);
        setCrop(null);
        setError(err instanceof Error ? err.message : "Failed to load image.");
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    onCleanup(() => {
      disposed = true;
    });
  });

  createEffect(() => {
    const currentSize = previewSize();
    const currentAspect = aspect();
    if (!currentSize) return;
    setCrop((current) => clampImageCropRect(current ?? getInitialImageCropRect(currentSize, currentAspect), currentSize, currentAspect));
  });

  createEffect(() => {
    const currentCrop = crop();
    const currentPreview = preview();
    props.onChange?.(currentCrop && currentPreview ? { crop: currentCrop, rotation: rotation() } : null);
  });

  const moveCrop = (event: PointerEvent) => {
    const state = drag();
    const currentSize = previewSize();
    if (!state || !currentSize || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = readPointerPosition(event, frameRef);
    const dx = point.x - state.startX;
    const dy = point.y - state.startY;
    const start = state.startCrop;

    if (state.handle === "move") {
      setCrop(
        clampImageCropRect(
          {
            ...start,
            x: start.x + dx,
            y: start.y + dy,
          },
          currentSize,
          aspect(),
        ),
      );
      return;
    }

    let x = start.x;
    let y = start.y;
    let width = start.width;
    let height = start.height;
    const min = 0.08;

    if (state.handle.includes("w")) {
      x = clamp(start.x + dx, 0, start.x + start.width - min);
      width = start.width - (x - start.x);
    }
    if (state.handle.includes("e")) {
      width = clamp(start.width + dx, min, 1 - start.x);
    }
    if (state.handle.includes("n")) {
      y = clamp(start.y + dy, 0, start.y + start.height - min);
      height = start.height - (y - start.y);
    }
    if (state.handle.includes("s")) {
      height = clamp(start.height + dy, min, 1 - start.y);
    }

    setCrop(clampImageCropRect({ x, y, width, height }, currentSize, aspect()));
  };

  const endDrag = (event: PointerEvent) => {
    const state = drag();
    if (!state || state.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", moveCrop);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    setDrag(null);
  };

  const startDrag = (handle: DragHandle, event: PointerEvent) => {
    const currentCrop = crop();
    if (!currentCrop || disabled()) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    const point = readPointerPosition(event, frameRef);
    setDrag({
      handle,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startCrop: currentCrop,
    });
    window.addEventListener("pointermove", moveCrop);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  onCleanup(() => {
    window.removeEventListener("pointermove", moveCrop);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  });

  const zoom = () => {
    const currentCrop = crop();
    if (!currentCrop) return 1;
    return Math.round((1 / Math.max(currentCrop.width, currentCrop.height)) * 100) / 100;
  };

  const setZoom = (value: number) => {
    const currentCrop = crop();
    const currentSize = previewSize();
    if (!currentCrop || !currentSize || disabled()) return;
    const currentZoom = zoom();
    const scale = value / Math.max(0.01, currentZoom);
    setCrop(resizeImageCropAroundCenter(currentCrop, currentSize, aspect(), scale));
  };

  const rotateRight = () => {
    if (disabled()) return;
    setRotation((current) => rotateImageCropRight(current));
  };

  const previewFrameStyle = () => {
    const currentSize = previewSize();
    if (!currentSize) return {};
    return {
      "aspect-ratio": `${currentSize.width} / ${currentSize.height}`,
      "max-width": `min(100%, calc(min(58vh, 24rem) * ${currentSize.width} / ${currentSize.height}))`,
    };
  };

  const previewImageStyle = () => {
    const currentPreview = preview();
    const currentSize = previewSize();
    if (!currentPreview || !currentSize) return {};
    const swapsDimensions = rotation() === 90 || rotation() === 270;
    return {
      width: swapsDimensions ? `${(currentPreview.sourceWidth / currentSize.width) * 100}%` : "100%",
      height: swapsDimensions ? `${(currentPreview.sourceHeight / currentSize.height) * 100}%` : "100%",
      transform: `translate(-50%, -50%) rotate(${rotation()}deg)`,
    };
  };

  const cropStyle = () => {
    const currentCrop = crop();
    if (!currentCrop) return {};
    return {
      left: `${currentCrop.x * 100}%`,
      top: `${currentCrop.y * 100}%`,
      width: `${currentCrop.width * 100}%`,
      height: `${currentCrop.height * 100}%`,
      "box-shadow": "0 0 0 9999px rgba(0,0,0,.42)",
    };
  };

  const showResizeHandles = () => aspect() === "free" && previewShape() !== "circle";

  return (
    <div class="flex min-w-0 flex-col gap-3">
      <div class="flex min-h-56 items-center justify-center rounded-lg border border-zinc-200/80 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
        <Show when={!loading()} fallback={<span class="text-xs text-dimmed">Preparing image...</span>}>
          <Show when={!error()} fallback={<span class="text-xs text-red-500">{error()}</span>}>
            <Show when={preview() && crop()}>
              <div
                ref={frameRef}
                class="relative max-h-[min(58vh,24rem)] w-full max-w-full overflow-hidden rounded-lg bg-zinc-100 shadow-[var(--theme-shadow-elevated)] touch-none select-none dark:bg-zinc-950"
                style={previewFrameStyle()}
              >
                <img
                  src={preview()!.url}
                  alt="Crop preview"
                  class="absolute left-1/2 top-1/2 max-w-none object-fill"
                  style={previewImageStyle()}
                  draggable={false}
                />
                <div
                  class={`absolute border-2 border-white/95 ${previewShape() === "circle" ? "rounded-full" : "rounded-md"} cursor-grab active:cursor-grabbing`}
                  style={cropStyle()}
                  onPointerDown={(event) => startDrag("move", event)}
                >
                  <Show when={showResizeHandles()}>
                    <For each={["nw", "ne", "sw", "se"] as const}>
                      {(handle) => (
                        <button
                          type="button"
                          class={`${HANDLE_CLASS} ${handlePositionClass[handle]}`}
                          onPointerDown={(event) => startDrag(handle, event)}
                          aria-label={`Resize crop ${handle}`}
                          disabled={disabled()}
                        />
                      )}
                    </For>
                  </Show>
                </div>
                <button
                  type="button"
                  class="btn-input btn-sm absolute right-2 top-2 z-20 h-9 w-9 justify-center rounded-full bg-white/90 shadow-[var(--theme-shadow-elevated)] backdrop-blur dark:bg-zinc-950/85"
                  onClick={rotateRight}
                  disabled={disabled() || !crop() || Boolean(error())}
                  title="Rotate right"
                  aria-label="Rotate right"
                >
                  <i class="ti ti-corner-up-left" aria-hidden="true" />
                </button>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-secondary">Zoom</span>
          <span class="text-dimmed tabular-nums">{zoom().toFixed(2)}x</span>
        </div>
        <Slider value={zoom} onChange={setZoom} min={1} max={5} step={0.05} disabled={disabled() || !crop()} showValue={false} />
      </div>
    </div>
  );
}
