import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "quotes",
  name: "Quotes",
  icon: "ti ti-quote",
  description: "Display a cached motivational quote that refreshes hourly.",
  basePath: "/app/quotes",
  baseUrl: "http://app-quotes:3000",
  widgets: [{ id: "quote", path: "/api/quotes/widget/quote" }],
  openapi: "/api/quotes/openapi.json",
  // API-only app — no SSR pages. Just exposes /api/quotes for the widget +
  // public quote-of-the-hour endpoint.
  routes: ["/api/quotes", "/public/quotes"],
});

export const { ssr, plugin } = app;
