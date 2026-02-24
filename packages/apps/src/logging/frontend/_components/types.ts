/**
 * Filter state for the logs admin page.
 * All filter values are stored as URL query parameters (SSR-friendly).
 */
export type LogFilterState = {
  level: string;
  source: string;
  search: string;
  page: number;
};

export const defaultLogFilter: LogFilterState = {
  level: "all",
  source: "all",
  search: "",
  page: 1,
};

/** Parse filter state from URL search params. */
export function parseLogFilterFromUrl(url: URL): LogFilterState {
  const params = url.searchParams;
  return {
    level: params.get("level") || defaultLogFilter.level,
    source: params.get("source") || defaultLogFilter.source,
    search: params.get("search") || defaultLogFilter.search,
    page: parseInt(params.get("page") || "1", 10) || 1,
  };
}

/** Build URL with updated filter parameters. Only includes non-default values. */
export function buildLogFilterUrl(baseUrl: string, updates: Partial<LogFilterState>, current: LogFilterState): string {
  const merged = { ...current, ...updates };
  const params = new URLSearchParams();

  if (merged.level !== defaultLogFilter.level) params.set("level", merged.level);
  if (merged.source !== defaultLogFilter.source) params.set("source", merged.source);
  if (merged.search) params.set("search", merged.search);
  if (merged.page > 1) params.set("page", String(merged.page));

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/** Check if any filters are active (non-default). */
export function hasActiveLogFilters(filter: LogFilterState): boolean {
  return filter.level !== defaultLogFilter.level || filter.source !== defaultLogFilter.source || filter.search !== "";
}
