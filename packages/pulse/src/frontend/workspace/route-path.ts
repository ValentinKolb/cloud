import type { WorkspaceRouteState } from "./route-types";

const fallbackWorkspaceRouteState = (): WorkspaceRouteState => ({ view: "resources", dashboardId: "", sourceId: "", signalId: "" });
const blankWorkspaceRouteState = (view: WorkspaceRouteState["view"]): WorkspaceRouteState => ({
  view,
  dashboardId: "",
  sourceId: "",
  signalId: "",
});

const basePathParts = (path: string, baseId: string): string[] | null => {
  if (!baseId) return null;
  const marker = `/app/pulse/${baseId}`;
  const start = path.indexOf(marker);
  if (start < 0) return null;
  return path
    .slice(start + marker.length)
    .split("/")
    .filter(Boolean);
};

type RouteReader = (rest: string[]) => WorkspaceRouteState;

const dashboardRouteState: RouteReader = (rest) => ({
  view: rest[2] === "edit" ? "dashboard-edit" : "dashboard",
  dashboardId: rest[1] ?? "",
  sourceId: "",
  signalId: "",
});

const sourceRouteState: RouteReader = (rest) => ({ ...blankWorkspaceRouteState("sources"), sourceId: rest[1] ?? "" });

const resourceRouteState: RouteReader = (rest) =>
  rest[1] ? { ...blankWorkspaceRouteState("resource-detail"), signalId: decodeURIComponent(rest[1]) } : blankWorkspaceRouteState("resources");

const focusedSignalRoute =
  (view: Extract<WorkspaceRouteState["view"], "event-detail" | "metric-detail" | "state-detail">): RouteReader =>
  (rest) =>
    rest[1] ? { ...blankWorkspaceRouteState(view), signalId: decodeURIComponent(rest[1]) } : fallbackWorkspaceRouteState();

const signalRouteState: RouteReader = (rest) => {
  if (rest[1] === "states") return blankWorkspaceRouteState("activity-states");
  if (rest[1] === "metrics") return blankWorkspaceRouteState("activity-metrics");
  return blankWorkspaceRouteState("activity-events");
};

const routeReaders: Record<string, RouteReader> = {
  dashboards: dashboardRouteState,
  events: focusedSignalRoute("event-detail"),
  explorer: () => blankWorkspaceRouteState("explorer"),
  metrics: focusedSignalRoute("metric-detail"),
  resources: resourceRouteState,
  signals: signalRouteState,
  sources: sourceRouteState,
  states: focusedSignalRoute("state-detail"),
};

export const readWorkspacePathState = (path: string, baseId: string): WorkspaceRouteState => {
  const rest = basePathParts(path, baseId);
  if (!rest) return fallbackWorkspaceRouteState();
  return routeReaders[rest[0] ?? ""]?.(rest) ?? fallbackWorkspaceRouteState();
};
