import { charts } from "@k2b/stdlib";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";

export type ChartKind = keyof typeof charts;

type ChartBaseProps = {
  class?: string;
  style?: JSX.CSSProperties | string;
  label?: string;
  empty?: JSX.Element;
};

export type ChartProps = {
  [K in ChartKind]: ChartBaseProps & {
    kind: K;
  } & Omit<Parameters<(typeof charts)[K]>[0], "width" | "height">;
}[ChartKind];

const renderSvg = (props: ChartProps, width: number, height: number): string => {
  const { kind, class: _class, style: _style, label: _label, empty: _empty, ...options } = props;
  const render = charts[kind] as (value: Record<string, unknown>) => string;
  return render({ ...options, width, height });
};

const hasData = (props: ChartProps): boolean => {
  const value = props as ChartProps & {
    data?: unknown[];
    groups?: unknown[];
    rows?: Array<{ intervals?: unknown[] }>;
    series?: Array<{ data?: unknown[] }>;
  };

  if (Array.isArray(value.series)) return value.series.some((series) => (series.data?.length ?? 0) > 0);
  if (Array.isArray(value.data)) return value.data.length > 0;
  if (Array.isArray(value.groups)) return value.groups.length > 0;
  if (Array.isArray(value.rows)) return value.rows.some((row) => (row.intervals?.length ?? 0) > 0);
  return true;
};

export default function Chart(props: ChartProps): JSX.Element {
  let container: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 480, height: 280 });
  const svg = () => renderSvg(props, size().width, size().height);

  onMount(() => {
    if (!container || typeof ResizeObserver === "undefined") return;

    const update = () => {
      const rect = container?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={container}
      class={`k2b-chart ${props.class ?? ""}`}
      style={props.style}
      role="img"
      aria-label={props.label ?? `${props.kind} chart`}
      data-chart-kind={props.kind}
    >
      <Show when={hasData(props)} fallback={<div class="k2b-chart__empty">{props.empty ?? "No data"}</div>}>
        <div class="k2b-chart__svg" innerHTML={svg()} />
      </Show>
    </div>
  );
}
