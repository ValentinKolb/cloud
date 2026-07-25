import { formatBytes, formatDateTime, formatNumber } from "@valentinkolb/cloud/shared";
import { Chart } from "@valentinkolb/cloud/ui";

/**
 * Hydrating wrapper around `Chart`.
 *
 * `Chart` sizes itself by measuring its container in `onMount` and starts from
 * a hardcoded 480×280 until then. A chart rendered straight into an SSR page
 * never mounts, so it stays at that size no matter what height class it is
 * given — small, letterboxed, and unreadable. Making it an island is what
 * actually lets the ResizeObserver run and the chart fill its box.
 *
 * Island props must be serializable, so axis formatting is passed as a named
 * format rather than a function.
 */

export type ObservabilityChartFormat = "number" | "bytes" | "datetime";

export type ObservabilityChartProps = {
  kind: "line" | "bar" | "donut" | "stateTimeline";
  class?: string;
  /** Lane charts size by row count, so height comes from the caller. */
  style?: string;
  /** `line` only. */
  series?: { label?: string; data: { x: number; y: number }[] }[];
  /** `bar` and `donut`. */
  data?: { label: string; value: number }[];
  /** `stateTimeline` — one lane per row, marks positioned on the time axis. */
  rows?: { label: string; intervals: { from: number; to: number; state: string; label?: string }[] }[];
  states?: { state: string; label?: string; color?: string }[];
  xFormat?: ObservabilityChartFormat;
  yFormat?: ObservabilityChartFormat;
  legend?: boolean;
  area?: boolean;
};

/** Chart axes hand over a raw number, so each shared helper is adapted to that. */
const formatterFor = (format: ObservabilityChartFormat | undefined): ((value: number) => string) => {
  if (format === "bytes") return (value) => formatBytes(value);
  if (format === "datetime") return (value) => formatDateTime(new Date(value));
  return (value) => formatNumber(value);
};

export default function ObservabilityChart(props: ObservabilityChartProps) {
  const cls = () => props.class ?? "h-64 text-dimmed";

  if (props.kind === "line") {
    return (
      <Chart
        kind="line"
        class={cls()}
        series={props.series ?? []}
        xAxis={{ format: formatterFor(props.xFormat) }}
        yAxis={{ format: formatterFor(props.yFormat) }}
        legend={props.legend}
        area={props.area}
      />
    );
  }

  if (props.kind === "stateTimeline") {
    return (
      <Chart
        kind="stateTimeline"
        class={cls()}
        style={props.style}
        rows={props.rows ?? []}
        states={props.states}
        xAxis={{ format: formatterFor(props.xFormat) }}
        legend={props.legend}
      />
    );
  }

  if (props.kind === "bar") {
    return <Chart kind="bar" class={cls()} data={props.data ?? []} yAxis={{ format: formatterFor(props.yFormat) }} />;
  }

  return <Chart kind="donut" class={cls()} data={props.data ?? []} legend={props.legend} />;
}
