import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { createWeatherWidget } from "./widget";
import { weatherService } from "./service";
import { migrate } from "./migrate";
import { weatherCapabilities } from "./capabilities";
export type {
  WeatherData,
  DailyForecast,
  CurrentWeather,
  HourlyForecast,
} from "./service";

const app = {
  meta: {
    id: "weather",
    name: "Weather",
    icon: "ti ti-temperature-celsius",
    description: "Forecasts, saved locations, and weather widgets.",
    color: "blue",
    adminHref: "/admin/weather",
    nav: {
      href: "/app/weather",
      match: "/app/weather",
      section: "more",
      requiresAuth: true,
    },
  },
  service: weatherService,
  capabilities: weatherCapabilities,
  routes: {
    api: new Hono().route("/app/weather", apiRoutes),
    pages: new Hono().route("/app/weather", pageRoutes).route("/admin/weather", adminPageRoutes),
  },
  widgets: [createWeatherWidget],
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof weatherService>;

export default app;
export { weatherService as service };
export type { ApiType } from "./api";
