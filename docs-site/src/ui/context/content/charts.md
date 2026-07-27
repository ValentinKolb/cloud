# Chart

`Chart` renders typed chart data as responsive SVG. The caller owns the data, query, time range, labels, units, and surrounding explanation.

## Use Chart

Use it to show a trend, distribution, comparison, geographic series, or state history.

Use `StatCell` for one value. Use `DataTable` when readers need exact records rather than a visual summary.

## Import

```tsx
import {
  Chart,
  type ChartProps,
} from "@valentinkolb/cloud/ui";
```

## Chart kinds

`kind` selects the data and options accepted by the underlying chart:

- `line`, `scatter`, and `sparkline` for series;
- `bar`, `pie`, and `donut` for category values;
- `histogram` and `boxplot` for distributions;
- `gauge`, `barGauge`, and `stat` for bounded values;
- `heatmap` and `map` for spatial values;
- `stateTimeline` for intervals with discrete states.

TypeScript narrows the remaining properties from `kind`. The component derives its width and height, so do not pass dimensions as chart options.

## Data and sizing

Set the available size on the component itself, for example `class="h-56 w-full"`. Axes inherit `currentColor`; series use the shared chart color variables.

Empty series render a visible **No data** state. Keep loading and query errors outside the component so they are not confused with an empty result.

`interactive` is available for maps, line charts, and state timelines. Use it only when inspection, pan, or zoom improves the task.

## Accessibility

Interactive charts support keyboard inspection or navigation and expose named controls for zoom and reset. Labels and SVG titles remain available when the browser cannot show the enhanced tooltip.

Always provide the same conclusion in text. Do not make color, pointer hover, or the chart itself the only source of a status or exact value.

## Runtime

The initial SVG renders on the server at a stable default size. After hydration, a `ResizeObserver` measures the container and rebuilds the SVG at its actual dimensions.

Reactive data rebuilds the complete SVG. This suits dashboard polling and normal realtime updates, not frame-by-frame animation.

Interactive charts require hydration. Static charts remain readable in the server response.

## Example

```tsx
<Chart
  kind="line"
  class="h-56 w-full text-dimmed"
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
/>
```
