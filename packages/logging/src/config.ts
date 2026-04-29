import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "logging",
  name: "Logs",
  icon: "ti ti-list-details",
  description: "View, filter, and clean up application logs.",
  basePath: "/admin/logging",
  baseUrl: "http://app-logging:3000",
  adminHref: "/admin/logging",
  widgets: [{ id: "errors", path: "/api/logging/widget/errors" }],
  routes: ["/api/logging", "/admin/logging", "/public/logging"],
});

export const { ssr, plugin } = app;
