import { z } from "zod";

export const WeatherLocationIdSchema = z.string().regex(/^[0-9A-Za-z]{6}$/);

export const WeatherIconSchema = z.enum([
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

export const CurrentWeatherSchema = z
  .object({
    temperature: z.number().finite().min(-100).max(70).describe("Air temperature in degrees Celsius."),
    icon: WeatherIconSchema,
    cloudCover: z.number().finite().min(0).max(100).describe("Cloud cover percentage from 0 to 100."),
    windSpeed: z.number().finite().min(0).max(500).describe("Wind speed in kilometres per hour."),
    windGust: z.number().finite().min(0).max(500).nullable().describe("Wind gust speed in kilometres per hour."),
    windDirection: z.number().finite().min(0).max(360).nullable().describe("Wind direction in degrees."),
    humidity: z.number().finite().min(0).max(100).nullable().describe("Relative humidity percentage from 0 to 100."),
    precipitation: z.number().finite().min(0).max(1_000).describe("Precipitation in millimetres during the last hour."),
    pressure: z.number().finite().min(0).max(2_000).nullable().describe("Mean sea-level pressure in hectopascals."),
    visibility: z.number().finite().min(0).max(10_000_000).nullable().describe("Visibility in metres."),
    dewPoint: z.number().finite().min(-100).max(70).nullable().describe("Dew point in degrees Celsius."),
    sunshine: z.number().finite().min(0).max(60).nullable().describe("Sunshine duration in minutes during the last hour."),
    stationName: z.string().trim().min(1).max(160),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();

const HourlyForecastSchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }),
    temperature: z.number().finite().min(-100).max(70),
    icon: WeatherIconSchema,
    precipitation: z.number().finite().min(0).max(1_000),
    precipitationProbability: z.number().finite().min(0).max(100).nullable(),
    windSpeed: z.number().finite().min(0).max(500),
    cloudCover: z.number().finite().min(0).max(100),
  })
  .strict();

const DailyForecastSchema = z
  .object({
    date: z.iso.date(),
    icon: WeatherIconSchema,
    tempMin: z.number().finite().min(-100).max(70),
    tempMax: z.number().finite().min(-100).max(70),
    precipitation: z.number().finite().min(0).max(1_000),
    precipitationProbability: z.number().finite().min(0).max(100).nullable(),
    sunshine: z.number().finite().min(0).max(1_440),
  })
  .strict();

export const WeatherDataSchema = z
  .object({
    current: CurrentWeatherSchema,
    hourly: z.array(HourlyForecastSchema).max(12),
    daily: z.array(DailyForecastSchema).max(7),
  })
  .strict();

export type WeatherDataPayload = z.infer<typeof WeatherDataSchema>;
export type HourlyForecastPayload = z.infer<typeof HourlyForecastSchema>;
export type DailyForecastPayload = z.infer<typeof DailyForecastSchema>;
