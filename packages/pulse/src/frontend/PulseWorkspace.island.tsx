import {
  AppWorkspace,
  AutocompleteEditor,
  Chart,
  DataTable,
  dialogCore,
  FilterChip,
  MarkdownView,
  NumberInput,
  PanelDialog,
  panelDialogOptions,
  PermissionEditor,
  prompts,
  SelectInput,
  SettingsModal,
  StructuredDataPreview,
  TextInput,
  toast,
  type DataTableColumn,
  type FilterChipSection,
} from "@valentinkolb/cloud/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { markdown } from "@valentinkolb/cloud/shared";
import { formatTimeSpan } from "@valentinkolb/stdlib";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type {
  Aggregation,
  MetricType,
  PanelVisual,
  PulseBase,
  PulseCapabilitySnapshot,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardCardWidget,
  PulseDashboardConfig,
  PulseDashboardDslCompileResult,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricWidget,
  PulseDashboardPanel,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardWidget,
  PulseExplorerQuery,
  PulseMetricSummary,
  PulseMetricSeries,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseSavedQuery,
  PulseSource,
  PulseSourceToken,
  PulseSourceScrape,
  MetricQuery,
  MetricQueryPoint,
} from "../contracts";
import PulseLayoutHelp from "./PulseLayoutHelp";
import { buildPulseQuery, buildPulseQueryCompletions, defaultPulseQuery, pulseQueryHighlight } from "./query-authoring";

type MetricTextQueryResult = {
  compiled: PulseExplorerQuery;
  points: MetricQueryPoint[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};
type WorkspaceView = "dashboard" | "dashboard-edit" | "sources" | "explorer" | "activity-events" | "activity-states" | "activity-metrics";
type SourceKind = "metrics" | "http_ingest";
type GrantableLevel = Exclude<PermissionLevel, "none">;
type ExplorerResultView = "chart" | "table" | "compiled";
type QueryHistoryEntry = { query: string; ranAt: string };
type RefreshIntervalOption = "1" | "5" | "10" | "60" | "never";
type CreateSourceInput = {
  kind: SourceKind;
  name: string;
  endpointUrl?: string;
  bearerToken?: string;
  scrapeIntervalSeconds?: number;
};

type Props = {
  initialBases: PulseBase[];
  initialCapabilities: PulseCapabilitySnapshot | null;
  initialBaseId?: string | null;
  initialPath?: string;
  initialSearch?: string;
  initialSources?: PulseSource[];
  initialSourceScrapes?: Record<string, PulseSourceScrape[]>;
  initialSourceTokens?: Record<string, PulseSourceToken[]>;
  initialMetrics?: PulseMetricSummary[];
  initialActivityMetrics?: PulseMetricSummary[];
  initialSeries?: PulseMetricSeries[];
  initialRecentEvents?: PulseRecordedEvent[];
  initialCurrentStates?: PulseCurrentState[];
  initialActivityMetricSeries?: PulseMetricSeries[];
  initialActivityMetricPoints?: MetricQueryPoint[];
  initialDashboards?: PulseDashboard[];
  initialSavedQueries?: PulseSavedQuery[];
  initialPanelPoints?: Record<string, MetricQueryPoint[]>;
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return fallback;
};

const jsonFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
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

const compactDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const compactDay = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(new Date(value));

const compactDateWithDelta = (value: string) => `${compactDate(value)} (${formatTimeSpan(value)})`;

const normalizeEndpointInput = (value: string): string => (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);

const openQueryReferenceWindow = (baseId: string | null | undefined, options: { dashboardDsl?: boolean } = {}) => {
  if (!baseId || typeof window === "undefined") return;
  const params = options.dashboardDsl ? "?dashboardDsl=1" : "";
  window.open(`/app/pulse/${encodeURIComponent(baseId)}/query-reference${params}`, "pulse-query-reference", "popup,width=1180,height=840,resizable=yes,scrollbars=yes");
};

const formatIngestCounts = (counts: { metrics: number; events: number; states: number }): string =>
  [
    `${counts.metrics} metric${counts.metrics === 1 ? "" : "s"}`,
    `${counts.events} event${counts.events === 1 ? "" : "s"}`,
    `${counts.states} state${counts.states === 1 ? "" : "s"}`,
  ].join(", ");

const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;
const suggestionTagClass =
  "chip max-w-full cursor-pointer border-0 transition hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900 dark:hover:text-blue-200";

const parseScrapeInterval = (value: string | null | undefined): number => {
  const parsed = Number(value?.trim() || "60");
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(86_400, Math.max(10, Math.round(parsed)));
};

type WorkspaceRouteState = {
  view: WorkspaceView;
  dashboardId: string;
  sourceId: string;
};

type ActivityQueryState = {
  q: string;
  type: "" | MetricType;
  eventId: string;
  stateId: string;
  metric: string;
};

const emptyActivityQueryState = (): ActivityQueryState => ({ q: "", type: "", eventId: "", stateId: "", metric: "" });

const readActivityQueryState = (search?: string): ActivityQueryState => {
  if (search === undefined && typeof window === "undefined") return emptyActivityQueryState();
  const params = new URLSearchParams(search ?? window.location.search);
  const type = params.get("type") ?? "";
  return {
    q: params.get("q")?.trim() ?? "",
    type: type === "gauge" || type === "counter" || type === "histogram" || type === "summary" ? type : "",
    eventId: params.get("event") ?? "",
    stateId: params.get("state") ?? "",
    metric: params.get("metric") ?? "",
  };
};

const stateRowId = (state: PulseCurrentState): string =>
  [state.key, state.sourceId ?? "", state.entityId, JSON.stringify(state.dimensions)].join(":");

const readWorkspacePathState = (path: string, baseId: string): WorkspaceRouteState => {
  const fallback: WorkspaceRouteState = { view: "dashboard", dashboardId: "", sourceId: "" };
  if (!baseId) return fallback;
  const marker = `/app/pulse/${baseId}`;
  const start = path.indexOf(marker);
  if (start < 0) return fallback;
  const rest = path
    .slice(start + marker.length)
    .split("/")
    .filter(Boolean);
  if (rest[0] === "dashboards") return { view: rest[2] === "edit" ? "dashboard-edit" : "dashboard", dashboardId: rest[1] ?? "", sourceId: "" };
  if (rest[0] === "sources") return { view: "sources", dashboardId: "", sourceId: rest[1] ?? "" };
  if (rest[0] === "explorer" || rest[0] === "metric-explorer") return { view: "explorer", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity" && rest[1] === "states") return { view: "activity-states", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity" && rest[1] === "metrics") return { view: "activity-metrics", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity") return { view: "activity-events", dashboardId: "", sourceId: "" };
  return fallback;
};

const panelQuery = (baseId: string, panel: PulseDashboardPanel) => ({
  kind: "metric" as const,
  baseId,
  metric: panel.metric,
  aggregation: panel.aggregation,
  bucket: panel.bucket,
  since: panel.since,
  sourceId: panel.sourceId ?? null,
  dimensions: panel.dimensions ?? undefined,
});

const formatValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

const formatSignalValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatValue(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
};

const gaugeMax = (unit: string | null, value: number): number => {
  if (unit === "%") return 100;
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
};

const pointsToBars = (points: MetricQueryPoint[]) =>
  points.slice(-48).map((point) => ({
    label: compactDate(point.bucket),
    value: point.value ?? 0,
  }));

const pointsToHistogram = (points: MetricQueryPoint[]) =>
  points.map((point) => point.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const pointsToHeatmap = (points: MetricQueryPoint[]) =>
  points.slice(-240).map((point) => {
    const date = new Date(point.bucket);
    return {
      x: new Intl.DateTimeFormat(undefined, { hour: "2-digit" }).format(date),
      y: compactDay(point.bucket),
      value: point.value ?? 0,
    };
  });

const queryPointColumns: DataTableColumn<MetricQueryPoint>[] = [
  { id: "bucket", header: "Bucket", value: (point) => compactDateWithDelta(point.bucket), cellClass: "w-48 whitespace-nowrap" },
  { id: "value", header: "Value", value: (point) => formatValue(point.value), cellClass: "w-32 whitespace-nowrap" },
];

const seriesLabel = (series: PulseMetricSeries, sourceName?: string): string => {
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

const quoteQueryPart = (value: string): string => (/[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value);

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

const dashboardMetricPanels = (config: PulseDashboardConfig): PulseDashboardPanel[] => [
  ...config.panels,
  ...dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric"),
];

const quoteDashboardDslString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const visualStatement = (visual: PanelVisual): string => (visual === "line" ? "chart" : visual);

const panelToDashboardDsl = (panel: PulseDashboardPanel): string => {
  const source = panel.sourceId ? ` source ${panel.sourceId}` : "";
  const dimensions = Object.entries(panel.dimensions ?? {});
  const where = dimensions.length
    ? ` where ${dimensions.map(([key, value]) => `${key}=${quoteQueryPart(String(value))}`).join(", ")}`
    : "";
  return `    ${visualStatement(panel.visual)} ${quoteDashboardDslString(panel.title)} {
      query metric ${panel.metric} ${panel.aggregation} every ${panel.bucket} since ${panel.since}${source}${where}
    }`;
};

const dashboardToDsl = (dashboard: PulseDashboard): string => {
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

const readQueryHistory = (baseId: string): QueryHistoryEntry[] => {
  if (!baseId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queryHistoryKey(baseId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is QueryHistoryEntry => typeof item?.query === "string" && typeof item?.ranAt === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

const writeQueryHistory = (baseId: string, history: QueryHistoryEntry[]) => {
  if (!baseId || typeof window === "undefined") return;
  window.localStorage.setItem(queryHistoryKey(baseId), JSON.stringify(history.slice(0, 20)));
};

const SOURCE_TYPE_OPTIONS = [
  { id: "http_ingest", label: "HTTP ingest", icon: "ti ti-webhook", description: "Push metrics, events, and states." },
  { id: "metrics", label: "Metrics endpoint", icon: "ti ti-plug", description: "Scrape a Prometheus-compatible endpoint." },
];

const DASHBOARD_REFRESH_OPTIONS = [
  { id: "1", label: "Every 1 second", icon: "ti ti-player-play" },
  { id: "5", label: "Every 5 seconds", icon: "ti ti-refresh" },
  { id: "10", label: "Every 10 seconds", icon: "ti ti-refresh" },
  { id: "60", label: "Every minute", icon: "ti ti-clock" },
  { id: "never", label: "Never", icon: "ti ti-player-pause" },
];

const refreshOptionFromConfig = (config: PulseDashboardConfig): RefreshIntervalOption =>
  config.refreshIntervalSeconds === null ? "never" : String(config.refreshIntervalSeconds ?? 5) as RefreshIntervalOption;

const refreshIntervalFromOption = (value: string): PulseDashboardConfig["refreshIntervalSeconds"] =>
  value === "never" ? null : value === "1" || value === "5" || value === "10" || value === "60" ? Number(value) as 1 | 5 | 10 | 60 : 5;

const sourceKindIcon = (kind: PulseSource["kind"]): string => {
  if (kind === "http_ingest") return "ti ti-webhook";
  if (kind === "metrics") return "ti ti-plug";
  return "ti ti-database-share";
};

const sourceStatus = (source: PulseSource) => {
  if (!source.enabled) return { label: "Paused", dot: "bg-zinc-400", text: "text-dimmed", icon: "ti ti-player-pause" };
  if (source.lastError) return { label: "Error", dot: "bg-red-500", text: "text-red-600 dark:text-red-300", icon: "ti ti-alert-circle" };
  if (source.lastSeenAt) return { label: "Healthy", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", icon: "ti ti-check" };
  return { label: "Waiting", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", icon: "ti ti-clock" };
};

const VISUAL_OPTIONS = [
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "stat", label: "Stat", icon: "ti ti-number" },
  { id: "gauge", label: "Gauge", icon: "ti ti-gauge" },
  { id: "barGauge", label: "Bar gauge", icon: "ti ti-progress" },
  { id: "histogram", label: "Histogram", icon: "ti ti-chart-histogram" },
  { id: "heatmap", label: "Heatmap", icon: "ti ti-grid-dots" },
];

const RESULT_VIEW_OPTIONS = [
  { id: "chart", label: "Chart", icon: "ti ti-chart-line" },
  { id: "table", label: "Table", icon: "ti ti-table" },
  { id: "compiled", label: "Compiled", icon: "ti ti-code" },
];

const METRIC_TYPE_FILTER_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "gauge", label: "Gauge", icon: "ti ti-gauge" },
      { value: "counter", label: "Counter", icon: "ti ti-number" },
      { value: "histogram", label: "Histogram", icon: "ti ti-chart-histogram" },
      { value: "summary", label: "Summary", icon: "ti ti-chart-dots" },
    ],
  },
];

export default function PulseWorkspace(props: Props) {
  const initialBaseId = props.initialBaseId ?? props.initialBases[0]?.id ?? "";
  const initialPath = props.initialPath ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const initialRouteState = readWorkspacePathState(initialPath, initialBaseId);
  const initialDashboardId =
    props.initialDashboards?.find((dashboard) => dashboard.id === initialRouteState.dashboardId)?.id ??
    props.initialDashboards?.[0]?.id ??
    initialRouteState.dashboardId;
  const initialActivityQuery = readActivityQueryState(props.initialSearch);
  const [bases, setBases] = createSignal(props.initialBases);
  const [selectedBaseId, setSelectedBaseId] = createSignal(initialBaseId);
  const [sources, setSources] = createSignal<PulseSource[]>(props.initialSources ?? []);
  const [sourceScrapes, setSourceScrapes] = createSignal<Record<string, PulseSourceScrape[]>>(props.initialSourceScrapes ?? {});
  const [sourceTokens, setSourceTokens] = createSignal<Record<string, PulseSourceToken[]>>(props.initialSourceTokens ?? {});
  const [sourceSearch, setSourceSearch] = createSignal("");
  const [metrics, setMetrics] = createSignal<PulseMetricSummary[]>(props.initialMetrics ?? []);
  const [activityMetrics, setActivityMetrics] = createSignal<PulseMetricSummary[]>(props.initialActivityMetrics ?? []);
  const [series, setSeries] = createSignal<PulseMetricSeries[]>(props.initialSeries ?? []);
  const [recentEvents, setRecentEvents] = createSignal<PulseRecordedEvent[]>(props.initialRecentEvents ?? []);
  const [currentStates, setCurrentStates] = createSignal<PulseCurrentState[]>(props.initialCurrentStates ?? []);
  const [dashboards, setDashboards] = createSignal<PulseDashboard[]>(props.initialDashboards ?? []);
  const [savedQueries, setSavedQueries] = createSignal<PulseSavedQuery[]>(props.initialSavedQueries ?? []);
  const [selectedDashboardId, setSelectedDashboardId] = createSignal(initialDashboardId);
  const [activeView, setActiveView] = createSignal<WorkspaceView>(initialRouteState.view);
  const [selectedMetric, setSelectedMetric] = createSignal(props.initialMetrics?.[0]?.name ?? "");
  const [selectedSourceId, setSelectedSourceId] = createSignal(initialRouteState.sourceId);
  const [activitySearch, setActivitySearch] = createSignal(initialActivityQuery.q);
  const [metricTypeFilter, setMetricTypeFilter] = createSignal<"" | MetricType>(initialActivityQuery.type);
  const [selectedEventId, setSelectedEventId] = createSignal(initialActivityQuery.eventId);
  const [selectedStateId, setSelectedStateId] = createSignal(initialActivityQuery.stateId);
  const [selectedActivityMetricName, setSelectedActivityMetricName] = createSignal(initialActivityQuery.metric);
  const [activityMetricSeries, setActivityMetricSeries] = createSignal<PulseMetricSeries[]>(props.initialActivityMetricSeries ?? []);
  const [activityMetricPoints, setActivityMetricPoints] = createSignal<MetricQueryPoint[]>(props.initialActivityMetricPoints ?? []);
  const [selectedSeriesId, setSelectedSeriesId] = createSignal("");
  const [selectedVisual, setSelectedVisual] = createSignal<PanelVisual>("line");
  const [selectedAggregation, setSelectedAggregation] = createSignal<Aggregation>("avg");
  const [selectedBucket, setSelectedBucket] = createSignal("5m");
  const [selectedSince, setSelectedSince] = createSignal("24h");
  const [queryText, setQueryText] = createSignal("");
  const [lastRunQuery, setLastRunQuery] = createSignal("");
  const [queryDiagnostics, setQueryDiagnostics] = createSignal<PulseQueryCompileResult | null>(null);
  const [queryHistory, setQueryHistory] = createSignal<QueryHistoryEntry[]>(readQueryHistory(initialBaseId));
  const [querySeeded, setQuerySeeded] = createSignal(false);
  const [querySuggestionsExpanded, setQuerySuggestionsExpanded] = createSignal(false);
  const [querySuggestionSearch, setQuerySuggestionSearch] = createSignal("");
  const [explorerResultView, setExplorerResultView] = createSignal<ExplorerResultView>("chart");
  const [points, setPoints] = createSignal<MetricQueryPoint[]>([]);
  const [explorerEvents, setExplorerEvents] = createSignal<PulseRecordedEvent[]>([]);
  const [explorerStates, setExplorerStates] = createSignal<PulseCurrentState[]>([]);
  const [queryRunning, setQueryRunning] = createSignal(false);
  const [panelPoints, setPanelPoints] = createSignal<Record<string, MetricQueryPoint[]>>(props.initialPanelPoints ?? {});
  const [dashboardDslText, setDashboardDslText] = createSignal("");
  const [dashboardDslDiagnostics, setDashboardDslDiagnostics] = createSignal<PulseDashboardDslCompileResult | null>(null);
  const [dashboardPreviewConfig, setDashboardPreviewConfig] = createSignal<PulseDashboardConfig | null>(null);
  const [dashboardDslSeededFor, setDashboardDslSeededFor] = createSignal("");
  const [dashboardDslSaving, setDashboardDslSaving] = createSignal(false);
  const [httpIngestToken, setHttpIngestToken] = createSignal("");
  const [tokenSourceId, setTokenSourceId] = createSignal("");
  const [origin, setOrigin] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = createSignal(false);
  let queryRunId = 0;
  let activityDataRequestId = 0;
  let lastAutoRunQuery = "";

  const selectedBase = createMemo(() => bases().find((base) => base.id === selectedBaseId()) ?? null);
  const selectedDashboard = createMemo(
    () => dashboards().find((dashboard) => dashboard.id === selectedDashboardId()) ?? dashboards()[0] ?? null,
  );
  const dashboardEditPreviewConfig = createMemo(() => dashboardPreviewConfig() ?? selectedDashboard()?.config ?? null);
  const selectedSource = createMemo(() => sources().find((source) => source.id === selectedSourceId()) ?? null);
  const selectedSourceScrapes = createMemo(() => (selectedSourceId() ? (sourceScrapes()[selectedSourceId()] ?? []) : []));
  const selectedSourceTokens = createMemo(() => (selectedSourceId() ? (sourceTokens()[selectedSourceId()] ?? []) : []));
  const selectedEvent = createMemo(() => recentEvents().find((event) => event.id === selectedEventId()) ?? null);
  const selectedState = createMemo(() => currentStates().find((state) => stateRowId(state) === selectedStateId()) ?? null);
  const selectedActivityMetric = createMemo(
    () => activityMetrics().find((metric) => metric.name === selectedActivityMetricName()) ?? null,
  );
  const selectedSeries = createMemo(() => series().find((item) => item.id === selectedSeriesId()) ?? null);
  const sourceNameById = createMemo(() => new Map(sources().map((source) => [source.id, source.name])));
  const metricByName = createMemo(() => new Map(metrics().map((metric) => [metric.name, metric])));
  const sourceById = createMemo(() => new Map(sources().map((source) => [source.id, source])));
  const filteredSources = createMemo(() => {
    const q = sourceSearch().trim().toLowerCase();
    if (!q) return sources();
    return sources().filter((source) =>
      [source.name, source.kind, source.endpointUrl ?? "", source.lastError ?? ""].some((value) => value.toLowerCase().includes(q)),
    );
  });
  const activityMetricSources = createMemo(() => {
    const unique = new Map<string, PulseSource>();
    for (const item of activityMetricSeries()) {
      const source = sourceById().get(item.sourceId ?? "");
      if (source) unique.set(source.id, source);
    }
    return [...unique.values()];
  });
  const sourceColumns: DataTableColumn<PulseSource>[] = [
    { id: "source", header: "Source", value: "name", cellClass: "min-w-56" },
    { id: "status", header: "Status", cellClass: "w-28 whitespace-nowrap" },
    { id: "target", header: "Target", cellClass: "min-w-48" },
    { id: "seen", header: "Last seen", cellClass: "w-48 whitespace-nowrap" },
  ];
  const sourceScrapeColumns: DataTableColumn<PulseSourceScrape>[] = [
    { id: "status", header: "Status", cellClass: "w-28 whitespace-nowrap" },
    { id: "finished", header: "Finished", cellClass: "w-44 whitespace-nowrap" },
    { id: "samples", header: "Data", cellClass: "w-28 whitespace-nowrap" },
    { id: "duration", header: "Time", cellClass: "w-20 whitespace-nowrap" },
    { id: "error", header: "Error", cellClass: "min-w-40" },
  ];
  const sourceTokenColumns: DataTableColumn<PulseSourceToken>[] = [
    { id: "label", header: "Token", value: "label", cellClass: "min-w-40" },
    { id: "created", header: "Created", cellClass: "w-36 whitespace-nowrap" },
    { id: "used", header: "Last used", cellClass: "w-36 whitespace-nowrap" },
    { id: "actions", header: "", cellClass: "w-16 whitespace-nowrap text-right" },
  ];
  const eventColumns: DataTableColumn<PulseRecordedEvent>[] = [
    { id: "kind", header: "Event", value: "kind", cellClass: "min-w-52" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "entity", header: "Entity", cellClass: "w-40 whitespace-nowrap" },
    { id: "value", header: "Value", cellClass: "w-24 whitespace-nowrap" },
    { id: "time", header: "Time", cellClass: "w-44 whitespace-nowrap" },
  ];
  const stateColumns: DataTableColumn<PulseCurrentState>[] = [
    { id: "key", header: "State", value: "key", cellClass: "min-w-52" },
    { id: "value", header: "Value", cellClass: "min-w-40" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "entity", header: "Entity", cellClass: "w-40 whitespace-nowrap" },
    { id: "updated", header: "Updated", cellClass: "w-44 whitespace-nowrap" },
  ];
  const metricColumns: DataTableColumn<PulseMetricSummary>[] = [
    { id: "name", header: "Metric", value: "name", cellClass: "min-w-72" },
    { id: "type", header: "Type", value: "type", cellClass: "w-24 whitespace-nowrap" },
    { id: "unit", header: "Unit", cellClass: "w-24 whitespace-nowrap" },
    { id: "series", header: "Series", cellClass: "w-24 whitespace-nowrap" },
    { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
  ];
  const previewSeries = createMemo(() => [
    {
      label: selectedMetric() || "metric",
      data: points().map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })),
    },
  ]);
  const queryCompletions = createMemo(() =>
    buildPulseQueryCompletions({ metrics: metrics(), events: recentEvents(), states: currentStates(), sources: sources(), series: series() }),
  );
  const compiledQuery = createMemo(() => queryDiagnostics()?.compiled ?? null);
  const compiledMetricQuery = createMemo(() => (compiledQuery()?.kind === "metric" ? (compiledQuery() as MetricQuery) : null));
  const matchingMetricSeries = createMemo(() => {
    const compiled = compiledMetricQuery();
    if (!compiled) return [];
    const filters = Object.entries(compiled.dimensions ?? {}).map(([key, value]) => [key, String(value)] as const);
    return series().filter((item) => {
      if (item.metric !== compiled.metric) return false;
      if (compiled.sourceId && item.sourceId !== compiled.sourceId) return false;
      return filters.every(([key, value]) => item.dimensions[key] === value);
    });
  });
  const queryFilterSuggestions = createMemo(() => {
    const compiled = compiledMetricQuery();
    if (!compiled) return [];
    const existing = new Set(Object.keys(compiled.dimensions ?? {}));
    const dimensions = new Map<string, Map<string, number>>();
    for (const item of matchingMetricSeries()) {
      for (const [key, value] of Object.entries(item.dimensions)) {
        if (existing.has(key)) continue;
        if (!dimensions.has(key)) dimensions.set(key, new Map());
        const values = dimensions.get(key)!;
        values.set(value, (values.get(value) ?? 0) + 1);
      }
    }
    return [...dimensions.entries()]
      .map(([key, values]) => ({
        key,
        count: [...values.values()].reduce((sum, value) => sum + value, 0),
        values: [...values.entries()]
          .map(([value, count]) => ({ key, value, count }))
          .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  });
  const matchingMetricSources = createMemo(() => {
    const unique = new Map<string, { source: PulseSource; count: number }>();
    for (const item of matchingMetricSeries()) {
      const source = sourceById().get(item.sourceId ?? "");
      if (source) unique.set(source.id, { source, count: (unique.get(source.id)?.count ?? 0) + 1 });
    }
    return [...unique.values()].sort((left, right) => right.count - left.count || left.source.name.localeCompare(right.source.name));
  });
  const querySuggestionMatches = createMemo(() => {
    const search = querySuggestionSearch().trim().toLowerCase();
    const sourceMatches = matchingMetricSources().filter(({ source }) =>
      !search ? true : [source.name, source.kind, source.endpointUrl ?? ""].some((value) => value.toLowerCase().includes(search)),
    );
    const labelMatches = queryFilterSuggestions()
      .map((group) => ({
        ...group,
        values: group.values.filter((filter) =>
          !search ? true : `${filter.key}=${filter.value}`.toLowerCase().includes(search) || filter.value.toLowerCase().includes(search),
        ),
      }))
      .filter((group) => group.values.length > 0);
    return {
      sources: sourceMatches,
      labels: labelMatches,
    };
  });
  const visibleQuerySourceSuggestions = createMemo(() => {
    const limit = querySuggestionsExpanded() ? 25 : 4;
    return querySuggestionMatches().sources.slice(0, limit);
  });
  const visibleQueryLabelSuggestions = createMemo(() => {
    const groupLimit = querySuggestionsExpanded() ? 12 : 3;
    const valueLimit = querySuggestionsExpanded() ? 8 : 4;
    return querySuggestionMatches()
      .labels.slice(0, groupLimit)
      .map((group) => ({ ...group, values: group.values.slice(0, valueLimit), hiddenValues: Math.max(0, group.values.length - valueLimit) }));
  });
  const querySuggestionOverflow = createMemo(() => {
    const sourceOverflow = compiledMetricQuery()?.sourceId ? 0 : querySuggestionMatches().sources.length - visibleQuerySourceSuggestions().length;
    const labelOverflow = querySuggestionMatches().labels.reduce(
      (count, group, index) => count + (index >= visibleQueryLabelSuggestions().length ? group.values.length : Math.max(0, group.values.length - (querySuggestionsExpanded() ? 8 : 4))),
      0,
    );
    return Math.max(0, sourceOverflow) + Math.max(0, labelOverflow);
  });
  const previewUnit = createMemo(() => metricByName().get(compiledMetricQuery()?.metric ?? selectedMetric())?.unit ?? null);
  const defaultQueryText = createMemo(() => {
    const metric = selectedMetric();
    if (!metric) return "";
    const seriesFilter = selectedSeries();
    const sourceId = seriesFilter?.sourceId ?? selectedSourceId();
    return buildPulseQuery({
      metric,
      aggregation: selectedAggregation(),
      bucket: selectedBucket(),
      since: selectedSince(),
      sourceId,
      dimensions: seriesFilter?.dimensions,
    });
  });

  const loadBaseData = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const [nextSources, nextMetrics, nextDashboards, nextSavedQueries] = await Promise.all([
      jsonFetch<PulseSource[]>(`/api/pulse/bases/${baseId}/sources`, { signal }),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics`, { signal }),
      jsonFetch<PulseDashboard[]>(`/api/pulse/bases/${baseId}/dashboards`, { signal }),
      jsonFetch<PulseSavedQuery[]>(`/api/pulse/bases/${baseId}/saved-queries`, { signal }),
    ]);
    setSources(nextSources);
    setMetrics(nextMetrics);
    setDashboards(nextDashboards);
    setSavedQueries(nextSavedQueries);
    setSelectedMetric((current) =>
      current && nextMetrics.some((metric) => metric.name === current) ? current : (nextMetrics[0]?.name ?? ""),
    );
    setSelectedSourceId((current) => (current && nextSources.some((source) => source.id === current) ? current : ""));
    setSelectedDashboardId((current) => nextDashboards.find((dashboard) => dashboard.id === current)?.id ?? nextDashboards[0]?.id ?? "");
  };

  const activityQueryParams = (
    includeType = false,
    snapshot: { q: string; type: "" | MetricType } = { q: activitySearch().trim(), type: metricTypeFilter() },
  ) => {
    const params = new URLSearchParams();
    if (snapshot.q) params.set("q", snapshot.q);
    if (includeType && snapshot.type) params.set("type", snapshot.type);
    return params;
  };

  const loadActivityData = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++activityDataRequestId;
    const snapshot = { q: activitySearch().trim(), type: metricTypeFilter() };
    const eventParams = activityQueryParams(false, snapshot);
    const stateParams = activityQueryParams(false, snapshot);
    const metricParams = activityQueryParams(true, snapshot);
    const [nextEvents, nextStates, nextMetrics] = await Promise.all([
      jsonFetch<PulseRecordedEvent[]>(`/api/pulse/bases/${baseId}/recent-events?${eventParams}`, { signal }),
      jsonFetch<PulseCurrentState[]>(`/api/pulse/bases/${baseId}/states?${stateParams}`, { signal }),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics?${metricParams}`, { signal }),
    ]);
    if (
      signal?.aborted ||
      requestId !== activityDataRequestId ||
      selectedBaseId() !== baseId ||
      activitySearch().trim() !== snapshot.q ||
      metricTypeFilter() !== snapshot.type
    ) {
      return;
    }
    setRecentEvents(nextEvents);
    setCurrentStates(nextStates);
    setActivityMetrics(nextMetrics);
    setSelectedEventId((current) => (current && nextEvents.some((event) => event.id === current) ? current : ""));
    setSelectedStateId((current) => (current && nextStates.some((state) => stateRowId(state) === current) ? current : ""));
    setSelectedActivityMetricName((current) =>
      current && nextMetrics.some((metric) => metric.name === current) ? current : "",
    );
  };

  const loadSeries = async (baseId = selectedBaseId(), metric = selectedMetric(), sourceId = selectedSourceId()) => {
    if (!baseId || !metric) {
      setSeries([]);
      setSelectedSeriesId("");
      return;
    }
    const params = new URLSearchParams({ metric });
    if (sourceId) params.set("sourceId", sourceId);
    const nextSeries = await jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${baseId}/series?${params}`);
    setSeries(nextSeries);
    setSelectedSeriesId((current) => (current && nextSeries.some((item) => item.id === current) ? current : ""));
  };

  const fetchMetricSeries = async (baseId: string, metric: string, sourceId?: string | null) => {
    const params = new URLSearchParams({ metric });
    if (sourceId) params.set("sourceId", sourceId);
    return jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${baseId}/series?${params}`);
  };

  const loadSourceScrapes = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextScrapes = await jsonFetch<PulseSourceScrape[]>(`/api/pulse/bases/${baseId}/sources/${sourceId}/scrapes`, { signal });
    setSourceScrapes((current) => ({ ...current, [sourceId]: nextScrapes }));
  };

  const loadSourceTokens = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextTokens = await jsonFetch<PulseSourceToken[]>(`/api/pulse/bases/${baseId}/sources/${sourceId}/tokens`, { signal });
    setSourceTokens((current) => ({ ...current, [sourceId]: nextTokens }));
  };

  const loadPanel = async (panel: PulseDashboardPanel, baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const data = await jsonFetch<MetricQueryPoint[]>("/api/pulse/query/metric", {
      method: "POST",
      signal,
      body: JSON.stringify(panelQuery(baseId, panel)),
    });
    setPanelPoints((current) => ({ ...current, [panel.id]: data }));
  };

  const refreshDashboard = async (dashboard = selectedDashboard(), baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!dashboard || !baseId) return;
    await Promise.all(dashboardMetricPanels(dashboard.config).map((panel) => loadPanel(panel, baseId, signal).catch(() => undefined)));
  };

  const workspaceHref = (nextState: { view: WorkspaceView; dashboardId?: string; sourceId?: string }) => {
    const baseId = selectedBaseId();
    if (!baseId) return "/app/pulse";
    const activitySuffix = () => {
      const params = activityQueryParams(nextState.view === "activity-metrics");
      if (nextState.view === "activity-events" && selectedEventId()) params.set("event", selectedEventId());
      if (nextState.view === "activity-states" && selectedStateId()) params.set("state", selectedStateId());
      if (nextState.view === "activity-metrics" && selectedActivityMetricName()) params.set("metric", selectedActivityMetricName());
      const query = params.toString();
      return query ? `?${query}` : "";
    };
    if (nextState.view === "dashboard") {
      return nextState.dashboardId ? `/app/pulse/${baseId}/dashboards/${nextState.dashboardId}` : `/app/pulse/${baseId}`;
    }
    if (nextState.view === "dashboard-edit") {
      return nextState.dashboardId ? `/app/pulse/${baseId}/dashboards/${nextState.dashboardId}/edit` : `/app/pulse/${baseId}`;
    }
    if (nextState.view === "sources") {
      return nextState.sourceId ? `/app/pulse/${baseId}/sources/${nextState.sourceId}` : `/app/pulse/${baseId}/sources`;
    }
    if (nextState.view === "explorer") return `/app/pulse/${baseId}/explorer`;
    if (nextState.view === "activity-states") return `/app/pulse/${baseId}/activity/states${activitySuffix()}`;
    if (nextState.view === "activity-metrics") return `/app/pulse/${baseId}/activity/metrics${activitySuffix()}`;
    return `/app/pulse/${baseId}/activity/events${activitySuffix()}`;
  };

  const applyWorkspacePathState = (path = typeof window === "undefined" ? (props.initialPath ?? "") : window.location.pathname) => {
    const next = readWorkspacePathState(path, selectedBaseId());
    const activity = readActivityQueryState();
    setActiveView(next.view);
    setSelectedDashboardId(next.dashboardId);
    setSelectedSourceId(next.sourceId);
    setActivitySearch(activity.q);
    setMetricTypeFilter(activity.type);
    setSelectedEventId(activity.eventId);
    setSelectedStateId(activity.stateId);
    setSelectedActivityMetricName(activity.metric);
  };

  const navigateWorkspace = (
    nextState: { view: WorkspaceView; dashboardId?: string; sourceId?: string },
    mode: "push" | "replace" = "push",
  ) => {
    const href = workspaceHref(nextState);
    if (typeof window !== "undefined" && href !== `${window.location.pathname}${window.location.search}`) {
      if (mode === "replace") window.history.replaceState({}, "", href);
      else window.history.pushState({}, "", href);
    }
    setActiveView(nextState.view);
    setSelectedDashboardId(nextState.dashboardId ?? (nextState.view === "dashboard" || nextState.view === "dashboard-edit" ? selectedDashboardId() : ""));
    setSelectedSourceId(nextState.sourceId ?? "");
  };

  const createDashboard = async () => {
    const baseId = selectedBaseId();
    if (!baseId) return null;
    const result = await prompts.form({
      title: "New dashboard",
      icon: "ti ti-layout-dashboard",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "Operations" },
      },
      confirmText: "Create",
    });
    const name = result ? String(result.name ?? "").trim() : "";
    if (!name) return null;
    setLoading(true);
    try {
      const dashboard = await jsonFetch<PulseDashboard>(`/api/pulse/bases/${baseId}/dashboards`, {
        method: "POST",
        body: JSON.stringify({ name, config: { panels: [] } }),
      });
      setDashboards((current) => [dashboard, ...current]);
      navigateWorkspace({ view: "dashboard", dashboardId: dashboard.id });
      toast.success("Dashboard created");
      return dashboard;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create dashboard");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const ensureDashboard = async () => selectedDashboard() ?? createDashboard();

  const updateBaseSettings = async (base: PulseBase, input: { name: string; description: string; retentionDays: number }) => {
    const name = input.name.trim();
    if (!name) {
      toast.error("Pulse name is required");
      return false;
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) {
      toast.error("Retention must be between 1 and 3650 days");
      return false;
    }
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseBase>(`/api/pulse/bases/${base.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: input.description.trim() || null,
          retentionDays: input.retentionDays,
        }),
      });
      setBases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Pulse settings saved");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Pulse settings");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openSettingsDialog = async () => {
    if (settingsDialogOpen()) return;
    const base = selectedBase();
    if (!base) return;
    try {
      setLoading(true);
      const accessEntries = await jsonFetch<AccessEntry[]>(`/api/pulse/bases/${base.id}/access`);
      setLoading(false);
      setSettingsDialogOpen(true);

      await prompts.dialog<void>(
        (close) => {
          const [name, setName] = createSignal(base.name);
          const [description, setDescription] = createSignal(base.description ?? "");
          const [retentionDays, setRetentionDays] = createSignal<number | null>(base.retentionDays);
          const saveProfile = async () =>
            updateBaseSettings(base, {
              name: name(),
              description: description(),
              retentionDays: retentionDays() ?? base.retentionDays,
            });

          const saveRetention = async () =>
            updateBaseSettings(base, {
              name: name(),
              description: description(),
              retentionDays: retentionDays() ?? base.retentionDays,
            });

          const grantAccess = (principal: Principal, permission: GrantableLevel) =>
            jsonFetch<AccessEntry>(`/api/pulse/bases/${base.id}/access`, {
              method: "POST",
              body: JSON.stringify({ principal, permission }),
            });

          const updateAccess = (accessId: string, permission: GrantableLevel) =>
            jsonFetch<void>(`/api/pulse/access/${accessId}`, {
              method: "PATCH",
              body: JSON.stringify({ permission }),
            });

          const revokeAccess = (accessId: string) => jsonFetch<void>(`/api/pulse/access/${accessId}`, { method: "DELETE" });

          const cannotDeleteYet = async () => {
            await prompts.alert("Pulse base deletion is not available yet. Remove sources or revoke access instead.", {
              title: "Deletion unavailable",
              icon: "ti ti-alert-triangle",
            });
          };

          return (
            <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
              <SettingsModal title="Pulse settings" subtitle={base.name} icon="ti ti-activity-heartbeat" onClose={close} closeLabel="Close">
                <SettingsModal.Tab
                  id="general"
                  title="General"
                  icon="ti ti-settings"
                  description="Name and description shown across Pulse."
                >
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveProfile();
                    }}
                  >
                    <TextInput
                      label="Name"
                      description="Shown in the Pulse sidebar, overview, and dashboard headers."
                      icon="ti ti-tag"
                      value={name}
                      onInput={setName}
                      required
                    />
                    <TextInput
                      label="Description"
                      description="Optional context for teammates who can access this Pulse base."
                      icon="ti ti-align-left"
                      value={description}
                      onInput={setDescription}
                      multiline
                      lines={3}
                      placeholder="Optional"
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading() || !name().trim()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="access"
                  title="Access"
                  icon="ti ti-users"
                  description="Grant people and groups access to this Pulse base."
                >
                  <PermissionEditor
                    initialEntries={accessEntries}
                    canEdit
                    grantAccess={grantAccess}
                    updateAccess={updateAccess}
                    revokeAccess={revokeAccess}
                    allowedLevels={[
                      { level: "read", label: "View", icon: "ti-eye" },
                      { level: "write", label: "Edit", icon: "ti-pencil" },
                      { level: "admin", label: "Manage", icon: "ti-shield" },
                    ]}
                  />
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="retention"
                  title="Retention"
                  icon="ti ti-clock-cog"
                  description="Control how long raw telemetry stays queryable."
                >
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRetention();
                    }}
                  >
                    <NumberInput
                      label="Raw data retention"
                      description="Pulse keeps raw metrics, events, and states for this many days before cleanup."
                      icon="ti ti-clock"
                      suffix="days"
                      min={1}
                      max={3650}
                      value={retentionDays}
                      onInput={setRetentionDays}
                      required
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save retention
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="danger"
                  title="Danger zone"
                  icon="ti ti-alert-triangle"
                  tone="danger"
                  description="Destructive actions for this Pulse base."
                >
                  <div class="info-block-warning mb-4">
                    Pulse base deletion is not wired yet. Source removal and access changes are available from the regular workspace
                    controls.
                  </div>
                  <button type="button" class="btn-danger btn-sm" onClick={() => void cannotDeleteYet()}>
                    <i class="ti ti-trash text-sm" />
                    Delete Pulse base
                  </button>
                </SettingsModal.Tab>
              </SettingsModal>
            </div>
          );
        },
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open Pulse settings");
    } finally {
      setLoading(false);
      setSettingsDialogOpen(false);
    }
  };

  const createSource = async (input: CreateSourceInput) => {
    const baseId = selectedBaseId();
    if (!baseId) return false;
    const endpointInput = String(input.endpointUrl ?? "").trim();
    if (input.kind === "metrics" && !endpointInput) {
      toast.error("Endpoint URL is required");
      return false;
    }
    const name = input.name.trim() || (input.kind === "http_ingest" ? "Telemetry push" : "Metrics endpoint");
    setLoading(true);
    try {
      const source = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources`, {
        method: "POST",
        body: JSON.stringify(
          input.kind === "metrics"
            ? {
                kind: "metrics",
                name,
                endpointUrl: normalizeEndpointInput(endpointInput),
                bearerToken: input.bearerToken?.trim() || null,
                scrapeIntervalSeconds: parseScrapeInterval(String(input.scrapeIntervalSeconds ?? 60)),
              }
            : { kind: input.kind, name },
        ),
      });
      navigateWorkspace({ view: "sources", sourceId: source.id });
      await loadBaseData(baseId);
      if (input.kind === "metrics") {
        try {
          const counts = await jsonFetch<{ metrics: number; events: number; states: number }>(
            `/api/pulse/bases/${baseId}/sources/${source.id}/scrape`,
            {
              method: "POST",
              body: "{}",
            },
          );
          await loadBaseData(baseId);
          await loadSourceScrapes(baseId, source.id);
          toast.success(`Metrics source added and scraped: ${formatIngestCounts(counts)}`);
          return true;
        } catch (scrapeError) {
          toast.error(
            scrapeError instanceof Error
              ? `Source added, initial scrape failed: ${scrapeError.message}`
              : "Source added, initial scrape failed",
          );
        }
      }
      toast.success(`${input.kind === "http_ingest" ? "HTTP ingest" : "Metrics"} source created`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add source");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const addSource = () =>
    dialogCore.open<void>((close) => {
      const [kind, setKind] = createSignal<SourceKind>("http_ingest");
      const [name, setName] = createSignal("");
      const [endpointUrl, setEndpointUrl] = createSignal("");
      const [bearerToken, setBearerToken] = createSignal("");
      const [scrapeIntervalSeconds, setScrapeIntervalSeconds] = createSignal<number | null>(60);
      const title = () => (kind() === "http_ingest" ? "HTTP ingest" : "Metrics endpoint");
      const sourceInfo = () =>
        "After creating this source, add one or more labeled ingest tokens from the source detail panel. Use those URLs from ingestors, apps, automations, imports, or jobs.";
      const submit = async () => {
        const created = await createSource({
          kind: kind(),
          name: name(),
          endpointUrl: endpointUrl(),
          bearerToken: bearerToken(),
          scrapeIntervalSeconds: scrapeIntervalSeconds() ?? 60,
        });
        if (created) close();
      };

      return (
        <form
          class="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PanelDialog>
            <PanelDialog.Header
              title="New source"
              subtitle="Add one telemetry input for this Pulse base."
              icon="ti ti-plug-connected"
              close={close}
            />
            <PanelDialog.Body>
              <TextInput
                label="Name"
                description="Shown in source lists, dashboard filters, and setup examples."
                icon="ti ti-tag"
                value={name}
                onInput={setName}
                placeholder={kind() === "http_ingest" ? "Sales pipeline" : "Service metrics"}
              />

              <PanelDialog.Section title={title()} subtitle="Choose how Pulse should receive data." icon="ti ti-route">
                <SelectInput
                  label="Type"
                  description="Pick a scrape target or an ingest source that pushes data into Pulse."
                  icon="ti ti-plug-connected"
                  value={kind}
                  onChange={(value) => setKind(value as SourceKind)}
                  options={SOURCE_TYPE_OPTIONS}
                  required
                />
                <Show when={kind() === "metrics"}>
                  <div class="grid gap-3 md:grid-cols-2">
                    <TextInput
                      label="Endpoint URL"
                      description="Pulse will scrape this /metrics endpoint on the configured interval."
                      type="url"
                      icon="ti ti-link"
                      value={endpointUrl}
                      onInput={setEndpointUrl}
                      placeholder="https://example.local/metrics"
                      required
                    />
                    <NumberInput
                      label="Scrape interval"
                      description="How often Pulse scrapes the endpoint."
                      icon="ti ti-refresh"
                      suffix="sec"
                      min={10}
                      max={86_400}
                      value={scrapeIntervalSeconds}
                      onInput={setScrapeIntervalSeconds}
                    />
                  </div>
                  <TextInput
                    label="Bearer token"
                    description="Optional. Stored encrypted by Pulse."
                    icon="ti ti-key"
                    value={bearerToken}
                    onInput={setBearerToken}
                    placeholder="Optional"
                    password
                  />
                </Show>
                <Show when={kind() !== "metrics"}>
                  <div class="info-block-info">
                    <div class="flex items-start gap-2">
                      <i class="ti ti-info-circle mt-0.5 shrink-0 text-blue-500" />
                      <p>{sourceInfo()}</p>
                    </div>
                  </div>
                </Show>
              </PanelDialog.Section>
            </PanelDialog.Body>
            <PanelDialog.Footer>
              <button type="button" class="btn-input btn-input-sm" onClick={() => close()} disabled={loading()}>
                Cancel
              </button>
              <button type="submit" class="btn-input btn-input-sm" disabled={loading() || (kind() === "metrics" && !endpointUrl().trim())}>
                <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-sm`} />
                Add
              </button>
            </PanelDialog.Footer>
          </PanelDialog>
        </form>
      );
    }, panelDialogOptions);

  const scrape = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setLoading(true);
    try {
      const counts = await jsonFetch<{ metrics: number; events: number; states: number }>(
        `/api/pulse/bases/${baseId}/sources/${source.id}/scrape`,
        {
          method: "POST",
          body: "{}",
        },
      );
      await loadBaseData(baseId);
      await loadSourceScrapes(baseId, source.id);
      await refreshDashboard();
      toast.success(`Metrics scraped: ${formatIngestCounts(counts)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scrape failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await refreshDashboard();
      toast.success(updated.enabled ? "Source resumed" : "Source paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      setLoading(false);
    }
  };

  const editSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    const result = await prompts.form({
      title: source.kind === "metrics" ? "Edit metrics source" : "Edit source",
      icon: source.kind === "metrics" ? "ti ti-plug" : "ti ti-pencil",
      fields:
        source.kind === "metrics"
          ? {
              name: {
                type: "text",
                label: "Source name",
                description: "Shown in source lists and dashboard filters.",
                required: true,
                default: source.name,
              },
              endpointUrl: {
                type: "text",
                label: "Metrics endpoint URL",
                description: "Pulse scrapes this endpoint on the configured interval.",
                required: true,
                default: source.endpointUrl ?? "",
              },
              scrapeIntervalSeconds: {
                type: "text",
                label: "Scrape interval in seconds",
                description: "How often Pulse should fetch this metrics endpoint.",
                default: String(source.scrapeIntervalSeconds ?? 60),
              },
              bearerToken: {
                type: "text",
                label: "New bearer token",
                description: "Leave empty to keep the currently stored encrypted token.",
                placeholder: "Leave empty to keep unchanged",
              },
            }
          : {
              name: {
                type: "text",
                label: "Source name",
                description: "Shown in source lists and dashboard filters.",
                required: true,
                default: source.name,
              },
            },
      confirmText: "Save",
    });
    const name = result ? String(result.name ?? "").trim() : "";
    if (!name) return;
    const patch: Record<string, unknown> = { name };
    if (source.kind === "metrics") {
      const endpoint = String(result?.endpointUrl ?? "").trim() || source.endpointUrl?.trim();
      if (!endpoint) return;
      patch.endpointUrl = normalizeEndpointInput(endpoint);
      const interval = parseScrapeInterval(String(result?.scrapeIntervalSeconds ?? source.scrapeIntervalSeconds ?? 60));
      patch.scrapeIntervalSeconds = interval;
      const bearer = String(result?.bearerToken ?? "").trim();
      if (bearer) patch.bearerToken = bearer;
    }

    setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Source updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      setLoading(false);
    }
  };

  const removeSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    if (
      !(await prompts.confirm(`Remove source "${source.name}"? Existing samples stay available, but new data will stop.`, {
        title: "Remove source",
        variant: "danger",
      }))
    )
      return;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}`, { method: "DELETE" });
      setSelectedSourceId((current) => (current === source.id ? "" : current));
      await loadBaseData(baseId);
      await refreshDashboard();
      toast.success("Source removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove source");
    } finally {
      setLoading(false);
    }
  };

  const defaultMetricAggregation = (type: MetricType): Aggregation => {
    if (type === "counter") return "rate";
    if (type === "histogram" || type === "summary") return "p95";
    return "latest";
  };

  const loadActivityMetricDetail = async (metric: PulseMetricSummary | null, baseId = selectedBaseId()) => {
    if (!baseId || !metric) {
      setActivityMetricSeries([]);
      setActivityMetricPoints([]);
      return;
    }
    const [nextSeries, nextPoints] = await Promise.all([
      fetchMetricSeries(baseId, metric.name).catch(() => []),
      jsonFetch<MetricQueryPoint[]>("/api/pulse/query/metric", {
        method: "POST",
        body: JSON.stringify({
          baseId,
          metric: metric.name,
          aggregation: defaultMetricAggregation(metric.type),
          bucket: metric.type === "gauge" ? "1m" : "5m",
          since: "24h",
        }),
      }).catch(() => []),
    ]);
    setActivityMetricSeries(nextSeries);
    setActivityMetricPoints(nextPoints);
  };

  const currentExplorerQuery = () => queryText().trim() || defaultQueryText() || defaultPulseQuery(metrics());

  const applyQueryDimensionFilter = (key: string, value: string) => {
    const query = currentExplorerQuery();
    if (!query) return;
    const filter = `${key}=${quoteQueryPart(value)}`;
    setQueryText(/\bwhere\b/i.test(query) ? `${query}, ${filter}` : `${query} where ${filter}`);
  };

  const applyQuerySourceFilter = (sourceId: string) => {
    const query = currentExplorerQuery();
    if (!query || /\bsource\b/i.test(query)) return;
    setQueryText(`${query} source ${sourceId}`);
  };

  const rememberQuery = (baseId: string, query: string) => {
    const next = [{ query, ranAt: new Date().toISOString() }, ...queryHistory().filter((item) => item.query !== query)].slice(0, 20);
    setQueryHistory(next);
    writeQueryHistory(baseId, next);
  };

  const runTextQuery = async (options: { query?: string; manual?: boolean; remember?: boolean } = {}) => {
    const baseId = selectedBaseId();
    const query = options.query?.trim() || currentExplorerQuery();
    if (!baseId || !query) return;
    const runId = ++queryRunId;
    setQueryRunning(true);
    try {
      const result = await jsonFetch<MetricTextQueryResult>("/api/pulse/query/metric-text", {
        method: "POST",
        body: JSON.stringify({ baseId, query }),
      });
      if (runId !== queryRunId) return;
      setQueryText(query);
      if (result.compiled.kind === "metric") {
        setSelectedMetric(result.compiled.metric);
        setSelectedAggregation(result.compiled.aggregation);
        setSelectedBucket(result.compiled.bucket);
        setSelectedSince(result.compiled.since);
        setSelectedSourceId(result.compiled.sourceId ?? "");
      } else if (explorerResultView() === "chart") {
        setExplorerResultView("table");
      }
      setPoints(result.points);
      setExplorerEvents(result.events);
      setExplorerStates(result.states);
      setQueryDiagnostics({ ok: true, diagnostics: [{ severity: "info", message: "Query is valid." }], compiled: result.compiled });
      setLastRunQuery(query);
      if (options.remember ?? options.manual ?? true) rememberQuery(baseId, query);
    } catch (error) {
      if (runId !== queryRunId) return;
      const message = error instanceof Error ? error.message : "Query failed";
      if (options.manual ?? true) {
        toast.error(message);
      } else {
        setQueryDiagnostics({ ok: false, diagnostics: [{ severity: "error", message }], compiled: null });
      }
    } finally {
      if (runId === queryRunId) setQueryRunning(false);
    }
  };

  const saveCurrentQuery = async () => {
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) return;
    const compiled = compiledQuery();
    const queryName =
      compiled?.kind === "metric" ? compiled.metric : compiled?.kind === "events" ? compiled.event || "All events" : compiled?.kind === "states" ? compiled.state || "All states" : "Pulse query";
    const result = await prompts.form({
      title: "Save query",
      icon: "ti ti-device-floppy",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: queryName },
        description: {
          type: "text",
          label: "Description",
          multiline: true,
          lines: 3,
          placeholder: "Optional notes for this query",
        },
      },
      confirmText: "Save",
    });
    if (!result) return;
    const name = String(result.name ?? "").trim();
    if (!name) return;
    setLoading(true);
    try {
      const saved = await jsonFetch<PulseSavedQuery>(`/api/pulse/bases/${baseId}/saved-queries`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: String(result.description ?? "").trim() || null,
          query,
        }),
      });
      setSavedQueries((current) => [saved, ...current]);
      toast.success("Query saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save query");
    } finally {
      setLoading(false);
    }
  };

  const removeSavedQuery = async (query: PulseSavedQuery) => {
    if (!(await prompts.confirm(`Remove saved query "${query.name}"?`, { title: "Remove query", variant: "danger" }))) return;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${query.baseId}/saved-queries/${query.id}`, { method: "DELETE" });
      setSavedQueries((current) => current.filter((item) => item.id !== query.id));
      toast.success("Query removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove query");
    } finally {
      setLoading(false);
    }
  };

  const addPanel = async () => {
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) return;
    const compiled = compiledQuery() ?? (await jsonFetch<MetricTextQueryResult>("/api/pulse/query/metric-text", {
      method: "POST",
      body: JSON.stringify({ baseId, query }),
    }).then((result) => {
      setQueryDiagnostics({ ok: true, diagnostics: [{ severity: "info", message: "Query is valid." }], compiled: result.compiled });
      setPoints(result.points);
      setExplorerEvents(result.events);
      setExplorerStates(result.states);
      return result.compiled;
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Query failed");
      return null;
    }));
    if (!compiled) return;
    if (compiled.kind !== "metric") {
      toast.error("Dashboard panels currently support metric queries only.");
      return;
    }
    const panelVisual: PanelVisual = explorerResultView() === "table" ? "table" : selectedVisual();
    const dashboard = await ensureDashboard();
    if (!dashboard) return;
    const source = sourceById().get(compiled.sourceId ?? "");
    const titleDefault = source ? `${source.name} · ${compiled.metric}` : compiled.metric;
    const result = await prompts.form({
      title: "Add dashboard panel",
      icon: "ti ti-layout-grid-add",
      fields: {
        title: { type: "text", label: "Panel title", placeholder: titleDefault },
      },
      confirmText: "Add panel",
    });
    if (!result) return;
    const title = String(result.title ?? "").trim() || compiled.metric;
    const panel: PulseDashboardPanel = {
      id: crypto.randomUUID(),
      title,
      metric: compiled.metric,
      visual: panelVisual,
      aggregation: compiled.aggregation,
      bucket: compiled.bucket,
      since: compiled.since,
      sourceId: compiled.sourceId ?? null,
      dimensions: compiled.dimensions,
    };
    const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
      method: "PATCH",
      body: JSON.stringify({ config: { ...dashboard.config, panels: [...dashboard.config.panels, panel] } }),
    });
    setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedDashboardId(updated.id);
    await loadPanel(panel, baseId);
    toast.success("Panel added");
  };

  const removePanel = async (panelId: string) => {
    const dashboard = selectedDashboard();
    if (!dashboard) return;
    const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
      method: "PATCH",
      body: JSON.stringify({ config: { ...dashboard.config, panels: dashboard.config.panels.filter((panel) => panel.id !== panelId) } }),
    });
    setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setPanelPoints((current) => {
      const next = { ...current };
      delete next[panelId];
      return next;
    });
    toast.success("Panel removed");
  };

  const compileDashboardDslPreview = async (dashboard: PulseDashboard, text: string) => {
    const baseId = selectedBaseId();
    if (!baseId || !text.trim()) {
      setDashboardDslDiagnostics(null);
      return;
    }
    try {
      const result = await jsonFetch<PulseDashboardDslCompileResult>("/api/pulse/dashboard-dsl/compile", {
        method: "POST",
        body: JSON.stringify({ baseId, text }),
      });
      setDashboardDslDiagnostics(result);
      if (result.ok && result.config) {
        setDashboardPreviewConfig(result.config);
        await Promise.all(dashboardMetricPanels(result.config).map((panel) => loadPanel(panel, baseId).catch(() => undefined)));
      }
    } catch (error) {
      setDashboardDslDiagnostics({
        ok: false,
        diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not compile dashboard", line: 1, column: 1 }],
        config: null,
      });
    }
  };

  const saveDashboardDsl = async () => {
    const dashboard = selectedDashboard();
    const compiled = dashboardDslDiagnostics();
    if (!dashboard || !compiled?.ok || !compiled.config) {
      toast.error("Fix dashboard DSL errors before saving");
      return;
    }
    setDashboardDslSaving(true);
    try {
      const config: PulseDashboardConfig = {
        ...compiled.config,
        refreshIntervalSeconds: dashboard.config.refreshIntervalSeconds,
      };
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: dashboard.name, config }),
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDashboardDslSeededFor("");
      toast.success("Dashboard saved");
      await refreshDashboard(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save dashboard");
    } finally {
      setDashboardDslSaving(false);
    }
  };

  const enablePublicLink = async (dashboard = selectedDashboard(), options: { copy?: boolean } = {}) => {
    if (!dashboard) return;
    setLoading(true);
    try {
      const result = await jsonFetch<{ dashboard: PulseDashboard; token: string }>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
        method: "POST",
        body: "{}",
      });
      setDashboards((current) => current.map((item) => (item.id === result.dashboard.id ? result.dashboard : item)));
      const link = `${origin() || window.location.origin}/app/pulse/display/${result.token}`;
      if (options.copy) await clipboard.copy(link);
      toast.success(options.copy ? "Public dashboard link copied" : "Public dashboard link enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create public link");
    } finally {
      setLoading(false);
    }
  };

  const disablePublicLink = async (dashboard = selectedDashboard()) => {
    if (!dashboard) return;
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
        method: "DELETE",
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Public dashboard link disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable public link");
    } finally {
      setLoading(false);
    }
  };

  const updateDashboardSettings = async (dashboard: PulseDashboard, input: { name: string; refreshInterval: RefreshIntervalOption }) => {
    const refreshIntervalSeconds = refreshIntervalFromOption(input.refreshInterval);
    const trimmed = input.name.trim();
    if (!trimmed) {
      toast.error("Dashboard name is required");
      return false;
    }
    setLoading(true);
    try {
      const config: PulseDashboardConfig = { ...dashboard.config, refreshIntervalSeconds };
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed, config }),
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Dashboard updated");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update dashboard");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteDashboard = async (dashboard: PulseDashboard) => {
    if (
      !(await prompts.confirm(`Delete dashboard "${dashboard.name}"?`, {
        title: "Delete dashboard",
        variant: "danger",
      }))
    )
      return false;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/dashboards/${dashboard.id}`, { method: "DELETE" });
      const nextDashboards = dashboards().filter((item) => item.id !== dashboard.id);
      setDashboards(nextDashboards);
      const fallback = nextDashboards[0] ?? null;
      if (selectedDashboardId() === dashboard.id) navigateWorkspace(fallback ? { view: "dashboard", dashboardId: fallback.id } : { view: "dashboard" });
      toast.success("Dashboard deleted");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete dashboard");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openDashboardSettingsDialog = async (dashboard: PulseDashboard) => {
    try {
      await prompts.dialog<void>(
        (close) => {
          const [name, setName] = createSignal(dashboard.name);
          const [refreshInterval, setRefreshInterval] = createSignal<RefreshIntervalOption>(refreshOptionFromConfig(dashboard.config));
          const currentDashboard = createMemo(() => dashboards().find((item) => item.id === dashboard.id) ?? dashboard);
          return (
            <div class="flex h-[72vh] min-h-0 flex-col overflow-hidden">
              <SettingsModal
                title="Dashboard settings"
                subtitle={dashboard.name}
                icon="ti ti-layout-dashboard"
                onClose={close}
                closeLabel="Close"
              >
                <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name shown in the Pulse sidebar and header.">
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateDashboardSettings(currentDashboard(), { name: name(), refreshInterval: refreshInterval() });
                    }}
                  >
                    <TextInput
                      label="Name"
                      description="Use a short dashboard name that describes the view or audience."
                      icon="ti ti-tag"
                      value={name}
                      onInput={setName}
                      required
                    />
                    <SelectInput
                      label="Auto refresh"
                      description="Controls how often Pulse refreshes this dashboard in the background. Use never for static views."
                      icon="ti ti-refresh"
                      value={refreshInterval}
                      onChange={(value) => setRefreshInterval(value as RefreshIntervalOption)}
                      options={DASHBOARD_REFRESH_OPTIONS}
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading() || !name().trim()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save
                    </button>
                    <button
                      type="button"
                      class="btn-input btn-input-sm self-start"
                      onClick={() => {
                        close();
                        openDashboardEditor(currentDashboard().id);
                      }}
                    >
                      <i class="ti ti-code" /> Edit DSL
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="public-link"
                  title="Public link"
                  icon="ti ti-link"
                  description="Anyone with the UUID link can view this dashboard's included data."
                >
                  <div class="flex flex-col gap-3">
                    <div class={currentDashboard().publicEnabled ? "info-block-success" : "info-block-info"}>
                      {currentDashboard().publicEnabled
                        ? "Public display is enabled. Copy the link whenever you need it, or disable public access."
                        : "Public display is disabled. Create a link when you want to share this dashboard without auth."}
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <button type="button" class="btn-input btn-input-sm" disabled={loading()} onClick={() => void enablePublicLink(currentDashboard(), { copy: true })}>
                        <i class="ti ti-copy" />
                        {currentDashboard().publicEnabled ? "Copy public link" : "Create and copy link"}
                      </button>
                      <Show when={currentDashboard().publicEnabled}>
                        <button type="button" class="btn-input btn-input-sm" disabled={loading()} onClick={() => void disablePublicLink(currentDashboard())}>
                          <i class="ti ti-link-off" />
                          Disable public link
                        </button>
                      </Show>
                    </div>
                  </div>
                </SettingsModal.Tab>

                <SettingsModal.Tab id="danger" title="Danger zone" icon="ti ti-alert-triangle" tone="danger" description="Delete this dashboard.">
                  <button
                    type="button"
                    class="btn-danger btn-sm"
                    disabled={loading()}
                    onClick={() => void deleteDashboard(dashboard).then((deleted) => deleted && close())}
                  >
                    <i class="ti ti-trash text-sm" />
                    Delete dashboard
                  </button>
                </SettingsModal.Tab>
              </SettingsModal>
            </div>
          );
        },
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open dashboard settings");
    }
  };

  const renderPanel = (panel: PulseDashboardPanel) => {
    const data = panelPoints()[panel.id] ?? [];
    const last = data.at(-1)?.value ?? null;
    const summary = metricByName().get(panel.metric);
    const unit = summary?.unit ?? null;
    if (panel.visual === "stat") {
      return (
        <Chart
          kind="stat"
          class="h-36 text-primary"
          label={panel.title}
          value={formatValue(last)}
          unit={unit ?? undefined}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (panel.visual === "gauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="gauge"
          class="h-44 text-primary"
          value={value}
          min={0}
          max={gaugeMax(unit, value)}
          label={panel.title}
          unit={unit ?? undefined}
        />
      );
    }
    if (panel.visual === "barGauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="barGauge"
          class="h-36 text-primary"
          data={[{ label: panel.title, value, min: 0, max: gaugeMax(unit, value), unit: unit ?? undefined }]}
          min={0}
          max={gaugeMax(unit, value)}
          unit={unit ?? undefined}
        />
      );
    }
    if (panel.visual === "bar") {
      return <Chart kind="bar" class="h-48 text-dimmed" data={pointsToBars(data)} showValues={data.length <= 16} />;
    }
    if (panel.visual === "histogram") {
      return <Chart kind="histogram" class="h-48 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    }
    if (panel.visual === "heatmap") {
      return (
        <Chart
          kind="heatmap"
          class="h-48 text-dimmed"
          data={pointsToHeatmap(data)}
          format={(value) => formatValue(value)}
          showValues={data.length <= 48}
        />
      );
    }
    if (panel.visual === "table") {
      return (
        <DataTable
          rows={data}
          columns={queryPointColumns}
          getRowId={(point) => point.bucket}
          density="compact"
          class="max-h-64 overflow-auto"
          empty="No points yet."
        />
      );
    }
    return (
      <Chart
        kind="line"
        class="h-48 text-dimmed"
        series={[{ label: panel.title, data: data.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const renderPanelCard = (panel: PulseDashboardPanel, options: { description?: string | null; removable?: boolean } = {}) => (
    <article class="paper p-4">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-primary">{panel.title}</p>
          <p class="mt-1 truncate text-xs text-dimmed">
            {panel.metric} · {panel.aggregation} / {panel.bucket}
            {panel.sourceId ? ` · ${sourceNameById().get(panel.sourceId) ?? "source"}` : ""}
          </p>
          <Show when={options.description}>
            {(description) => <p class="mt-2 text-xs leading-relaxed text-dimmed">{description()}</p>}
          </Show>
        </div>
        <Show when={options.removable}>
          <button type="button" class="btn-icon" title="Remove panel" onClick={() => void removePanel(panel.id)}>
            <i class="ti ti-x" />
          </button>
        </Show>
      </div>
      {renderPanel(panel)}
    </article>
  );

  const renderMarkdownWidget = (widget: PulseDashboardMarkdownWidget) => (
    <article class="paper p-4">
      <Show when={widget.title || widget.description}>
        <div class="mb-3">
          <Show when={widget.title}>
            {(title) => <p class="text-sm font-semibold text-primary">{title()}</p>}
          </Show>
          <Show when={widget.description}>
            {(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}
          </Show>
        </div>
      </Show>
      <MarkdownView html={markdown.render(widget.markdown)} smallHeadings class="text-sm" />
    </article>
  );

  const renderCardWidget = (widget: PulseDashboardCardWidget) => (
    <article class="paper p-4">
      <div class="mb-3">
        <p class="text-sm font-semibold text-primary">{widget.title}</p>
        <Show when={widget.description}>
          {(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}
        </Show>
      </div>
      <div class="space-y-3">
        <For each={widget.rows}>{(row) => renderDashboardRow(row)}</For>
      </div>
    </article>
  );

  const renderDashboardWidget = (widget: PulseDashboardWidget) => {
    const span = Math.min(12, Math.max(1, widget.span ?? 12));
    return (
      <div style={{ "grid-column": `span ${span} / span ${span}` }}>
        {widget.kind === "metric"
          ? renderPanelCard(widget, { description: widget.description })
          : widget.kind === "markdown"
            ? renderMarkdownWidget(widget)
            : renderCardWidget(widget)}
      </div>
    );
  };

  const renderDashboardRow = (row: PulseDashboardRow) => (
    <div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <For each={row.cells}>{(widget) => renderDashboardWidget(widget)}</For>
    </div>
  );

  const renderDashboardSection = (section: PulseDashboardSection) => (
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-primary">{section.title}</h2>
        <Show when={section.description}>
          {(description) => <p class="mt-1 max-w-3xl text-xs leading-relaxed text-dimmed">{description()}</p>}
        </Show>
      </div>
      <For each={section.rows}>{(row) => renderDashboardRow(row)}</For>
      <For each={section.sections}>
        {(child) => <div class="border-l border-border/70 pl-4">{renderDashboardSection(child)}</div>}
      </For>
    </section>
  );

  const refreshSourcesView = async (baseId: string, signal: AbortSignal) => {
    await loadBaseData(baseId, signal);
    const source = selectedSource();
    if (!source) return;
    await loadSourceScrapes(baseId, source.id, signal);
    if (source.kind === "http_ingest") await loadSourceTokens(baseId, source.id, signal);
  };

  const refreshActivityView = async (baseId: string, signal: AbortSignal) => {
    await loadActivityData(baseId, signal);
  };

  const refreshDashboardView = async (baseId: string, signal: AbortSignal) => {
    await loadBaseData(baseId, signal);
    await refreshDashboard(selectedDashboard(), baseId, signal);
  };

  const refreshIntervalForView = (view: WorkspaceView): number | null => {
    if (view === "dashboard") {
      const interval = selectedDashboard()?.config.refreshIntervalSeconds;
      return interval === null ? null : (interval ?? 5);
    }
    if (view === "sources" || view === "activity-events" || view === "activity-states" || view === "activity-metrics") return 5;
    return null;
  };

  onMount(() => {
    setOrigin(window.location.origin);
    const onPopState = () => applyWorkspacePathState();
    window.addEventListener("popstate", onPopState);
    void loadBaseData();
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setQueryHistory(readQueryHistory(baseId));
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    const view = activeView();
    selectedDashboardId();
    selectedDashboard()?.config.refreshIntervalSeconds;
    if (!baseId) return;
    const intervalSeconds = refreshIntervalForView(view);
    if (intervalSeconds === null) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentRefresh: AbortController | undefined;
    let failures = 0;

    const run = () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(intervalSeconds * 1000);
        return;
      }

      currentRefresh?.abort();
      const refresh = new AbortController();
      currentRefresh = refresh;
      const task =
        view === "dashboard"
          ? refreshDashboardView(baseId, refresh.signal)
          : view === "sources"
            ? refreshSourcesView(baseId, refresh.signal)
            : refreshActivityView(baseId, refresh.signal);

      task
        .then(() => {
          failures = 0;
        })
        .catch((error) => {
          if (refresh.signal.aborted) return;
          failures += 1;
          console.warn("Pulse workspace refresh failed", error);
        })
        .finally(() => {
          if (currentRefresh === refresh) currentRefresh = undefined;
          schedule(Math.min(60_000, intervalSeconds * 1000 * Math.max(1, 2 ** failures)));
        });
    };

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(run, delayMs + Math.floor(Math.random() * 350));
    };

    schedule(intervalSeconds * 1000);
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      currentRefresh?.abort();
    });
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    if (dashboard) void refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    if (activeView() !== "dashboard-edit" || !dashboard) return;
    if (dashboardDslSeededFor() === dashboard.id) return;
    const text = dashboardToDsl(dashboard);
    setDashboardDslText(text);
    setDashboardPreviewConfig(dashboard.config);
    setDashboardDslDiagnostics(null);
    setDashboardDslSeededFor(dashboard.id);
    void refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    const text = dashboardDslText();
    if (activeView() !== "dashboard-edit" || !dashboard || dashboardDslSeededFor() !== dashboard.id) return;
    const timeout = setTimeout(() => void compileDashboardDslPreview(dashboard, text), 350);
    onCleanup(() => clearTimeout(timeout));
  });

  createEffect(() => {
    if (querySeeded() || queryText().trim() || metrics().length === 0) return;
    setQueryText(defaultPulseQuery(metrics()));
    setQuerySeeded(true);
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) {
      setQueryDiagnostics(null);
      return;
    }
    let canceled = false;
    const timeout = setTimeout(() => {
      void jsonFetch<PulseQueryCompileResult>("/api/pulse/query/compile-text", {
        method: "POST",
        body: JSON.stringify({ baseId, query }),
      })
        .then((result) => {
          if (canceled || query !== currentExplorerQuery()) return;
          setQueryDiagnostics(result);
          if (result.ok && result.compiled && query !== lastAutoRunQuery) {
            lastAutoRunQuery = query;
            void runTextQuery({ query, manual: false, remember: false });
          }
        })
        .catch((error) => {
          if (canceled) return;
          setQueryDiagnostics({
            ok: false,
            diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not compile query" }],
            compiled: null,
          });
        });
    }, 250);
    onCleanup(() => {
      canceled = true;
      clearTimeout(timeout);
    });
  });

  createEffect(() => {
    void loadSeries(selectedBaseId(), selectedMetric(), selectedSourceId()).catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    const compiled = compiledMetricQuery();
    const baseId = selectedBaseId();
    if (!compiled || !baseId) return;
    void loadSeries(baseId, compiled.metric, compiled.sourceId ?? "").catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    activitySearch();
    metricTypeFilter();
    const refresh = new AbortController();
    void loadActivityData(baseId, refresh.signal).catch(() => {
      if (refresh.signal.aborted) return;
      setRecentEvents([]);
      setCurrentStates([]);
      setActivityMetrics([]);
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    const metric = selectedActivityMetric();
    void loadActivityMetricDetail(metric, baseId).catch(() => {
      setActivityMetricSeries([]);
      setActivityMetricPoints([]);
    });
  });

  createEffect(() => {
    const source = selectedSource();
    if (!source || activeView() !== "sources") return;
    void loadSourceScrapes(selectedBaseId(), source.id).catch(() => {
      setSourceScrapes((current) => ({ ...current, [source.id]: [] }));
    });
    if (source.kind === "http_ingest") {
      void loadSourceTokens(selectedBaseId(), source.id).catch(() => {
        setSourceTokens((current) => ({ ...current, [source.id]: [] }));
      });
    }
  });

  createEffect(() => {
    sources();
    dashboards();
    const view = activeView();
    if (view === "dashboard" || view === "dashboard-edit") {
      const dashboardId = selectedDashboardId();
      navigateWorkspace({ view, dashboardId }, "replace");
    } else if (view === "sources") {
      navigateWorkspace({ view, sourceId: selectedSourceId() }, "replace");
    }
  });

  const openDashboard = (dashboardId: string) => {
    navigateWorkspace({ view: "dashboard", dashboardId });
  };

  const openDashboardEditor = (dashboardId = selectedDashboardId()) => {
    if (!dashboardId) return;
    navigateWorkspace({ view: "dashboard-edit", dashboardId });
  };

  const renderDashboardSidebarItem = (dashboard: PulseDashboard) => {
    return (
      <div
        class="sidebar-item group text-xs"
        classList={{ "sidebar-item-active": (activeView() === "dashboard" || activeView() === "dashboard-edit") && selectedDashboard()?.id === dashboard.id }}
        title={dashboard.name}
      >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openDashboard(dashboard.id)}>
          <i class="ti ti-chart-area-line text-sm" />
          <span class="truncate">{dashboard.name}</span>
        </button>
        <button
          type="button"
          class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Open settings for ${dashboard.name}`}
          title="Dashboard settings"
          onClick={(event) => {
            event.stopPropagation();
            void openDashboardSettingsDialog(dashboard);
          }}
        >
          <i class="ti ti-settings text-xs" />
        </button>
      </div>
    );
  };

  const openSources = () => {
    navigateWorkspace({ view: "sources", sourceId: selectedSourceId() });
  };

  const selectSource = (source: PulseSource) => {
    navigateWorkspace({ view: "sources", sourceId: source.id });
  };

  const openQueryExplorer = () => navigateWorkspace({ view: "explorer" });
  const openActivityEvents = () => navigateWorkspace({ view: "activity-events" });
  const openActivityStates = () => navigateWorkspace({ view: "activity-states" });
  const openActivityMetrics = () => navigateWorkspace({ view: "activity-metrics" });

  const replaceActivityUrl = () => {
    const view = activeView();
    if (view !== "activity-events" && view !== "activity-states" && view !== "activity-metrics") return;
    navigateWorkspace({ view }, "replace");
  };

  const updateActivitySearch = (value: string) => {
    setActivitySearch(value);
    replaceActivityUrl();
  };

  const updateMetricTypeFilter = (value: string[]) => {
    setMetricTypeFilter((value[0] ?? "") as "" | MetricType);
    replaceActivityUrl();
  };

  const selectEvent = (event: PulseRecordedEvent) => {
    setSelectedEventId(event.id);
    setSelectedStateId("");
    setSelectedActivityMetricName("");
    replaceActivityUrl();
  };

  const selectState = (state: PulseCurrentState) => {
    setSelectedStateId(stateRowId(state));
    setSelectedEventId("");
    setSelectedActivityMetricName("");
    replaceActivityUrl();
  };

  const selectActivityMetric = (metric: PulseMetricSummary) => {
    setSelectedActivityMetricName(metric.name);
    setSelectedEventId("");
    setSelectedStateId("");
    replaceActivityUrl();
  };

  const closeActivityDetail = () => {
    setSelectedEventId("");
    setSelectedStateId("");
    setSelectedActivityMetricName("");
    replaceActivityUrl();
  };

  const renderDashboardConfigContent = (config: () => PulseDashboardConfig | null, options: { removable?: boolean } = {}) => {
    const currentConfig = createMemo(() => {
      const value = config();
      return value && (value.panels.length || dashboardLayoutWidgets(value).length) ? value : null;
    });
    return (
      <Show
        when={currentConfig()}
        fallback={
          <div class="paper flex flex-1 items-center justify-center p-8 text-center text-sm text-dimmed">
            Open the query explorer or dashboard editor to add the first panel.
          </div>
        }
      >
        {(currentConfig) => (
          <div class="space-y-4">
            <Show when={currentConfig().layout}>
              {(layout) => (
                <>
                  <Show when={layout().description}>
                    {(description) => <p class="max-w-3xl text-sm leading-relaxed text-dimmed">{description()}</p>}
                  </Show>
                  <For each={layout().sections}>{(section) => renderDashboardSection(section)}</For>
                </>
              )}
            </Show>
            <Show when={currentConfig().panels.length}>
              <div class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                <For each={currentConfig().panels}>{(panel) => renderPanelCard(panel, { removable: options.removable })}</For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    );
  };

  const renderDashboardView = () => (
    <section class="flex min-h-0 flex-1 flex-col">
      {renderDashboardConfigContent(() => selectedDashboard()?.config ?? null, { removable: true })}
    </section>
  );

  const appendDashboardDslSnippet = (snippet: string) => {
    setDashboardDslText((current) => `${current.trimEnd()}\n\n${snippet}\n`);
  };

  const renderReferenceList = (props: {
    title: string;
    icon: string;
    items: { label: string; meta?: string; snippet?: string }[];
    empty: string;
  }) => (
    <section class="paper p-3">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
        <i class={`${props.icon} text-sm text-dimmed`} />
        <span>{props.title}</span>
      </div>
      <Show when={props.items.length} fallback={<p class="text-xs text-dimmed">{props.empty}</p>}>
        <div class="max-h-40 overflow-auto">
          <For each={props.items.slice(0, 24)}>
            {(item) => (
              <Show
                when={item.snippet}
                fallback={
                  <div class="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs">
                    <span class="truncate font-medium text-secondary">{item.label}</span>
                    <Show when={item.meta}>
                      {(meta) => <span class="shrink-0 text-[11px] text-dimmed">{meta()}</span>}
                    </Show>
                  </div>
                }
              >
                {(snippet) => (
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    onClick={() => appendDashboardDslSnippet(snippet())}
                    title="Append DSL snippet"
                  >
                    <span class="truncate font-medium text-secondary">{item.label}</span>
                    <Show when={item.meta}>
                      {(meta) => <span class="shrink-0 text-[11px] text-dimmed">{meta()}</span>}
                    </Show>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </section>
  );

  const dashboardReferenceSources = createMemo(() =>
    sources().map((source) => ({
      label: source.name,
      meta: source.kind,
      snippet: `section ${quoteDashboardDslString(source.name)} {\n  chart "Metric" {\n    query metric metric.name avg every 5m since 24h source ${source.id}\n  }\n}`,
    })),
  );

  const dashboardReferenceMetrics = createMemo(() =>
    metrics().map((metric) => ({
      label: metric.name,
      meta: metric.type,
      snippet: `chart ${quoteDashboardDslString(metric.name)} {\n  query metric ${metric.name} ${metric.type === "counter" ? "rate" : "avg"} every 5m since 24h\n}`,
    })),
  );

  const dashboardReferenceEvents = createMemo(() => {
    const names = [...new Set(recentEvents().map((event) => event.kind))].sort();
    return names.map((name) => ({
      label: name,
      meta: "event",
      snippet: `table ${quoteDashboardDslString(name)} {\n  query events ${name} since 24h limit 100\n}`,
    }));
  });

  const dashboardReferenceStates = createMemo(() => {
    const names = [...new Set(currentStates().map((state) => state.key))].sort();
    return names.map((name) => ({
      label: name,
      meta: "state",
      snippet: `table ${quoteDashboardDslString(name)} {\n  query states ${name} limit 100\n}`,
    }));
  });

  const dashboardReferenceLabels = createMemo(() => {
    const labels = new Map<string, Set<string>>();
    const addDimensions = (dimensions: Record<string, string>) => {
      for (const [key, value] of Object.entries(dimensions)) {
        if (!labels.has(key)) labels.set(key, new Set());
        labels.get(key)!.add(value);
      }
    };
    for (const item of series()) addDimensions(item.dimensions);
    for (const item of recentEvents()) addDimensions(item.dimensions);
    for (const item of currentStates()) addDimensions(item.dimensions);
    return [...labels.entries()]
      .map(([label, values]) => ({ label, meta: `${values.size} values` }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });

  const dashboardReferenceEntities = createMemo(() => {
    const entities = new Map<string, { type: string | null; count: number }>();
    const addEntity = (entityId: string | null, entityType: string | null) => {
      if (!entityId) return;
      const current = entities.get(entityId);
      entities.set(entityId, { type: current?.type ?? entityType, count: (current?.count ?? 0) + 1 });
    };
    for (const item of series()) addEntity(item.entityId, item.entityType);
    for (const item of recentEvents()) addEntity(item.entityId, item.entityType);
    for (const item of currentStates()) addEntity(item.entityId, item.entityType);
    return [...entities.entries()]
      .map(([label, value]) => ({ label, meta: value.type ? `${value.type} · ${value.count}` : `${value.count}` }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });

  const renderDashboardEditView = () => {
    return (
      <section class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <button
              type="button"
              class="mb-1 inline-flex items-center gap-1 text-xs text-dimmed hover:text-primary"
              onClick={() => selectedDashboard() && openDashboard(selectedDashboard()!.id)}
            >
              <i class="ti ti-arrow-left" /> Back to dashboard
            </button>
            <h1 class="truncate text-base font-semibold text-primary">{selectedDashboard()?.name ?? "Dashboard"} DSL</h1>
            <p class="mt-0.5 text-xs text-dimmed">Author sections, cards, markdown, and query-backed widgets.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span
              class={`chip border-0 ${
                dashboardDslDiagnostics()?.ok
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                  : dashboardDslDiagnostics()
                    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                    : ""
              }`}
            >
              <i class={`ti ${dashboardDslDiagnostics()?.ok ? "ti-check" : dashboardDslDiagnostics() ? "ti-alert-circle" : "ti-clock"}`} />
              <span>{dashboardDslDiagnostics()?.ok ? "Valid" : dashboardDslDiagnostics() ? "Invalid" : "Waiting"}</span>
            </span>
            <button
              type="button"
              class="btn-input btn-input-sm"
              disabled={!selectedDashboard() || dashboardDslSaving() || !dashboardDslDiagnostics()?.ok}
              onClick={() => void saveDashboardDsl()}
            >
              <i class={`ti ${dashboardDslSaving() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} /> Save
            </button>
            <button type="button" class="btn-input btn-input-sm" onClick={() => openQueryReferenceWindow(selectedBaseId(), { dashboardDsl: true })}>
              <i class="ti ti-external-link" /> Query reference
            </button>
          </div>
        </div>

        <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(420px,0.95fr)_minmax(520px,1.25fr)]">
          <div class="flex min-h-0 flex-col gap-3">
            <div class="paper overflow-hidden p-0">
              <AutocompleteEditor
                value={dashboardDslText}
                onInput={setDashboardDslText}
                lines={18}
                spellcheck={false}
                ariaLabel="Pulse dashboard DSL"
                ariaInvalid={dashboardDslDiagnostics()?.ok === false}
                placeholder={'dashboard "Solar overview" {\n  section "Today" {\n    gauge "Charge" {\n      query metric solar.battery.charge_percent latest since 10m\n    }\n  }\n}'}
              />
            </div>
            <Show when={dashboardDslDiagnostics()?.diagnostics.length}>
              <div class="space-y-1">
                <For each={dashboardDslDiagnostics()?.diagnostics ?? []}>
                  {(diagnostic) => (
                    <p class="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-300">
                      <i class="ti ti-alert-circle" />
                      {diagnostic.line}:{diagnostic.column} · {diagnostic.message}
                    </p>
                  )}
                </For>
              </div>
            </Show>
            <div class="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {renderReferenceList({ title: "Sources", icon: "ti ti-database-share", items: dashboardReferenceSources(), empty: "No sources yet." })}
              {renderReferenceList({ title: "Metrics", icon: "ti ti-chart-dots", items: dashboardReferenceMetrics(), empty: "No metrics yet." })}
              {renderReferenceList({ title: "Events", icon: "ti ti-bolt", items: dashboardReferenceEvents(), empty: "No events yet." })}
              {renderReferenceList({ title: "States", icon: "ti ti-toggle-right", items: dashboardReferenceStates(), empty: "No states yet." })}
              {renderReferenceList({ title: "Labels", icon: "ti ti-tags", items: dashboardReferenceLabels(), empty: "No labels yet." })}
              {renderReferenceList({ title: "Entities", icon: "ti ti-cube", items: dashboardReferenceEntities(), empty: "No entities yet." })}
            </div>
          </div>

          <div class="min-h-0 overflow-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
            {renderDashboardConfigContent(() => dashboardEditPreviewConfig())}
          </div>
        </div>
      </section>
    );
  };

  const renderSourceCell = (
    source: PulseSource,
    col: DataTableColumn<PulseSource>,
    render: (value: unknown) => JSX.Element,
  ): JSX.Element => {
    if (col.id === "source") {
      const status = sourceStatus(source);
      return (
        <div class="flex min-w-0 items-center gap-2">
          <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <i class={`${sourceKindIcon(source.kind)} text-base`} />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-primary">{source.name}</p>
            <p class={`mt-0.5 flex items-center gap-1 truncate text-xs ${status.text}`}>
              <span class={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
              {status.label}
              <span class="text-dimmed">· {source.kind}</span>
            </p>
          </div>
        </div>
      );
    }
    if (col.id === "status") {
      const status = sourceStatus(source);
      return (
        <span class={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${status.text}`}>
          <i class={status.icon} />
          {status.label}
        </span>
      );
    }
    if (col.id === "target") {
      if (source.kind === "metrics") {
        return (
          <div class="min-w-0">
            <p class="truncate text-xs text-secondary" title={source.endpointUrl ?? ""}>
              {source.endpointUrl ?? "No endpoint"}
            </p>
            <p class="mt-1 text-xs text-dimmed">Every {source.scrapeIntervalSeconds ?? 60}s</p>
          </div>
        );
      }
      if (source.kind === "http_ingest") return <span class="text-xs text-secondary">Token ingest endpoint</span>;
      return <span class="text-xs text-secondary">Internal app telemetry</span>;
    }
    if (col.id === "seen") return source.lastSeenAt ? compactDateWithDelta(source.lastSeenAt) : "Waiting";
    return render(source[col.id as keyof PulseSource]);
  };

  const renderSourceScrapeCell = (scrape: PulseSourceScrape, col: DataTableColumn<PulseSourceScrape>): JSX.Element => {
    if (col.id === "status") {
      return (
        <span
          class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            scrape.success
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          <i class={`ti ${scrape.success ? "ti-check" : "ti-alert-circle"}`} />
          {scrape.success ? "Success" : "Error"}
        </span>
      );
    }
    if (col.id === "finished") return <span class="text-xs text-secondary">{compactDateWithDelta(scrape.finishedAt)}</span>;
    if (col.id === "samples") return <span class="text-xs text-secondary">{formatIngestCounts(scrape)}</span>;
    if (col.id === "duration") return <span class="text-xs text-secondary">{scrape.durationMs}ms</span>;
    if (col.id === "error") {
      return (
        <span class={scrape.errorMessage ? "line-clamp-2 text-xs text-red-600 dark:text-red-300" : "text-xs text-dimmed"}>
          {scrape.errorMessage ?? "-"}
        </span>
      );
    }
    return null;
  };

  const renderSourceTokenCell = (source: PulseSource, token: PulseSourceToken, col: DataTableColumn<PulseSourceToken>): JSX.Element => {
    if (col.id === "label") {
      return (
        <span class="inline-flex items-center gap-2 text-xs font-medium text-secondary">
          <i class="ti ti-key text-dimmed" />
          {token.label}
        </span>
      );
    }
    if (col.id === "created") return <span class="text-xs text-secondary">{compactDateWithDelta(token.createdAt)}</span>;
    if (col.id === "used") return <span class="text-xs text-secondary">{token.lastUsedAt ? compactDateWithDelta(token.lastUsedAt) : "Never"}</span>;
    if (col.id === "actions") {
      return (
        <button
          type="button"
          class="btn-simple btn-sm text-dimmed hover:text-red-600"
          title={`Remove ${token.label}`}
          disabled={loading()}
          onClick={(event) => {
            event.stopPropagation();
            void removeIngestToken(source, token);
          }}
        >
          <i class="ti ti-trash" />
        </button>
      );
    }
    return null;
  };

  const renderEventCell = (
    event: PulseRecordedEvent,
    col: DataTableColumn<PulseRecordedEvent>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "source") return <span class="text-xs text-secondary">{sourceNameById().get(event.sourceId ?? "") ?? "-"}</span>;
    if (col.id === "entity") return <span class="text-xs text-secondary">{event.entityId || "-"}</span>;
    if (col.id === "value") return <span class="text-xs text-secondary">{event.value === null ? "-" : formatValue(event.value)}</span>;
    if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(event.ts)}</span>;
    return render(event[col.id as keyof PulseRecordedEvent]);
  };

  const renderStateCell = (state: PulseCurrentState, col: DataTableColumn<PulseCurrentState>, render: (value: unknown) => JSX.Element) => {
    if (col.id === "value") {
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={formatSignalValue(state.value)}>
          {formatSignalValue(state.value)}
        </span>
      );
    }
    if (col.id === "source") return <span class="text-xs text-secondary">{sourceNameById().get(state.sourceId ?? "") ?? "-"}</span>;
    if (col.id === "entity") return <span class="text-xs text-secondary">{state.entityId || "-"}</span>;
    if (col.id === "updated") return <span class="text-xs text-secondary">{compactDateWithDelta(state.updatedAt)}</span>;
    return render(state[col.id as keyof PulseCurrentState]);
  };

  const renderMetricCell = (
    metric: PulseMetricSummary,
    col: DataTableColumn<PulseMetricSummary>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "unit") return <span class="text-xs text-secondary">{metric.unit ?? "-"}</span>;
    if (col.id === "series") return <span class="text-xs text-secondary">{metric.seriesCount}</span>;
    if (col.id === "lastSeen")
      return <span class="text-xs text-secondary">{metric.lastSeenAt ? compactDateWithDelta(metric.lastSeenAt) : "-"}</span>;
    return render(metric[col.id as keyof PulseMetricSummary]);
  };

  const renderActivityToolbar = (kind: "events" | "states" | "metrics") => (
    <div class="flex min-w-0 flex-1 shrink-0 flex-wrap items-center gap-2">
      <div class="min-w-64 flex-1">
        <TextInput
          type="search"
          icon="ti ti-search"
          value={activitySearch}
          onInput={updateActivitySearch}
          placeholder={kind === "events" ? "Search events..." : kind === "states" ? "Search states..." : "Search metrics..."}
          clearable
        />
      </div>
      <Show when={kind === "metrics"}>
        <FilterChip
          label="Type"
          icon="ti ti-filter"
          value={metricTypeFilter() ? [metricTypeFilter()] : []}
          onChange={updateMetricTypeFilter}
          options={METRIC_TYPE_FILTER_OPTIONS}
        />
      </Show>
    </div>
  );

  const openSourceFromDetail = (sourceId: string | null | undefined) => {
    if (!sourceId) return;
    navigateWorkspace({ view: "sources", sourceId });
  };

  const renderEventDetail = (event: PulseRecordedEvent) => (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <section class="detail-section-compact">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold leading-5 text-primary">{event.kind}</h2>
            <p class="mt-1 text-xs text-dimmed">{compactDateWithDelta(event.ts)} · event</p>
          </div>
          <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={closeActivityDetail}>
            <i class="ti ti-x" />
          </button>
        </div>
      </section>
      <div class="detail-stack">
        <section class="detail-section">
          <h3 class="detail-section-label">Event</h3>
          <div class="detail-row">
            <i class="ti ti-number detail-row-icon text-blue-500" />
            <span class="detail-row-label">Value</span>
            <span>{event.value === null ? "-" : formatValue(event.value)}</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-box detail-row-icon text-emerald-600" />
            <span class="detail-row-label">Entity</span>
            <span>{event.entityId || "-"}</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-database detail-row-icon text-violet-500" />
            <span class="detail-row-label">Source</span>
            <span>{sourceNameById().get(event.sourceId ?? "") ?? "-"}</span>
          </div>
          <Show when={event.sourceId}>
            {(sourceId) => (
              <button type="button" class="btn-input btn-input-sm mt-3 self-start" onClick={() => openSourceFromDetail(sourceId())}>
                <i class="ti ti-arrow-right" /> Open source
              </button>
            )}
          </Show>
        </section>
        <section class="detail-section">
          <StructuredDataPreview title="Dimensions" data={event.dimensions} empty="No dimensions." />
        </section>
        <section class="detail-section">
          <StructuredDataPreview title="Payload" data={event.payload} empty="No payload." />
        </section>
      </div>
    </div>
  );

  const renderStateDetail = (state: PulseCurrentState) => (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <section class="detail-section-compact">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold leading-5 text-primary">{state.key}</h2>
            <p class="mt-1 text-xs text-dimmed">{compactDateWithDelta(state.updatedAt)} · state</p>
          </div>
          <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={closeActivityDetail}>
            <i class="ti ti-x" />
          </button>
        </div>
      </section>
      <div class="detail-stack">
        <section class="detail-section">
          <h3 class="detail-section-label">Current value</h3>
          <p class="break-all text-sm font-medium text-primary">{formatSignalValue(state.value)}</p>
        </section>
        <section class="detail-section">
          <h3 class="detail-section-label">State</h3>
          <div class="detail-row">
            <i class="ti ti-box detail-row-icon text-emerald-600" />
            <span class="detail-row-label">Entity</span>
            <span>{state.entityId || "-"}</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-database detail-row-icon text-violet-500" />
            <span class="detail-row-label">Source</span>
            <span>{sourceNameById().get(state.sourceId ?? "") ?? "-"}</span>
          </div>
          <Show when={state.sourceId}>
            {(sourceId) => (
              <button type="button" class="btn-input btn-input-sm mt-3 self-start" onClick={() => openSourceFromDetail(sourceId())}>
                <i class="ti ti-arrow-right" /> Open source
              </button>
            )}
          </Show>
        </section>
        <section class="detail-section">
          <StructuredDataPreview title="Dimensions" data={state.dimensions} empty="No dimensions." />
        </section>
      </div>
    </div>
  );

  const renderActivityMetricChart = (metric: PulseMetricSummary) => {
    const data = activityMetricPoints();
    const last = data.at(-1)?.value ?? null;
    if (metric.type === "gauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="gauge"
          class="h-44 text-primary"
          value={value}
          min={0}
          max={gaugeMax(metric.unit, value)}
          label="Latest"
          unit={metric.unit ?? undefined}
        />
      );
    }
    if (metric.type === "counter") {
      return (
        <Chart
          kind="stat"
          class="h-36 text-primary"
          label="Rate"
          value={formatValue(last)}
          unit={metric.unit ?? undefined}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (metric.type === "histogram") {
      return <Chart kind="histogram" class="h-44 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    }
    return (
      <Chart
        kind="line"
        class="h-44 text-dimmed"
        series={[{ label: metric.name, data: data.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const renderMetricDetail = (metric: PulseMetricSummary) => (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <section class="detail-section-compact">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold leading-5 text-primary">{metric.name}</h2>
            <p class="mt-1 text-xs text-dimmed">
              {metric.type} · {metric.seriesCount} series{metric.unit ? ` · ${metric.unit}` : ""}
            </p>
          </div>
          <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={closeActivityDetail}>
            <i class="ti ti-x" />
          </button>
        </div>
      </section>
      <div class="detail-stack">
        <section class="detail-section">
          {renderActivityMetricChart(metric)}
        </section>
        <section class="detail-section">
          <h3 class="detail-section-label">Metric</h3>
          <div class="detail-row">
            <i class="ti ti-clock detail-row-icon text-blue-500" />
            <span class="detail-row-label">Last seen</span>
            <span>{metric.lastSeenAt ? compactDateWithDelta(metric.lastSeenAt) : "-"}</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-stack-3 detail-row-icon text-emerald-600" />
            <span class="detail-row-label">Series</span>
            <span>{metric.seriesCount}</span>
          </div>
        </section>
        <section class="detail-section">
          <h3 class="detail-section-label">Sources</h3>
          <Show
            when={activityMetricSources().length}
            fallback={<p class="text-xs text-dimmed">No source attached to this metric yet.</p>}
          >
            <div class="flex flex-col gap-2">
              <For each={activityMetricSources()}>
                {(source) => (
                  <button type="button" class="btn-input btn-input-sm justify-start" onClick={() => openSourceFromDetail(source.id)}>
                    <i class="ti ti-database-share" /> {source.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );

  const renderSourcesView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            value={sourceSearch}
            onInput={setSourceSearch}
            placeholder="Search sources..."
            clearable
          />
        </div>
        <button type="button" class="btn-input btn-input-sm" disabled={!selectedBaseId() || loading()} onClick={() => void addSource()}>
          <i class="ti ti-plus" /> Source
        </button>
      </div>
      <DataTable
        rows={filteredSources()}
        columns={sourceColumns}
        getRowId={(source) => source.id}
        selectedRowId={selectedSourceId() || null}
        onRowClick={selectSource}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No sources yet."
        scrollPreserveKey="pulse-sources-table"
        renderCell={({ row: source, col, render }) => renderSourceCell(source, col, render)}
      />
    </section>
  );

  const renderExplorerChart = () => {
    const data = points();
    const title = compiledMetricQuery()?.metric ?? (selectedMetric() || "Query");
    const last = data.at(-1)?.value ?? null;
    const unit = previewUnit();
    if (selectedVisual() === "stat") {
      return <Chart kind="stat" class="h-full min-h-72 text-primary" label={title} value={formatValue(last)} unit={unit ?? undefined} sparkline={data.map((point) => point.value ?? 0)} />;
    }
    if (selectedVisual() === "gauge") {
      const value = last ?? 0;
      return <Chart kind="gauge" class="h-full min-h-72 text-primary" value={value} min={0} max={gaugeMax(unit, value)} label={title} unit={unit ?? undefined} />;
    }
    if (selectedVisual() === "barGauge") {
      const value = last ?? 0;
      return <Chart kind="barGauge" class="h-full min-h-72 text-primary" data={[{ label: title, value, min: 0, max: gaugeMax(unit, value), unit: unit ?? undefined }]} min={0} max={gaugeMax(unit, value)} unit={unit ?? undefined} />;
    }
    if (selectedVisual() === "bar") return <Chart kind="bar" class="h-full min-h-72 text-dimmed" data={pointsToBars(data)} showValues={data.length <= 16} />;
    if (selectedVisual() === "histogram") return <Chart kind="histogram" class="h-full min-h-72 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    if (selectedVisual() === "heatmap") return <Chart kind="heatmap" class="h-full min-h-72 text-dimmed" data={pointsToHeatmap(data)} format={(value) => formatValue(value)} showValues={data.length <= 48} />;
    return (
      <Chart
        kind="line"
        class="h-full min-h-72 text-dimmed"
        series={previewSeries()}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const renderExplorerResult = () => {
    const compiled = compiledQuery();
    const queryWasRun = lastRunQuery() === currentExplorerQuery();
    if (explorerResultView() === "compiled") {
      return <StructuredDataPreview data={compiledQuery() ?? {}} empty="Run a query to see the compiled shape." />;
    }
    if (compiled?.kind === "events") {
      return (
        <DataTable
          rows={explorerEvents()}
          columns={eventColumns}
          getRowId={(event) => event.id}
          selectedRowId={null}
          density="compact"
          class="h-full overflow-auto"
          empty="Run an events query to see events."
          renderCell={({ row: event, col, render }) => renderEventCell(event, col, render)}
        />
      );
    }
    if (compiled?.kind === "states") {
      return (
        <DataTable
          rows={explorerStates()}
          columns={stateColumns}
          getRowId={stateRowId}
          selectedRowId={null}
          density="compact"
          class="h-full overflow-auto"
          empty="Run a states query to see current states."
          renderCell={({ row: state, col, render }) => renderStateCell(state, col, render)}
        />
      );
    }
    if (explorerResultView() === "table") {
      return (
        <DataTable
          rows={points()}
          columns={queryPointColumns}
          getRowId={(point) => point.bucket}
          density="compact"
          class="h-full overflow-auto"
          empty={queryWasRun ? "No points matched this metric query. Try a wider since range or check whether the source is still ingesting." : "Run a metric query to see points."}
        />
      );
    }
    if (compiled && compiled.kind !== "metric") {
      return <div class="flex h-full min-h-72 items-center justify-center text-sm text-dimmed">Use Table or Compiled for this query type.</div>;
    }
    if (points().length > 0) return renderExplorerChart();
    return (
      <div class="flex h-full min-h-72 items-center justify-center px-6 text-center text-sm text-dimmed">
        {queryWasRun ? "No points matched this metric query. Try a wider since range or check whether the source is still ingesting." : "Run a metric query to preview data."}
      </div>
    );
  };

  const renderMetricExplorerView = () => (
    <section class="grid grid-cols-1 gap-3 pb-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="flex flex-col gap-3">
        <div class="paper p-3">
          <AutocompleteEditor
            value={queryText}
            onInput={setQueryText}
            onSubmit={() => void runTextQuery({ manual: true, remember: true })}
            completions={queryCompletions()}
            highlight={pulseQueryHighlight}
            restoreExpansionOnBackspace={false}
            lines={5}
            spellcheck={false}
            placeholder="metric orders.created increase every 1h since 7d where channel=web"
            ariaLabel="Pulse query"
            ariaInvalid={queryDiagnostics()?.ok === false}
          />
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <For each={queryDiagnostics()?.diagnostics ?? []}>
              {(diagnostic) => (
                <span class={diagnostic.severity === "error" ? "text-red-600 dark:text-red-300" : "text-dimmed"}>
                  <i class={diagnostic.severity === "error" ? "ti ti-alert-circle" : "ti ti-check"} /> {diagnostic.message}
                </span>
              )}
            </For>
            <Show when={queryRunning()}>
              <span class="text-dimmed">
                <i class="ti ti-loader-2 animate-spin" /> Updating preview...
              </span>
            </Show>
          </div>
        </div>

        <Show when={compiledMetricQuery() && matchingMetricSeries().length > 0}>
          <div class="paper p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-sm font-semibold text-primary">Suggested refinements</h3>
                  <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-dimmed dark:bg-zinc-900">
                    click to autocomplete
                  </span>
                </div>
                <p class="mt-1 text-xs text-dimmed">Based on the matched series. Add a source or label to narrow the query.</p>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-dimmed">
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-stack-2" />
                  {plural(matchingMetricSeries().length, "series", "series")}
                </span>
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-database-share" />
                  {plural(matchingMetricSources().length, "source")}
                </span>
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-tags" />
                  {plural(queryFilterSuggestions().length, "label key")}
                </span>
                <Show when={querySuggestionOverflow() > 0 || querySuggestionsExpanded()}>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-full bg-zinc-100 px-2.5 text-xs font-medium text-secondary transition hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    onClick={() => setQuerySuggestionsExpanded((expanded) => !expanded)}
                  >
                    <i class={`ti ${querySuggestionsExpanded() ? "ti-chevron-up" : "ti-adjustments-horizontal"}`} />
                    {querySuggestionsExpanded() ? "Show less" : `Browse${querySuggestionOverflow() > 0 ? ` +${querySuggestionOverflow()}` : ""}`}
                  </button>
                </Show>
              </div>
            </div>
            <Show when={querySuggestionsExpanded()}>
              <div class="mt-3 max-w-xl">
                <TextInput
                  type="search"
                  icon="ti ti-search"
                  value={querySuggestionSearch}
                  onInput={setQuerySuggestionSearch}
                  placeholder="Search suggested sources and labels..."
                  clearable
                />
              </div>
            </Show>
            <div class="mt-3 space-y-2">
              <Show when={!compiledMetricQuery()?.sourceId && visibleQuerySourceSuggestions().length > 0}>
                <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                  <div class="pt-1 text-xs font-medium text-dimmed">Sources</div>
                  <div class="flex flex-wrap gap-2">
                    <For each={visibleQuerySourceSuggestions()}>
                      {({ source, count }) => (
                        <button type="button" class={suggestionTagClass} onClick={() => applyQuerySourceFilter(source.id)}>
                          <i class="ti ti-database-share" />
                          <span class="truncate">{source.name}</span>
                          <span class="text-dimmed">· {count}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <For each={visibleQueryLabelSuggestions()}>
                {(group) => (
                  <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                    <div class="truncate pt-1 text-xs font-medium text-dimmed" title={`${group.key} · ${plural(group.count, "series", "series")}`}>
                      {group.key}
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <For each={group.values}>
                        {(filter) => (
                          <button
                            type="button"
                            class={suggestionTagClass}
                            onClick={() => applyQueryDimensionFilter(filter.key, filter.value)}
                            title={`Add where ${filter.key}=${filter.value}`}
                          >
                            <i class="ti ti-tag" />
                            <span class="truncate">{filter.value}</span>
                            <span class="text-dimmed">· {filter.count}</span>
                          </button>
                        )}
                      </For>
                      <Show when={group.hiddenValues > 0}>
                        <span class="inline-flex h-7 items-center px-2 text-xs text-dimmed">+{group.hiddenValues} more</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
              <Show when={querySuggestionsExpanded() && querySuggestionMatches().sources.length === 0 && querySuggestionMatches().labels.length === 0}>
                <p class="text-xs text-dimmed">No suggested filters match this search.</p>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={compiledMetricQuery() && matchingMetricSeries().length === 0}>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-dimmed">
            <span class="inline-flex items-center gap-1">
              <i class="ti ti-stack-2" />
              0 series matched
            </span>
          </div>
        </Show>

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-input btn-input-sm" disabled={!currentExplorerQuery() || queryRunning()} onClick={() => void runTextQuery({ manual: true, remember: true })}>
            <i class={`ti ${queryRunning() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} /> Reload
          </button>
          <button type="button" class="btn-input btn-input-sm" disabled={!selectedBaseId()} onClick={() => openQueryReferenceWindow(selectedBaseId())}>
            <i class="ti ti-external-link" /> Open reference
          </button>
          <Show when={explorerResultView() !== "compiled" && compiledQuery()?.kind === "metric"}>
            <button type="button" class="btn-input btn-input-sm" disabled={!compiledQuery() || loading()} onClick={addPanel}>
              <i class="ti ti-layout-grid-add" /> Add panel
            </button>
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-40">
            <SelectInput
              icon="ti ti-layout"
              value={explorerResultView}
              onChange={(value) => setExplorerResultView(compiledQuery()?.kind !== "metric" && value === "chart" ? "table" : (value as ExplorerResultView))}
              options={RESULT_VIEW_OPTIONS}
            />
          </div>
          <Show when={explorerResultView() === "chart"}>
            <div class="min-w-44">
              <SelectInput
                icon="ti ti-chart-line"
                value={selectedVisual}
                onChange={(value) => setSelectedVisual(value as PanelVisual)}
                options={VISUAL_OPTIONS}
              />
            </div>
          </Show>
          <span class="ml-auto text-xs text-dimmed">
            {compiledQuery()?.kind === "events"
              ? `${explorerEvents().length} events`
              : compiledQuery()?.kind === "states"
                ? `${explorerStates().length} states`
                : `${points().length} points`}
          </span>
        </div>

        <div class="paper min-h-[28rem] overflow-hidden">
          <div class={explorerResultView() === "table" ? "min-h-[28rem]" : "min-h-[28rem] p-3"}>{renderExplorerResult()}</div>
        </div>
      </div>

      <aside class="flex min-h-0 flex-col gap-3">
        <div class="paper flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="flex items-center justify-between gap-2 px-3 py-2">
            <span class="text-label text-xs">Saved</span>
            <button type="button" class="text-xs font-medium text-secondary transition hover:text-blue-600" disabled={!currentExplorerQuery() || loading()} onClick={() => void saveCurrentQuery()}>
              <i class="ti ti-device-floppy" /> Save current
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
            <Show when={savedQueries().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No saved queries.</p>}>
              <For each={savedQueries()}>
                {(item) => (
                  <div class="group flex items-start gap-2 rounded px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <button type="button" class="min-w-0 flex-1 text-left" onClick={() => setQueryText(item.query)}>
                      <span class="block truncate text-sm font-medium text-secondary">{item.name}</span>
                      <code class="block truncate font-mono text-[11px] text-dimmed">{item.query}</code>
                    </button>
                    <button type="button" class="icon-btn opacity-0 group-hover:opacity-100" onClick={() => void removeSavedQuery(item)} aria-label="Remove saved query">
                      <i class="ti ti-trash" />
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="paper flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="px-3 py-2 text-label text-xs">History</div>
          <div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
            <Show when={queryHistory().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No runs yet.</p>}>
              <For each={queryHistory()}>
                {(item) => (
                  <button type="button" class="block w-full rounded px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900" onClick={() => setQueryText(item.query)}>
                    <code class="block truncate font-mono text-[11px] text-secondary">{item.query}</code>
                    <span class="text-[11px] text-dimmed">{compactDateWithDelta(item.ranAt)}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </aside>
    </section>
  );

  const renderActivityEventsView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        {renderActivityToolbar("events")}
      </div>
      <DataTable
        rows={recentEvents()}
        columns={eventColumns}
        getRowId={(event) => event.id}
        selectedRowId={selectedEventId() || null}
        onRowClick={selectEvent}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No events ingested yet."
        scrollPreserveKey="pulse-activity-events"
        renderCell={({ row, col, render }) => renderEventCell(row, col, render)}
      />
    </section>
  );

  const renderActivityStatesView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        {renderActivityToolbar("states")}
      </div>
      <DataTable
        rows={currentStates()}
        columns={stateColumns}
        getRowId={stateRowId}
        selectedRowId={selectedStateId() || null}
        onRowClick={selectState}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No states ingested yet."
        scrollPreserveKey="pulse-activity-states"
        renderCell={({ row, col, render }) => renderStateCell(row, col, render)}
      />
    </section>
  );

  const renderActivityMetricsView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        {renderActivityToolbar("metrics")}
      </div>
      <DataTable
        rows={activityMetrics()}
        columns={metricColumns}
        getRowId={(metric) => metric.name}
        selectedRowId={selectedActivityMetricName() || null}
        onRowClick={selectActivityMetric}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No metrics ingested yet."
        scrollPreserveKey="pulse-activity-metrics"
        renderCell={({ row, col, render }) => renderMetricCell(row, col, render)}
      />
    </section>
  );

  const copySetupText = async (text: string, label: string) => {
    await clipboard.copy(text);
    toast.success(label);
  };

  const createIngestToken = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId || source.kind !== "http_ingest") return;
    const result = await prompts.form({
      title: "Add ingest token",
      icon: "ti ti-key",
      fields: {
        label: { type: "text", label: "Token label", required: true, placeholder: "Production server" },
      },
      confirmText: "Create token",
    });
    if (!result) return;
    const label = String(result.label ?? "").trim();
    if (!label) return;
    setLoading(true);
    try {
      const created = await jsonFetch<{ source: PulseSource; token: PulseSourceToken; ingestToken: string }>(
        `/api/pulse/bases/${baseId}/sources/${source.id}/tokens`,
        {
          method: "POST",
          body: JSON.stringify({ label }),
        },
      );
      setSources((current) => current.map((item) => (item.id === created.source.id ? created.source : item)));
      setSourceTokens((current) => ({ ...current, [source.id]: [created.token, ...(current[source.id] ?? [])] }));
      setTokenSourceId(source.id);
      setHttpIngestToken(created.ingestToken);
      toast.success("Ingest token created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create ingest token");
    } finally {
      setLoading(false);
    }
  };

  const removeIngestToken = async (source: PulseSource, token: PulseSourceToken) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    if (
      !(await prompts.confirm(`Remove ingest token "${token.label}"? Clients using it will stop sending data.`, {
        title: "Remove ingest token",
        variant: "danger",
      }))
    )
      return;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}/tokens/${token.id}`, { method: "DELETE" });
      setSourceTokens((current) => ({ ...current, [source.id]: (current[source.id] ?? []).filter((item) => item.id !== token.id) }));
      if (tokenSourceId() === source.id) setHttpIngestToken("");
      toast.success("Ingest token removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove ingest token");
    } finally {
      setLoading(false);
    }
  };

  const renderSourceDetail = (source: PulseSource) => {
    const sourceToken = () => (tokenSourceId() === source.id && source.kind === "http_ingest" ? httpIngestToken() : "");
    const httpExample = () =>
      source.kind === "http_ingest" && sourceToken()
        ? `curl -fsS -X POST ${origin()}/api/pulse/ingest/${sourceToken()} \\
  -H "Content-Type: application/json" \\
  --data '{
    "metrics": [
      { "name": "orders.created", "value": 1, "type": "counter", "dimensions": { "channel": "webshop" } },
      { "name": "solar.output_watts", "value": 4200, "type": "gauge", "unit": "W", "dimensions": { "site": "warehouse" } }
    ],
    "events": [
      { "kind": "order.created", "dimensions": { "channel": "webshop" }, "payload": { "orderId": "demo-1001" } },
      { "kind": "import.finished", "dimensions": { "dataset": "inventory" }, "payload": { "rows": 128 } }
    ],
    "states": [
      { "key": "checkout.enabled", "value": true },
      { "key": "integration.online", "value": true, "dimensions": { "integration": "webshop" } }
    ]
  }'`
        : "";
    const renderCodeSection = (params: { title: string; code: string }) => (
      <section class="detail-section">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-secondary">{params.title}</h3>
          <div class="flex shrink-0 items-center gap-1">
            <button type="button" class="btn-input btn-input-sm" onClick={() => void copySetupText(params.code, "Command copied")}>
              <i class="ti ti-copy" /> Copy
            </button>
          </div>
        </div>
        <pre class="max-h-72 overflow-auto rounded-lg bg-zinc-100 p-3 text-[11px] leading-relaxed text-secondary dark:bg-zinc-900/80">
          <code>{params.code}</code>
        </pre>
      </section>
    );

    return (
      <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
        <section class="detail-section-compact">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-base font-semibold leading-5 text-primary">{source.name}</h2>
              <p class="mt-1 truncate text-xs text-dimmed">
                {source.kind}
                {source.enabled ? " · enabled" : " · paused"}
                {source.bearerTokenConfigured ? " · bearer auth" : ""}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span
                class="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
                title="Source"
              >
                <i class="ti ti-database-share text-sm" />
              </span>
              <button
                type="button"
                class="btn-simple btn-sm text-dimmed hover:text-primary"
                title="Edit source"
                onClick={() => void editSource(source)}
              >
                <i class="ti ti-pencil" />
              </button>
              <button
                type="button"
                class="btn-simple btn-sm text-dimmed hover:text-primary"
                title={source.enabled ? "Pause source" : "Resume source"}
                onClick={() => void toggleSource(source)}
              >
                <i class={`ti ${source.enabled ? "ti-player-pause" : "ti-player-play"}`} />
              </button>
              <button
                type="button"
                class="btn-simple btn-sm text-dimmed hover:text-primary"
                title="Close detail"
                onClick={() => navigateWorkspace({ view: "sources" })}
              >
                <i class="ti ti-x" />
              </button>
            </div>
          </div>
        </section>

        <div class="detail-stack">
          <section class="detail-section">
            <h3 class="detail-section-label">Status</h3>
            <div class="detail-row">
              <i class="ti ti-clock detail-row-icon text-blue-500" />
              <span class="detail-row-label">Last seen</span>
              <span>{source.lastSeenAt ? compactDateWithDelta(source.lastSeenAt) : "Waiting"}</span>
            </div>
            <Show when={source.kind === "metrics"}>
              <div class="detail-row">
                <i class="ti ti-refresh detail-row-icon text-emerald-600" />
                <span class="detail-row-label">Interval</span>
                <span>{source.scrapeIntervalSeconds ?? 60}s</span>
              </div>
            </Show>
            <Show when={source.lastError}>
              {(message) => (
                <div class="detail-row text-red-600 dark:text-red-300">
                  <i class="ti ti-alert-circle detail-row-icon" />
                  <span class="detail-row-label">Error</span>
                  <span class="break-all">{message()}</span>
                </div>
              )}
            </Show>
          </section>

          <Show when={source.kind === "metrics"}>
            <section class="detail-section overflow-hidden !p-0">
              <DataTable
                rows={selectedSourceScrapes()}
                columns={sourceScrapeColumns}
                getRowId={(scrape) => scrape.id}
                density="compact"
                class="max-h-72 overflow-auto"
                empty="No scrapes recorded yet."
                renderCell={({ row: scrape, col }) => renderSourceScrapeCell(scrape, col)}
              />
            </section>
          </Show>

          <section class="detail-section">
            <h3 class="detail-section-label">Target</h3>
            <Show when={source.kind === "metrics"} fallback={<p class="text-xs text-secondary">{source.kind} ingest endpoint</p>}>
              <p class="break-all text-xs text-secondary">{source.endpointUrl ?? "No endpoint"}</p>
            </Show>
          </section>

          <Show when={source.kind === "http_ingest"}>
            <section class="detail-section overflow-hidden !p-0">
              <DataTable
                rows={selectedSourceTokens()}
                columns={sourceTokenColumns}
                getRowId={(token) => token.id}
                density="compact"
                class="max-h-72 overflow-auto"
                empty="No ingest tokens yet."
                renderCell={({ row: token, col }) => renderSourceTokenCell(source, token, col)}
              />
            </section>
          </Show>

          <Show when={httpExample()}>
            {(command) => renderCodeSection({ title: "HTTP ingest example", code: command() })}
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-2 p-3">
          <Show when={source.kind === "metrics"}>
            <button
              type="button"
              class="btn-input btn-input-sm"
              disabled={loading() || !source.enabled}
              onClick={() => void scrape(source)}
            >
              <i class="ti ti-refresh" /> Scrape
            </button>
          </Show>
          <Show when={source.kind === "http_ingest"}>
            <button
              type="button"
              class="btn-input btn-input-sm"
              disabled={loading()}
              onClick={() => void createIngestToken(source)}
              title="Create a labeled ingest token"
            >
              <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-key"}`} />
              Add token
            </button>
          </Show>
          <button type="button" class="btn-danger btn-sm ml-auto" disabled={loading()} onClick={() => void removeSource(source)}>
            <i class="ti ti-trash" /> Remove
          </button>
        </div>
      </div>
    );
  };

  return (
    <AppWorkspace class="min-h-[760px]">
      <PulseLayoutHelp />
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader
          title={selectedBase()?.name ?? "Pulse"}
          subtitle={`${sources().length} source${sources().length === 1 ? "" : "s"} · ${metrics().length} metric${metrics().length === 1 ? "" : "s"}`}
          icon="ti ti-activity-heartbeat"
          action={
            <button
              type="button"
              onClick={() => void openSettingsDialog()}
              class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
              title="Settings"
              aria-label={`Settings for ${selectedBase()?.name ?? "Pulse"}`}
              disabled={!selectedBase() || loading()}
            >
              <i class="ti ti-settings text-xs" />
            </button>
          }
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="pulse-sidebar-mobile">
            <div class="grid gap-3">
              <AppWorkspace.SidebarSection title="Dashboards">
                <AppWorkspace.SidebarItem icon="ti ti-plus" active={false} onClick={() => void createDashboard()}>
                  New dashboard
                </AppWorkspace.SidebarItem>
                <For each={dashboards()}>
                  {(dashboard) => renderDashboardSidebarItem(dashboard)}
                </For>
              </AppWorkspace.SidebarSection>
              <AppWorkspace.SidebarSection title="Data">
                <AppWorkspace.SidebarItem
                  icon="ti ti-database"
                  active={activeView() === "sources"}
                  onClick={openSources}
                  meta={sources().length}
                >
                  Sources
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem icon="ti ti-terminal-2" active={activeView() === "explorer"} onClick={openQueryExplorer}>
                  Query explorer
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>
              <AppWorkspace.SidebarSection title="Activity">
                <AppWorkspace.SidebarItem
                  icon="ti ti-bolt"
                  active={activeView() === "activity-events"}
                  onClick={openActivityEvents}
                  meta={recentEvents().length}
                >
                  Events
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem
                  icon="ti ti-toggle-right"
                  active={activeView() === "activity-states"}
                  onClick={openActivityStates}
                  meta={currentStates().length}
                >
                  States
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem
                  icon="ti ti-chart-dots"
                  active={activeView() === "activity-metrics"}
                  onClick={openActivityMetrics}
                  meta={metrics().length}
                >
                  Metrics
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>
            </div>
          </AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarSection title="Dashboards">
            <AppWorkspace.SidebarItem icon="ti ti-plus" active={false} onClick={() => void createDashboard()}>
              New dashboard
            </AppWorkspace.SidebarItem>
            <For each={dashboards()}>
              {(dashboard) => renderDashboardSidebarItem(dashboard)}
            </For>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Data">
            <AppWorkspace.SidebarItem
              icon="ti ti-database"
              active={activeView() === "sources"}
              onClick={openSources}
              meta={sources().length}
            >
              Sources
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem icon="ti ti-terminal-2" active={activeView() === "explorer"} onClick={openQueryExplorer}>
              Query explorer
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarSection title="Activity">
            <AppWorkspace.SidebarItem
              icon="ti ti-bolt"
              active={activeView() === "activity-events"}
              onClick={openActivityEvents}
              meta={recentEvents().length}
            >
              Events
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem
              icon="ti ti-toggle-right"
              active={activeView() === "activity-states"}
              onClick={openActivityStates}
              meta={currentStates().length}
            >
              States
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem
              icon="ti ti-chart-dots"
              active={activeView() === "activity-metrics"}
              onClick={openActivityMetrics}
              meta={metrics().length}
            >
              Metrics
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>

          <AppWorkspace.SidebarFooter>
            <div class="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-secondary dark:bg-zinc-900">
              <div class="flex items-center gap-2">
                <span
                  class={`inline-flex h-2.5 w-2.5 rounded-full ${props.initialCapabilities?.timescaleEnabled ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                <span>{props.initialCapabilities?.timescaleEnabled ? "TimescaleDB enabled" : "Dev fallback"}</span>
              </div>
              <p class="mt-1">Retention: {selectedBase()?.retentionDays ?? 30} days</p>
            </div>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main class="gap-3 overflow-y-auto">
        {activeView() === "dashboard"
          ? renderDashboardView()
          : activeView() === "dashboard-edit"
            ? renderDashboardEditView()
            : activeView() === "sources"
              ? renderSourcesView()
              : activeView() === "explorer"
                ? renderMetricExplorerView()
                : activeView() === "activity-states"
                  ? renderActivityStatesView()
                  : activeView() === "activity-metrics"
                    ? renderActivityMetricsView()
                    : renderActivityEventsView()}
      </AppWorkspace.Main>

      <AppWorkspace.Detail
        open={
          (activeView() === "sources" && Boolean(selectedSource())) ||
          (activeView() === "activity-events" && Boolean(selectedEvent())) ||
          (activeView() === "activity-states" && Boolean(selectedState())) ||
          (activeView() === "activity-metrics" && Boolean(selectedActivityMetric()))
        }
        width="lg"
        viewTransitionName="pulse-source-detail"
      >
        {activeView() === "sources" ? (
          <Show when={selectedSource()} keyed>
            {(source) => renderSourceDetail(source)}
          </Show>
        ) : activeView() === "activity-events" ? (
          <Show when={selectedEvent()} keyed>
            {(event) => renderEventDetail(event)}
          </Show>
        ) : activeView() === "activity-states" ? (
          <Show when={selectedState()} keyed>
            {(state) => renderStateDetail(state)}
          </Show>
        ) : (
          <Show when={selectedActivityMetric()} keyed>
            {(metric) => renderMetricDetail(metric)}
          </Show>
        )}
      </AppWorkspace.Detail>
    </AppWorkspace>
  );
}
