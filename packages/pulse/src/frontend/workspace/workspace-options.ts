import type { FilterChipSection } from "@valentinkolb/cloud/ui";
import type { PulseDashboardConfig } from "../../contracts";
import type { RefreshIntervalOption } from "./types";

export const SOURCE_TYPE_OPTIONS = [
  { id: "http_ingest", label: "HTTP ingest", icon: "ti ti-webhook", description: "Push metrics, events, and states." },
  { id: "metrics", label: "Metrics endpoint", icon: "ti ti-plug", description: "Scrape a Prometheus-compatible endpoint." },
];

export const DASHBOARD_REFRESH_OPTIONS = [
  { id: "1", label: "Every 1 second", icon: "ti ti-player-play" },
  { id: "5", label: "Every 5 seconds", icon: "ti ti-refresh" },
  { id: "10", label: "Every 10 seconds", icon: "ti ti-refresh" },
  { id: "60", label: "Every minute", icon: "ti ti-clock" },
  { id: "never", label: "Never", icon: "ti ti-player-pause" },
];

export const refreshOptionFromConfig = (config: PulseDashboardConfig): RefreshIntervalOption =>
  config.refreshIntervalSeconds === null ? "never" : (String(config.refreshIntervalSeconds ?? 5) as RefreshIntervalOption);

export const refreshIntervalFromOption = (value: string): PulseDashboardConfig["refreshIntervalSeconds"] =>
  value === "never" ? null : value === "1" || value === "5" || value === "10" || value === "60" ? (Number(value) as 1 | 5 | 10 | 60) : 5;

export const VISUAL_OPTIONS = [
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "stat", label: "Stat", icon: "ti ti-number" },
  { id: "gauge", label: "Gauge", icon: "ti ti-gauge" },
  { id: "barGauge", label: "Bar gauge", icon: "ti ti-progress" },
  { id: "histogram", label: "Histogram", icon: "ti ti-chart-histogram" },
  { id: "heatmap", label: "Heatmap", icon: "ti ti-grid-dots" },
];

export const RESULT_VIEW_OPTIONS = [
  { id: "chart", label: "Chart", icon: "ti ti-chart-line" },
  { id: "table", label: "Table", icon: "ti ti-table" },
  { id: "compiled", label: "Compiled", icon: "ti ti-code" },
];

export const METRIC_TYPE_FILTER_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "gauge", label: "Gauge", icon: "ti ti-gauge" },
      { value: "counter", label: "Counter", icon: "ti ti-number" },
      { value: "histogram", label: "Histogram", icon: "ti ti-chart-histogram" },
      { value: "summary", label: "Summary", icon: "ti ti-chart-dots" },
    ],
  },
];
