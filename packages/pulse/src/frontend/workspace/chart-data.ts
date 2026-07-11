import type { DateContext } from "@valentinkolb/stdlib";
import type { DataTableColumn } from "@valentinkolb/cloud/ui";
import type { MetricQueryPoint } from "../../contracts";
import { compactDate, compactDateWithDelta, compactDay } from "./date-format";
import { formatValue } from "./metric-format";

export const pointsToBars = (points: MetricQueryPoint[], context?: DateContext) =>
  points.slice(-48).map((point) => ({
    label: compactDate(point.bucket, context),
    value: point.value ?? 0,
  }));

export const pointsToHistogram = (points: MetricQueryPoint[]) =>
  points.map((point) => point.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

export const pointsToHeatmap = (points: MetricQueryPoint[], context?: DateContext) =>
  points.slice(-240).map((point) => {
    const date = new Date(point.bucket);
    return {
      x: compactDate(date.toISOString(), context).slice(0, 2),
      y: compactDay(point.bucket, context),
      value: point.value ?? 0,
    };
  });

export const queryPointColumns: DataTableColumn<MetricQueryPoint>[] = [
  { id: "bucket", header: "Bucket", value: (point) => compactDateWithDelta(point.bucket), cellClass: "w-48 whitespace-nowrap" },
  { id: "value", header: "Value", value: (point) => formatValue(point.value), cellClass: "w-32 whitespace-nowrap" },
];
