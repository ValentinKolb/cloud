import { dropzone } from "@k2b/stdlib/solid";
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";
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

type FileFieldProps = {
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  class?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

export type FileDropzoneProps = FileFieldProps & {
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  icon?: string;
  title?: JSX.Element;
  subtitle?: JSX.Element;
  hint?: JSX.Element;
  onDrop: (files: File[]) => void | Promise<void>;
};

export function FileDropzone(props: FileDropzoneProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const disabled = () => Boolean(props.disabled || props.busy);
  let input: HTMLInputElement | undefined;
  const emit = (files: File[]) => {
    if (disabled() || files.length === 0) return;
    void props.onDrop(props.multiple === false ? files.slice(0, 1) : files);
  };
  const zone = dropzone.create({ accept: props.accept, onDrop: emit });
  const title = () =>
    props.busy
      ? "Uploading…"
      : zone.invalidDrag()
        ? "File type not accepted"
        : zone.isDragging()
          ? "Drop to upload"
          : (props.title ?? "Drop files or choose files");

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <button
        id={meta.controlId}
        type="button"
        class="k2b-dropzone"
        data-dragging={zone.isDragging() ? "true" : undefined}
        data-invalid={zone.invalidDrag() || props.error ? "true" : undefined}
        disabled={disabled()}
        aria-label={props["aria-label"]}
        aria-describedby={fieldDescribedBy(meta, props.description, props.error)}
        onClick={() => input?.click()}
        {...zone.handlers}
      >
        <i class={props.busy ? "ti ti-loader-2 k2b-spin" : (props.icon ?? "ti ti-cloud-upload")} aria-hidden="true" />
        <span>{title()}</span>
        <Show when={zone.invalidDrag()} fallback={<Show when={props.subtitle}>{props.subtitle}</Show>}>
          <small>Choose a file matching this field.</small>
        </Show>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </button>
      <input
        ref={input}
        class="k2b-sr-only"
        type="file"
        accept={props.accept}
        multiple={props.multiple ?? true}
        disabled={disabled()}
        tabIndex={-1}
        onChange={(event) => {
          emit(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
    </Field>
  );
}

export type ImageInputProps = FileFieldProps & {
  value?: string | null;
  onValueChange?: (value: string | null, file?: File) => void;
  round?: boolean;
  variant?: "default" | "small";
  transform?: (file: File) => Promise<string>;
  accept?: string;
  fallbackMarker?: string;
};

const fileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image could not be read.")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Image could not be read.")));
    reader.readAsDataURL(file);
  });

export function ImageInput(props: ImageInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const [busy, setBusy] = createSignal(false);
  const [localError, setLocalError] = createSignal<string>();
  let input: HTMLInputElement | undefined;
  const disabled = () => Boolean(props.disabled || busy() || !props.onValueChange);
  const value = () =>
    props.value && !props.value.includes(props.fallbackMarker ?? "?fallback") ? props.value : null;
  const select = async (file: File | undefined) => {
    if (!file || disabled()) return;
    setBusy(true);
    setLocalError();
    try {
      const transformed = await (props.transform ?? fileAsDataUrl)(file);
      props.onValueChange?.(transformed, file);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Image could not be processed.");
    } finally {
      setBusy(false);
      if (input) input.value = "";
    }
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error ?? localError()}
      meta={meta}
      required={props.required}
    >
      <div
        class="k2b-image-input"
        data-round={props.round ? "true" : undefined}
        data-variant={props.variant ?? "default"}
        role="group"
        aria-describedby={fieldDescribedBy(meta, props.description, props.error ?? localError())}
      >
        <div class="k2b-image-input__preview">
          <Show
            when={value()}
            fallback={<i class="ti ti-photo-off" aria-hidden="true" />}
          >
            {(source) => <img src={source()} alt={typeof props.label === "string" ? props.label : "Selected image"} />}
          </Show>
        </div>
        <div class="k2b-image-input__actions">
          <button type="button" class="k2b-button" data-variant="secondary" disabled={disabled()} onClick={() => input?.click()}>
            <i class={busy() ? "ti ti-loader-2 k2b-spin" : "ti ti-photo-plus"} aria-hidden="true" />
            {value() ? "Change" : "Add"}
          </button>
          <Show when={value()}>
            <button
              type="button"
              class="k2b-button"
              data-variant="ghost"
              disabled={disabled()}
              onClick={() => props.onValueChange?.(null)}
            >
              <i class="ti ti-trash" aria-hidden="true" /> Remove
            </button>
          </Show>
        </div>
        <input
          ref={input}
          id={meta.controlId}
          class="k2b-sr-only"
          type="file"
          accept={props.accept ?? ".jpg,.jpeg,.png,.gif,.webp"}
          disabled={disabled()}
          required={props.required && !value()}
          onChange={(event) => void select(event.currentTarget.files?.[0])}
        />
      </div>
    </Field>
  );
}

type PreviewState = {
  url: string;
  objectUrl: boolean;
  width: number;
  height: number;
};

type DragHandle = "move" | "nw" | "ne" | "sw" | "se";
type DragState = {
  handle: DragHandle;
  pointerId: number;
  x: number;
  y: number;
  crop: ImageCropRect;
};

export type ImageCropperProps = {
  source: ImageCropSource;
  aspect?: ImageCropAspect;
  previewShape?: "rect" | "circle";
  disabled?: boolean;
  onChange?: (state: ImageCropState | null) => void;
  class?: string;
};

const ready = (image: HTMLImageElement) =>
  image.complete && image.naturalWidth > 0
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("Failed to load image.")), { once: true });
      });

const loadPreview = async (source: ImageCropSource): Promise<PreviewState> => {
  const objectUrl = source instanceof Blob;
  const image =
    source instanceof HTMLImageElement
      ? source
      : Object.assign(new Image(), {
          crossOrigin: objectUrl ? undefined : "anonymous",
          src:
            source instanceof HTMLCanvasElement
              ? source.toDataURL("image/png")
              : objectUrl
                ? URL.createObjectURL(source)
                : source,
        });
  try {
    await ready(image);
    return {
      url: source instanceof HTMLImageElement ? source.currentSrc || source.src : image.src,
      objectUrl,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(image.src);
    throw error;
  }
};

export function ImageCropper(props: ImageCropperProps): JSX.Element {
  const [preview, setPreview] = createSignal<PreviewState>();
  const [crop, setCrop] = createSignal<ImageCropRect>();
  const [rotation, setRotation] = createSignal<ImageCropRotation>(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const [drag, setDrag] = createSignal<DragState>();
  let frame: HTMLDivElement | undefined;
  let ownedUrl: string | undefined;
  const aspect = () => props.aspect ?? "free";
  const size = () => {
    const current = preview();
    if (!current) return undefined;
    return rotation() === 90 || rotation() === 270
      ? { width: current.height, height: current.width }
      : { width: current.width, height: current.height };
  };
  const replace = (next?: PreviewState) => {
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    ownedUrl = next?.objectUrl ? next.url : undefined;
    setPreview(next);
  };

  createEffect(() => {
    const source = props.source;
    let disposed = false;
    setLoading(true);
    setError();
    setCrop();
    setRotation(0);
    void loadPreview(source)
      .then((next) => {
        if (disposed) {
          if (next.objectUrl) URL.revokeObjectURL(next.url);
        } else replace(next);
      })
      .catch((reason) => !disposed && setError(reason instanceof Error ? reason.message : "Failed to load image."))
      .finally(() => !disposed && setLoading(false));
    onCleanup(() => {
      disposed = true;
    });
  });

  createEffect(() => {
    const currentSize = size();
    if (!currentSize) return;
    setCrop((current) => clampImageCropRect(current ?? getInitialImageCropRect(currentSize, aspect()), currentSize, aspect()));
  });
  createEffect(() => {
    props.onChange?.(preview() && crop() ? { crop: crop()!, rotation: rotation() } : null);
  });
  onCleanup(() => replace());

  const point = (event: PointerEvent) => {
    const bounds = frame?.getBoundingClientRect();
    return bounds
      ? { x: (event.clientX - bounds.left) / Math.max(1, bounds.width), y: (event.clientY - bounds.top) / Math.max(1, bounds.height) }
      : { x: 0, y: 0 };
  };
  const move = (event: PointerEvent) => {
    const active = drag();
    const currentSize = size();
    if (!active || !currentSize || event.pointerId !== active.pointerId) return;
    const current = point(event);
    const dx = current.x - active.x;
    const dy = current.y - active.y;
    const start = active.crop;
    if (active.handle === "move") {
      setCrop(clampImageCropRect({ ...start, x: start.x + dx, y: start.y + dy }, currentSize, aspect()));
      return;
    }
    let { x, y, width, height } = start;
    if (active.handle.includes("w")) {
      x += dx;
      width -= dx;
    }
    if (active.handle.includes("e")) width += dx;
    if (active.handle.includes("n")) {
      y += dy;
      height -= dy;
    }
    if (active.handle.includes("s")) height += dy;
    setCrop(clampImageCropRect({ x, y, width, height }, currentSize, aspect()));
  };
  const stop = (event: PointerEvent) => {
    if (drag()?.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    setDrag();
  };
  const start = (handle: DragHandle, event: PointerEvent) => {
    const current = crop();
    if (!current || props.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const currentPoint = point(event);
    setDrag({ handle, pointerId: event.pointerId, x: currentPoint.x, y: currentPoint.y, crop: current });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  onCleanup(() => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  });

  const zoom = () => {
    const current = crop();
    return current ? 1 / Math.max(current.width, current.height) : 1;
  };
  const setZoom = (next: number) => {
    const current = crop();
    const currentSize = size();
    if (current && currentSize && !props.disabled) {
      setCrop(resizeImageCropAroundCenter(current, currentSize, aspect(), next / zoom()));
    }
  };

  return (
    <div class={`k2b-image-cropper ${props.class ?? ""}`}>
      <div class="k2b-image-cropper__stage">
        <Show when={!loading()} fallback={<small>Preparing image…</small>}>
          <Show when={!error()} fallback={<small class="k2b-image-cropper__error">{error()}</small>}>
            <Show when={preview() && crop()}>
              <div
                ref={frame}
                class="k2b-image-cropper__frame"
                style={{ "aspect-ratio": `${size()!.width} / ${size()!.height}` }}
              >
                <img src={preview()!.url} alt="Crop preview" draggable={false} style={{ transform: `rotate(${rotation()}deg)` }} />
                <div
                  class="k2b-image-cropper__selection"
                  data-shape={props.previewShape ?? "rect"}
                  style={{
                    left: `${crop()!.x * 100}%`,
                    top: `${crop()!.y * 100}%`,
                    width: `${crop()!.width * 100}%`,
                    height: `${crop()!.height * 100}%`,
                  }}
                  onPointerDown={(event) => start("move", event)}
                >
                  <Show when={aspect() === "free" && props.previewShape !== "circle"}>
                    <For each={["nw", "ne", "sw", "se"] as const}>
                      {(handle) => (
                        <button
                          type="button"
                          class="k2b-image-cropper__handle"
                          data-handle={handle}
                          aria-label={`Resize crop ${handle}`}
                          disabled={props.disabled}
                          onPointerDown={(event) => start(handle, event)}
                        />
                      )}
                    </For>
                  </Show>
                </div>
                <button
                  type="button"
                  class="k2b-image-cropper__rotate"
                  aria-label="Rotate right"
                  disabled={props.disabled}
                  onClick={() => setRotation((current) => rotateImageCropRight(current))}
                >
                  <i class="ti ti-rotate-clockwise" aria-hidden="true" />
                </button>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={aspect() !== "free" && crop()}>
        <label class="k2b-image-cropper__zoom">
          <span>Zoom <output>{zoom().toFixed(2)}×</output></span>
          <input
            type="range"
            min="1"
            max="5"
            step="0.05"
            value={zoom()}
            disabled={props.disabled}
            onInput={(event) => setZoom(event.currentTarget.valueAsNumber)}
          />
        </label>
      </Show>
    </div>
  );
}
