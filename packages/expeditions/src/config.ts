import { defineApp } from "@valentinkolb/cloud";

/**
 * App declaration for the expeditions demo / template app.
 *
 * `defineApp()` returns an object that contains:
 *   - `start({ routes, lifecycle, ... })` → call from index.ts to bootstrap
 *   - `ssr` — an SSR helper page handlers wrap themselves in
 *   - `plugin` — the Bun plugin used in `preload.ts` to discover islands
 *
 * Everything you put here is platform-discoverable: nav links, widget
 * endpoints and admin section all show up automatically once this app
 * registers itself in the Redis app registry at startup.
 *
 * To turn this template into a real app: rename `id`, `name`, `icon`,
 * `description`, `basePath`, `baseUrl`, `adminHref`, and the widget paths.
 */
export const app = defineApp({
  id: "expeditions",
  name: "Expeditions",
  icon: "ti ti-map-2",
  description: "Plan a journey, tick off waypoints, get a high-five email when you reach the summit.",
  basePath: "/app/expeditions",
  // baseUrl = the docker-internal URL the gateway proxies to. Container name
  // must match the service in compose.dev.yml.
  baseUrl: "http://app-expeditions:3000",
  adminHref: "/admin/expeditions",
  nav: {
    href: "/app/expeditions",
    match: "/app/expeditions",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  // Widgets are HTTP endpoints the dashboard calls to render a tile. The
  // `path` is relative to this app's HTTP service (the gateway prefixes it
  // automatically when forwarding the request).
  widgets: [{ id: "active", path: "/api/expeditions/widget/active" }],
  // Top-level URL prefixes the gateway routes to this container. Standard
  // four-prefix scheme: api covers widget + CRUD, app + admin host the SSR
  // pages, public serves the per-app CSS bundle.
  routes: ["/api/expeditions", "/app/expeditions", "/admin/expeditions", "/public/expeditions"],
});

export const { ssr, plugin } = app;
