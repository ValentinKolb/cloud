import { defineApp } from "@valentinkolb/cloud";

/**
 * API Docs: single Scalar UI that aggregates every running app's
 * OpenAPI spec (advertised via `defineApp({ openapi: ... })`) into
 * one source-switcher view. Each app's spec stays its own; this app
 * renders them together into one navigable doc index.
 *
 * Public on purpose: API references are documentation, not data.
 * the `/api/<id>/openapi.json` endpoints they point at are public too.
 * Lives in the rail's "more" dropdown so it stays one click away
 * without taking primary-nav real estate.
 */
export const app = defineApp({
  id: "api-docs",
  name: "API Docs",
  icon: "ti ti-books",
  description: "Aggregated OpenAPI documentation for every cloud app.",
  appearance: { accent: "#0f766e", background: { from: "#14b8a6", to: "#22d3ee", angle: 135 } },
  basePath: "/app/api-docs",
  baseUrl: "http://app-api-docs:3000",
  nav: {
    href: "/app/api-docs",
    match: "/app/api-docs",
    section: "more",
  },
  routes: ["/app/api-docs", "/public/api-docs"],
});

export const { ssr, plugin } = app;
