import { z } from "zod";

const WeatherIconSchema = z.enum([
  "clear-day",
  "clear-night",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "cloudy",
  "fog",
  "wind",
  "rain",
  "sleet",
  "snow",
  "hail",
  "thunderstorm",
]);

export const CurrentWeatherSchema = z.object({
  temperature: z.number(),
  icon: WeatherIconSchema,
  cloudCover: z.number(),
  windSpeed: z.number(),
  windGust: z.number().nullable(),
  windDirection: z.number().nullable(),
  humidity: z.number().nullable(),
  precipitation: z.number(),
  pressure: z.number().nullable(),
  visibility: z.number().nullable(),
  dewPoint: z.number().nullable(),
  sunshine: z.number().nullable(),
  stationName: z.string(),
  timestamp: z.string(),
});

const HourlyForecastSchema = z.object({
  timestamp: z.string(),
  temperature: z.number(),
  icon: WeatherIconSchema,
  precipitation: z.number(),
  precipitationProbability: z.number().nullable(),
  windSpeed: z.number(),
  cloudCover: z.number(),
});

const DailyForecastSchema = z.object({
  date: z.string(),
  icon: WeatherIconSchema,
  tempMin: z.number(),
  tempMax: z.number(),
  precipitation: z.number(),
  precipitationProbability: z.number().nullable(),
  sunshine: z.number(),
});

export const WeatherDataSchema = z.object({
  current: CurrentWeatherSchema,
  hourly: z.array(HourlyForecastSchema),
  daily: z.array(DailyForecastSchema),
});

export type WeatherDataPayload = z.infer<typeof WeatherDataSchema>;
export type HourlyForecastPayload = z.infer<typeof HourlyForecastSchema>;
export type DailyForecastPayload = z.infer<typeof DailyForecastSchema>;
