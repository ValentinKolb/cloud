import type { Hono } from "hono";
import type { Context } from "hono";
import type { JSX } from "solid-js/jsx-runtime";

import type { Role, User } from "./shared";

export type AppColor = "blue" | "emerald" | "violet" | "orange" | "red" | "amber" | "zinc" | "cyan" | "rose";

export type AppMeta = {
  id: string;
  name: string;
  icon: string;
  description: string;
  color?: AppColor;
  adminHref?: string;
  nav?: {
    href: string;
    match?: string;
    section: "primary" | "more" | "hidden";
    requiresAuth?: boolean;
    requiresRoles?: Role[];
  };
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

export type AppFacade<Service = unknown> = {
  meta: AppMeta;
  service: Service;
  routes: {
    api?: Hono<any>;
    pages?: Hono<any>;
    ws?: Hono<any>;
  };
  widgets?: WidgetFactory[];
  lifecycle?: AppLifecycle;
  capabilities?: AppCapabilities;
  /** @deprecated Use lifecycle.start instead. */
  start?: () => void;
};

/**
 * Removes query parameters from a navigation href so path matching stays stable.
 */
export const stripQuery = (href: string): string => href.split("?")[0] ?? href;

/**
 * Resolves the active-path matcher for a nav entry.
 */
export const resolveNavMatch = (meta: AppMeta): string | undefined => meta.nav?.match ?? (meta.nav ? stripQuery(meta.nav.href) : undefined);

/**
 * Resolves app accent color with a deterministic default.
 */
export const resolveAppColor = (color?: AppColor): AppColor => color ?? "zinc";
