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
  settings: {
    "grids.max_file_size_mb": {
      kind: "number",
      label: "Max File Size",
      default: 10,
      description: "Maximum size per uploaded Grids file.",
    },
  },
  openapi: "/api/grids/openapi.json",
  // `/share/grids` hosts anonymous-friendly pages (public forms etc).
  // We don't use `/public/grids` because the SSR framework reserves
  // `/public/*` for static-asset serving and 404s anything that doesn't
  // match a real file on disk.
  routes: ["/api/grids", "/app/grids", "/admin/grids", "/share/grids"],
});

export const { ssr, plugin } = app;
