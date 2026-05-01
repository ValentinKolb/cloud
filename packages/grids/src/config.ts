import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "grids",
  name: "Grids",
  icon: "ti ti-table",
  description: "Flexible tables: bases, fields, records, views, forms.",
  basePath: "/app/grids",
  baseUrl: "http://app-grids:3000",
  adminHref: "/admin/grids",
  nav: {
    href: "/app/grids",
    match: "/app/grids",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  openapi: "/api/grids/openapi.json",
  routes: ["/api/grids", "/app/grids", "/admin/grids", "/public/grids"],
});

export const { ssr, plugin } = app;
