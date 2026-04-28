import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "logging",
  name: "Logs",
  icon: "ti ti-list-details",
  description: "View, filter, and clean up application logs.",
  basePath: "/admin/logs",
  baseUrl: "http://app-logging:3000",
  adminHref: "/admin/logs",
  widgets: [{ id: "errors", path: "/api/logging/widgets/errors" }],
});

export const { ssr, plugin } = app;
