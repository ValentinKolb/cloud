import type { PermissionLevel } from "@valentinkolb/cloud/contracts";
import type { DockWorkspaceState, ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import type {
  MetricQueryPoint,
  MetricType,
  PulseBase,
  PulseCapabilitySnapshot,
  PulseCurrentState,
  PulseDashboard,
  PulseExplorerQuery,
  PulseInventory,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseSavedQuery,
  PulseSource,
  PulseSourceScrape,
} from "../../contracts";
export type { ActivityQueryState, ResourceQueryState, WorkspaceRouteState, WorkspaceView } from "./routes";
import type { ActivityQueryState, ResourceQueryState, WorkspaceRouteState } from "./routes";

export type MetricTextQueryResult = {
  compiled: PulseExplorerQuery;
  points: MetricQueryPoint[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};

export type SourceKind = "metrics" | "http_ingest";
export type GrantableLevel = Exclude<PermissionLevel, "none">;
export type ExplorerResultView = "chart" | "table" | "compiled";
export type QueryHistoryEntry = { query: string; ranAt: string };
export type RefreshIntervalOption = "1" | "5" | "10" | "60" | "never";

export type BrowseEntity = {
  id: string;
  type: string | null;
  sourceIds: string[];
  metricCount: number;
  eventCount: number;
  stateCount: number;
  dimensions: Record<string, string>;
};

export type ActivityEventGroup = {
  id: string;
  kind: string;
  subject: string;
  sourceId: string | null;
  latest: PulseRecordedEvent;
  rows: PulseRecordedEvent[];
};

export type ActivityStateGroup = {
  id: string;
  key: string;
  sourceId: string | null;
  latest: PulseCurrentState;
  rows: PulseCurrentState[];
};

export type CreateSourceInput = {
  kind: SourceKind;
  name: string;
  endpointUrl?: string;
  bearerToken?: string;
  scrapeIntervalSeconds?: number;
};

export type PulseWorkspaceProps = {
  initialBases: PulseBase[];
  initialCapabilities: PulseCapabilitySnapshot | null;
  initialBaseId?: string | null;
  initialPath?: string;
  initialSearch?: string;
  initialRouteState?: WorkspaceRouteState;
  initialActivityQuery?: ActivityQueryState;
  initialResourceQuery?: ResourceQueryState;
  initialSources?: PulseSource[];
  initialSourceScrapes?: Record<string, PulseSourceScrape[]>;
  initialSourceApiKeys?: Record<string, ResourceApiKey[]>;
  initialMetrics?: PulseMetricSummary[];
  initialInventory?: PulseInventory;
  initialActivityMetrics?: PulseMetricSummary[];
  initialSeries?: PulseMetricSeries[];
  initialRecentEvents?: PulseRecordedEvent[];
  initialCurrentStates?: PulseCurrentState[];
  initialFocusedMetricSeries?: PulseMetricSeries[];
  initialFocusedEvents?: PulseRecordedEvent[];
  initialFocusedStates?: PulseCurrentState[];
  initialFocusedHasMore?: boolean;
  initialDashboards?: PulseDashboard[];
  initialSavedQueries?: PulseSavedQuery[];
  initialPanelPoints?: Record<string, MetricQueryPoint[]>;
  initialExplorerDockState?: DockWorkspaceState | null;
  initialDateConfig?: DateContext;
  initialNow?: string;
  initialOrigin?: string;
};
