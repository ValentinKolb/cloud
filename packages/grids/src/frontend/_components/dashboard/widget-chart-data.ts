import type { BarItem, Point, Series, SliceItem } from "@valentinkolb/stdlib";
import type {
  AggregationSpec,
  ChartWidget,
  Field,
  GroupBySpec,
} from "../../../service";
import { dates } from "@valentinkolb/stdlib";

/**
 * Transforms `record.group()` buckets into the shapes the platform
 * `Chart` primitive expects. Pure functions — no DOM, no DB calls;
 * lives in this file so unit tests can hit every chart-type / edge
 * case without spinning up the resolver or hitting the SVG layer.
 *
 * Bucket shape produced by the group resolver:
 *
 * ```ts
 * { keys: unknown[]; values: Record<"<fieldId>__<agg>", unknown> }
 * ```
 *
 *  - `keys` is parallel to `widget.source.groupBy` (one entry per groupBy spec).
 *  - `values` keys are namespaced `${fieldId}__${agg}` (mirrors `record.aggregate()`).
 *    The shorthand `*` is used for COUNT(*).
 *
 * The transformers in this module take one bucket array + the
 * relevant widget metadata, and emit either a list of slices/bars
 * (donut, bar) or one-or-more series of points (line, scatter).
 */

/** Bucket shape as produced by `gridsService.record.group()`. */
export type ChartBucket = {
  keys: unknown[];
  values: Record<string, unknown>;
};

/** The same `${fieldId}__${agg}` key the server uses to namespace
 *  aggregation results inside `bucket.values`. */
export const aggKey = (spec: AggregationSpec): string => `${spec.fieldId}__${spec.agg}`;

/** Derive a human label for an aggregation — same precedence the
 *  view-stats resolver uses: explicit `.label` first, then a
 *  generated `agg(fieldName)` / `agg(*)` fallback. */
export const aggLabel = (
  spec: AggregationSpec,
  fieldsById: Map<string, Field>,
): string => {
  if (spec.label) return spec.label;
  if (spec.fieldId === "*") return `${spec.agg}(*)`;
  const field = fieldsById.get(spec.fieldId);
  return `${spec.agg}(${field?.name ?? "?"})`;
};

/** Coerce a bucket-value to a finite number, or null when it's
 *  missing / non-numeric. The group resolver returns strings for
 *  decimal aggregations (matching `record.aggregate()`), so we cast
 *  carefully and reject NaN / Infinity so the chart layer never sees
 *  a bad point. */
export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Render the first groupBy key of a bucket as a category label
 *  (donut / bar / line x-axis tick). Date-truncated keys come back
 *  as ISO strings — we format them with the matching readable form;
 *  numeric keys stringify natively; everything else falls back to
 *  `String(...)` with an em-dash for nullish. */
export const formatCategoryKey = (key: unknown, spec: GroupBySpec | undefined): string => {
  if (key === null || key === undefined) return "—";
  // Date-truncated groupBy → ISO date string. Pick a granularity-
  // appropriate format so a `month` axis doesn't waste pixels on
  // day/time noise. The `dates.formatDate` family is locale-aware.
  if (spec?.granularity && (typeof key === "string" || key instanceof Date)) {
    const granularity = spec.granularity;
    if (granularity === "year") {
      const d = new Date(key);
      return Number.isFinite(d.valueOf()) ? String(d.getUTCFullYear()) : String(key);
    }
    if (granularity === "month" || granularity === "quarter") {
      const d = new Date(key);
      if (!Number.isFinite(d.valueOf())) return String(key);
      // "Jan 2025" — concise for axis ticks, still unambiguous.
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
    }
    // day / week → 05 Mar 2025
    return dates.formatDate(key as string | Date);
  }
  return String(key);
};

/**
 * Donut / bar — both want `{label, value}[]`. Picks the first
 * aggregation as the value source (the renderer documents this
 * convention; multi-agg donuts don't make visual sense). Buckets
 * with non-numeric values are dropped silently — they'd render as
 * zero-area slices anyway.
 */
export const bucketsToSlices = (
  buckets: ChartBucket[],
  primaryAgg: AggregationSpec,
  groupBy: GroupBySpec | undefined,
): SliceItem[] => {
  const key = aggKey(primaryAgg);
  const items: SliceItem[] = [];
  for (const b of buckets) {
    const v = toNumber(b.values[key]);
    if (v === null) continue;
    items.push({ label: formatCategoryKey(b.keys[0], groupBy), value: v });
  }
  return items;
};

/** Bar items are structurally identical to slices — alias for
 *  callsite clarity (bar charts can carry negatives, donuts can't,
 *  but the shape itself is the same). */
export const bucketsToBars = (
  buckets: ChartBucket[],
  primaryAgg: AggregationSpec,
  groupBy: GroupBySpec | undefined,
): BarItem[] => bucketsToSlices(buckets, primaryAgg, groupBy) as BarItem[];

/**
 * Line — one `Series` per aggregation. x is the bucket index (0..N)
 * so categorical groupBys (strings, mixed types) work without
 * domain math; the renderer puts the category label on the x-axis
 * tick via a custom `xAxis.format` (see `chartXAxisFormat`).
 *
 * For numeric groupBys (e.g. a "year" field), the index-as-x makes
 * the line evenly spaced regardless of source spacing — semantically
 * "trend over ordered buckets", which is what dashboard line charts
 * almost always mean. True numeric x-axes (continuous quantities)
 * can come later with an explicit `xField` knob if a use case shows up.
 */
export const bucketsToLineSeries = (
  buckets: ChartBucket[],
  aggs: AggregationSpec[],
  fieldsById: Map<string, Field>,
): Series[] => {
  return aggs.map((agg) => {
    const key = aggKey(agg);
    const data: Point[] = [];
    buckets.forEach((b, idx) => {
      const y = toNumber(b.values[key]);
      if (y === null) return;
      data.push({ x: idx, y });
    });
    return { label: aggLabel(agg, fieldsById), data };
  });
};

/**
 * Scatter — needs ≥2 aggregations. x = first agg, y = second agg
 * per bucket. A third+ agg can become point size when set (bubble
 * scatter); two-agg minimum maps directly to a flat scatter.
 *
 * When fewer than 2 aggs are configured the function returns an
 * empty series array; the wrapping Chart shows its "No data"
 * placeholder instead of an axis-only blank.
 */
export const bucketsToScatterSeries = (
  buckets: ChartBucket[],
  aggs: AggregationSpec[],
  fieldsById: Map<string, Field>,
): Series[] => {
  if (aggs.length < 2) return [];
  const xKey = aggKey(aggs[0]!);
  const yKey = aggKey(aggs[1]!);
  const sizeKey = aggs[2] ? aggKey(aggs[2]) : null;
  const data: Point[] = [];
  for (const b of buckets) {
    const x = toNumber(b.values[xKey]);
    const y = toNumber(b.values[yKey]);
    if (x === null || y === null) continue;
    const size = sizeKey ? toNumber(b.values[sizeKey]) ?? undefined : undefined;
    data.push({ x, y, size });
  }
  const xLabel = aggLabel(aggs[0]!, fieldsById);
  const yLabel = aggLabel(aggs[1]!, fieldsById);
  return [{ label: `${yLabel} vs ${xLabel}`, data }];
};

/** Format-function for the x-axis tick numeric index, looking up the
 *  bucket key by position and rendering it via `formatCategoryKey`.
 *  Stdlib's `AxisOptions.format(v: number)` is called with each tick
 *  value — we round-trip the index back to a label. */
export const chartXAxisFormat = (
  buckets: ChartBucket[],
  groupBy: GroupBySpec | undefined,
): ((v: number) => string) => {
  return (v: number) => {
    const idx = Math.round(v);
    const bucket = buckets[idx];
    if (!bucket) return "";
    return formatCategoryKey(bucket.keys[0], groupBy);
  };
};

/**
 * Resolves the chartType-specific data + axis options bundle the
 * renderer hands straight to `<Chart kind=... />`. Splitting this
 * here keeps the renderer dumb (one switch on chartType) and the
 * transforms unit-testable in isolation.
 */
export type ChartRenderData =
  | { kind: "donut"; data: SliceItem[] }
  | { kind: "bar"; data: BarItem[] }
  | {
      kind: "line";
      series: Series[];
      xAxisFormat: (v: number) => string;
    }
  | { kind: "scatter"; series: Series[] };

export const buildChartRenderData = (
  widget: ChartWidget,
  buckets: ChartBucket[],
  fieldsById: Map<string, Field>,
): ChartRenderData => {
  const aggs = widget.source.aggregations;
  const groupBy = widget.source.groupBy?.[0];
  const primary = aggs[0]!;
  switch (widget.chartType) {
    case "donut":
      return { kind: "donut", data: bucketsToSlices(buckets, primary, groupBy) };
    case "bar":
      return { kind: "bar", data: bucketsToBars(buckets, primary, groupBy) };
    case "line":
      return {
        kind: "line",
        series: bucketsToLineSeries(buckets, aggs, fieldsById),
        xAxisFormat: chartXAxisFormat(buckets, groupBy),
      };
    case "scatter":
      return {
        kind: "scatter",
        series: bucketsToScatterSeries(buckets, aggs, fieldsById),
      };
  }
};
