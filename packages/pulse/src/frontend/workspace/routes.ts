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

type DashboardControlQueryState = Record<string, string>;

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

const emptyResourceQueryState = (): ResourceQueryState => ({ q: "", sourceId: "", type: "" });

const DASHBOARD_CONTROL_PREFIX = "c_";
const dashboardControlVariable = (param: string): string | null =>
  param.startsWith(DASHBOARD_CONTROL_PREFIX) ? param.slice(DASHBOARD_CONTROL_PREFIX.length) : null;

export const readDashboardControlQueryState = (search: string): DashboardControlQueryState => {
  const params = new URLSearchParams(search);
  const values: DashboardControlQueryState = {};
  for (const [param, value] of params.entries()) {
    const variable = dashboardControlVariable(param);
    if (variable) values[variable] = value;
  }
  return values;
};

export const readActivityQueryState = (search: string): ActivityQueryState => {
  const params = new URLSearchParams(search);
  const type = params.get("type") ?? "";
  return {
    q: params.get("q")?.trim() ?? "",
    type: type === "gauge" || type === "counter" || type === "histogram" || type === "summary" ? type : "",
  };
};

export const readResourceQueryState = (search: string): ResourceQueryState => {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q")?.trim() ?? "",
    sourceId: params.get("source")?.trim() ?? "",
    type: params.get("type")?.trim() ?? "",
  };
};

export const readWorkspacePathState = (path: string, baseId: string): WorkspaceRouteState => {
  const fallback: WorkspaceRouteState = { view: "resources", dashboardId: "", sourceId: "", signalId: "" };
  if (!baseId) return fallback;
  const marker = `/app/pulse/${baseId}`;
  const start = path.indexOf(marker);
  if (start < 0) return fallback;
  const rest = path
    .slice(start + marker.length)
    .split("/")
    .filter(Boolean);
  if (rest[0] === "dashboards")
    return { view: rest[2] === "edit" ? "dashboard-edit" : "dashboard", dashboardId: rest[1] ?? "", sourceId: "", signalId: "" };
  if (rest[0] === "sources") return { view: "sources", dashboardId: "", sourceId: rest[1] ?? "", signalId: "" };
  if (rest[0] === "resources" && rest[1])
    return { view: "resource-detail", dashboardId: "", sourceId: "", signalId: decodeURIComponent(rest[1]) };
  if (rest[0] === "resources") return { view: "resources", dashboardId: "", sourceId: "", signalId: "" };
  if (rest[0] === "metrics" && rest[1])
    return { view: "metric-detail", dashboardId: "", sourceId: "", signalId: decodeURIComponent(rest[1]) };
  if (rest[0] === "states" && rest[1])
    return { view: "state-detail", dashboardId: "", sourceId: "", signalId: decodeURIComponent(rest[1]) };
  if (rest[0] === "events" && rest[1])
    return { view: "event-detail", dashboardId: "", sourceId: "", signalId: decodeURIComponent(rest[1]) };
  if (rest[0] === "explorer" || rest[0] === "metric-explorer") return { view: "explorer", dashboardId: "", sourceId: "", signalId: "" };
  if ((rest[0] === "signals" || rest[0] === "activity") && rest[1] === "states")
    return { view: "activity-states", dashboardId: "", sourceId: "", signalId: "" };
  if ((rest[0] === "signals" || rest[0] === "activity") && rest[1] === "metrics")
    return { view: "activity-metrics", dashboardId: "", sourceId: "", signalId: "" };
  if (rest[0] === "signals" || rest[0] === "activity") return { view: "activity-events", dashboardId: "", sourceId: "", signalId: "" };
  return fallback;
};

const activitySearch = (activity: Partial<ActivityQueryState> = {}) => {
  const params = new URLSearchParams();
  if (activity.q?.trim()) params.set("q", activity.q.trim());
  if (activity.type) params.set("type", activity.type);
  const query = params.toString();
  return query ? `?${query}` : "";
};

const resourceSearch = (resources: Partial<ResourceQueryState> = {}) => {
  const params = new URLSearchParams();
  if (resources.q?.trim()) params.set("q", resources.q.trim());
  if (resources.sourceId?.trim()) params.set("source", resources.sourceId.trim());
  if (resources.type?.trim()) params.set("type", resources.type.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const buildPulseWorkspaceHref = ({ baseId, state, activity, resources, focusedSearch }: WorkspaceHrefOptions): string => {
  if (!baseId) return "/app/pulse";
  if (state.view === "dashboard") {
    return state.dashboardId ? `/app/pulse/${baseId}/dashboards/${state.dashboardId}` : `/app/pulse/${baseId}/resources`;
  }
  if (state.view === "dashboard-edit") {
    return state.dashboardId ? `/app/pulse/${baseId}/dashboards/${state.dashboardId}/edit` : `/app/pulse/${baseId}`;
  }
  if (state.view === "sources") {
    return state.sourceId ? `/app/pulse/${baseId}/sources/${state.sourceId}` : `/app/pulse/${baseId}/sources`;
  }
  if (state.view === "resource-detail") return `/app/pulse/${baseId}/resources/${encodeURIComponent(state.signalId ?? "")}`;
  if (state.view === "resources") return `/app/pulse/${baseId}/resources${resourceSearch(resources)}`;
  if (state.view === "metric-detail" || state.view === "state-detail" || state.view === "event-detail") {
    const params = new URLSearchParams();
    if (focusedSearch?.trim()) params.set("q", focusedSearch.trim());
    const query = params.toString();
    const prefix = state.view === "metric-detail" ? "metrics" : state.view === "state-detail" ? "states" : "events";
    return `/app/pulse/${baseId}/${prefix}/${encodeURIComponent(state.signalId ?? "")}${query ? `?${query}` : ""}`;
  }
  if (state.view === "explorer") return `/app/pulse/${baseId}/explorer`;
  if (state.view === "activity-states") return `/app/pulse/${baseId}/signals/states${activitySearch(activity)}`;
  if (state.view === "activity-metrics") return `/app/pulse/${baseId}/signals/metrics${activitySearch(activity)}`;
  return `/app/pulse/${baseId}/signals/events${activitySearch(activity)}`;
};
