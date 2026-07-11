import type { CloudRuntime, RuntimeAppMeta } from "../contracts/app";
import type { AppRegistryEntry } from "../contracts/registry";
import type { Role } from "../contracts/shared";

/**
 * Builds a `CloudRuntime` (the shape consumed by Layout, AdminSidebar, NavMenu)
 * from registry entries.
 *
 * This produces the exact same shape as `createRuntimeContext()` in core/runtime.ts,
 * so all existing UI components work unchanged.
 */
export const buildRuntimeFromRegistry = (entries: AppRegistryEntry[]): CloudRuntime => ({
  apps: entries.map(
    (e): RuntimeAppMeta => ({
      id: e.id,
      name: e.name,
      icon: e.icon,
      description: e.description,
      appearance: e.appearance,
      adminHref: e.nav?.adminHref,
      routes: e.routes,
      nav: e.nav
        ? {
            href: e.nav.href,
            match: e.nav.match,
            section: e.nav.section,
            requiresAuth: e.nav.requiresAuth,
            // Registry stores roles as serialized strings; the source type is
            // Role[] and round-trip is value-preserving.
            requiresRoles: e.nav.requiresRoles as Role[] | undefined,
          }
        : undefined,
      searchTags: e.search?.tags,
      searchHelp: e.search?.help,
      searchTagHelp: e.search?.tagHelp,
      legalLinks: e.legalLinks ? e.legalLinks.map((l) => ({ ...l })) : undefined,
      openapi: e.openapi,
    }),
  ),
});
