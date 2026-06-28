import { createSignal, onMount, onCleanup, Show, For } from "solid-js";

export type LightboxImage = {
  src: string;
  alt?: string;
  downloadUrl?: string;
};

type LightboxProps = {
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
};

/**
 * Minimal, accessible lightbox using native <dialog>.
 * Supports keyboard navigation, touch swipe gestures, and screen readers.
 */
export default function Lightbox(props: LightboxProps) {
  const [index, setIndex] = createSignal(props.initialIndex ?? 0);
  let dialogRef!: HTMLDialogElement;

  // Touch gesture tracking
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 50;

  const current = () => props.images[index()];
  const isMultiple = () => props.images.length > 1;
  const prev = () => {
    if (!isMultiple()) return;
    setIndex((i) => (i - 1 + props.images.length) % props.images.length);
  };
  const next = () => {
    if (!isMultiple()) return;
    setIndex((i) => (i + 1) % props.images.length);
  };

  const close = () => {
    dialogRef.close();
    props.onClose();
  };

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        close();
        break;
      case "ArrowLeft":
        prev();
        break;
      case "ArrowRight":
        next();
        break;
    }
  };

  // Touch handlers for swipe gestures
  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    // Only trigger swipe if horizontal movement is dominant
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        prev();
      } else {
        next();
      }
    }
  };

  // Click on backdrop closes lightbox
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === dialogRef) {
      close();
    }
  };

  onMount(() => {
    dialogRef.showModal();
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <dialog
      ref={dialogRef}
      class="fixed inset-0 m-0 h-dvh w-dvw max-h-none max-w-none bg-black/92 backdrop:bg-transparent p-0 text-white"
      onMouseDown={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label="Image lightbox"
    >
      {/* Top bar */}
      <div class="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 sm:p-6">
        <div class="flex min-w-0 flex-col gap-2">
          <Show when={isMultiple()}>
            <span
              class="inline-flex w-fit items-center rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs text-white/80 backdrop-blur"
              aria-live="polite"
            >
              {index() + 1} / {props.images.length}
            </span>
          </Show>
          <Show when={current()?.alt}>
            <div class="max-w-[min(70vw,42rem)] rounded-2xl border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-sm">
              <div class="truncate text-sm font-medium text-white">{current()?.alt}</div>
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <Show when={current()?.downloadUrl}>
            <a
              href={current()!.downloadUrl}
              download=""
              class="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 text-sm text-white transition-colors hover:bg-white/14"
              aria-label="Download image"
            >
              <i class="ti ti-download text-base" />
              <span class="hidden sm:inline">Download</span>
            </a>
          </Show>
          <button
            type="button"
            onClick={close}
            class="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 text-sm text-white transition-colors hover:bg-white/14"
            aria-label="Close lightbox"
          >
            <i class="ti ti-x text-base" />
            <span class="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div class="flex h-full w-full items-center justify-center px-6 pb-20 pt-24 sm:px-12 sm:pb-24 sm:pt-28">
        <img src={current()?.src} alt={current()?.alt ?? ""} class="max-h-full max-w-full object-contain select-none" draggable={false} />
      </div>

      <Show when={isMultiple()}>
        <button
          type="button"
          onClick={prev}
          class="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white transition-colors hover:bg-white/14 sm:left-6"
          aria-label="Previous image"
        >
          <i class="ti ti-chevron-left text-2xl" />
        </button>
        <button
          type="button"
          onClick={next}
          class="absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white transition-colors hover:bg-white/14 sm:right-6"
          aria-label="Next image"
        >
          <i class="ti ti-chevron-right text-2xl" />
        </button>
      </Show>

      <Show when={isMultiple() && props.images.length <= 10}>
        <div
          class="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 backdrop-blur"
          role="tablist"
          aria-label="Image navigation"
        >
          <For each={props.images}>
            {(_, i) => (
              <button
                type="button"
                onClick={() => setIndex(i())}
                class="h-2.5 w-2.5 rounded-full transition-colors"
                classList={{
                  "bg-white": index() === i(),
                  "bg-white/40 hover:bg-white/60": index() !== i(),
                }}
                role="tab"
                aria-selected={index() === i()}
                aria-label={`Go to image ${i() + 1}`}
              />
            )}
          </For>
        </div>
      </Show>
    </dialog>
  );
}
