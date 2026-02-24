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
  const hasPrev = () => index() > 0;
  const hasNext = () => index() < props.images.length - 1;
  const isMultiple = () => props.images.length > 1;

  const prev = () => hasPrev() && setIndex((i) => i - 1);
  const next = () => hasNext() && setIndex((i) => i + 1);

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
      class="fixed inset-0 m-0 h-dvh w-dvw max-h-none max-w-none bg-black/90 backdrop:bg-transparent p-0"
      onMouseDown={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label="Image lightbox"
    >
      {/* Top bar */}
      <div class="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4">
        {/* Counter */}
        <Show when={isMultiple()}>
          <span class="text-white/80 text-sm" aria-live="polite">
            {index() + 1} / {props.images.length}
          </span>
        </Show>
        <Show when={!isMultiple()}>
          <span />
        </Show>

        {/* Actions */}
        <div class="flex items-center gap-2">
          <Show when={current()?.downloadUrl}>
            <a
              href={current()!.downloadUrl}
              download=""
              class="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Download image"
            >
              <i class="ti ti-download text-xl" />
            </a>
          </Show>
          <button
            type="button"
            onClick={close}
            class="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close lightbox"
          >
            <i class="ti ti-x text-xl" />
          </button>
        </div>
      </div>

      {/* Image container */}
      <div class="flex items-center justify-center h-full w-full p-12">
        <img src={current()?.src} alt={current()?.alt ?? ""} class="max-h-full max-w-full object-contain select-none" draggable={false} />
      </div>

      {/* Navigation buttons */}
      <Show when={isMultiple()}>
        <button
          type="button"
          onClick={prev}
          disabled={!hasPrev()}
          class="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
          aria-label="Previous image"
        >
          <i class="ti ti-chevron-left text-2xl" />
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!hasNext()}
          class="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
          aria-label="Next image"
        >
          <i class="ti ti-chevron-right text-2xl" />
        </button>
      </Show>

      {/* Dot indicators */}
      <Show when={isMultiple() && props.images.length <= 10}>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2" role="tablist" aria-label="Image navigation">
          <For each={props.images}>
            {(_, i) => (
              <button
                type="button"
                onClick={() => setIndex(i())}
                class="w-2 h-2 rounded-full transition-colors"
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
