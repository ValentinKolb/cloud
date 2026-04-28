import type { Context } from "hono";
import type { JSX } from "solid-js/jsx-runtime";

import type { Role, User } from "./shared";

/**
 * One link entry contributed by an app to the global legal/info footer
 * (login page, app footer, rail dropdown). Aggregated across all running
 * apps via `listLegalLinks()`.
 */
export type LegalLink = {
  label: string;
  href: string;
  icon?: string;
};

export type AppMeta = {
  id: string;
  name: string;
  icon: string;
  description: string;
  adminHref?: string;
  nav?: {
    href: string;
    match?: string;
    section: "primary" | "more" | "hidden";
    requiresAuth?: boolean;
    requiresRoles?: Role[];
  };
  /**
   * Legal/info pages this app owns. Aggregated app-wide and rendered in
   * login footer, app Footer, and the rail "more" dropdown. Each app
   * contributes its own (e.g. settings → terms/privacy/imprint, faq → FAQ).
   */
  legalLinks?: LegalLink[];
};

export type RuntimeAppMeta = AppMeta & {
  searchTags?: string[];
  searchHelp?: string;
  searchTagHelp?: AppSearchTagHelpEntry[];
};

export type WidgetFactory = (c: Context, user?: User) => Widget | Promise<Widget>;

export type WidgetData = {
  id: string;
  title: string;
  icon: string;
  content: JSX.Element;
};

export type Widget = WidgetData | null;

export type CloudLogger = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export type CloudRuntime = {
  apps: readonly RuntimeAppMeta[];
};

export type CloudContext = {
  logger: (source: string) => CloudLogger;
  settings: {
    get: <T = unknown>(key: string) => T;
    set: (key: string, value: unknown) => Promise<void>;
  };
  runtime: CloudRuntime;
};

export type CloudLifecycleContext = CloudContext;

export type AppLifecycle = {
  setup?: (ctx: CloudContext) => Promise<void>;
  start?: (ctx: CloudContext) => Promise<void>;
  stop?: (ctx: CloudContext) => Promise<void>;
};

export type SearchPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type AppSearchContext = {
  get: <K extends "user" | "sessionToken">(key: K) => K extends "user" ? User : string;
};

export type AppSearchInput = {
  query: string;
  tags: string[];
  limit: number;
  ctx: AppSearchContext;
};

export type AppSearchMetadataEntry = {
  label: string;
  value: string;
};

export type AppSearchTagHelpEntry = {
  tag: string;
  help: string;
};

export type AppSearchResult = {
  id: string;
  title: string;
  href: string;
  preview?: string;
  icon?: string;
  priority?: SearchPriority;
  metadata?: AppSearchMetadataEntry[];
  previewUrl?: string;
};

export type AppCapabilities = {
  search?: {
    tags?: readonly string[];
    help?: string;
    tagHelp?: readonly AppSearchTagHelpEntry[];
    run: (input: AppSearchInput) => Promise<AppSearchResult[]>;
  };
};

/**
 * Removes query parameters from a navigation href so path matching stays stable.
 */
export const stripQuery = (href: string): string => href.split("?")[0] ?? href;

/**
 * Resolves the active-path matcher for a nav entry.
 */
export const resolveNavMatch = (meta: AppMeta): string | undefined => meta.nav?.match ?? (meta.nav ? stripQuery(meta.nav.href) : undefined);
