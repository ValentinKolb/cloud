import type { MapViewport } from "@valentinkolb/stdlib";
import { charts } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { DEFAULT_MAP_VIEWPORT, normalizeMapViewport, panMapViewport, zoomMapViewport } from "./chart-map-viewport";

/**
 * Chart — minimal Solid wrapper around `stdlib.charts`.
 *
 * **Live-update story.** `charts.<kind>(opts)` returns an SVG string;
 * Solid's `innerHTML` is reactive, so any time a prop (signal, store
 * slice, derived value) changes, the SVG re-renders. No manual
 * subscription, no imperative DOM patching. Trade-off: every change
 * is a full SVG re-build, not a diff — fine for dashboard cadences
 * (poll, websocket, store updates). Don't use this for 60fps streaming.
 *
 * **Sizing.** stdlib emits `<svg viewBox="0 0 W H">` with no width/
 * height attributes, so the SVG would otherwise fall back to the
 * browser's replaced-element default (300×150) and either overflow
 * or look squished. We measure the wrapping `<div>` with a
 * ResizeObserver and pass the actual pixel dimensions to stdlib —
 * the viewBox matches the container, no aspect distortion, no
 * letterboxing. Sizing the wrapper itself is the caller's job
 * (`class="h-56 w-full"`, flex child, etc.). On SSR (no observer)
 * the chart renders at stdlib's default size; the first client-side
 * frame re-measures and re-renders.
 *
 * **Why so thin.** The props are a discriminated union over each
 * stdlib chart function — `kind: "line"` brings in exactly the params
 * `charts.line` expects, `kind: "bar"` brings in `charts.bar`'s, etc.
 * Options stay aligned with stdlib without renaming. The sole wrapper
 * extension is `interactive` for maps, which adds bounded pan / zoom
 * controls while keeping stdlib's viewport as the rendering contract.
 * If stdlib gains a new option, it's automatically available at every
 * callsite.
 *
 * **Theming.** stdlib charts use `currentColor` for axes / ticks /
 * tick labels — set the wrapping element's `color` (via Tailwind
 * `text-dimmed` / `text-primary` / dark variants) and everything
 * inherits. Series colors come from `--stdlib-chart-c1..c8` CSS
 * custom properties; override on the parent for per-chart palettes.
 *
 * ```tsx
 * <Chart kind="line" class="h-48 text-dimmed"
 *        series={[{ data: points() }]}
 *        yAxis={{ format: v => `€${v}k` }} />
 *
 * <Chart kind="donut" class="h-48" data={slices()} />
 *
 * <Chart kind="sparkline" class="w-24 h-6 text-emerald-600" data={trend()} />
 *
 * <Chart kind="map" class="h-64" series={locations()} interactive />
 * ```
 */

/** All chart kinds shipped by `stdlib.charts`. */
export type ChartKind = keyof typeof charts;

/**
 * Per-kind props: `kind` discriminator + the exact options that
 * `charts.<kind>` accepts, **minus** `width` / `height` (the wrapper
 * owns those — they're derived from container measurement). Solid's
 * component model handles discriminated unions natively, so callsites
 * get full type safety.
 */
export type ChartProps = {
  [K in ChartKind]: {
    kind: K;
    class?: string;
    style?: JSX.CSSProperties | string;
  } & Omit<Parameters<(typeof charts)[K]>[0], "width" | "height"> &
    (K extends "map" ? { interactive?: boolean } : {});
}[ChartKind];

/**
 * Internal — strips wrapper-only keys from props and forwards the
 * rest (plus measured size) to `charts[kind]`. The `any` is the
 * price for dispatching one function call across 8 different option
 * types; an explicit per-kind switch would type it but balloon the
 * component for no runtime benefit.
 */
const renderSvg = (props: ChartProps, width: number, height: number, viewport?: MapViewport): string => {
  const { kind, class: _class, style: _style, interactive: _interactive, ...opts } = props as ChartProps & { interactive?: boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (charts[kind] as (o: unknown) => string)({
    ...(opts as any),
    ...(kind === "map" && viewport ? { viewport } : {}),
    width,
    height,
  });
};

/** Empty-data short-circuit. Kept per-kind because stdlib's payload
 *  key differs (series vs data vs groups). We're conservative: only
 *  block on truly empty inputs; partially-filled series get rendered
 *  as-is and stdlib handles the gaps. */
const isEmpty = (props: ChartProps): boolean => {
  if (props.kind === "line" || props.kind === "scatter") {
    return !props.series?.length || props.series.every((s) => !s.data.length);
  }
  if (props.kind === "bar" || props.kind === "donut" || props.kind === "pie") {
    return !props.data?.length;
  }
  if (props.kind === "histogram" || props.kind === "sparkline") {
    return !props.data?.length;
  }
  if (props.kind === "boxplot") {
    return !props.groups?.length;
  }
  return false;
};

const Chart = (props: ChartProps): JSX.Element => {
  let containerRef: HTMLDivElement | undefined;
  // Initial size matches stdlib's chart-function defaults so the SSR
  // render is sensible. The observer updates this on the first
  // client-side frame; the SVG re-renders reactively via innerHTML.
  const [size, setSize] = createSignal({ width: 480, height: 280 });
  const initialMapViewport = props.kind === "map" ? normalizeMapViewport(props.viewport) : DEFAULT_MAP_VIEWPORT;
  const [mapViewport, setMapViewport] = createSignal<MapViewport>(initialMapViewport);
  const [dragging, setDragging] = createSignal(false);
  let drag:
    | {
        pointerId: number;
        x: number;
        y: number;
        width: number;
        height: number;
        viewport: MapViewport;
      }
    | undefined;

  const interactiveMap = () => props.kind === "map" && props.interactive === true;

  const mapDimensions = () => {
    const viewportElement = containerRef?.querySelector(".stdlib-chart-map-viewport");
    const rect = viewportElement?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    return size();
  };

  const zoom = (delta: number) => {
    setMapViewport((current) => zoomMapViewport(current, delta));
  };

  const reset = () => {
    setMapViewport(initialMapViewport);
  };

  const handlePointerDown: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent> = (event) => {
    if (!interactiveMap() || event.button !== 0 || (event.target as Element).closest("button")) {
      return;
    }
    const dimensions = mapDimensions();
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: dimensions.width,
      height: dimensions.height,
      viewport: mapViewport(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent> = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setMapViewport(panMapViewport(drag.viewport, event.clientX - drag.x, event.clientY - drag.y, drag.width, drag.height));
  };

  const stopDragging: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent> = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    setDragging(false);
  };

  const handleWheel: JSX.EventHandlerUnion<HTMLDivElement, WheelEvent> = (event) => {
    if (!interactiveMap() || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1 : -1);
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (!interactiveMap()) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom(1);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoom(-1);
      return;
    }
    if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    const delta: readonly [number, number] | undefined = {
      ArrowLeft: [40, 0],
      ArrowRight: [-40, 0],
      ArrowUp: [0, 40],
      ArrowDown: [0, -40],
    }[event.key] as readonly [number, number] | undefined;
    if (!delta) return;
    event.preventDefault();
    const dimensions = mapDimensions();
    setMapViewport((current) => panMapViewport(current, delta[0], delta[1], dimensions.width, dimensions.height));
  };

  onMount(() => {
    if (!containerRef) return;
    // Seed immediately from layout — avoids one wasted re-render in
    // the case where the container already has its final size at
    // mount time (the common case for dashboard widgets).
    const rect = containerRef.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Floor to integer pixels; sub-pixel jitter would trigger an
      // SVG re-render on every scroll/zoom otherwise.
      if (width > 0 && height > 0) {
        setSize((prev) => {
          const w = Math.round(width);
          const h = Math.round(height);
          return prev.width === w && prev.height === h ? prev : { width: w, height: h };
        });
      }
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  return (
    <Show
      when={!isEmpty(props)}
      fallback={
        <div ref={containerRef} class={`flex items-center justify-center text-xs text-dimmed ${props.class ?? ""}`} style={props.style}>
          No data
        </div>
      }
    >
      {/* The wrapping div is what the ResizeObserver watches. `block`
          + the caller's sizing classes (h-48, w-full, flex-1, …) drive
          the available space; the SVG inside fills it via viewBox =
          container size. `innerHTML` is reactive in Solid — re-runs
          on every prop / size change, so live data updates propagate
          without ceremony. */}
      <div
        ref={containerRef}
        class={`relative block ${
          interactiveMap() ? (dragging() ? "cursor-grabbing select-none" : "cursor-grab") : ""
        } ${props.class ?? ""}`}
        style={props.style}
        role="group"
        aria-label={interactiveMap() ? "Interactive map" : undefined}
        tabIndex={interactiveMap() ? 0 : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div
          class="h-full w-full"
          innerHTML={renderSvg(props, size().width, size().height, interactiveMap() ? mapViewport() : undefined)}
        />
        <Show when={interactiveMap()}>
          <div class="absolute right-2 top-2 z-10 flex items-center gap-1">
            <button type="button" class="icon-btn bg-[var(--ui-field)]" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1)}>
              <i class="ti ti-plus" aria-hidden="true" />
            </button>
            <button type="button" class="icon-btn bg-[var(--ui-field)]" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoom(-1)}>
              <i class="ti ti-minus" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn bg-[var(--ui-field)]"
              aria-label="Reset map view"
              title="Reset map view (0)"
              onClick={reset}
            >
              <i class="ti ti-focus-centered" aria-hidden="true" />
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default Chart;
