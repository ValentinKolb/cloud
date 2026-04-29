import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "weather",
  name: "Weather",
  icon: "ti ti-temperature-celsius",
  description: "Forecasts, saved locations, and weather widgets.",
  basePath: "/app/weather",
  baseUrl: "http://app-weather:3000",
  adminHref: "/admin/weather",
  nav: {
    href: "/app/weather",
    match: "/app/weather",
    section: "more",
    requiresAuth: true,
  },
  widgets: [{ id: "current", path: "/api/weather/widget/current" }],
  routes: ["/api/weather", "/app/weather", "/admin/weather", "/public/weather"],
  settings: {
    "weather.default_lat": {
      kind: "string",
      label: "Default Latitude",
      default: "",
      description: "Default latitude shown in weather widgets",
      placeholder: "e.g. 48.401082 (Ulm)",
    },
    "weather.default_lon": {
      kind: "string",
      label: "Default Longitude",
      default: "",
      description: "Default longitude shown in weather widgets",
      placeholder: "e.g. 9.987608 (Ulm)",
    },
    "weather.cache_minutes": {
      kind: "number",
      label: "Cache TTL (minutes)",
      default: 30,
      min: 1,
      max: 1440,
      description: "How long weather data is cached before fetching fresh data (in minutes)",
    },
    "weather.geo_url": {
      kind: "url",
      label: "Geo API URL",
      default: "",
      description: "Geocoding API URL for the location search feature",
      placeholder: "e.g. https://geocoding.example.com/search",
    },
  },
});

export const { ssr, plugin } = app;
