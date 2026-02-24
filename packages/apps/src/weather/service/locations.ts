import { sql } from "bun";
import { err, fail, ok, paginate, type PageParams, type Paginated, type Result } from "@valentinkolb/cloud/lib/server";
import { logger } from "@valentinkolb/cloud/core/services";

const log = logger("weather");

export type Location = {
  id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
};

/**
 * Stores one user-owned weather location and returns the persisted row.
 */
const create = async (config: {
  userId: string;
  data: {
    name: string;
    state?: string;
    lat: number;
    lon: number;
  };
}): Promise<Result<Location>> => {
  try {
    const [location] = await sql`
      INSERT INTO weather_locations (user_id, name, state, lat, lon)
      VALUES (${config.userId}, ${config.data.name}, ${config.data.state ?? null}, ${config.data.lat}, ${config.data.lon})
      RETURNING id, name, state, lat, lon
    `;
    return ok(location as Location);
  } catch (error) {
    log.error("Failed to create location", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(err.internal("Failed to create location"));
  }
};

/**
 * Deletes one saved location owned by the user and reports `NOT_FOUND` when no row matches.
 */
const remove = async (config: { id: string; userId: string }): Promise<Result<void>> => {
  try {
    const result = await sql`
      DELETE FROM weather_locations
      WHERE id = ${config.id}::uuid AND user_id = ${config.userId}
      RETURNING id
    `;

    if (result.length === 0) {
      return fail(err.notFound("Location"));
    }

    return ok();
  } catch (error) {
    log.error("Failed to delete location", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(err.internal("Failed to delete location"));
  }
};

/**
 * Lists all saved weather locations for one user with optional search and pagination.
 */
const list = async (config: { userId: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<Location>> => {
  const locations = (await sql`
    SELECT id, name, state, lat, lon
    FROM weather_locations
    WHERE user_id = ${config.userId}
    ORDER BY created_at ASC
  `) as Location[];

  const query = config.filter?.query?.trim().toLowerCase();
  const filtered =
    query && query.length > 0
      ? locations.filter((location) => {
          const name = location.name.toLowerCase();
          const state = (location.state ?? "").toLowerCase();
          return name.includes(query) || state.includes(query);
        })
      : locations;

  if (!config.pagination) {
    return {
      items: filtered,
      page: 1,
      perPage: filtered.length,
      total: filtered.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(config.pagination);
  const items = filtered.slice(offset, offset + perPage);
  return {
    items,
    page,
    perPage,
    total: filtered.length,
    hasNext: page * perPage < filtered.length,
  };
};

/**
 * Returns one saved location for the owning user, or `null` if it is missing/inaccessible.
 */
const get = async (config: { id: string; userId: string }): Promise<Location | null> => {
  const [location] = await sql`
    SELECT id, name, state, lat, lon
    FROM weather_locations
    WHERE id = ${config.id}::uuid AND user_id = ${config.userId}
  `;
  return (location as Location) ?? null;
};

export const weatherLocationsService = {
  list,
  get,
  create,
  remove,
};
