import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "quotes",
  name: "Quotes",
  icon: "ti ti-quote",
  description: "Display a cached motivational quote that refreshes hourly.",
  basePath: "/app/quotes",
  baseUrl: "http://app-quotes:3000",
});

export const { ssr, plugin } = app;
