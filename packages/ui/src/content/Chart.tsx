import { charts } from "@k2b/stdlib";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import {
  panStateTimelineViewport,
  renderStateTimeline,
  type StateTimelineDomain,
  type StateTimelineOptions,
  stateTimelineDomain,
  stateTimelineHeight,
  zoomStateTimelineViewport,
} from "./chart-state-timeline";

export type ChartKind = keyof typeof charts;
type ChartBaseProps = {
  class?: string;
  style?: JSX.CSSProperties | string;
  label?: string;
  empty?: JSX.Element;
  interactive?: boolean;
};
export type ChartProps = {
  [K in ChartKind]: ChartBaseProps & { kind: K } &
    (K extends "stateTimeline" ? StateTimelineOptions : Omit<Parameters<(typeof charts)[K]>[0], "width" | "height">);
}[ChartKind];

const hasData = (props: ChartProps): boolean => {
  const value = props as ChartProps & { data?: unknown[]; groups?: unknown[]; rows?: Array<{ intervals?: unknown[] }>; series?: Array<{ data?: unknown[] }> };
  if (Array.isArray(value.series)) return value.series.some((series) => (series.data?.length ?? 0) > 0);
  if (Array.isArray(value.data)) return value.data.length > 0;
  if (Array.isArray(value.groups)) return value.groups.length > 0;
  if (Array.isArray(value.rows)) return value.rows.some((row) => (row.intervals?.length ?? 0) > 0);
  return true;
};

export function Chart(props: ChartProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let tooltip: HTMLSpanElement | undefined;
  const timeline = () => props.kind === "stateTimeline";
  const fullDomain = () => timeline() ? stateTimelineDomain((props as Extract<ChartProps, { kind: "stateTimeline" }>).rows, (props as Extract<ChartProps, { kind: "stateTimeline" }>).domain) : [0, 1] as StateTimelineDomain;
  const [viewport, setViewport] = createSignal<StateTimelineDomain>(fullDomain());
  const [size, setSize] = createSignal({
    width: 480,
    height: timeline() ? stateTimelineHeight((props as Extract<ChartProps, { kind: "stateTimeline" }>).rows.length) : 280,
  });
  let drag: { id: number; x: number; viewport: StateTimelineDomain } | undefined;
  const svg = () => {
    const { kind, class: _class, style: _style, label: _label, empty: _empty, interactive: _interactive, ...options } = props;
    if (kind === "stateTimeline") return renderStateTimeline({ ...(options as StateTimelineOptions), ...size(), viewport: viewport() });
    return (charts[kind] as (value: Record<string, unknown>) => string)({ ...options, ...size() });
  };
  const reset = () => setViewport(fullDomain());
  const zoom = (direction: number) => setViewport((current) => zoomStateTimelineViewport(current, fullDomain(), direction));
  const showTooltip = (target: EventTarget | null) => {
    const trigger = target instanceof Element ? triggerWithTooltip(target) : null;
    if (!tooltip || !trigger?.dataset.chartTooltip) return;
    tooltip.textContent = trigger.dataset.chartTooltip;
    const triggerRect = trigger.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect();
    if (rootRect) {
      tooltip.style.left = `${Math.min(rootRect.width - 12, Math.max(12, triggerRect.left - rootRect.left + triggerRect.width / 2))}px`;
      tooltip.style.top = `${Math.max(4, triggerRect.top - rootRect.top)}px`;
    }
    tooltip.hidden = false;
  };
  const hideTooltip = () => { if (tooltip) tooltip.hidden = true; };

  onMount(() => {
    if (!root || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = root?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={root}
      class={`k2b-chart ${props.class ?? ""}`}
      style={props.style ?? (timeline() ? { height: `${stateTimelineHeight((props as Extract<ChartProps, { kind: "stateTimeline" }>).rows.length)}px` } : undefined)}
      role={props.interactive && timeline() ? "application" : "img"}
      tabindex={props.interactive && timeline() ? 0 : undefined}
      aria-label={props.label ?? `${props.kind} chart`}
      data-chart-kind={props.kind}
      data-interactive={props.interactive ? "true" : undefined}
      onPointerMove={(event) => {
        showTooltip(event.target);
        if (drag && timeline()) setViewport(panStateTimelineViewport(drag.viewport, fullDomain(), event.clientX - drag.x, event.currentTarget.clientWidth));
      }}
      onPointerLeave={hideTooltip}
      onPointerDown={(event) => {
        if (!props.interactive || !timeline() || event.button !== 0 || (event.target as Element).closest("a,button")) return;
        drag = { id: event.pointerId, x: event.clientX, viewport: viewport() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (drag?.id === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag = undefined;
      }}
      onWheel={(event) => {
        if (!props.interactive || !timeline() || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        zoom(event.deltaY < 0 ? 1 : -1);
      }}
      onKeyDown={(event) => {
        if (!props.interactive || !timeline()) return;
        if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1); }
        if (event.key === "-") { event.preventDefault(); zoom(-1); }
        if (event.key === "0" || event.key === "Home") { event.preventDefault(); reset(); }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setViewport((current) => panStateTimelineViewport(current, fullDomain(), event.key === "ArrowLeft" ? 80 : -80, event.currentTarget.clientWidth));
        }
      }}
    >
      <Show when={hasData(props)} fallback={<div class="k2b-chart__empty">{props.empty ?? "No data"}</div>}>
        <div class="k2b-chart__svg" innerHTML={svg()} />
        <span ref={tooltip} class="k2b-chart__tooltip" role="tooltip" hidden />
        <Show when={props.interactive && timeline()}>
          <div class="k2b-chart__controls" aria-label="Chart controls">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}><i class="ti ti-plus" aria-hidden="true" /></button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)}><i class="ti ti-minus" aria-hidden="true" /></button>
            <button type="button" aria-label="Reset view" onClick={reset}><i class="ti ti-focus-centered" aria-hidden="true" /></button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

const triggerWithTooltip = (element: Element): HTMLElement | null =>
  (element.closest("[data-chart-tooltip]") as HTMLElement | null);

export default Chart;
