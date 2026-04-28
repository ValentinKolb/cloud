import type { AppRegistryEntry } from "@valentinkolb/cloud/contracts";

// ─── Route derivation from registry entries ─────────────────────────────────

export type AppRoute = { prefix: string; appId: string; baseUrl: string };

/**
 * Well-known prefixes for core that don't follow standard patterns.
 */
const CORE_PREFIXES = [
  "/auth",
  "/me",
  "/api/auth",
  "/api/search",
  "/api/accounts/entities",
  "/api/admin/account-lifecycle",
  "/public/global.css",
  "/public/core",
  "/_ssr",
  "/branding",
  "/llms.txt",
  "/admin",
  // /faq, /tools, /legal/*, /impressum no longer here — they're auto-derived
  // from each app's `nav.href` or `legalLinks[].href` declarations.
];

/**
 * Build route prefixes from registry entries.
 * Derives routes from nav.href, nav.adminHref, and well-known patterns.
 * Core gets special treatment because it owns many top-level paths.
 */
export const buildAppRoutes = (apps: AppRegistryEntry[]): AppRoute[] => {
  const routes: AppRoute[] = [];

  // 1. Non-core apps first. Their auto-derived prefixes (nav.href,
  //    nav.adminHref) may collide with CORE_PREFIXES (e.g. settings's
  //    `/api/admin/settings` collides with the shared admin API in core).
  for (const app of apps) {
    const { id, baseUrl, nav } = app;

    if (id === "gateway") continue; // Don't route to ourselves
    if (id === "core") continue;    // Core handled last so CORE_PREFIXES win

    // Standard app prefixes derived from nav (strip query strings)
    if (nav?.href) {
      const href = nav.href.split("?")[0]!;
      routes.push({ prefix: href, appId: id, baseUrl });
      // SSR bundle path
      routes.push({ prefix: `${href}/_ssr`, appId: id, baseUrl });
      // API prefix (derive from nav.href: /app/X -> /api/app/X)
      routes.push({ prefix: `/api${href}`, appId: id, baseUrl });
      // Some apps also serve under /api/{id} (legacy compat, e.g. accounts)
      routes.push({ prefix: `/api/${id}`, appId: id, baseUrl });
    }

    if (nav?.adminHref) {
      routes.push({ prefix: nav.adminHref, appId: id, baseUrl });
      // SSR bundle for admin pages
      routes.push({ prefix: `${nav.adminHref}/_ssr`, appId: id, baseUrl });
      // API prefix for admin
      routes.push({ prefix: `/api${nav.adminHref}`, appId: id, baseUrl });
    }

    // Legal-link prefixes (e.g. settings owns /impressum, /legal/privacy,
    // /legal/terms; faq owns /faq — already covered by nav.href but harmless).
    for (const link of app.legalLinks ?? []) {
      const href = link.href.split("?")[0]!;
      routes.push({ prefix: href, appId: id, baseUrl });
      routes.push({ prefix: `${href}/_ssr`, appId: id, baseUrl });
    }

    // Public assets
    routes.push({ prefix: `/public/${id}`, appId: id, baseUrl });
  }

  // 2. Core LAST so its CORE_PREFIXES overwrite any conflicting auto-derived
  //    prefix from above (last-write-wins in the route trie).
  const core = apps.find((a) => a.id === "core");
  if (core) {
    for (const prefix of CORE_PREFIXES) {
      routes.push({ prefix, appId: "core", baseUrl: core.baseUrl });
    }
  }

  return routes;
};

/**
 * Core acts as the fallback — add it last with the "/" prefix
 * so any unmatched route goes to core (home page, 404, etc.).
 */
export const buildRoutesWithFallback = (apps: AppRegistryEntry[]): AppRoute[] => {
  const routes = buildAppRoutes(apps);

  // Add core as the root fallback (lowest priority since it's the shortest prefix)
  const core = apps.find((a) => a.id === "core");
  if (core) {
    routes.push({ prefix: "/", appId: "core", baseUrl: core.baseUrl });
  }

  return routes;
};
