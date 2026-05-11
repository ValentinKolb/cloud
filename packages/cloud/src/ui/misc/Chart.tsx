import { charts } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";

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
 * Zero invented API, zero option renaming. If stdlib gains a new
 * option, it's automatically available at every callsite.
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
  [K in ChartKind]: { kind: K; class?: string; style?: JSX.CSSProperties | string } & Omit<
    Parameters<(typeof charts)[K]>[0],
    "width" | "height"
  >;
}[ChartKind];

/**
 * Internal — strips wrapper-only keys from props and forwards the
 * rest (plus measured size) to `charts[kind]`. The `any` is the
 * price for dispatching one function call across 8 different option
 * types; an explicit per-kind switch would type it but balloon the
 * component for no runtime benefit.
 */
const renderSvg = (props: ChartProps, width: number, height: number): string => {
  const { kind, class: _class, style: _style, ...opts } = props;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (charts[kind] as (o: unknown) => string)({ ...(opts as any), width, height });
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
        <div
          ref={containerRef}
          class={`flex items-center justify-center text-xs text-dimmed ${props.class ?? ""}`}
          style={props.style}
        >
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
        class={`block ${props.class ?? ""}`}
        style={props.style}
        innerHTML={renderSvg(props, size().width, size().height)}
      />
    </Show>
  );
};

export default Chart;
