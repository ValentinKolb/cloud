/** Weather icon codes from Brightsky API */
export type WeatherIcon =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy-day"
  | "partly-cloudy-night"
  | "cloudy"
  | "fog"
  | "wind"
  | "rain"
  | "sleet"
  | "snow"
  | "hail"
  | "thunderstorm";

/** Current weather data */
export type CurrentWeather = {
  temperature: number; // deg C
  icon: WeatherIcon;
  cloudCover: number; // 0-100%
  windSpeed: number; // km/h
  windGust: number | null; // km/h
  windDirection: number | null; // degrees
  humidity: number | null; // 0-100%
  precipitation: number; // mm in last hour
  pressure: number | null; // hPa
  visibility: number | null; // meters
  dewPoint: number | null; // deg C
  sunshine: number | null; // minutes in last hour
  stationName: string;
  timestamp: string; // ISO timestamp
};

/** Hourly forecast entry */
export type HourlyForecast = {
  timestamp: string;
  temperature: number;
  icon: WeatherIcon;
  precipitation: number;
  precipitationProbability: number | null; // 0-100%
  windSpeed: number;
  cloudCover: number;
};

/** Daily forecast summary */
export type DailyForecast = {
  date: string; // YYYY-MM-DD
  tempMin: number;
  tempMax: number;
  icon: WeatherIcon;
  precipitation: number; // total mm
  precipitationProbability: number | null; // max probability for the day
  sunshine: number; // total minutes
};

/** Full weather data with forecasts */
export type WeatherData = {
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
};
