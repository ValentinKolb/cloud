import type { WeatherIcon } from "./types";

/** Map Brightsky icon to Tabler icon name. */
const getTablerIcon = (icon: WeatherIcon): string => {
  const iconMap: Record<WeatherIcon, string> = {
    "clear-day": "sun",
    "clear-night": "moon",
    "partly-cloudy-day": "sun-moon",
    "partly-cloudy-night": "sun-moon",
    cloudy: "cloud",
    fog: "mist",
    wind: "wind",
    rain: "cloud-rain",
    sleet: "cloud-snow",
    snow: "snowflake",
    hail: "cloud-snow",
    thunderstorm: "cloud-storm",
  };
  return iconMap[icon] ?? "cloud";
};

/** Get Tailwind color class for temperature. */
const getTempColorClass = (temp: number): string => {
  if (temp <= 0) return "text-blue-400";
  if (temp <= 10) return "text-cyan-500";
  if (temp <= 20) return "text-emerald-500";
  if (temp <= 25) return "text-amber-500";
  return "text-red-500";
};

/** Get temperature color class for an average of min/max. */
const getAvgTempColorClass = (tempMin: number, tempMax: number): string => {
  return getTempColorClass((tempMin + tempMax) / 2);
};

/** Format temperature with degree symbol. */
const formatTemp = (temp: number): string => `${temp}°`;

/** Format temperature range (e.g., "12° / 5°"). */
const formatTempRange = (tempMax: number, tempMin: number): string => `${tempMax}° / ${tempMin}°`;

export const weatherUiService = {
  getTablerIcon,
  getTempColorClass,
  getAvgTempColorClass,
  formatTemp,
  formatTempRange,
};

export type WeatherUiService = typeof weatherUiService;
