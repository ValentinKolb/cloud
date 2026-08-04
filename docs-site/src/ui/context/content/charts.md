# Chart

`Chart` renders typed chart data as responsive SVG. The caller owns the data, query, time range, labels, units, and surrounding explanation.

## Use Chart

Use it to show a trend, distribution, comparison, geographic series, or state history.

Use `StatCell` for one value. Use `DataTable` when readers need exact records rather than a visual summary.

## Import

```tsx
import {
  Chart,
  type ChartLabels,
  type ChartKind,
  type ChartProps,
  RangePicker,
  type RangeOption,
  type RangePickerProps,
  type StateTimelineChartOptions,
  type StateTimelineDomain,
  type StateTimelineInterval,
  type StateTimelineRow,
  type StateTimelineState,
} from "@k2b/ui";
```

## Chart kinds

`kind` selects the data and options accepted by the underlying chart:

- `line`, `scatter`, and `sparkline` for series;
- `bar`, `pie`, and `donut` for category values;
- `histogram` and `boxplot` for distributions;
- `gauge`, `barGauge`, and `stat` for bounded values;
- `heatmap` and `map` for spatial values;
- `stateTimeline` for intervals with discrete states.

TypeScript narrows the remaining properties from `kind`. `width` and `height` are removed from the accepted chart options: the component measures its own box and draws the SVG to fill it.

## Data and sizing

The wrapper is a plain block with no intrinsic height, so the caller sets it — `style={{ height: "14rem" }}` or an application class. The exception is `stateTimeline`, which derives its height from the row count. Axes inherit `currentColor`; series use the shared chart color variables.

Empty series render a visible **No data** state. Keep loading and query errors outside the component so they are not confused with an empty result.

`labels` localizes package-owned text such as the empty state, series fallback,
interactive region names, zoom controls, and reset controls. Pass labels from
the host when the application is localized; the component never reads the
browser locale during SSR.

`interactive` is available for maps, line charts, and state timelines. Use it
only when inspection, pan, or zoom improves the task.

Interactive line charts expose the nearest point through pointer and keyboard
inspection. Interactive maps use the supplied viewport as their reset point
and keep pan and zoom within geographic bounds.

State timelines use `StateTimelineRow` values containing bounded
`StateTimelineInterval` ranges. `domain` fixes the complete data range;
otherwise the chart derives it from the intervals. State definitions provide
visible labels and semantic colors. Row and interval `href` values remain
native links.

`StateTimelineChartOptions`, `StateTimelineDomain`,
`StateTimelineInterval`, `StateTimelineRow`, and `StateTimelineState` expose
the complete timeline contract for shared data builders.

## URL-owned ranges

`RangePicker` renders a small set of native range links. Each `RangeOption`
contains `value`, `href`, and an optional label. The selected value receives
`aria-current`.

Use it beside a chart when the server owns the query window:

```tsx
<RangePicker
  value="24h"
  options={[
    { value: "1h", href: "?window=1h" },
    { value: "24h", href: "?window=24h" },
  ]}
/>
```

## Accessibility

Interactive charts support keyboard inspection or navigation. Interactive maps and state timelines additionally expose named zoom-in, zoom-out, and reset controls; interactive line charts have no zoom, only point inspection. Labels and SVG titles remain available when the browser cannot show the enhanced tooltip.

Always provide the same conclusion in text. Do not make color, pointer hover, or the chart itself the only source of a status or exact value.

## Runtime

The initial SVG renders on the server at a stable default size. After hydration, a `ResizeObserver` measures the container and rebuilds the SVG at its actual dimensions.

Reactive data rebuilds the complete SVG. This suits dashboard polling and normal realtime updates, not frame-by-frame animation.

Interactive charts require hydration. Static charts remain readable in the server response.

## Example

```tsx
<Chart
  kind="line"
  style={{ height: "14rem" }}
  series={[
    {
      label: "Requests",
      data: [
        { x: 1, y: 42 },
        { x: 2, y: 51 },
        { x: 3, y: 47 },
      ],
    },
  ]}
  xAxis={{ format: (value) => `${value}h` }}
  yAxis={{ format: (value) => `${value} req/s` }}
  legend
  smooth
  interactive
/>
```

```tsx
<Chart
  kind="map"
  style={{ height: "16rem" }}
  series={[
    {
      label: "Requests",
      data: [
        { latitude: 52.52, longitude: 13.405, label: "Berlin" },
      ],
    },
  ]}
  interactive
/>

<Chart
  kind="stateTimeline"
  rows={[
    {
      label: "Worker",
      intervals: [
        { from: 0, to: 4, state: "ok", tooltip: "Succeeded" },
      ],
    },
  ]}
  states={[{ state: "ok", label: "Healthy", color: "#10b981" }]}
  domain={[0, 10]}
  interactive
/>
```
