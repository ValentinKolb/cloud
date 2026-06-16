import { dates, type DateContext } from "@valentinkolb/stdlib";
import type { DataTableColumn, FilterChipSection } from "@valentinkolb/cloud/ui";
import type {
  MetricQueryPoint,
  MetricType,
  PanelVisual,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardMetricWidget,
  PulseDashboardPanel,
  PulseDashboardSection,
  PulseDashboardWidget,
  PulseMetricSeries,
  PulseRecordedEvent,
  PulseSource,
} from "../../contracts";
import { derivePulseResource, pulseResourceKey, pulseSignalSubject } from "../../resource-model";
import type { QueryHistoryEntry, RefreshIntervalOption } from "./types";
export { emptyActivityQueryState, readActivityQueryState, readWorkspacePathState } from "./routes";

export const suggestionTagClass =
  "chip max-w-full cursor-pointer border-0 transition hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-200";
export const FOCUSED_PAGE_SIZE = 100;

export type PulseDateContext = DateContext & { now?: string | Date };

export const defaultPulseDateContext: PulseDateContext = {
  timeZone: "UTC",
  locale: "en",
  firstDayOfWeek: 1,
};

const dateContext = (context?: DateContext): DateContext => ({
  ...defaultPulseDateContext,
  ...(context ?? {}),
});

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
};

export const jsonFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await readError(response, "Request failed"));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return JSON.parse(text) as T;
};

export const compactDate = (value: string, context?: DateContext) => {
  const resolved = dateContext(context);
  if (resolved.timeZone) return dates.instantToZonedInput(value, resolved.timeZone).slice(11, 16);
  return new Intl.DateTimeFormat(resolved.locale ?? "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export const compactDay = (value: string, context?: DateContext) => {
  const resolved = dateContext(context);
  return new Intl.DateTimeFormat(resolved.locale ?? "en", {
    timeZone: resolved.timeZone,
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
};

export const compactDateWithDelta = (value: string, context?: PulseDateContext) => {
  const resolved = dateContext(context);
  return `${compactDate(value, resolved)} (${dates.formatTimeSpan(value, context?.now ?? new Date(), resolved)})`;
};

export const normalizeEndpointInput = (value: string): string =>
  /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;

export const openQueryReferenceWindow = (baseId: string | null | undefined, options: { dashboardDsl?: boolean } = {}) => {
  if (!baseId || typeof window === "undefined") return;
  const params = options.dashboardDsl ? "?dashboardDsl=1" : "";
  window.open(
    `/app/pulse/${encodeURIComponent(baseId)}/query-reference${params}`,
    "pulse-query-reference",
    "popup,width=1180,height=840,resizable=yes,scrollbars=yes",
  );
};

export const formatIngestCounts = (counts: { metrics: number; events: number; states: number }): string =>
  [
    `${counts.metrics} metric${counts.metrics === 1 ? "" : "s"}`,
    `${counts.events} event${counts.events === 1 ? "" : "s"}`,
    `${counts.states} state${counts.states === 1 ? "" : "s"}`,
  ].join(", ");

export const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;

export const parseScrapeInterval = (value: string | null | undefined): number => {
  const parsed = Number(value?.trim() || "60");
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(86_400, Math.max(10, Math.round(parsed)));
};

export const stateRowId = (state: PulseCurrentState): string =>
  [state.key, state.sourceId ?? "", state.entityId, JSON.stringify(state.dimensions)].join(":");

export const eventGroupId = (event: PulseRecordedEvent): string => [event.kind, signalSubject(event)].join(":");

export const stateGroupId = (state: PulseCurrentState): string => [state.key, state.sourceId ?? ""].join(":");

export const panelQuery = (baseId: string, panel: PulseDashboardPanel) => ({
  kind: "metric" as const,
  baseId,
  metric: panel.metric,
  aggregation: panel.aggregation,
  bucket: panel.bucket,
  since: panel.since,
  sourceId: panel.sourceId ?? null,
  dimensions: panel.dimensions ?? undefined,
});

export const formatValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

export const formatSignalValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatValue(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
};

export const gaugeMax = (unit: string | null, value: number): number => {
  if (unit === "%") return 100;
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
};

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

export const seriesLabel = (series: PulseMetricSeries, sourceName?: string): string => {
  const important = ["instance", "host", "node", "device", "mountpoint", "vmid", "name", "job"]
    .map((key) => (series.dimensions[key] ? `${key}=${series.dimensions[key]}` : null))
    .filter(Boolean);
  const label =
    important.length > 0
      ? important.join(", ")
      : series.entityId ||
        Object.entries(series.dimensions)
          .slice(0, 3)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ");
  return [sourceName, label || series.id.slice(0, 8)].filter(Boolean).join(" · ");
};

export const quoteQueryPart = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

export const resourceKey = pulseResourceKey;

export const signalResourceId = (params: {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
}): string | null => derivePulseResource({ signalName: params.metric ?? params.key ?? params.kind, ...params })?.id ?? null;

export const signalResourceType = (params: {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
}): string | null => derivePulseResource({ signalName: params.metric ?? params.key ?? params.kind, ...params })?.type ?? null;

export const signalResourceKey = (params: {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
}): string | null => derivePulseResource({ signalName: params.metric ?? params.key ?? params.kind, ...params })?.key ?? null;

export const signalSubject = (params: {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
}): string => pulseSignalSubject({ signalName: params.metric ?? params.key ?? params.kind, ...params });

export const dimensionsSummary = (dimensions: Record<string, string>, limit = 3): string =>
  Object.entries(dimensions)
    .filter(([key]) => !["host", "instance", "collector"].includes(key))
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");

export const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

export const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

export const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

export const dashboardMetricPanels = (config: PulseDashboardConfig): PulseDashboardPanel[] => [
  ...config.panels,
  ...dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric"),
];

export const quoteDashboardDslString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const visualStatement = (visual: PanelVisual): string => (visual === "line" ? "chart" : visual);

export const panelToDashboardDsl = (panel: PulseDashboardPanel): string => {
  const source = panel.sourceId ? ` source ${panel.sourceId}` : "";
  const dimensions = Object.entries(panel.dimensions ?? {});
  const where = dimensions.length ? ` where ${dimensions.map(([key, value]) => `${key}=${quoteQueryPart(String(value))}`).join(", ")}` : "";
  return `    ${visualStatement(panel.visual)} ${quoteDashboardDslString(panel.title)} {
      query metric ${panel.metric} ${panel.aggregation} every ${panel.bucket} since ${panel.since}${source}${where}
    }`;
};

export const dashboardToDsl = (dashboard: PulseDashboard): string => {
  if (dashboard.config.dsl?.trim()) return dashboard.config.dsl;
  const panelBlocks = dashboard.config.panels.length
    ? dashboard.config.panels.map(panelToDashboardDsl).join("\n\n")
    : `    markdown "Start here" {
      """
      Add cards, charts, tables, and notes with the Pulse dashboard DSL.
      """
    }`;
  return `dashboard ${quoteDashboardDslString(dashboard.name)} {
  description "Live Pulse dashboard."

  section "Overview" {
${panelBlocks}
  }
}`;
};

const queryHistoryKey = (baseId: string): string => `pulse.queryHistory.${baseId}`;

export const readQueryHistory = (baseId: string): QueryHistoryEntry[] => {
  if (!baseId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queryHistoryKey(baseId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is QueryHistoryEntry => typeof item?.query === "string" && typeof item?.ranAt === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

export const writeQueryHistory = (baseId: string, history: QueryHistoryEntry[]) => {
  if (!baseId || typeof window === "undefined") return;
  window.localStorage.setItem(queryHistoryKey(baseId), JSON.stringify(history.slice(0, 20)));
};

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

export const sourceKindIcon = (kind: PulseSource["kind"]): string => {
  if (kind === "http_ingest") return "ti ti-webhook";
  if (kind === "metrics") return "ti ti-plug";
  return "ti ti-database-share";
};

export const sourceStatus = (source: PulseSource) => {
  if (!source.enabled) return { label: "Paused", dot: "bg-zinc-400", text: "text-dimmed", icon: "ti ti-player-pause" };
  if (source.lastError) return { label: "Error", dot: "bg-red-500", text: "text-red-600 dark:text-red-300", icon: "ti ti-alert-circle" };
  if (source.lastSeenAt)
    return { label: "Healthy", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", icon: "ti ti-check" };
  return { label: "Waiting", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", icon: "ti ti-clock" };
};

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
