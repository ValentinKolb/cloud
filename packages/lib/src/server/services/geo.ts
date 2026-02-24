import { err, fail, ok, paginate, type PageParams, type Paginated, type Result } from "./result";

type GeoApiPlace = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country_code?: string;
  admin1_code?: string;
  feature_class?: string;
  feature_code?: string;
};

type GeoApiSearchResponse = {
  places?: GeoApiPlace[];
};

export type GeoPlace = {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  state?: string;
  featureClass?: string;
  featureCode?: string;
};

/**
 * Normalizes and validates geo API base URLs before outbound requests.
 */
const normalizeBaseUrl = (baseUrl: string): Result<string> => {
  const value = baseUrl.trim();
  if (!value) {
    return fail(err.badInput("Geo API base URL is required"));
  }
  return ok(value.replace(/\/$/, ""));
};

/**
 * Maps one geo API place record to the internal place model and drops invalid rows.
 */
const toPlace = (place: GeoApiPlace): GeoPlace | null => {
  if (typeof place.name !== "string" || typeof place.latitude !== "number" || typeof place.longitude !== "number") {
    return null;
  }

  return {
    name: place.name,
    lat: place.latitude,
    lon: place.longitude,
    country: place.country_code,
    state: place.admin1_code,
    featureClass: place.feature_class,
    featureCode: place.feature_code,
  };
};

/**
 * Searches places through the configured geo API and returns paginated, normalized matches.
 */
const list = async (config: {
  baseUrl: string;
  pagination?: PageParams;
  filter: {
    query: string;
    country?: string;
    featureClass?: string;
    featureCode?: string;
  };
}): Promise<Result<Paginated<GeoPlace>>> => {
  const query = config.filter.query.trim();
  if (!query) {
    const { page, perPage } = paginate(config.pagination);
    return ok({
      items: [],
      page,
      perPage,
      total: 0,
      hasNext: false,
    });
  }

  const baseUrlResult = normalizeBaseUrl(config.baseUrl);
  if (!baseUrlResult.ok) return baseUrlResult;

  const params = new URLSearchParams({ q: query });
  if (config.filter.country?.trim()) {
    params.set("country", config.filter.country.trim());
  }

  try {
    const res = await fetch(`${baseUrlResult.data}/geo/search?${params}`);
    if (!res.ok) {
      return fail(err.internal(`Geo search failed with status ${res.status}`));
    }

    const body = (await res.json()) as GeoApiSearchResponse;
    const mapped = (body.places ?? []).map(toPlace).filter((place): place is GeoPlace => place !== null);

    const filtered = mapped.filter((place) => {
      if (config.filter.featureClass && place.featureClass !== config.filter.featureClass) {
        return false;
      }
      if (config.filter.featureCode && place.featureCode !== config.filter.featureCode) {
        return false;
      }
      return true;
    });

    const { page, perPage, offset } = paginate(config.pagination);
    const items = filtered.slice(offset, offset + perPage);
    return ok({
      items,
      page,
      perPage,
      total: filtered.length,
      hasNext: page * perPage < filtered.length,
    });
  } catch (error) {
    return fail(err.internal(`Geo search request failed: ${error instanceof Error ? error.message : String(error)}`));
  }
};

/**
 * Resolves one place by coordinates via reverse geocoding.
 */
const get = async (config: { baseUrl: string; lat: number; lon: number }): Promise<Result<GeoPlace | null>> => {
  const baseUrlResult = normalizeBaseUrl(config.baseUrl);
  if (!baseUrlResult.ok) return baseUrlResult;

  try {
    const res = await fetch(`${baseUrlResult.data}/geo/reverse?lat=${config.lat}&lng=${config.lon}`);
    if (!res.ok) {
      return fail(err.internal(`Geo reverse lookup failed with status ${res.status}`));
    }

    const body = (await res.json()) as GeoApiSearchResponse;
    const first = (body.places ?? []).map(toPlace).find((place): place is GeoPlace => place !== null);

    return ok(first ?? null);
  } catch (error) {
    return fail(err.internal(`Geo reverse request failed: ${error instanceof Error ? error.message : String(error)}`));
  }
};

export const geoService = {
  place: {
    list,
    get,
  },
};

export type GeoService = typeof geoService;

export const geo = geoService;
