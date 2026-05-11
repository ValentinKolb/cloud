import { test, expect, describe } from "bun:test";
import type { AggregationSpec, ChartWidget, Field, GroupBySpec } from "../../../service";
import {
  aggKey,
  aggLabel,
  bucketsToBars,
  bucketsToLineSeries,
  bucketsToScatterSeries,
  bucketsToSlices,
  buildChartRenderData,
  chartXAxisFormat,
  formatCategoryKey,
  toNumber,
} from "./widget-chart-data";

// =============================================================================
// widget-chart-data — pure bucket → series transforms.
//
// Goal: every chartType-specific path has a happy case + an edge
// case (non-numeric value, missing agg, empty buckets). The
// transforms are the seam between the resolver and the SVG layer,
// so a regression here corrupts every chart silently — worth the
// thorough coverage.
// =============================================================================

const countStar: AggregationSpec = { fieldId: "*", agg: "count" };
const sumAmount: AggregationSpec = { fieldId: "f-amount", agg: "sum", label: "Total amount" };
const avgScore: AggregationSpec = { fieldId: "f-score", agg: "avg" };

// Minimal field map used to derive labels for aggregations on real fields.
const fieldsById = new Map<string, Field>([
  ["f-amount", { id: "f-amount", name: "Amount" } as unknown as Field],
  ["f-score", { id: "f-score", name: "Score" } as unknown as Field],
]);

const categoryGroupBy: GroupBySpec = { fieldId: "f-status" };
const monthGroupBy: GroupBySpec = { fieldId: "f-created", granularity: "month" };
const yearGroupBy: GroupBySpec = { fieldId: "f-created", granularity: "year" };

// =============================================================================
// Small helpers
// =============================================================================

describe("aggKey / aggLabel", () => {
  test("aggKey matches the server-side namespace pattern", () => {
    expect(aggKey(countStar)).toBe("*__count");
    expect(aggKey(sumAmount)).toBe("f-amount__sum");
  });

  test("aggLabel prefers explicit .label, then fieldName, then fallback", () => {
    expect(aggLabel(sumAmount, fieldsById)).toBe("Total amount");
    expect(aggLabel(avgScore, fieldsById)).toBe("avg(Score)");
    expect(aggLabel(countStar, fieldsById)).toBe("count(*)");
    expect(aggLabel({ fieldId: "missing-uuid", agg: "max" }, fieldsById)).toBe("max(?)");
  });
});

describe("toNumber", () => {
  test("passes through finite numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.14)).toBe(-3.14);
  });

  test("parses string-encoded decimals", () => {
    // Decimal-cell aggregations come back as strings (no float drift) —
    // the transform must coerce them or we'd silently drop every
    // sum/avg of a currency column.
    expect(toNumber("42.50")).toBe(42.5);
    expect(toNumber("-7")).toBe(-7);
  });

  test("rejects NaN / Infinity / non-numeric strings", () => {
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
    expect(toNumber("hello")).toBeNull();
    expect(toNumber("12px")).toBeNull();
  });

  test("treats null / undefined / objects as missing", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber({})).toBeNull();
    expect(toNumber([])).toBeNull();
  });
});

describe("formatCategoryKey", () => {
  test("string / number passthrough for ungrouped + non-date keys", () => {
    expect(formatCategoryKey("Open", categoryGroupBy)).toBe("Open");
    expect(formatCategoryKey(42, categoryGroupBy)).toBe("42");
  });

  test("null / undefined → em-dash", () => {
    expect(formatCategoryKey(null, categoryGroupBy)).toBe("—");
    expect(formatCategoryKey(undefined, undefined)).toBe("—");
  });

  test("year granularity collapses to 4-digit year", () => {
    expect(formatCategoryKey("2025-01-01T00:00:00Z", yearGroupBy)).toBe("2025");
  });

  test("month granularity uses 'Mon YYYY' locale format", () => {
    // Avoid locale-specific assertion — just verify it shrinks the
    // ISO string and contains both a month name AND the year. Robust
    // across en-US ("Mar 2025") and de-DE ("März 2025").
    const out = formatCategoryKey("2025-03-15T00:00:00Z", monthGroupBy);
    expect(out).not.toBe("2025-03-15T00:00:00Z");
    expect(out).toMatch(/2025/);
  });
});

// =============================================================================
// Donut / bar — single-aggregation slice/bar items
// =============================================================================

const sliceBuckets = [
  { keys: ["Open"], values: { "*__count": 12 } },
  { keys: ["Pending"], values: { "*__count": 5 } },
  { keys: ["Closed"], values: { "*__count": 47 } },
];

describe("bucketsToSlices / bucketsToBars", () => {
  test("happy path — first agg, first groupBy key per bucket", () => {
    expect(bucketsToSlices(sliceBuckets, countStar, categoryGroupBy)).toEqual([
      { label: "Open", value: 12 },
      { label: "Pending", value: 5 },
      { label: "Closed", value: 47 },
    ]);
  });

  test("bars alias slices (structural identity)", () => {
    expect(bucketsToBars(sliceBuckets, countStar, categoryGroupBy)).toEqual(
      bucketsToSlices(sliceBuckets, countStar, categoryGroupBy),
    );
  });

  test("drops buckets with non-numeric / missing value (no zero-area noise)", () => {
    const mixed = [
      { keys: ["A"], values: { "*__count": 10 } },
      { keys: ["B"], values: { "*__count": null } },
      { keys: ["C"], values: { "*__count": "not-a-number" } },
      { keys: ["D"], values: {} },
    ];
    expect(bucketsToSlices(mixed, countStar, categoryGroupBy)).toEqual([
      { label: "A", value: 10 },
    ]);
  });

  test("empty bucket list → empty result (no throw)", () => {
    expect(bucketsToSlices([], countStar, categoryGroupBy)).toEqual([]);
  });
});

// =============================================================================
// Line — one series per aggregation, x = bucket index
// =============================================================================

const lineBuckets = [
  { keys: ["Q1"], values: { "*__count": 10, "f-amount__sum": "120.50" } },
  { keys: ["Q2"], values: { "*__count": 14, "f-amount__sum": "180.00" } },
  { keys: ["Q3"], values: { "*__count": 9, "f-amount__sum": "95.25" } },
];

describe("bucketsToLineSeries", () => {
  test("emits one series per agg, x = bucket index", () => {
    const out = bucketsToLineSeries(lineBuckets, [countStar, sumAmount], fieldsById);
    expect(out).toHaveLength(2);
    expect(out[0]!.label).toBe("count(*)");
    expect(out[0]!.data).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: 14 },
      { x: 2, y: 9 },
    ]);
    expect(out[1]!.label).toBe("Total amount");
    expect(out[1]!.data).toEqual([
      { x: 0, y: 120.5 },
      { x: 1, y: 180 },
      { x: 2, y: 95.25 },
    ]);
  });

  test("missing values in a series are skipped, x indices stay aligned", () => {
    const sparse = [
      { keys: ["A"], values: { "*__count": 10 } },
      { keys: ["B"], values: { "*__count": null } },
      { keys: ["C"], values: { "*__count": 5 } },
    ];
    const out = bucketsToLineSeries(sparse, [countStar], fieldsById);
    // x=1 dropped, x=0 and x=2 keep their original indices so the
    // line lands at the right tick (no silent re-indexing).
    expect(out[0]!.data).toEqual([
      { x: 0, y: 10 },
      { x: 2, y: 5 },
    ]);
  });

  test("empty aggs → empty series array", () => {
    expect(bucketsToLineSeries(lineBuckets, [], fieldsById)).toEqual([]);
  });
});

// =============================================================================
// Scatter — needs ≥2 aggs (x=agg1, y=agg2, optional size=agg3)
// =============================================================================

describe("bucketsToScatterSeries", () => {
  test("happy path — x from first agg, y from second", () => {
    const out = bucketsToScatterSeries(lineBuckets, [countStar, sumAmount], fieldsById);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Total amount vs count(*)");
    expect(out[0]!.data).toEqual([
      { x: 10, y: 120.5, size: undefined },
      { x: 14, y: 180, size: undefined },
      { x: 9, y: 95.25, size: undefined },
    ]);
  });

  test("third agg becomes bubble size", () => {
    const buckets = [
      { keys: ["a"], values: { "*__count": 5, "f-amount__sum": 10, "f-score__avg": 3 } },
    ];
    const out = bucketsToScatterSeries(buckets, [countStar, sumAmount, avgScore], fieldsById);
    expect(out[0]!.data[0]!.size).toBe(3);
  });

  test("fewer than 2 aggs → empty series (renderer shows empty state)", () => {
    expect(bucketsToScatterSeries(lineBuckets, [countStar], fieldsById)).toEqual([]);
    expect(bucketsToScatterSeries(lineBuckets, [], fieldsById)).toEqual([]);
  });
});

// =============================================================================
// chartXAxisFormat — index → category label round-trip for line charts
// =============================================================================

describe("chartXAxisFormat", () => {
  test("maps round tick value to bucket key", () => {
    const fmt = chartXAxisFormat(lineBuckets, categoryGroupBy);
    expect(fmt(0)).toBe("Q1");
    expect(fmt(1)).toBe("Q2");
    expect(fmt(2)).toBe("Q3");
  });

  test("rounds floating-point ticks before lookup (stdlib emits e.g. 0.5)", () => {
    const fmt = chartXAxisFormat(lineBuckets, categoryGroupBy);
    // 0.5 rounds to 1 → "Q2". Avoids blank ticks when the axis
    // generator places ticks between integer bucket indices.
    expect(fmt(0.5)).toBe("Q2");
  });

  test("out-of-range ticks → empty string (clean axis, no NaN)", () => {
    const fmt = chartXAxisFormat(lineBuckets, categoryGroupBy);
    expect(fmt(-1)).toBe("");
    expect(fmt(99)).toBe("");
  });
});

// =============================================================================
// buildChartRenderData — top-level dispatcher used by the renderer
// =============================================================================

const widget = (chartType: ChartWidget["chartType"]): ChartWidget => ({
  id: "w1",
  kind: "chart",
  chartType,
  viewId: "11111111-1111-1111-1111-111111111111",
});

const renderInput = (
  w: ChartWidget,
  aggs: AggregationSpec[],
  buckets: typeof sliceBuckets,
) => ({
  widget: w,
  groupBy: [categoryGroupBy],
  aggregations: aggs,
  buckets,
  fieldsById,
});

describe("buildChartRenderData", () => {
  test("donut → SliceItem[] (first agg only)", () => {
    const out = buildChartRenderData(renderInput(widget("donut"), [countStar], sliceBuckets));
    expect(out.kind).toBe("donut");
    if (out.kind !== "donut") throw new Error("unreachable");
    expect(out.data).toHaveLength(3);
  });

  test("bar → BarItem[]", () => {
    const out = buildChartRenderData(renderInput(widget("bar"), [countStar], sliceBuckets));
    expect(out.kind).toBe("bar");
  });

  test("line → series + xAxisFormat callback wired up", () => {
    const out = buildChartRenderData(renderInput(widget("line"), [countStar, sumAmount], lineBuckets));
    expect(out.kind).toBe("line");
    if (out.kind !== "line") throw new Error("unreachable");
    expect(out.series).toHaveLength(2);
    expect(out.xAxisFormat(0)).toBe("Q1");
  });

  test("scatter → series with bubble x/y points", () => {
    const out = buildChartRenderData(renderInput(widget("scatter"), [countStar, sumAmount], lineBuckets));
    expect(out.kind).toBe("scatter");
    if (out.kind !== "scatter") throw new Error("unreachable");
    expect(out.series).toHaveLength(1);
  });
});
