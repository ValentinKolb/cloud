import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "notebooks",
  name: "Notebooks",
  icon: "ti ti-note",
  description: "Collaborative notebooks with structured notes and realtime sync.",
  appearance: {
    accent: "#eab308",
    background: {
      from: "#ffd60a",
      to: "#ffcc00",
      angle: 145,
      strength: 24,
    },
  },
  basePath: "/app/notebooks",
  baseUrl: "http://app-notebooks:3000",
  adminHref: "/admin/notebooks",
  nav: {
    href: "/app/notebooks?recent=true",
    match: "/app/notebooks",
    section: "primary",
    requiresAuth: true,
  },
  widgets: [{ id: "recent", path: "/api/notebooks/widget/recent" }],
  openapi: "/api/notebooks/openapi.json",
  routes: ["/api/notebooks", "/app/notebooks", "/admin/notebooks", "/public/notebooks"],
});

export const { ssr, plugin } = app;
