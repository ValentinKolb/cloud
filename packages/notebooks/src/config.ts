import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "notebooks",
  name: "Notebooks",
  icon: "ti ti-notebook",
  description: "Collaborative notebooks with structured notes and realtime sync.",
  basePath: "/app/notebooks",
  baseUrl: "http://app-notebooks:3000",
  adminHref: "/admin/notebooks",
  nav: {
    href: "/app/notebooks?recent=true",
    match: "/app/notebooks",
    section: "primary",
    requiresAuth: true,
  },
});

export const { ssr, plugin } = app;
