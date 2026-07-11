import { defineApp } from "@valentinkolb/cloud";
import { CORE_SETTINGS } from "./_settings";

export const app = defineApp({
  id: "core",
  name: "Core",
  icon: "ti ti-cloud",
  description: "Auth, search, admin, and platform services.",
  baseUrl: "http://app-core:3000",
  settings: CORE_SETTINGS,
  legalLinks: [
    { label: "Imprint", href: "/impressum", icon: "ti ti-info-circle" },
    { label: "Privacy", href: "/legal/privacy", icon: "ti ti-shield-lock" },
    { label: "Terms", href: "/legal/terms", icon: "ti ti-file-text" },
  ],
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
    "/cli",
    "/me",
    "/admin",
    "/legal/privacy",
    "/legal/terms",
    "/impressum",
    "/api/auth",
    "/api/announcements",
    "/api/search",
    "/api/accounts/entities",
    "/api/admin/account-lifecycle",
    "/api/admin/core",
    "/api/openapi.json",
    "/branding",
    "/_ssr",
    "/public/fonts.css",
    "/public/fonts",
    "/public/tabler-icons.css",
    "/public/tabler-icons.woff2",
    "/public/global.css",
    "/public/logo.svg",
    "/public/core",
  ],
});

export const { ssr, plugin } = app;
