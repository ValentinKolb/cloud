/**
 * URL is the single source of truth for what the telemetry page shows.
 *
 * Every control — range, app, route drilldown, sort — is a query param, so
 * the page stays server-rendered, links are shareable, and the island only
 * has to navigate. Parsing and URL building live here rather than in the
 * island so the two can never drift apart.
 */
import {
  DEFAULT_TELEMETRY_RANGE,
  DEFAULT_TELEMETRY_ROUTE_SORT,
  isTelemetryRange,
  isTelemetryRouteSort,
  type TelemetryRange,
  type TelemetryRouteSort,
} from "../contracts";

export const TELEMETRY_PAGE_PATH = "/admin/observability/telemetry";

export type TelemetryFilter = {
  range: TelemetryRange;
  appId: string;
  /** Selected route template — presence of this is what opens the drilldown. */
  route: string;
  sort: TelemetryRouteSort;
  /** Row filters, orthogonal to `sort`: narrow the table, don't reorder it. */
  errorsOnly: boolean;
  slowOnly: boolean;
};

export const defaultTelemetryFilter: TelemetryFilter = {
  range: DEFAULT_TELEMETRY_RANGE,
  appId: "",
  route: "",
  sort: DEFAULT_TELEMETRY_ROUTE_SORT,
  errorsOnly: false,
  slowOnly: false,
};

export const parseTelemetryFilterFromUrl = (url: URL): TelemetryFilter => {
  const range = url.searchParams.get("range");
  const sort = url.searchParams.get("sort");
  return {
    range: isTelemetryRange(range) ? range : defaultTelemetryFilter.range,
    appId: url.searchParams.get("app")?.trim() ?? "",
    route: url.searchParams.get("route")?.trim() ?? "",
    sort: isTelemetryRouteSort(sort) ? sort : defaultTelemetryFilter.sort,
    errorsOnly: url.searchParams.get("errors") === "1",
    slowOnly: url.searchParams.get("slow") === "1",
  };
};

/**
 * Builds a page URL from the current filter plus a patch. Values equal to the
 * default are omitted so the common case stays a clean, readable link.
 */
export const buildTelemetryFilterUrl = (current: TelemetryFilter, updates: Partial<TelemetryFilter> = {}): string => {
  const next: TelemetryFilter = { ...current, ...updates };
  const params = new URLSearchParams();
  if (next.range !== defaultTelemetryFilter.range) params.set("range", next.range);
  if (next.appId) params.set("app", next.appId);
  if (next.route) params.set("route", next.route);
  if (next.sort !== defaultTelemetryFilter.sort) params.set("sort", next.sort);
  if (next.errorsOnly) params.set("errors", "1");
  if (next.slowOnly) params.set("slow", "1");
  const query = params.toString();
  return query ? `${TELEMETRY_PAGE_PATH}?${query}` : TELEMETRY_PAGE_PATH;
};

/** Drives the "clear filters" affordance; the range always has a value. */
export const hasActiveTelemetryFilters = (filter: TelemetryFilter): boolean =>
  filter.appId !== "" || filter.route !== "" || filter.sort !== defaultTelemetryFilter.sort || filter.errorsOnly || filter.slowOnly;

/** Resets everything except the range, which always has a value. */
export const clearTelemetryFiltersUrl = (filter: TelemetryFilter): string =>
  buildTelemetryFilterUrl(defaultTelemetryFilter, { range: filter.range });

/**
 * Selecting an app while a route of a different app is open would show a
 * drilldown that contradicts the filter, so the route is dropped.
 */
export const selectAppUrl = (filter: TelemetryFilter, appId: string): string => buildTelemetryFilterUrl(filter, { appId, route: "" });

export const selectRouteUrl = (filter: TelemetryFilter, appId: string, route: string): string =>
  buildTelemetryFilterUrl(filter, { appId, route });

export const closeRouteUrl = (filter: TelemetryFilter): string => buildTelemetryFilterUrl(filter, { route: "" });
