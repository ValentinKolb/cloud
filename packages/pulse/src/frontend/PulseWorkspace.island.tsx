import {
  AppWorkspace,
  AutocompleteEditor,
  Chart,
  DataTable,
  dialogCore,
  FilterChip,
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
  PulseDashboardPanel,
  PulseExplorerQuery,
  PulseMetricSummary,
  PulseMetricSeries,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseSavedQuery,
  PulseSource,
  PulseSourceScrape,
  MetricQuery,
  MetricQueryPoint,
} from "../contracts";
import PulseLayoutHelp from "./PulseLayoutHelp";
import { buildPulseQuery, buildPulseQueryCompletions, defaultPulseQuery, pulseQueryHighlight } from "./query-authoring";

type SourceWithToken = PulseSource & { ingestToken?: string };
type MetricTextQueryResult = {
  compiled: PulseExplorerQuery;
  points: MetricQueryPoint[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};
type WorkspaceView = "dashboard" | "sources" | "explorer" | "activity-events" | "activity-states" | "activity-metrics";
type SourceKind = "metrics" | "http_ingest";
type GrantableLevel = Exclude<PermissionLevel, "none">;
type ExplorerResultView = "chart" | "table" | "compiled";
type QueryHistoryEntry = { query: string; ranAt: string };
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
  return (await response.json()) as T;
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

const openQueryReferenceWindow = (baseId: string | null | undefined) => {
  if (!baseId || typeof window === "undefined") return;
  window.open(`/app/pulse/${encodeURIComponent(baseId)}/query-reference`, "pulse-query-reference", "popup,width=1180,height=840,resizable=yes,scrollbars=yes");
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

const readActivityQueryState = (): ActivityQueryState => {
  if (typeof window === "undefined") return emptyActivityQueryState();
  const params = new URLSearchParams(window.location.search);
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
  if (rest[0] === "dashboards") return { view: "dashboard", dashboardId: rest[1] ?? "", sourceId: "" };
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

const dimensionsFingerprint = (dimensions: PulseDashboardPanel["dimensions"]): string =>
  JSON.stringify(Object.entries(dimensions ?? {}).sort(([left], [right]) => left.localeCompare(right)));

const quoteQueryPart = (value: string): string => (/[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value);

const panelFingerprint = (panel: PulseDashboardPanel): string =>
  [
    panel.sourceId ?? "",
    panel.metric,
    panel.visual,
    panel.aggregation,
    panel.bucket,
    panel.since,
    dimensionsFingerprint(panel.dimensions),
  ].join(":");

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

type PresetPanel = {
  metric: string;
  title: string;
  visual: PanelVisual;
  aggregation: Aggregation;
  bucket: string;
  since: string;
};

const SERVER_PRESET: PresetPanel[] = [
  { metric: "system.cpu.usage", title: "CPU usage", visual: "line", aggregation: "avg", bucket: "5m", since: "24h" },
  { metric: "system.memory.used_percent", title: "Memory used", visual: "gauge", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "system.disk.root.used_percent", title: "Root disk used", visual: "gauge", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "system.disk.used_percent", title: "Disk usage", visual: "barGauge", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "system.load.1m", title: "Load 1m", visual: "line", aggregation: "avg", bucket: "5m", since: "24h" },
  { metric: "system.net.rx_bytes", title: "Network RX/s", visual: "line", aggregation: "rate", bucket: "5m", since: "24h" },
  { metric: "system.net.tx_bytes", title: "Network TX/s", visual: "line", aggregation: "rate", bucket: "5m", since: "24h" },
  { metric: "docker.containers.running", title: "Docker containers", visual: "stat", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "proxmox.vms.running", title: "Proxmox VMs", visual: "stat", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "proxmox.containers.running", title: "Proxmox containers", visual: "stat", aggregation: "latest", bucket: "1m", since: "24h" },
  { metric: "system.uptime.seconds", title: "Uptime", visual: "stat", aggregation: "latest", bucket: "1m", since: "24h" },
];

const SOURCE_TYPE_OPTIONS = [
  { id: "http_ingest", label: "HTTP ingest", icon: "ti ti-webhook", description: "Push metrics, events, and states." },
  { id: "metrics", label: "Metrics endpoint", icon: "ti ti-plug", description: "Scrape a Prometheus-compatible endpoint." },
];

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
  const initialActivityQuery = readActivityQueryState();
  const [bases, setBases] = createSignal(props.initialBases);
  const [selectedBaseId, setSelectedBaseId] = createSignal(initialBaseId);
  const [sources, setSources] = createSignal<PulseSource[]>([]);
  const [sourceScrapes, setSourceScrapes] = createSignal<Record<string, PulseSourceScrape[]>>({});
  const [sourceSearch, setSourceSearch] = createSignal("");
  const [metrics, setMetrics] = createSignal<PulseMetricSummary[]>([]);
  const [activityMetrics, setActivityMetrics] = createSignal<PulseMetricSummary[]>([]);
  const [series, setSeries] = createSignal<PulseMetricSeries[]>([]);
  const [recentEvents, setRecentEvents] = createSignal<PulseRecordedEvent[]>([]);
  const [currentStates, setCurrentStates] = createSignal<PulseCurrentState[]>([]);
  const [dashboards, setDashboards] = createSignal<PulseDashboard[]>([]);
  const [savedQueries, setSavedQueries] = createSignal<PulseSavedQuery[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = createSignal(initialRouteState.dashboardId);
  const [activeView, setActiveView] = createSignal<WorkspaceView>(initialRouteState.view);
  const [selectedMetric, setSelectedMetric] = createSignal("");
  const [selectedSourceId, setSelectedSourceId] = createSignal(initialRouteState.sourceId);
  const [activitySearch, setActivitySearch] = createSignal(initialActivityQuery.q);
  const [metricTypeFilter, setMetricTypeFilter] = createSignal<"" | MetricType>(initialActivityQuery.type);
  const [selectedEventId, setSelectedEventId] = createSignal(initialActivityQuery.eventId);
  const [selectedStateId, setSelectedStateId] = createSignal(initialActivityQuery.stateId);
  const [selectedActivityMetricName, setSelectedActivityMetricName] = createSignal(initialActivityQuery.metric);
  const [activityMetricSeries, setActivityMetricSeries] = createSignal<PulseMetricSeries[]>([]);
  const [activityMetricPoints, setActivityMetricPoints] = createSignal<MetricQueryPoint[]>([]);
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
  const [panelPoints, setPanelPoints] = createSignal<Record<string, MetricQueryPoint[]>>({});
  const [publicLink, setPublicLink] = createSignal("");
  const [httpIngestToken, setHttpIngestToken] = createSignal("");
  const [tokenSourceId, setTokenSourceId] = createSignal("");
  const [origin, setOrigin] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = createSignal(false);
  let queryRunId = 0;
  let lastAutoRunQuery = "";

  const selectedBase = createMemo(() => bases().find((base) => base.id === selectedBaseId()) ?? null);
  const selectedDashboard = createMemo(
    () => dashboards().find((dashboard) => dashboard.id === selectedDashboardId()) ?? dashboards()[0] ?? null,
  );
  const selectedSource = createMemo(() => sources().find((source) => source.id === selectedSourceId()) ?? null);
  const selectedSourceScrapes = createMemo(() => (selectedSourceId() ? (sourceScrapes()[selectedSourceId()] ?? []) : []));
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

  const loadBaseData = async (baseId = selectedBaseId()) => {
    if (!baseId) return;
    const [nextSources, nextMetrics, nextDashboards, nextSavedQueries] = await Promise.all([
      jsonFetch<PulseSource[]>(`/api/pulse/bases/${baseId}/sources`),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics`),
      jsonFetch<PulseDashboard[]>(`/api/pulse/bases/${baseId}/dashboards`),
      jsonFetch<PulseSavedQuery[]>(`/api/pulse/bases/${baseId}/saved-queries`),
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

  const activityQueryParams = (includeType = false) => {
    const params = new URLSearchParams();
    const q = activitySearch().trim();
    if (q) params.set("q", q);
    if (includeType && metricTypeFilter()) params.set("type", metricTypeFilter());
    return params;
  };

  const loadActivityData = async (baseId = selectedBaseId()) => {
    if (!baseId) return;
    const eventParams = activityQueryParams(false);
    const stateParams = activityQueryParams(false);
    const metricParams = activityQueryParams(true);
    const [nextEvents, nextStates, nextMetrics] = await Promise.all([
      jsonFetch<PulseRecordedEvent[]>(`/api/pulse/bases/${baseId}/recent-events?${eventParams}`),
      jsonFetch<PulseCurrentState[]>(`/api/pulse/bases/${baseId}/states?${stateParams}`),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics?${metricParams}`),
    ]);
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

  const loadSourceScrapes = async (baseId = selectedBaseId(), sourceId = selectedSourceId()) => {
    if (!baseId || !sourceId) return;
    const nextScrapes = await jsonFetch<PulseSourceScrape[]>(`/api/pulse/bases/${baseId}/sources/${sourceId}/scrapes`);
    setSourceScrapes((current) => ({ ...current, [sourceId]: nextScrapes }));
  };

  const loadPanel = async (panel: PulseDashboardPanel, baseId = selectedBaseId()) => {
    if (!baseId) return;
    const data = await jsonFetch<MetricQueryPoint[]>("/api/pulse/query/metric", {
      method: "POST",
      body: JSON.stringify(panelQuery(baseId, panel)),
    });
    setPanelPoints((current) => ({ ...current, [panel.id]: data }));
  };

  const refreshDashboard = async (dashboard = selectedDashboard(), baseId = selectedBaseId()) => {
    if (!dashboard || !baseId) return;
    await Promise.all(dashboard.config.panels.map((panel) => loadPanel(panel, baseId).catch(() => undefined)));
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
    setSelectedDashboardId(nextState.dashboardId ?? "");
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
      const source = await jsonFetch<SourceWithToken>(`/api/pulse/bases/${baseId}/sources`, {
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
      if (input.kind === "http_ingest") {
        setTokenSourceId(source.id);
        setHttpIngestToken(source.ingestToken ?? "");
      }
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
        "After creating this source, Pulse generates a dedicated HTTP ingest URL and token. Use it from ingestors, scripts, business apps, automations, imports, or jobs to send metrics, events, and states.";
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

  const rotateIngestToken = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    if (
      !(await prompts.confirm(`Rotate ingest token for "${source.name}"? The old token will stop working.`, {
        title: "Rotate ingest token",
        variant: "danger",
      }))
    )
      return;
    setLoading(true);
    try {
      const result = await jsonFetch<{ source: PulseSource; ingestToken: string }>(
        `/api/pulse/bases/${baseId}/sources/${source.id}/ingest-token`,
        {
          method: "POST",
          body: "{}",
        },
      );
      setSources((current) => current.map((item) => (item.id === result.source.id ? result.source : item)));
      setTokenSourceId(source.id);
      if (source.kind === "http_ingest") setHttpIngestToken(result.ingestToken);
      toast.success("Ingest token rotated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rotate token");
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
      body: JSON.stringify({ config: { panels: [...dashboard.config.panels, panel] } }),
    });
    setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedDashboardId(updated.id);
    await loadPanel(panel, baseId);
    toast.success("Panel added");
  };

  const addServerPreset = async () => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    const dashboard = await ensureDashboard();
    if (!dashboard) return;
    const source = selectedSource();
    const prefix = source?.name ?? selectedBase()?.name ?? "Server";
    const sourceId = source?.id ?? null;
    const existing = new Set(dashboard.config.panels.map(panelFingerprint));
    const presetPanels: PulseDashboardPanel[] = SERVER_PRESET.map((preset) => ({
      id: crypto.randomUUID(),
      title: `${prefix} · ${preset.title}`,
      metric: preset.metric,
      visual: preset.visual,
      aggregation: preset.aggregation,
      bucket: preset.bucket,
      since: preset.since,
      sourceId,
    }));
    const [diskSeries, rxSeries, txSeries, vmRunningSeries, vmMemorySeries, vmDiskSeries, ctRunningSeries] = await Promise.all([
      fetchMetricSeries(baseId, "system.disk.used_percent", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "system.net.rx_bytes", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "system.net.tx_bytes", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "proxmox.vm.running", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "proxmox.vm.memory_mb", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "proxmox.vm.bootdisk_gb", sourceId).catch(() => []),
      fetchMetricSeries(baseId, "proxmox.container.running", sourceId).catch(() => []),
    ]);
    const dynamicPanels: PulseDashboardPanel[] = [
      ...diskSeries.slice(0, 6).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · Disk ${item.dimensions.mountpoint ?? item.entityId ?? "usage"}`,
        metric: "system.disk.used_percent",
        visual: "barGauge" as const,
        aggregation: "latest" as const,
        bucket: "1m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...rxSeries.slice(0, 4).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · RX ${item.dimensions.interface ?? item.entityId ?? "network"}`,
        metric: "system.net.rx_bytes",
        visual: "line" as const,
        aggregation: "rate" as const,
        bucket: "5m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...txSeries.slice(0, 4).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · TX ${item.dimensions.interface ?? item.entityId ?? "network"}`,
        metric: "system.net.tx_bytes",
        visual: "line" as const,
        aggregation: "rate" as const,
        bucket: "5m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...vmRunningSeries.slice(0, 8).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · VM ${item.dimensions.name ?? item.dimensions.vmid ?? item.entityId ?? "running"}`,
        metric: "proxmox.vm.running",
        visual: "barGauge" as const,
        aggregation: "latest" as const,
        bucket: "1m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...ctRunningSeries.slice(0, 8).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · CT ${item.dimensions.name ?? item.dimensions.vmid ?? item.entityId ?? "running"}`,
        metric: "proxmox.container.running",
        visual: "barGauge" as const,
        aggregation: "latest" as const,
        bucket: "1m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...vmMemorySeries.slice(0, 6).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · VM memory ${item.dimensions.name ?? item.dimensions.vmid ?? item.entityId ?? ""}`.trim(),
        metric: "proxmox.vm.memory_mb",
        visual: "stat" as const,
        aggregation: "latest" as const,
        bucket: "1m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
      ...vmDiskSeries.slice(0, 6).map((item) => ({
        id: crypto.randomUUID(),
        title: `${prefix} · VM disk ${item.dimensions.name ?? item.dimensions.vmid ?? item.entityId ?? ""}`.trim(),
        metric: "proxmox.vm.bootdisk_gb",
        visual: "stat" as const,
        aggregation: "latest" as const,
        bucket: "1m",
        since: "24h",
        sourceId: item.sourceId ?? sourceId,
        dimensions: item.dimensions,
      })),
    ];
    const panels = [...presetPanels, ...dynamicPanels].filter((panel) => !existing.has(panelFingerprint(panel)));

    if (panels.length === 0) {
      toast.success("Starter preset already exists");
      return;
    }

    setLoading(true);
    try {
      const currentPanels = dashboards().find((item) => item.id === dashboard.id)?.config.panels ?? dashboard.config.panels;
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config: { panels: [...currentPanels, ...panels] } }),
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedDashboardId(updated.id);
      await Promise.all(panels.map((panel) => loadPanel(panel, baseId).catch(() => undefined)));
      toast.success(
        dynamicPanels.length === 0
          ? "Starter preset added. Run it again after the first ingest to add matching series panels."
          : `Starter preset added: ${panels.length} panel${panels.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add preset");
    } finally {
      setLoading(false);
    }
  };

  const removePanel = async (panelId: string) => {
    const dashboard = selectedDashboard();
    if (!dashboard) return;
    const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
      method: "PATCH",
      body: JSON.stringify({ config: { panels: dashboard.config.panels.filter((panel) => panel.id !== panelId) } }),
    });
    setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setPanelPoints((current) => {
      const next = { ...current };
      delete next[panelId];
      return next;
    });
    toast.success("Panel removed");
  };

  const enablePublicLink = async () => {
    const dashboard = selectedDashboard();
    if (!dashboard) return;
    setLoading(true);
    try {
      const result = await jsonFetch<{ dashboard: PulseDashboard; token: string }>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
        method: "POST",
        body: "{}",
      });
      setDashboards((current) => current.map((item) => (item.id === result.dashboard.id ? result.dashboard : item)));
      setPublicLink(`${window.location.origin}/app/pulse/display/${result.token}`);
      toast.success("Public dashboard link created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create public link");
    } finally {
      setLoading(false);
    }
  };

  const disablePublicLink = async () => {
    const dashboard = selectedDashboard();
    if (!dashboard) return;
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
        method: "DELETE",
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setPublicLink("");
      toast.success("Public dashboard link disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable public link");
    } finally {
      setLoading(false);
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

  onMount(() => {
    setOrigin(window.location.origin);
    const onPopState = () => applyWorkspacePathState();
    window.addEventListener("popstate", onPopState);
    void loadBaseData();
    void loadActivityData();
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setQueryHistory(readQueryHistory(baseId));
    const events = new EventSource(`/api/pulse/bases/${baseId}/events`);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void Promise.all([loadBaseData(baseId), loadActivityData(baseId)]).then(() => refreshDashboard(selectedDashboard(), baseId));
      }, 150);
    };
    events.addEventListener("metric.ingested", scheduleRefresh);
    events.addEventListener("event.ingested", scheduleRefresh);
    events.addEventListener("state.changed", scheduleRefresh);
    events.addEventListener("source.changed", scheduleRefresh);
    events.addEventListener("base.changed", scheduleRefresh);
    onCleanup(() => {
      events.close();
      if (refreshTimer) clearTimeout(refreshTimer);
    });
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    if (dashboard) void refreshDashboard(dashboard);
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
    void loadActivityData(baseId).catch(() => {
      setRecentEvents([]);
      setCurrentStates([]);
      setActivityMetrics([]);
    });
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
  });

  createEffect(() => {
    sources();
    dashboards();
    const view = activeView();
    if (view === "dashboard") {
      const dashboardId = selectedDashboardId();
      navigateWorkspace({ view, dashboardId }, "replace");
    } else if (view === "sources") {
      navigateWorkspace({ view, sourceId: selectedSourceId() }, "replace");
    }
  });

  const openDashboard = (dashboardId: string) => {
    navigateWorkspace({ view: "dashboard", dashboardId });
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

  const renderDashboardView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="truncate text-base font-semibold text-primary">{selectedDashboard()?.name ?? "Dashboard"}</h1>
          <p class="mt-0.5 text-xs text-dimmed">
            {selectedDashboard()?.config.panels.length ?? 0} panels · {sources().length} sources · realtime updates
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-input btn-input-sm"
            disabled={!selectedBaseId() || loading()}
            onClick={() => void createDashboard()}
          >
            <i class="ti ti-plus" /> Dashboard
          </button>
          <button type="button" class="btn-input btn-input-sm" disabled={!selectedBaseId() || loading()} onClick={addServerPreset}>
            <i class="ti ti-layout-dashboard" /> Starter preset
          </button>
          <button type="button" class="btn-input btn-input-sm" disabled={!selectedDashboard() || loading()} onClick={enablePublicLink}>
            <i class="ti ti-link" /> {selectedDashboard()?.publicEnabled ? "Rotate public link" : "Public link"}
          </button>
          <Show when={selectedDashboard()?.publicEnabled}>
            <button
              type="button"
              class="btn-icon"
              title="Disable public link"
              disabled={loading()}
              onClick={() => void disablePublicLink()}
            >
              <i class="ti ti-link-off" />
            </button>
          </Show>
        </div>
      </div>
      <Show when={selectedDashboard()?.publicEnabled && !publicLink()}>
        <div class="info-block-success">
          Public display is enabled. Rotate the link to copy a new URL, or disable it with the link-off action.
        </div>
      </Show>
      <Show when={publicLink()}>
        {(link) => (
          <div class="info-block-info">
            <a class="font-medium underline-offset-2 hover:underline" href={link()} target="_blank" rel="noreferrer">
              {link()}
            </a>
          </div>
        )}
      </Show>

      <Show
        when={selectedDashboard()?.config.panels.length}
        fallback={
          <div class="paper flex flex-1 items-center justify-center p-8 text-center text-sm text-dimmed">
            Open the query explorer to preview data and add the first panel.
          </div>
        }
      >
        <div class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          <For each={selectedDashboard()?.config.panels ?? []}>
            {(panel) => (
              <article class="paper p-4">
                <div class="mb-3 flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-primary">{panel.title}</p>
                    <p class="mt-1 truncate text-xs text-dimmed">
                      {panel.metric} · {panel.aggregation} / {panel.bucket}
                      {panel.sourceId ? ` · ${sourceNameById().get(panel.sourceId) ?? "source"}` : ""}
                    </p>
                  </div>
                  <button type="button" class="btn-icon" title="Remove panel" onClick={() => void removePanel(panel.id)}>
                    <i class="ti ti-x" />
                  </button>
                </div>
                {renderPanel(panel)}
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );

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

  const generateIngestSetup = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId || source.kind !== "http_ingest") return;
    setLoading(true);
    try {
      const result = await jsonFetch<{ source: PulseSource; ingestToken: string }>(
        `/api/pulse/bases/${baseId}/sources/${source.id}/ingest-token`,
        {
          method: "POST",
          body: "{}",
        },
      );
      setSources((current) => current.map((item) => (item.id === result.source.id ? result.source : item)));
      setTokenSourceId(source.id);
      if (source.kind === "http_ingest") setHttpIngestToken(result.ingestToken);
      toast.success("Setup token generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate setup token");
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
            <section class="detail-section">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="detail-section-label">Setup</h3>
                  <p class="text-xs text-secondary">
                    {sourceToken()
                      ? "Use this token-backed setup now. Pulse only stores a hash, so this token will not be shown again after reload."
                      : "Generate a new token-backed setup example. Pulse only shows the raw token once."}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn-input btn-input-sm"
                  disabled={loading()}
                  onClick={() => void generateIngestSetup(source)}
                  title={sourceToken() ? "Generate a fresh token and replace the current setup URL" : "Generate setup example"}
                >
                  <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : sourceToken() ? "ti-refresh" : "ti-key"}`} />
                  {sourceToken() ? "Regenerate" : "Generate setup"}
                </button>
              </div>
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
                <For each={dashboards()}>
                  {(dashboard) => (
                    <AppWorkspace.SidebarItem
                      icon="ti ti-layout-dashboard"
                      active={activeView() === "dashboard" && selectedDashboard()?.id === dashboard.id}
                      onClick={() => openDashboard(dashboard.id)}
                      meta={dashboard.config.panels.length}
                      title={dashboard.name}
                    >
                      {dashboard.name}
                    </AppWorkspace.SidebarItem>
                  )}
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
            <For each={dashboards()}>
              {(dashboard) => (
                <AppWorkspace.SidebarItem
                  icon="ti ti-chart-area-line"
                  active={activeView() === "dashboard" && selectedDashboard()?.id === dashboard.id}
                  onClick={() => openDashboard(dashboard.id)}
                  meta={dashboard.config.panels.length}
                  title={dashboard.name}
                >
                  {dashboard.name}
                </AppWorkspace.SidebarItem>
              )}
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
