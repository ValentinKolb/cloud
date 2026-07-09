import { dates, text, type DateContext } from "@valentinkolb/stdlib";
import type { DataTableColumn, FilterChipSection } from "@valentinkolb/cloud/ui";
import type {
  MetricQueryPoint,
  MetricType,
  PanelVisual,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardEventQuery,
  PulseDashboardEventsWidget,
  PulseDashboardMetricQuery,
  PulseDashboardMetricWidget,
  PulseDashboardSection,
  PulseDashboardStateQuery,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseExplorerQuery,
  PulseRecordedEvent,
  PulseSource,
} from "../../contracts";
import { derivePulseResource, pulseResourceKey, pulseSignalSubject } from "../../resource-model";
import type { QueryHistoryEntry, RefreshIntervalOption } from "./types";

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

const queryFiltersToText = (query: PulseDashboardMetricQuery | PulseDashboardEventQuery | PulseDashboardStateQuery): string => {
  const source = query.sourceId ? ` source ${query.sourceId}` : "";
  const entity = query.entityId ? ` entity ${quoteQueryPart(query.entityId)}` : "";
  const entityType = query.entityType ? ` entity_type ${quoteQueryPart(query.entityType)}` : "";
  const dimensions = Object.entries(query.dimensions ?? {});
  const where = dimensions.length ? ` where ${dimensions.map(([key, value]) => `${key}=${quoteQueryPart(String(value))}`).join(", ")}` : "";
  const limit = query.kind === "events" || query.kind === "states" ? ` limit ${query.limit}` : "";
  return `${source}${entity}${entityType}${where}${limit}`;
};

export const dashboardMetricQueryText = (query: PulseDashboardMetricQuery): string =>
  `metric ${query.metric} ${query.aggregation} every ${query.bucket} since ${query.since}${queryFiltersToText(query)}`;

export const dashboardEventQueryText = (query: PulseDashboardEventQuery): string =>
  `events ${query.event ?? "*"} since ${query.since}${queryFiltersToText(query)}`;

export const dashboardStateQueryText = (query: PulseDashboardStateQuery): string =>
  `states ${query.state ?? "*"}${query.since ? ` since ${query.since}` : ""}${queryFiltersToText(query)}`;

const trimFixed = (value: number, fractionDigits: number): string => {
  const fixed = value.toFixed(fractionDigits);
  return fractionDigits === 0 ? fixed : fixed.replace(/\.?0+$/, "");
};

export const formatValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "0";
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  if (Math.abs(value) >= 100) return trimFixed(value, 0);
  if (Math.abs(value) >= 10) return trimFixed(value, 1);
  if (Math.abs(value) >= 1) return trimFixed(value, 2);
  if (Math.abs(value) >= 0.01) return trimFixed(value, 3);
  return trimFixed(value, 4);
};

type MetricUnitKind = "bytes" | "count" | "milliseconds" | "percent" | "seconds" | "unknown";

const metricUnitKind = (unit: string | null | undefined): MetricUnitKind => {
  const normalized = unit?.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "%" || normalized === "percent" || normalized === "percentage") return "percent";
  if (normalized === "count" || normalized === "counts") return "count";
  if (normalized === "byte" || normalized === "bytes" || normalized === "b") return "bytes";
  if (normalized === "second" || normalized === "seconds" || normalized === "sec" || normalized === "secs" || normalized === "s") return "seconds";
  if (normalized === "millisecond" || normalized === "milliseconds" || normalized === "ms") return "milliseconds";
  return "unknown";
};

export const compactMetricUnit = (unit: string | null | undefined): string | undefined => {
  const value = unit?.trim();
  if (!value) return undefined;
  const kind = metricUnitKind(value);
  if (kind === "percent") return "%";
  if (kind === "count") return undefined;
  if (kind === "bytes") return "B";
  if (kind === "seconds") return "s";
  if (kind === "milliseconds") return "ms";
  return value;
};

const formatSeconds = (seconds: number): string => {
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  if (absolute < 1) return `${sign}${formatValue(absolute * 1000)}ms`;
  if (absolute < 60) return `${sign}${formatValue(absolute)}s`;

  const totalSeconds = Math.round(absolute);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (days > 0) return `${sign}${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${sign}${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${sign}${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ""}`;
};

export const formatMetricValue = (value: number | null | undefined, unit?: string | null): string => {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  const kind = metricUnitKind(unit);
  if (kind === "percent") return `${trimFixed(value, Math.abs(value) >= 100 ? 0 : 2)}%`;
  if (kind === "count") return formatValue(value);
  if (kind === "bytes") return `${value < 0 ? "-" : ""}${text.pprintBytes(Math.abs(value))}`;
  if (kind === "seconds") return formatSeconds(value);
  if (kind === "milliseconds") return formatSeconds(value / 1000);
  const compactUnit = compactMetricUnit(unit);
  return compactUnit ? `${formatValue(value)} ${compactUnit}` : formatValue(value);
};

export const formatSignalValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatValue(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
};

export const gaugeMax = (unit: string | null, value: number): number => {
  if (metricUnitKind(unit) === "percent") return 100;
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
};

const dashboardAutoSpan = (cellCount: number): number => {
  if (cellCount <= 1) return 12;
  if (cellCount === 2) return 6;
  if (cellCount === 3) return 4;
  return 3;
};

export const dashboardCellSpan = (span: number | null | undefined, cellCount: number): number =>
  Math.min(12, Math.max(1, span ?? dashboardAutoSpan(cellCount)));

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

export const quoteQueryPart = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const resourceKey = pulseResourceKey;

const signalResourceId = (params: {
  metric?: string;
  key?: string;
  kind?: string;
  entityId?: string | null;
  entityType?: string | null;
  sourceId?: string | null;
  dimensions: Record<string, string>;
}): string | null => derivePulseResource({ signalName: params.metric ?? params.key ?? params.kind, ...params })?.id ?? null;

const signalResourceType = (params: {
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

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

export const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

export const dashboardMetricWidgets = (config: PulseDashboardConfig): PulseDashboardMetricWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric");

export const dashboardEventsWidgets = (config: PulseDashboardConfig) =>
  dashboardLayoutWidgets(config).filter((widget) => widget.kind === "events");

export const dashboardStatesWidgets = (config: PulseDashboardConfig) =>
  dashboardLayoutWidgets(config).filter((widget) => widget.kind === "states");

export const quoteDashboardDslString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const dashboardVisualStatement = (visual: PanelVisual): string => visual;

export const dashboardQueryLine = (query: string): string => {
  let output = "";
  let pendingSpace = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    if (quote) {
      output += char;
      if (char === "\\" && index + 1 < query.length) {
        index += 1;
        output += query[index]!;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      if (pendingSpace && output) output += " ";
      pendingSpace = false;
      quote = char;
      output += char;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output) output += " ";
    pendingSpace = false;
    output += char;
  }
  return output.trim();
};

export const dashboardWidgetSnippetFromQuery = (query: string, compiled: PulseExplorerQuery, visual: PanelVisual): string => {
  const normalizedQuery = dashboardQueryLine(query);
  if (compiled.kind === "metric") {
    return `${dashboardVisualStatement(visual)} ${quoteDashboardDslString(compiled.metric)} {\n  query ${normalizedQuery}\n}`;
  }
  if (compiled.kind === "events") {
    return `table ${quoteDashboardDslString(compiled.event || "Events")} {\n  query ${normalizedQuery}\n}`;
  }
  return `table ${quoteDashboardDslString(compiled.state || "States")} {\n  query ${normalizedQuery}\n}`;
};

export const starterDashboardDsl = (name: string, description?: string | null): string => {
  const dashboardDescription = description?.trim() || "Describe what this dashboard should answer.";
  return `dashboard ${quoteDashboardDslString(name)} {
  description ${quoteDashboardDslString(dashboardDescription)}

  section "Overview" {
    markdown "Start here" {
      """
      Add cards, charts, tables, and notes with the Pulse dashboard DSL.
      Use the inventory pane to insert metrics, states, events, sources, and resources.
      """
    }
  }
}`;
};

export const dashboardToDsl = (dashboard: PulseDashboard): string => {
  return dashboard.config.dsl?.trim() ? dashboard.config.dsl : "";
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
