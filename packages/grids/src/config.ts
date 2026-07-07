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
    href: "/app/grids?recent=true",
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
    "grids.http_request_allow_private_networks": {
      kind: "boolean",
      label: "Allow Private HTTP Requests",
      default: false,
      description:
        "Allow Grids workflows to call private, loopback, and link-local HTTP targets. Keep disabled unless this deployment intentionally integrates with internal services.",
    },
  },
  openapi: "/api/grids/openapi.json",
  // `/share/grids` hosts anonymous-friendly pages (public forms etc);
  // `/public/grids` is reserved for this app's generated CSS/assets.
  routes: ["/api/grids", "/app/grids", "/admin/grids", "/share/grids", "/public/grids"],
});

export const { ssr, plugin } = app;
