import { defineApp } from "@valentinkolb/cloud";
import { CORE_SETTINGS } from "./_settings";

export const app = defineApp({
  id: "core",
  name: "Core",
  icon: "ti ti-cloud",
  description: "Auth, search, admin, and platform services.",
  baseUrl: "http://app-core:3000",
  settings: CORE_SETTINGS,
  // Core's API surface lives at non-standard paths (/api/auth, /api/search,
  // /api/accounts/entities, ...), so its OpenAPI spec doesn't fit the
  // `/api/<id>/openapi.json` convention. Mounted at the top-level
  // `/api/openapi.json` instead and routed via the explicit entry below.
  openapi: "/api/openapi.json",
  // Core owns the platform's top-level paths plus the catch-all "/" so
  // unmatched URLs fall through to its 404 page. Per-app admin pages
  // (`/admin/spaces`, `/admin/gateway`, …) are owned by their respective
  // apps and have their own longer-prefix entries in the trie.
  routes: [
    "/",
    "/auth",
    "/me",
    "/admin",
    "/api/auth",
    "/api/search",
    "/api/accounts/entities",
    "/api/admin/account-lifecycle",
    "/api/admin/core",
    "/api/openapi.json",
    "/branding",
    "/_ssr",
    "/public/global.css",
    "/public/logo.svg",
    "/public/core",
  ],
});

export const { ssr, plugin } = app;
