import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "dashboard",
  name: "Dashboard",
  icon: "ti ti-layout-dashboard",
  description: "User home — composable widgets from every app on the platform.",
  appearance: { accent: "#7c3aed", background: { from: "#8b5cf6", to: "#d946ef", angle: 135 } },
  basePath: "/app/dashboard",
  baseUrl: "http://app-dashboard:3000",
  // `section: "hidden"` keeps the dashboard out of the rail (users land here
  // via `/` → `/app/dashboard`).
  nav: { href: "/app/dashboard", match: "/app/dashboard", section: "hidden" },
  routes: ["/api/dashboard", "/app/dashboard", "/public/dashboard"],
});

export const { ssr, plugin } = app;
