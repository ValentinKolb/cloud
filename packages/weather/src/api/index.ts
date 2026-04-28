import { Hono } from "hono";
import { rateLimit, v, jsonResponse, requiresAuth, auth, type AuthContext, respond } from "@valentinkolb/cloud/server";
import { describeRoute } from "hono-openapi";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { weatherService } from "@valentinkolb/cloud/services";
import { z } from "zod";

const WeatherQuerySchema = z.object({
  lat: z.string().optional(),
  lon: z.string().optional(),
});

const CurrentWeatherSchema = z.object({
  temperature: z.number(),
  icon: z.string(),
  cloudCover: z.number(),
  windSpeed: z.number(),
  humidity: z.number().nullable(),
  precipitation: z.number(),
  stationName: z.string(),
  timestamp: z.string(),
});

const HourlyForecastSchema = z.object({
  timestamp: z.string(),
  temperature: z.number(),
  icon: z.string(),
  precipitation: z.number(),
  windSpeed: z.number(),
});

const DailyForecastSchema = z.object({
  date: z.string(),
  icon: z.string(),
  tempMin: z.number(),
  tempMax: z.number(),
  precipitation: z.number(),
});

const WeatherDataSchema = z.object({
  current: CurrentWeatherSchema,
  hourly: z.array(HourlyForecastSchema),
  daily: z.array(DailyForecastSchema),
});

const ErrorResponseSchema = z.object({
  message: z.string(),
});
const MessageResponseSchema = z.object({
  message: z.string(),
});

const LocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  state: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
});

const CreateLocationSchema = z.object({
  name: z.string().min(1),
  state: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
});

const GeoResultSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  country: z.string().optional(),
  state: z.string().optional(),
});

const GeoSearchQuerySchema = z.object({
  q: z.string().min(1),
  country: z.string().optional(),
});

const ForecastByCityQuerySchema = z.object({
  q: z.string().min(1),
});

// Locations API (requires auth)
const locationsApi = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .post(
    "/",
    describeRoute({
      tags: ["Weather"],
      summary: "Add a saved location",
      description: "Add a new location to the user's saved locations.",
      ...requiresAuth,
      responses: {
        201: jsonResponse(LocationSchema, "Location created"),
        401: jsonResponse(ErrorResponseSchema, "Unauthorized"),
      },
    }),
    v("json", CreateLocationSchema),
    async (c) => {
      const user = c.get("user");
      const { name, state, lat, lon } = c.req.valid("json");

      return respond(
        c,
        weatherService.location.saved.create({
          userId: user.id,
          data: { name, state, lat, lon },
        }),
        201,
      );
    },
  )
  .delete(
    "/:id",
    describeRoute({
      tags: ["Weather"],
      summary: "Delete a saved location",
      description: "Remove a location from the user's saved locations.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Location deleted"),
        401: jsonResponse(ErrorResponseSchema, "Unauthorized"),
        404: jsonResponse(ErrorResponseSchema, "Location not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");

      return respond(c, async () => {
        const result = await weatherService.location.saved.remove({
          id,
          userId: user.id,
        });
        if (!result.ok) return result;
        return ok({ message: "Location deleted" });
      });
    },
  );

/** Weather API routes — public endpoints + auth for locations. */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  // Public: Get weather data
  .get(
    "/",
    describeRoute({
      tags: ["Weather"],
      summary: "Get weather data",
      description:
        "Get current weather, hourly forecast (next 24h), and daily forecast (next 5 days). Optionally provide lat/lon coordinates, otherwise uses default location (Ulm).",
      responses: {
        200: jsonResponse(WeatherDataSchema, "Weather data"),
        500: jsonResponse(ErrorResponseSchema, "Failed to fetch weather"),
      },
    }),
    v("query", WeatherQuerySchema),
    async (c) => {
      const { lat, lon } = c.req.valid("query");

      return respond(c, async () => {
        const data = await weatherService.forecast.get({ lat, lon });
        if (!data) {
          return fail(err.internal("Failed to fetch weather data"));
        }
        return ok(data);
      });
    },
  )
  // Public: Get current weather only
  .get(
    "/current",
    describeRoute({
      tags: ["Weather"],
      summary: "Get current weather only",
      description: "Get only the current weather conditions. Optionally provide lat/lon coordinates.",
      responses: {
        200: jsonResponse(CurrentWeatherSchema, "Current weather"),
        500: jsonResponse(ErrorResponseSchema, "Failed to fetch weather"),
      },
    }),
    v("query", WeatherQuerySchema),
    async (c) => {
      const { lat, lon } = c.req.valid("query");

      return respond(c, async () => {
        const data = await weatherService.forecast.current.get({ lat, lon });
        if (!data) {
          return fail(err.internal("Failed to fetch weather data"));
        }
        return ok(data);
      });
    },
  )
  // Public: Forecast lookup by city name (DE only)
  .get(
    "/forecast/by-city",
    describeRoute({
      tags: ["Weather"],
      summary: "Get forecast by city name",
      description: "Uses the first German city search result and returns weather for its coordinates.",
      responses: {
        200: jsonResponse(WeatherDataSchema, "Weather data"),
        400: jsonResponse(ErrorResponseSchema, "Invalid city query"),
        404: jsonResponse(ErrorResponseSchema, "City not found"),
        500: jsonResponse(ErrorResponseSchema, "Failed to fetch weather"),
      },
    }),
    v("query", ForecastByCityQuerySchema),
    async (c) => {
      const { q } = c.req.valid("query");
      return respond(c, weatherService.forecast.getByCityName({ query: q }));
    },
  )
  // Public: Geo search proxy
  .get(
    "/geo/search",
    describeRoute({
      tags: ["Weather"],
      summary: "Search for locations",
      description: "Search for cities using the configured geo service. Weather app supports country=DE only.",
      responses: {
        200: jsonResponse(z.array(GeoResultSchema), "Search results"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
        500: jsonResponse(ErrorResponseSchema, "Geo service unavailable"),
      },
    }),
    v("query", GeoSearchQuerySchema),
    async (c) => {
      const { q, country } = c.req.valid("query");
      return respond(c, async () => {
        const result = await weatherService.location.city.list({
          pagination: { page: 1, perPage: 25 },
          filter: { query: q, country },
        });
        if (!result.ok) return result;
        return ok(result.data.items);
      });
    },
  )
  // Auth: Locations CRUD
  .route("/locations", locationsApi);

export default app;
export type ApiType = typeof app;
