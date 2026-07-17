import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal, render } from "solid-js/web";
import { FLOATING_WINDOW_VIEWPORT_GAP, type FloatingWindowRect, fitFloatingWindowRect } from "./floating-window-geometry";

export { type FloatingWindowRect, fitFloatingWindowRect } from "./floating-window-geometry";

type ResizeEdge = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type FloatingWindowProps = {
  title: string;
  icon?: string;
  children: JSX.Element;
  onClose: () => void;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** App accent copied into the portal for semantic icon and frame styling. */
  accent?: string;
  class?: string;
};

export type OpenFloatingWindowOptions = Omit<FloatingWindowProps, "children" | "onClose">;
export type FloatingWindowClose = () => void;

const MOBILE_BREAKPOINT = 640;
let nextLayer = 30;
const activeLayers = new Set<number>();

const allocateLayer = () => {
  const layer = ++nextLayer;
  activeLayers.add(layer);
  return layer;
};

const releaseLayer = (layer: number) => activeLayers.delete(layer);
const topActiveLayer = () => Math.max(...activeLayers);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const fitRect = (rect: FloatingWindowRect, minWidth: number, minHeight: number) =>
  fitFloatingWindowRect(rect, minWidth, minHeight, { width: window.innerWidth, height: window.innerHeight });

/**
 * Non-modal utility window for workflows that should remain visible beside an
 * app. It intentionally provides only window fundamentals: move, resize,
 * focus ordering and viewport clamping. Docking and window management belong
 * in higher-level product code if they are ever needed.
 */
export default function FloatingWindow(props: FloatingWindowProps) {
  const minWidth = () => props.minWidth ?? 360;
  const minHeight = () => props.minHeight ?? 320;
  const [mobile, setMobile] = createSignal(false);
  const [layer, setLayer] = createSignal(allocateLayer());
  const [rect, setRect] = createSignal<FloatingWindowRect>({
    x: FLOATING_WINDOW_VIEWPORT_GAP,
    y: FLOATING_WINDOW_VIEWPORT_GAP,
    width: props.initialWidth ?? 720,
    height: props.initialHeight ?? 640,
  });
  const titleId = `floating-window-title-${crypto.randomUUID()}`;
  let windowElement: HTMLElement | undefined;

  const bringToFront = () =>
    setLayer((current) => {
      if (current === topActiveLayer()) return current;
      releaseLayer(current);
      return allocateLayer();
    });

  onMount(() => {
    const updateViewport = () => {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
      setMobile(isMobile);
      if (!isMobile) setRect((current) => fitRect(current, minWidth(), minHeight()));
    };

    setRect((current) =>
      fitRect(
        {
          ...current,
          x: (window.innerWidth - current.width) / 2,
          y: (window.innerHeight - current.height) / 2,
        },
        minWidth(),
        minHeight(),
      ),
    );
    updateViewport();
    const closeTopWindow = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || layer() !== topActiveLayer()) return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("resize", updateViewport);
    window.addEventListener("keydown", closeTopWindow);
    const focusFrame = requestAnimationFrame(() => windowElement?.focus());
    onCleanup(() => {
      releaseLayer(layer());
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("keydown", closeTopWindow);
    });
  });

  const beginMove = (event: PointerEvent) => {
    if (mobile() || event.button !== 0) return;
    const origin = rect();
    const startX = event.clientX;
    const startY = event.clientY;
    bringToFront();

    const move = (next: PointerEvent) =>
      setRect(fitRect({ ...origin, x: origin.x + next.clientX - startX, y: origin.y + next.clientY - startY }, minWidth(), minHeight()));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    event.preventDefault();
  };

  const keyboardMove = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 24 : 8;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") deltaX = -step;
    else if (event.key === "ArrowRight") deltaX = step;
    else if (event.key === "ArrowUp") deltaY = -step;
    else if (event.key === "ArrowDown") deltaY = step;
    else return;
    setRect((current) => fitRect({ ...current, x: current.x + deltaX, y: current.y + deltaY }, minWidth(), minHeight()));
    event.preventDefault();
  };

  const resizeBy = (edge: ResizeEdge, deltaX: number, deltaY: number) => {
    const current = rect();
    let { x, y, width, height } = current;
    if (edge.includes("left")) {
      const nextWidth = clamp(width - deltaX, minWidth(), window.innerWidth - FLOATING_WINDOW_VIEWPORT_GAP - x);
      x += width - nextWidth;
      width = nextWidth;
    }
    if (edge.includes("right")) width += deltaX;
    if (edge.includes("top")) {
      const nextHeight = clamp(height - deltaY, minHeight(), window.innerHeight - FLOATING_WINDOW_VIEWPORT_GAP - y);
      y += height - nextHeight;
      height = nextHeight;
    }
    if (edge.includes("bottom")) height += deltaY;
    setRect(fitRect({ x, y, width, height }, minWidth(), minHeight()));
  };

  const beginResize = (edge: ResizeEdge, event: PointerEvent) => {
    if (mobile() || event.button !== 0) return;
    let previousX = event.clientX;
    let previousY = event.clientY;
    bringToFront();
    const move = (next: PointerEvent) => {
      resizeBy(edge, next.clientX - previousX, next.clientY - previousY);
      previousX = next.clientX;
      previousY = next.clientY;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    event.preventDefault();
  };

  const keyboardResize = (edge: ResizeEdge, event: KeyboardEvent) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") resizeBy(edge, -step, 0);
    else if (event.key === "ArrowRight") resizeBy(edge, step, 0);
    else if (event.key === "ArrowUp") resizeBy(edge, 0, -step);
    else if (event.key === "ArrowDown") resizeBy(edge, 0, step);
    else return;
    event.preventDefault();
  };

  const resizeHandle = (edge: ResizeEdge, className: string, cursor: string) => (
    <Show
      when={edge === "bottom-right"}
      fallback={
        <div
          class={`absolute ${className} z-10`}
          style={{ cursor }}
          aria-hidden="true"
          onPointerDown={(event) => beginResize(edge, event)}
        />
      }
    >
      <button
        type="button"
        class={`absolute ${className} z-10 opacity-0 focus-visible:bg-[var(--app-accent)] focus-visible:opacity-100 focus-visible:outline-none`}
        style={{ cursor }}
        aria-label="Resize window. Use arrow keys; hold Shift for larger steps."
        onPointerDown={(event) => beginResize(edge, event)}
        onKeyDown={(event) => keyboardResize(edge, event)}
      />
    </Show>
  );

  return (
    <Portal>
      <section
        ref={windowElement}
        class={`floating-window app-accent-scope fixed flex min-h-0 flex-col overflow-hidden bg-[var(--ui-surface-raised)] text-primary outline-none ${props.class ?? ""}`}
        classList={{ "inset-2 !h-auto !w-auto": mobile() }}
        style={
          mobile()
            ? { "--app-accent": props.accent, "z-index": layer() }
            : {
                "--app-accent": props.accent,
                left: `${rect().x}px`,
                top: `${rect().y}px`,
                width: `${rect().width}px`,
                height: `${rect().height}px`,
                "z-index": layer(),
              }
        }
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={bringToFront}
      >
        <header class="flex h-14 shrink-0 touch-none select-none items-center gap-3 px-4" onPointerDown={beginMove}>
          <Show when={props.icon}>
            {(icon) => <i class={`${icon()} shrink-0 text-base ${props.accent ? "app-accent-text" : "text-dimmed"}`} aria-hidden="true" />}
          </Show>
          <button
            type="button"
            class="min-w-0 flex-1 cursor-move truncate rounded-[var(--ui-radius-control)] text-left text-sm font-semibold focus-ui"
            aria-label={`Move ${props.title} window. Use arrow keys; hold Shift for larger steps.`}
            onKeyDown={keyboardMove}
            onPointerDown={(event) => {
              event.stopPropagation();
              beginMove(event);
            }}
          >
            <span id={titleId}>{props.title}</span>
          </button>
          <button
            type="button"
            class="icon-btn shrink-0"
            aria-label="Close window"
            onClick={props.onClose}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <i class="ti ti-x" />
          </button>
        </header>
        <div class="min-h-0 flex-1">{props.children}</div>

        <Show when={!mobile()}>
          {resizeHandle("left", "-left-1 top-3 bottom-3 w-2", "ew-resize")}
          {resizeHandle("right", "-right-1 top-3 bottom-3 w-2", "ew-resize")}
          {resizeHandle("top", "-top-1 left-3 right-3 h-2", "ns-resize")}
          {resizeHandle("bottom", "-bottom-1 left-3 right-3 h-2", "ns-resize")}
          {resizeHandle("top-left", "-left-1 -top-1 h-4 w-4", "nwse-resize")}
          {resizeHandle("top-right", "-right-1 -top-1 h-4 w-4", "nesw-resize")}
          {resizeHandle("bottom-left", "-bottom-1 -left-1 h-4 w-4", "nesw-resize")}
          {resizeHandle("bottom-right", "-bottom-1 -right-1 h-4 w-4", "nwse-resize")}
        </Show>
      </section>
    </Portal>
  );
}

/** Mount a floating utility window and return an idempotent close function. */
export const openFloatingWindow = (view: (close: FloatingWindowClose) => JSX.Element, options: OpenFloatingWindowOptions) => {
  if (typeof document === "undefined") throw new Error("Floating windows are browser-only");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const owner = document.createElement("div");
  document.body.appendChild(owner);
  let dispose: (() => void) | undefined;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    dispose?.();
    owner.remove();
    previousFocus?.focus();
  };

  dispose = render(
    () => (
      <FloatingWindow {...options} onClose={close}>
        {view(close)}
      </FloatingWindow>
    ),
    owner,
  );
  return close;
};
