import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal, render } from "solid-js/web";
import { getK2bPortalRoot } from "../internal/portal";
import {
  FLOATING_WINDOW_VIEWPORT_GAP,
  type FloatingWindowRect,
  fitFloatingWindowRect,
} from "./floating-window-geometry";

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
const topLayer = () => Math.max(...activeLayers);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export default function FloatingWindow(props: FloatingWindowProps): JSX.Element {
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
  const titleId = `k2b-floating-window-${Math.random().toString(36).slice(2)}`;
  let frame: HTMLElement | undefined;
  const fit = (value: FloatingWindowRect) =>
    fitFloatingWindowRect(value, minWidth(), minHeight(), { width: window.innerWidth, height: window.innerHeight });
  const front = () =>
    setLayer((current) => {
      if (current === topLayer()) return current;
      releaseLayer(current);
      return allocateLayer();
    });

  onMount(() => {
    const viewport = () => {
      const compact = window.innerWidth < MOBILE_BREAKPOINT;
      setMobile(compact);
      if (!compact) setRect((current) => fit(current));
    };
    setRect((current) =>
      fit({ ...current, x: (window.innerWidth - current.width) / 2, y: (window.innerHeight - current.height) / 2 }),
    );
    viewport();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && layer() === topLayer()) {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("resize", viewport);
    window.addEventListener("keydown", escape);
    const focus = requestAnimationFrame(() => frame?.focus());
    onCleanup(() => {
      releaseLayer(layer());
      cancelAnimationFrame(focus);
      window.removeEventListener("resize", viewport);
      window.removeEventListener("keydown", escape);
    });
  });

  const moveBy = (deltaX: number, deltaY: number) =>
    setRect((current) => fit({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  const beginMove = (event: PointerEvent) => {
    if (mobile() || event.button !== 0 || (event.target as Element).closest("button:not([data-window-move])")) return;
    const origin = rect();
    const start = { x: event.clientX, y: event.clientY };
    front();
    const move = (next: PointerEvent) =>
      setRect(fit({ ...origin, x: origin.x + next.clientX - start.x, y: origin.y + next.clientY - start.y }));
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
  const resizeBy = (edge: ResizeEdge, deltaX: number, deltaY: number) => {
    const current = rect();
    let { x, y, width, height } = current;
    if (edge.includes("left")) {
      const next = clamp(width - deltaX, minWidth(), window.innerWidth - FLOATING_WINDOW_VIEWPORT_GAP - x);
      x += width - next;
      width = next;
    }
    if (edge.includes("right")) width += deltaX;
    if (edge.includes("top")) {
      const next = clamp(height - deltaY, minHeight(), window.innerHeight - FLOATING_WINDOW_VIEWPORT_GAP - y);
      y += height - next;
      height = next;
    }
    if (edge.includes("bottom")) height += deltaY;
    setRect(fit({ x, y, width, height }));
  };
  const beginResize = (edge: ResizeEdge, event: PointerEvent) => {
    if (mobile() || event.button !== 0) return;
    let previous = { x: event.clientX, y: event.clientY };
    front();
    const move = (next: PointerEvent) => {
      resizeBy(edge, next.clientX - previous.x, next.clientY - previous.y);
      previous = { x: next.clientX, y: next.clientY };
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
  const arrows = (event: KeyboardEvent, action: (x: number, y: number) => void) => {
    const step = event.shiftKey ? 24 : 8;
    const delta =
      event.key === "ArrowLeft"
        ? [-step, 0]
        : event.key === "ArrowRight"
          ? [step, 0]
          : event.key === "ArrowUp"
            ? [0, -step]
            : event.key === "ArrowDown"
              ? [0, step]
              : undefined;
    if (!delta) return;
    action(delta[0]!, delta[1]!);
    event.preventDefault();
  };
  const handles: readonly [ResizeEdge, string][] = [
    ["left", "ew-resize"],
    ["right", "ew-resize"],
    ["top", "ns-resize"],
    ["bottom", "ns-resize"],
    ["top-left", "nwse-resize"],
    ["top-right", "nesw-resize"],
    ["bottom-left", "nesw-resize"],
    ["bottom-right", "nwse-resize"],
  ];

  const view = (
    <section
      ref={frame}
      class={`k2b-floating-window ${props.class ?? ""}`}
      data-mobile={mobile() ? "true" : undefined}
      style={
        mobile()
          ? { "--k2b-window-accent": props.accent, "z-index": layer() }
          : {
              "--k2b-window-accent": props.accent,
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
      onPointerDown={front}
    >
      <header onPointerDown={beginMove}>
        <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
        <button
          type="button"
          data-window-move
          class="k2b-floating-window__title"
          aria-label={`Move ${props.title} window. Use arrow keys; hold Shift for larger steps.`}
          onKeyDown={(event) => arrows(event, moveBy)}
        >
          <span id={titleId}>{props.title}</span>
        </button>
        <button type="button" class="k2b-icon-button" aria-label="Close window" onClick={props.onClose}>
          <i class="ti ti-x" aria-hidden="true" />
        </button>
      </header>
      <div class="k2b-floating-window__body">{props.children}</div>
      <Show when={!mobile()}>
        {handles.map(([edge, cursor]) => (
          <button
            type="button"
            class="k2b-floating-window__resize"
            data-edge={edge}
            style={{ cursor }}
            aria-label={`Resize window from ${edge}. Use arrow keys; hold Shift for larger steps.`}
            onPointerDown={(event) => beginResize(edge, event)}
            onKeyDown={(event) => arrows(event, (x, y) => resizeBy(edge, x, y))}
          />
        ))}
      </Show>
    </section>
  );
  return <Portal mount={typeof document === "undefined" ? undefined : getK2bPortalRoot()}>{view}</Portal>;
}

export const openFloatingWindow = (
  view: (close: FloatingWindowClose) => JSX.Element,
  options: OpenFloatingWindowOptions,
): FloatingWindowClose => {
  if (typeof document === "undefined") throw new Error("Floating windows are browser-only");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const owner = document.createElement("div");
  owner.className = "k2b-ui";
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
  dispose = render(() => <FloatingWindow {...options} onClose={close}>{view(close)}</FloatingWindow>, owner);
  return close;
};
