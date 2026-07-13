import type { AppAdminNavigationGroup, AppAppearance } from "./app";

/**
 * App-registry entry type. Populated internally by `defineApp()` + the
 * heartbeat runtime; never parsed from external input — plain TS types are
 * enough for type safety (no runtime validation needed).
 */

export type AppRegistryNav = {
  href: string;
  match?: string;
  section: "primary" | "more" | "hidden";
  requiresAuth?: boolean;
  requiresRoles?: string[];
  adminHref?: string;
};

export type AppRegistrySearch = {
  tags: string[];
  help: string;
  tagHelp: Array<{ tag: string; help: string }>;
  endpoint: string;
};

export type AppRegistryLegalLink = {
  label: string;
  href: string;
  icon?: string;
};

export type AppRegistryWidget = {
  id: string;
  /** Absolute path on the app's HTTP service, e.g. "/api/quotes/widget/random". */
  path: string;
};

export type AppRegistryEntry = {
  id: string;
  name: string;
  icon: string;
  description: string;
  appearance?: AppAppearance;
  baseUrl: string;
  /**
   * Top-level URL prefixes the gateway routes to this app. The gateway
   * builds a prefix-trie from these strings, no derivation or heuristics.
   */
  routes: readonly string[];
  nav?: AppRegistryNav;
  adminNav?: AppAdminNavigationGroup[];
  search?: AppRegistrySearch;
  legalLinks?: AppRegistryLegalLink[];
  widgets?: AppRegistryWidget[];
  /** Setting keys declared by this app. Used by admin tooling to avoid treating live app-owned settings as legacy. */
  settingKeys?: readonly string[];
  /** Gateway-relative URL where this app serves its OpenAPI JSON spec. */
  openapi?: string;
};
