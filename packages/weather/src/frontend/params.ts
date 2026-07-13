/**
 * Centralized URL query parameter handling for Weather app.
 */

// ============ Query Parameter Names ============

const QueryParams = {
  LAT: "lat",
  LON: "lon",
  ZOOM: "zoom",
  THEME: "theme",
  DETAIL: "detail",
} as const;

// ============ URL Builders ============

export type DisplaySettings = {
  zoom: 1 | 2 | 3;
  theme: "light" | "dark";
  detail: boolean;
};

/** Build URL for fullscreen weather display */
export const buildDisplayUrl = (lat: number, lon: number, settings: DisplaySettings): string => {
  const url = new URL("/app/weather/display", window.location.origin);
  url.searchParams.set(QueryParams.LAT, String(lat));
  url.searchParams.set(QueryParams.LON, String(lon));
  url.searchParams.set(QueryParams.ZOOM, String(settings.zoom));
  url.searchParams.set(QueryParams.THEME, settings.theme);
  if (settings.detail) {
    url.searchParams.set(QueryParams.DETAIL, "true");
  }
  return url.toString();
};
