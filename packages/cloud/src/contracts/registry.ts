import type { AppAdminNavigationGroup, AppAppearance } from "./app";
import type { CapabilityManifest, CapabilitySearchTagManifest } from "./capabilities";
import type { DashboardWidgetPresentation } from "./widgets";

/**
 * App-registry entry type. Populated internally by `defineApp()` + the
 * heartbeat runtime. Values are validated when read because Redis may still
 * contain records written by older or interrupted runtimes.
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
  endpoint: string;
  queryId: string;
  schemaHash: string;
  description: string;
  tags: CapabilitySearchTagManifest[];
};

export type AppRegistryCapabilitySummary = {
  protocolVersion: number;
  manifestHash: string;
};

/** Full manifests live separately so normal app discovery stays small. */
export type CapabilityRegistryEntry = {
  appId: string;
  appName: string;
  appIcon: string;
  endpoint: string;
  manifest: CapabilityManifest;
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
  presentation?: DashboardWidgetPresentation;
};

export type AppRuntimeMetadata = {
  release: string;
  syncVersion: string;
};

export type AppRegistryEntry = {
  id: string;
  name: string;
  icon: string;
  description: string;
  appearance?: AppAppearance;
  baseUrl: string;
  /** Build metadata reported by the running app. Missing on older app releases. */
  runtime?: AppRuntimeMetadata;
  /**
   * Top-level URL prefixes the gateway routes to this app. The gateway
   * builds a prefix-trie from these strings, no derivation or heuristics.
   */
  routes: readonly string[];
  nav?: AppRegistryNav;
  adminNav?: AppAdminNavigationGroup[];
  capabilities?: AppRegistryCapabilitySummary;
  search?: AppRegistrySearch;
  legalLinks?: AppRegistryLegalLink[];
  widgets?: AppRegistryWidget[];
  /** Setting keys declared by this app. Used by admin tooling to avoid treating live app-owned settings as legacy. */
  settingKeys?: readonly string[];
  /** Gateway-relative URL where this app serves its OpenAPI JSON spec. */
  openapi?: string;
};
