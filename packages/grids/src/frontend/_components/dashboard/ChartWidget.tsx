import { Show } from "solid-js";
import { Chart } from "@valentinkolb/cloud/ui";
import type { Widget, Field } from "../../../service";
import type { WidgetData } from "./widget-data";
import { buildChartRenderData } from "./widget-chart-data";
import { formatWidgetValue } from "./widget-format";

type Props = {
  widget: Extract<Widget, { kind: "chart" }>;
  data: WidgetData;
};

/**
 * Renders a chart widget — pairs `<Chart>` from cloud/ui with the
 * `buildChartRenderData` transform that turns resolved buckets into
 * the per-kind shape stdlib charts expect.
 *
 * **Frame.** A flat `paper` container with a compact header (title +
 * optional subtitle). Same paper rhythm as `ChartWidgetStub` so the
 * dashboard layout stays unchanged.
 *
 * **Empty / error states.** If the resolver returned an error, we
 * surface the reason in red. If buckets resolved but ended up empty
 * (e.g. filter excluded everything), `<Chart>`'s own empty-state
 * placeholder takes over — no double "no data" message.
 *
 * **Y-axis format.** Used only by axis-based charts. Donut charts
 * have no axes, so the editor does not expose axis fields for them.
 */
export default function ChartWidget(props: Props) {
  const isChartData = () => props.data.kind === "chart";
  const errorReason = () =>
    props.data.kind === "error" ? props.data.reason : null;

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <header class="px-3 py-2 flex flex-col">
        <span class="text-xs font-semibold text-primary truncate">
          {props.widget.title ?? `${props.widget.chartType} chart`}
        </span>
        <Show when={props.widget.subtitle}>
          <span class="text-[10px] text-dimmed truncate">{props.widget.subtitle}</span>
        </Show>
      </header>

      <div class="flex-1 min-h-0 px-3 pb-3 flex flex-col text-dimmed">
        <Show
          when={isChartData()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-xs">
              <Show when={errorReason()} fallback={<span>Loading…</span>}>
                <span class="text-red-600 dark:text-red-400">{errorReason()}</span>
              </Show>
            </div>
          }
        >
          <ChartBody
            widget={props.widget}
            data={props.data as Extract<WidgetData, { kind: "chart" }>}
          />
        </Show>
      </div>
    </div>
  );
}

/**
 * Inner renderer — split out so `Show` can guard the `data.kind`
 * narrowing cleanly. Picks the chartType-specific options bundle
 * from `buildChartRenderData` and passes it through to `<Chart>`.
 */
function ChartBody(props: {
  widget: Extract<Widget, { kind: "chart" }>;
  data: Extract<WidgetData, { kind: "chart" }>;
}) {
  const fieldsById = () => new Map<string, Field>(props.data.fields.map((f) => [f.id, f]));
  const renderData = () =>
    buildChartRenderData({
      widget: props.widget,
      groupBy: props.data.viewQuery.groupBy,
      aggregations: props.data.viewQuery.aggregations,
      buckets: props.data.buckets,
      fieldsById: fieldsById(),
      relationLabels: props.data.relationLabels,
    });

  const yFormat = () => (v: number) => formatWidgetValue(v, props.widget.format);

  return (
    <Show
      when={renderData()}
      keyed
      fallback={<div class="flex-1 flex items-center justify-center text-xs">No data</div>}
    >
      {(rd) => {
        switch (rd.kind) {
          case "donut":
            return (
              <Chart
                kind="donut"
                class="flex-1 min-h-0"
                data={rd.data}
                showLabels
              />
            );
          case "bar":
            return (
              <Chart
                kind="bar"
                class="flex-1 min-h-0"
                data={rd.data}
                yAxis={{ format: yFormat(), label: props.widget.yAxisLabel }}
              />
            );
          case "line":
            return (
              <Chart
                kind="line"
                class="flex-1 min-h-0"
                series={rd.series}
                xAxis={{ format: rd.xAxisFormat, label: props.widget.xAxisLabel }}
                yAxis={{ format: yFormat(), label: props.widget.yAxisLabel }}
                legend={rd.series.length > 1}
                smooth
              />
            );
          case "scatter":
            return (
              <Chart
                kind="scatter"
                class="flex-1 min-h-0"
                series={rd.series}
                xAxis={{ label: props.widget.xAxisLabel }}
                yAxis={{ format: yFormat(), label: props.widget.yAxisLabel }}
              />
            );
        }
      }}
    </Show>
  );
}
