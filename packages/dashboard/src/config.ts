import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "dashboard",
  name: "Dashboard",
  icon: "ti ti-layout-dashboard",
  description: "User home — composable widgets from every app on the platform.",
  basePath: "/app/dashboard",
  baseUrl: "http://app-dashboard:3000",
  // `section: "hidden"` keeps the dashboard out of the rail (users land here
  // via `/` → `/app/dashboard`) while still registering the route prefix in
  // the gateway's route table.
  nav: { href: "/app/dashboard", match: "/app/dashboard", section: "hidden" },
});

export const { ssr, plugin } = app;
