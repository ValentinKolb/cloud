export const SOURCE_KINDS = ["metrics", "http_ingest", "internal"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const BASE_ACCESS_LEVELS = ["viewer", "editor", "admin"] as const;
export type BaseAccessLevel = (typeof BASE_ACCESS_LEVELS)[number];

export const METRIC_TYPES = ["gauge", "counter", "histogram", "summary"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const AGGREGATIONS = ["avg", "sum", "min", "max", "count", "latest", "rate", "increase", "p50", "p90", "p95", "p99"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const PANEL_VISUALS = ["line", "bar", "stat", "gauge", "barGauge", "histogram", "heatmap", "table"] as const;
export type PanelVisual = (typeof PANEL_VISUALS)[number];

export type PulseBase = {
  id: string;
  name: string;
  description: string | null;
  retentionDays: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PulseSource = {
  id: string;
  baseId: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  endpointUrl: string | null;
  bearerTokenConfigured: boolean;
  scrapeIntervalSeconds: number | null;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PulseSourceScrape = {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  metrics: number;
  events: number;
  states: number;
  errorMessage: string | null;
};

export type PulseSourceToken = {
  id: string;
  sourceId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PulseMetric = {
  name: string;
  value: number;
  ts?: string;
  unit?: string | null;
  type?: MetricType;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type PulseEvent = {
  kind: string;
  ts?: string;
  value?: number | null;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  actorId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
  payload?: Record<string, unknown>;
};

export type PulseState = {
  key: string;
  value: string | number | boolean | null;
  ts?: string;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type PulseIngestBatch = {
  metrics?: PulseMetric[];
  events?: PulseEvent[];
  states?: PulseState[];
};

export type PulseRecordedEvent = {
  id: string;
  kind: string;
  ts: string;
  value: number | null;
  sourceId: string | null;
  entityId: string | null;
  entityType: string | null;
  dimensions: Record<string, string>;
  payload: Record<string, unknown>;
  recordedAt: string;
};

export type PulseCurrentState = {
  key: string;
  value: unknown;
  sourceId: string | null;
  entityId: string;
  entityType: string | null;
  dimensions: Record<string, string>;
  updatedAt: string;
};

export type PulseMetricSummary = {
  name: string;
  unit: string | null;
  type: MetricType;
  seriesCount: number;
  lastSeenAt: string | null;
};

export type PulseMetricSeries = {
  id: string;
  metric: string;
  sourceId: string | null;
  entityId: string | null;
  entityType: string | null;
  dimensions: Record<string, string>;
  lastSeenAt: string | null;
};

export type PulseCapabilitySnapshot = {
  timescaleEnabled: boolean;
  timeBucketAvailable: boolean;
  continuousAggregatesAvailable: boolean;
};

export type PulseDashboardPanel = {
  id: string;
  title: string;
  metric: string;
  visual: PanelVisual;
  aggregation: Aggregation;
  bucket: string;
  since: string;
  sourceId?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type PulseDashboardMetricWidget = PulseDashboardPanel & {
  kind: "metric";
  description?: string | null;
  span?: number;
};

export type PulseDashboardMarkdownWidget = {
  id: string;
  kind: "markdown";
  title?: string | null;
  description?: string | null;
  markdown: string;
  span?: number;
};

export type PulseDashboardCardWidget = {
  id: string;
  kind: "card";
  title: string;
  description?: string | null;
  rows: PulseDashboardRow[];
  span?: number;
};

export type PulseDashboardWidget = PulseDashboardMetricWidget | PulseDashboardMarkdownWidget | PulseDashboardCardWidget;

export type PulseDashboardRow = {
  id: string;
  kind: "row";
  height: "sm" | "md" | "lg";
  cells: PulseDashboardWidget[];
};

export type PulseDashboardSection = {
  id: string;
  kind: "section";
  title: string;
  description?: string | null;
  rows: PulseDashboardRow[];
  sections?: PulseDashboardSection[];
};

export type PulseDashboardLayout = {
  version: 1;
  description?: string | null;
  sections: PulseDashboardSection[];
};

export type PulseDashboardConfig = {
  panels: PulseDashboardPanel[];
  layout?: PulseDashboardLayout | null;
  dsl?: string | null;
};

export type PulseDashboard = {
  id: string;
  baseId: string;
  name: string;
  config: PulseDashboardConfig;
  publicEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PulseSavedQuery = {
  id: string;
  baseId: string;
  name: string;
  description: string | null;
  query: string;
  createdAt: string;
  updatedAt: string;
};

export type PulsePublicDashboardPanel = Pick<
  PulseDashboardPanel,
  "id" | "title" | "metric" | "visual" | "aggregation" | "bucket" | "since"
>;

export type PulsePublicDashboard = {
  id: string;
  name: string;
  config: {
    panels: PulsePublicDashboardPanel[];
  };
};

export type PulseDashboardSnapshot = {
  dashboard: PulsePublicDashboard;
  points: Record<string, MetricQueryPoint[]>;
};

export type PulseDashboardDslDiagnostic = {
  severity: "error";
  message: string;
  line: number;
  column: number;
};

export type PulseDashboardDslCompileResult = {
  ok: boolean;
  diagnostics: PulseDashboardDslDiagnostic[];
  config: PulseDashboardConfig | null;
};

export type MetricQuery = {
  kind: "metric";
  baseId: string;
  metric: string;
  aggregation: Aggregation;
  bucket: string;
  since: string;
  sourceId?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type EventQuery = {
  kind: "events";
  baseId: string;
  event: string | null;
  since: string;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
  limit: number;
};

export type StateQuery = {
  kind: "states";
  baseId: string;
  state: string | null;
  since?: string | null;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
  limit: number;
};

export type PulseExplorerQuery = MetricQuery | EventQuery | StateQuery;

export type MetricQueryPoint = {
  bucket: string;
  value: number | null;
};

export type PulseQueryDiagnostic = {
  severity: "error" | "info";
  message: string;
};

export type PulseQueryCompileResult = {
  ok: boolean;
  diagnostics: PulseQueryDiagnostic[];
  compiled: PulseExplorerQuery | null;
};
