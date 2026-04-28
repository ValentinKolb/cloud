import { registerGroupLabel, registerSettings } from "../settings/defaults";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { getCurrentWeather, getWeatherData } from "./forecast";
import { WEATHER_COUNTRY_CODE } from "./geo";
import { weatherLocationService } from "./location";
import { weatherLocationsService } from "./locations";
import type { WeatherData } from "./types";
import { weatherUiService } from "./ui";

registerGroupLabel("weather", "Weather");
registerSettings([
  {
    key: "weather.default_lat",
    kind: "string",
    default: "",
    description: "Default latitude",
    placeholder: "e.g. 48.401082 (Ulm)",
    group: "weather",
  },
  {
    key: "weather.default_lon",
    kind: "string",
    default: "",
    description: "Default longitude",
    placeholder: "e.g. 9.987608 (Ulm)",
    group: "weather",
  },
  {
    key: "weather.cache_minutes",
    kind: "number",
    default: 30,
    description: "How long weather data is cached before fetching fresh data (in minutes)",
    group: "weather",
  },
  {
    key: "weather.geo_url",
    kind: "url",
    default: "",
    description: "Geocoding API URL for the location search feature",
    placeholder: "e.g. https://geocoding.example.com/search",
    group: "weather",
  },
]);

/**
 * Resolves a city name to coordinates and returns weather for the first match.
 */
const getByCityName = async (config: { query: string }): Promise<Result<WeatherData>> => {
  const query = config.query.trim();
  if (!query) {
    return fail(err.badInput("City query is required"));
  }

  const cityResult = await weatherLocationService.city.list({
    pagination: { page: 1, perPage: 1 },
    filter: {
      query,
      country: WEATHER_COUNTRY_CODE,
    },
  });
  if (!cityResult.ok) return cityResult;

  const city = cityResult.data.items[0];
  if (!city) {
    return fail(err.notFound("City"));
  }

  const weather = await getWeatherData({
    lat: String(city.lat),
    lon: String(city.lon),
  });
  if (!weather) {
    return fail(err.notFound("Weather data for city"));
  }

  return ok(weather);
};

export const weatherService = {
  forecast: {
    get: getWeatherData,
    current: {
      get: getCurrentWeather,
    },
    getByCityName,
  },
  location: weatherLocationService,
  locations: weatherLocationsService,
  ui: weatherUiService,
};

export type WeatherService = typeof weatherService;
export type {
  WeatherData,
  DailyForecast,
  CurrentWeather,
  HourlyForecast,
  WeatherIcon,
} from "./types";
