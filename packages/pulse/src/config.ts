import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "pulse",
  name: "Pulse",
  icon: "ti ti-activity-heartbeat",
  description: "Metrics, events, states, and realtime dashboards.",
  basePath: "/app/pulse",
  baseUrl: "http://app-pulse:3000",
  nav: {
    href: "/app/pulse",
    match: "/app/pulse",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  openapi: "/api/pulse/openapi.json",
  routes: ["/api/pulse", "/app/pulse", "/public/pulse"],
});

export const { ssr, plugin } = app;
