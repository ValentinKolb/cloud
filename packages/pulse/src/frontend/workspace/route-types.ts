import type { MetricType } from "../../contracts";

export type WorkspaceView =
  | "dashboard"
  | "dashboard-edit"
  | "sources"
  | "resources"
  | "resource-detail"
  | "explorer"
  | "activity-events"
  | "activity-states"
  | "activity-metrics"
  | "metric-detail"
  | "state-detail"
  | "event-detail";

export type WorkspaceRouteState = {
  view: WorkspaceView;
  dashboardId: string;
  sourceId: string;
  signalId: string;
};

export type ActivityQueryState = {
  q: string;
  type: "" | MetricType;
};

export type ResourceQueryState = {
  q: string;
  sourceId: string;
  type: string;
};

type WorkspaceHrefState = {
  view: WorkspaceView;
  dashboardId?: string;
  sourceId?: string;
  signalId?: string;
};

export type WorkspaceHrefOptions = {
  baseId: string;
  state: WorkspaceHrefState;
  activity?: Partial<ActivityQueryState>;
  resources?: Partial<ResourceQueryState>;
  focusedSearch?: string;
};
