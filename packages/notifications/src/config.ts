import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "notifications",
  name: "Notifications",
  icon: "ti ti-bell",
  description: "Inspect sent notifications and resend or edit pending deliveries.",
  basePath: "/admin/notifications",
  baseUrl: "http://app-notifications:3000",
  adminHref: "/admin/notifications",
  openapi: "/api/notifications/openapi.json",
  routes: ["/api/notifications", "/admin/notifications", "/public/notifications"],
});

export const { ssr, plugin } = app;
