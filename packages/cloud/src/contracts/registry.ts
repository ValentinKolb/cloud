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
  /** Absolute path on the app's HTTP service, e.g. "/api/quotes/widgets/random". */
  path: string;
};

export type AppRegistryEntry = {
  id: string;
  name: string;
  icon: string;
  description: string;
  baseUrl: string;
  nav?: AppRegistryNav;
  search?: AppRegistrySearch;
  legalLinks?: AppRegistryLegalLink[];
  widgets?: AppRegistryWidget[];
};
