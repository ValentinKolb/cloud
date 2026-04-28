/**
 * Filter state for the logs admin page.
 * All filter values are stored as URL query parameters (SSR-friendly).
 */
export type LogFilterState = {
  level: string;
  sources: string[];
  search: string;
  page: number;
};

export const defaultLogFilter: LogFilterState = {
  level: "all",
  sources: [],
  search: "",
  page: 1,
};

/** Parse filter state from URL search params. */
export function parseLogFilterFromUrl(url: URL): LogFilterState {
  const params = url.searchParams;
  const rawSources = params.getAll("source");
  return {
    level: params.get("level") || defaultLogFilter.level,
    sources: rawSources.length > 0 ? [...new Set(rawSources.map((value) => value.trim()).filter(Boolean))] : defaultLogFilter.sources,
    search: params.get("search") || defaultLogFilter.search,
    page: parseInt(params.get("page") || "1", 10) || 1,
  };
}

/** Build URL with updated filter parameters. Only includes non-default values. */
export function buildLogFilterUrl(baseUrl: string, updates: Partial<LogFilterState>, current: LogFilterState): string {
  const merged = { ...current, ...updates };
  const params = new URLSearchParams();

  if (merged.level !== defaultLogFilter.level) params.set("level", merged.level);
  for (const source of merged.sources) params.append("source", source);
  if (merged.search) params.set("search", merged.search);
  if (merged.page > 1) params.set("page", String(merged.page));

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/** Check if any filters are active (non-default). */
export function hasActiveLogFilters(filter: LogFilterState): boolean {
  return filter.level !== defaultLogFilter.level || filter.sources.length > 0 || filter.search !== "";
}
