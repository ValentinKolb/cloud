import { err, fail, ok, type Paginated, type Result } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  type CapabilityResult,
  type CloudResourceView,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { type AuditActor, audit, weatherService } from "@valentinkolb/cloud/services";
import { z } from "zod";
import { CurrentWeatherSchema, WeatherDataSchema } from "./contracts";

const LocationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    state: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
  })
  .strict();

const LocationListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of saved locations to return."),
    cursor: z.string().min(1).max(2048).optional().describe("Opaque cursor returned by a previous location.list call."),
  })
  .strict();

const LocationGetInputSchema = z
  .object({
    locationId: z.uuid().describe("Stable UUID of the saved weather location."),
  })
  .strict();

const ForecastSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("saved").describe("Use a saved location owned by the current user."),
      locationId: z.uuid().describe("Stable UUID of the saved weather location."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("coordinates").describe("Use explicit latitude and longitude."),
      lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees from -90 to 90."),
      lon: z.number().min(-180).max(180).describe("Longitude in decimal degrees from -180 to 180."),
    })
    .strict(),
]);

const ForecastInputSchema = z
  .object({
    source: ForecastSourceSchema.describe("Saved location or explicit coordinates used for the forecast."),
  })
  .strict();

const CitySearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(120).describe("German city name to search for."),
    limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of city candidates to return."),
  })
  .strict();

const CitySearchDataSchema = z
  .array(
    z
      .object({
        name: z.string(),
        lat: z.number(),
        lon: z.number(),
        country: z.string().optional(),
        state: z.string().optional(),
      })
      .strict(),
  )
  .max(25);

const LocationCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).describe("Display name for the saved location."),
    state: z.string().trim().min(1).max(120).optional().describe("Optional state or region used to distinguish the location."),
    lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees from -90 to 90."),
    lon: z.number().min(-180).max(180).describe("Longitude in decimal degrees from -180 to 180."),
  })
  .strict();

const LocationDeleteDataSchema = z
  .object({
    locationId: z.uuid(),
    deleted: z.literal(true),
  })
  .strict();

const encodeCursor = (page: number): string => Buffer.from(JSON.stringify({ v: 1, page }), "utf8").toString("base64url");

export const decodeWeatherCapabilityCursor = (cursor: string | undefined): Result<number> => {
  if (!cursor) return ok(1);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; page?: unknown };
    return value.v === 1 && Number.isInteger(value.page) && Number(value.page) >= 1
      ? ok(Number(value.page))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const requireUserId = (context: CapabilityExecutionContext): Result<string> =>
  context.accessSubject.type === "user"
    ? ok(context.accessSubject.userId)
    : fail(err.forbidden("Weather capabilities require a user-backed actor"));

const locationHref = (locationId: string): string => `/app/weather/${locationId}`;

const locationPageResult = <T>(page: Paginated<unknown>, data: T, refs?: CapabilityResult<T>["refs"]): CapabilityInvocationResult<T> =>
  ok({
    data,
    ...(refs ? { refs } : {}),
    page: {
      hasMore: page.hasNext,
      ...(page.hasNext ? { nextCursor: encodeCursor(page.page + 1) } : {}),
    },
  });

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const userId = requireUserId(context);
  if (!userId.ok) return userId;

  const page = await weatherService.location.saved.list({
    userId: userId.data,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query },
  });
  const data: CloudResourceView[] = page.items.map((entry) => ({
    ref: { type: "weather.location", id: entry.id },
    title: entry.name,
    preview: entry.state ?? undefined,
    icon: "ti ti-temperature-celsius",
    priority: 6,
    metadata: [{ label: "Type", value: "Location" }, ...(entry.state ? [{ label: "State", value: entry.state }] : [])],
    links: [{ rel: "open", href: locationHref(entry.id) }],
  }));
  return ok({ data });
};

const runLocationList = async (input: z.infer<typeof LocationListInputSchema>, context: CapabilityExecutionContext) => {
  const userId = requireUserId(context);
  if (!userId.ok) return userId;
  const cursor = decodeWeatherCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;

  const page = await weatherService.location.saved.list({
    userId: userId.data,
    pagination: { page: cursor.data, perPage: input.limit },
  });
  return locationPageResult(
    page,
    page.items,
    page.items.map((location) => ({ type: "weather.location", id: location.id })),
  );
};

const runLocationGet = async (input: z.infer<typeof LocationGetInputSchema>, context: CapabilityExecutionContext) => {
  const userId = requireUserId(context);
  if (!userId.ok) return userId;
  const location = await weatherService.location.saved.get({ id: input.locationId, userId: userId.data });
  if (!location) return fail(err.notFound("Location"));
  return ok({
    data: location,
    refs: [{ type: "weather.location", id: location.id }],
    links: [{ rel: "open" as const, href: locationHref(location.id) }],
  });
};

type ForecastSource = z.infer<typeof ForecastSourceSchema>;
type ResolvedForecastSource = { lat: string; lon: string; locationId: string | null };

const resolveForecastSource = async (
  source: ForecastSource,
  context: CapabilityExecutionContext,
): Promise<Result<ResolvedForecastSource>> => {
  const userId = requireUserId(context);
  if (!userId.ok) return userId;
  if (source.kind === "coordinates") {
    return ok({ lat: String(source.lat), lon: String(source.lon), locationId: null });
  }

  const location = await weatherService.location.saved.get({ id: source.locationId, userId: userId.data });
  return location ? ok({ lat: String(location.lat), lon: String(location.lon), locationId: location.id }) : fail(err.notFound("Location"));
};

const forecastIdentity = (locationId: string | null) =>
  locationId
    ? {
        refs: [{ type: "weather.location", id: locationId }],
        links: [{ rel: "open" as const, href: locationHref(locationId) }],
      }
    : {};

const runCurrentForecast = async (input: z.infer<typeof ForecastInputSchema>, context: CapabilityExecutionContext) => {
  const source = await resolveForecastSource(input.source, context);
  if (!source.ok) return source;
  const data = await weatherService.forecast.current.get({ lat: source.data.lat, lon: source.data.lon });
  return data ? ok({ data, ...forecastIdentity(source.data.locationId) }) : fail(err.internal("Current weather is unavailable"));
};

const runForecast = async (input: z.infer<typeof ForecastInputSchema>, context: CapabilityExecutionContext) => {
  const source = await resolveForecastSource(input.source, context);
  if (!source.ok) return source;
  const data = await weatherService.forecast.get({ lat: source.data.lat, lon: source.data.lon });
  return data ? ok({ data, ...forecastIdentity(source.data.locationId) }) : fail(err.internal("Weather forecast is unavailable"));
};

const runCitySearch = async (input: z.infer<typeof CitySearchInputSchema>, context: CapabilityExecutionContext) => {
  const userId = requireUserId(context);
  if (!userId.ok) return userId;
  const result = await weatherService.location.city.list({
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query, country: "DE" },
  });
  return result.ok ? ok({ data: result.data.items.slice(0, input.limit) }) : result;
};

const capabilityAuditActor = (context: CapabilityExecutionContext): AuditActor =>
  context.actor.kind === "user"
    ? {
        userId: context.actor.user.id,
        uid: context.actor.user.uid,
        provider: context.actor.user.provider,
        roles: context.actor.user.roles,
      }
    : {
        uid: `service-account:${context.actor.serviceAccount.id}`,
        provider: "service_account",
        roles: context.actor.scopes,
      };

const audited = async <T>(
  params: {
    action: string;
    actor: AuditActor;
    target: { type: string; id?: string; label?: string };
    metadata: { capability: string };
  },
  operation: () => Promise<CapabilityInvocationResult<T>>,
): Promise<CapabilityInvocationResult<T>> => {
  const result = await operation();
  return result.ok ? audit.recordResultAfterSideEffect({ ...params, result }) : audit.recordResult({ ...params, result });
};

const runLocationCreate = async (input: z.infer<typeof LocationCreateInputSchema>, context: CapabilityExecutionContext) =>
  audited(
    {
      action: "weather.capability.location.create",
      actor: capabilityAuditActor(context),
      target: { type: "weather_location", label: input.name },
      metadata: { capability: "weather.location.create" },
    },
    async () => {
      const userId = requireUserId(context);
      if (!userId.ok) return userId;
      const result = await weatherService.location.saved.create({ userId: userId.data, data: input });
      if (!result.ok) return result;
      return ok({
        data: result.data,
        refs: [{ type: "weather.location", id: result.data.id }],
        links: [{ rel: "open" as const, href: locationHref(result.data.id) }],
      });
    },
  );

const runLocationDelete = async (input: z.infer<typeof LocationGetInputSchema>, context: CapabilityExecutionContext) =>
  audited(
    {
      action: "weather.capability.location.delete",
      actor: capabilityAuditActor(context),
      target: { type: "weather_location", id: input.locationId },
      metadata: { capability: "weather.location.delete" },
    },
    async () => {
      const userId = requireUserId(context);
      if (!userId.ok) return userId;
      const result = await weatherService.location.saved.remove({ id: input.locationId, userId: userId.data });
      return result.ok ? ok({ data: { locationId: input.locationId, deleted: true as const } }) : result;
    },
  );

export const weatherCapabilities = defineCapabilities({
  version: 1,
  types: {
    location: {
      title: "Saved location",
      description: "A saved weather location owned by the current user.",
      icon: "ti ti-map-pin",
    },
  },
  queries: {
    "location.search": {
      title: "Search saved weather locations",
      description: "Find saved weather locations owned by the current user by name or state.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [
          {
            tag: "weather",
            title: "Weather",
            description: "Show saved weather locations.",
            aliases: ["forecast", "location", "temperature"],
          },
        ],
      },
      run: runSearch,
    },
    "location.list": {
      title: "List saved weather locations",
      description: "List the current user's saved weather locations with bounded pagination.",
      input: LocationListInputSchema,
      data: z.array(LocationSchema).max(100),
      run: runLocationList,
    },
    "location.get": {
      title: "Get saved weather location",
      description: "Read one saved weather location owned by the current user by stable UUID.",
      input: LocationGetInputSchema,
      data: LocationSchema,
      run: runLocationGet,
    },
    "forecast.current": {
      title: "Get current weather",
      description: "Get current weather for one owned saved location or explicit coordinates.",
      input: ForecastInputSchema,
      data: CurrentWeatherSchema,
      run: runCurrentForecast,
    },
    "forecast.get": {
      title: "Get weather forecast",
      description:
        "Get current conditions plus up to 12 hourly and 7 daily forecasts for one owned saved location or explicit coordinates.",
      input: ForecastInputSchema,
      data: WeatherDataSchema,
      run: runForecast,
    },
    "city.search": {
      title: "Search German cities",
      description: "Find bounded German city candidates and coordinates for forecasts or saved locations.",
      input: CitySearchInputSchema,
      data: CitySearchDataSchema,
      run: runCitySearch,
    },
  },
  actions: {
    "location.create": {
      title: "Save weather location",
      description: "Save one weather location for the current user.",
      input: LocationCreateInputSchema,
      data: LocationSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      run: runLocationCreate,
    },
    "location.delete": {
      title: "Delete saved weather location",
      description: "Permanently delete one saved weather location owned by the current user.",
      input: LocationGetInputSchema,
      data: LocationDeleteDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "location", inputField: "locationId" },
      run: runLocationDelete,
    },
  },
});
