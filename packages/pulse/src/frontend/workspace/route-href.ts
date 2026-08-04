import { pulseBaseHref, pulseExplorerHref, pulseResourceHref, pulseSignalHref, pulseSourceHref } from "../../resource-hrefs";
import type { ActivityQueryState, ResourceQueryState, WorkspaceHrefOptions, WorkspaceView } from "./route-types";

const setTrimmedParam = (params: URLSearchParams, key: string, value: string | undefined): void => {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
};

const searchString = (params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `?${query}` : "";
};

const activitySearch = (activity: Partial<ActivityQueryState> = {}) => {
  const params = new URLSearchParams();
  setTrimmedParam(params, "q", activity.q);
  setTrimmedParam(params, "type", activity.type);
  return searchString(params);
};

const resourceSearch = (resources: Partial<ResourceQueryState> = {}) => {
  const params = new URLSearchParams();
  setTrimmedParam(params, "q", resources.q);
  setTrimmedParam(params, "source", resources.sourceId);
  setTrimmedParam(params, "type", resources.type);
  return searchString(params);
};

const focusedSignalSearch = (focusedSearch: string | undefined): string => {
  const params = new URLSearchParams();
  setTrimmedParam(params, "q", focusedSearch);
  return searchString(params);
};

type WorkspaceHrefBuilder = (options: WorkspaceHrefOptions & { baseId: string }) => string;

const viewHrefBuilders: Record<WorkspaceView, WorkspaceHrefBuilder> = {
  dashboard: ({ baseId, state }) =>
    state.dashboardId ? `/app/pulse/${baseId}/dashboards/${state.dashboardId}` : `/app/pulse/${baseId}/resources`,
  "dashboard-edit": ({ baseId, state }) =>
    state.dashboardId ? `/app/pulse/${baseId}/dashboards/${state.dashboardId}/edit` : pulseBaseHref(baseId),
  sources: ({ baseId, state }) => (state.sourceId ? pulseSourceHref(baseId, state.sourceId) : `/app/pulse/${baseId}/sources`),
  "resource-detail": ({ baseId, state }) => pulseResourceHref(baseId, state.signalId ?? ""),
  resources: ({ baseId, resources }) => `/app/pulse/${baseId}/resources${resourceSearch(resources)}`,
  "metric-detail": ({ baseId, state, focusedSearch }) =>
    `${pulseSignalHref(baseId, "metric", state.signalId ?? "")}${focusedSignalSearch(focusedSearch)}`,
  "state-detail": ({ baseId, state, focusedSearch }) =>
    `${pulseSignalHref(baseId, "state", state.signalId ?? "")}${focusedSignalSearch(focusedSearch)}`,
  "event-detail": ({ baseId, state, focusedSearch }) =>
    `${pulseSignalHref(baseId, "event", state.signalId ?? "")}${focusedSignalSearch(focusedSearch)}`,
  explorer: ({ baseId }) => pulseExplorerHref(baseId),
  "activity-states": ({ baseId, activity }) => `/app/pulse/${baseId}/signals/states${activitySearch(activity)}`,
  "activity-metrics": ({ baseId, activity }) => `/app/pulse/${baseId}/signals/metrics${activitySearch(activity)}`,
  "activity-events": ({ baseId, activity }) => `/app/pulse/${baseId}/signals/events${activitySearch(activity)}`,
};

export const buildPulseWorkspaceHref = (options: WorkspaceHrefOptions): string => {
  if (!options.baseId) return "/app/pulse";
  return viewHrefBuilders[options.state.view]({ ...options, baseId: options.baseId });
};
