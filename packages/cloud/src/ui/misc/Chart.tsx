import { charts } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import { Show } from "solid-js";

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
 * <Chart kind="donut" data={slices()} />
 *
 * <Chart kind="sparkline" data={trend()} class="text-emerald-600" />
 * ```
 */

/** All chart kinds shipped by `stdlib.charts`. */
export type ChartKind = keyof typeof charts;

/**
 * Per-kind props: `kind` discriminator + the exact options that
 * `charts.<kind>` accepts. Solid's component model handles
 * discriminated unions natively, so callsites get full type safety
 * (e.g. `kind: "bar"` rejects `series`, demands `data`).
 *
 * `class` and `style` are escape hatches for sizing — pick a height
 * via Tailwind (`h-48`, `h-full`) since the SVG itself sizes to its
 * `width`/`height` options (defaults 480×280 from stdlib).
 */
export type ChartProps = {
  [K in ChartKind]: { kind: K; class?: string; style?: JSX.CSSProperties | string } & Parameters<
    (typeof charts)[K]
  >[0];
}[ChartKind];

/**
 * Internal — strips `kind`/`class`/`style` from props and forwards
 * the rest to `charts[kind]`. The `any` is the price we pay for one
 * function call dispatching across 8 different option types; we'd
 * need an overload-by-overload switch to type it without it.
 */
const renderSvg = (props: ChartProps): string => {
  const { kind, class: _class, style: _style, ...opts } = props;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (charts[kind] as (o: unknown) => string)(opts as any);
};

const Chart = (props: ChartProps): JSX.Element => {
  // Empty-data short-circuit. stdlib's chart functions render an
  // "empty SVG" with placeholder text — fine, but we'd rather show
  // a tonal "No data" affordance that fits the dashboard look. The
  // check is per-kind because stdlib's payload key differs (series
  // vs data vs groups). We're conservative: only block on truly
  // empty inputs; partially-filled series get rendered as-is.
  const isEmpty = (): boolean => {
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

  return (
    <Show
      when={!isEmpty()}
      fallback={
        <div
          class={`flex items-center justify-center text-xs text-dimmed ${props.class ?? ""}`}
          style={props.style}
        >
          No data
        </div>
      }
    >
      {/* The wrapping div carries any caller-supplied sizing classes.
          `innerHTML` is reactive in Solid — re-runs on every prop
          change, so live data updates propagate without ceremony. */}
      <div class={props.class} style={props.style} innerHTML={renderSvg(props)} />
    </Show>
  );
};

export default Chart;
