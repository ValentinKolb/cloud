import { ephemeral } from "@k2b/sync";
import type { AppRegistryEntry, CapabilityRegistryEntry } from "../contracts/registry";
import type { DashboardWidgetPresentation } from "../contracts/widgets";
import { validateAppRegistryEntry } from "./registry-validation";

/**
 * Shared app registry backed by Redis via @k2b/sync ephemeral store.
 * Replaces the v4 `registry` module with `ephemeral<T>` + prefix filter.
 *
 * TTL is 3× the heartbeat interval (see `./heartbeat.ts`).
 */
export const APP_REGISTRY_TTL_MS = 180_000;

export const appRegistry = ephemeral<AppRegistryEntry>({
  id: "cloud-apps",
  ttlMs: APP_REGISTRY_TTL_MS,
  limits: { maxPayloadBytes: 64 * 1024 },
});

export const capabilityRegistry = ephemeral<CapabilityRegistryEntry>({
  id: "cloud-capabilities",
  ttlMs: APP_REGISTRY_TTL_MS,
  limits: { maxPayloadBytes: 512 * 1024 },
});

/**
 * App entry enriched with registry metadata.
 * `createdAt` = first registration of the container (uptime anchor).
 * `updatedAt` = most recent heartbeat touch.
 */
export type AppRegistryDetail = AppRegistryEntry & {
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  version: string;
};

export type AppRegistryIssue = {
  key: string;
  version: string;
  reason: string;
};

export type AppRegistrySnapshot = {
  apps: AppRegistryDetail[];
  issues: AppRegistryIssue[];
};

const loggedInvalidReasons = new Map<string, string>();

const reportInvalidEntry = (issue: AppRegistryIssue): void => {
  if (loggedInvalidReasons.get(issue.key) === issue.reason) return;
  loggedInvalidReasons.set(issue.key, issue.reason);
  console.error(
    JSON.stringify({
      level: "error",
      source: "app-registry",
      message: "Rejected invalid app registry entry",
      registryKey: issue.key,
      registryVersion: issue.version,
      reason: issue.reason,
    }),
  );
};

export const readAppRegistrySnapshot = async (): Promise<AppRegistrySnapshot> => {
  const snapshot = await appRegistry.snapshot({ prefix: "apps/" });
  const apps: AppRegistryDetail[] = [];
  const issues: AppRegistryIssue[] = [];
  const presentKeys = new Set<string>();

  for (const entry of snapshot.entries) {
    presentKeys.add(entry.key);
    const reason = validateAppRegistryEntry(entry.value);
    if (reason) {
      const issue = { key: entry.key, version: entry.version, reason };
      issues.push(issue);
      reportInvalidEntry(issue);
      continue;
    }
    loggedInvalidReasons.delete(entry.key);
    apps.push({
      ...(entry.value as AppRegistryEntry),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      version: entry.version,
    });
  }

  for (const key of loggedInvalidReasons.keys()) {
    if (!presentKeys.has(key)) loggedInvalidReasons.delete(key);
  }
  return { apps, issues };
};

export const requireUsableAppRegistry = (snapshot: AppRegistrySnapshot): AppRegistryDetail[] => {
  if (snapshot.apps.length === 0 && snapshot.issues.length > 0) {
    throw new Error(`App registry contains no valid entries (${snapshot.issues.length} rejected)`);
  }
  return snapshot.apps;
};

/**
 * List all currently live (TTL-valid) app registry entries.
 */
export const listApps = async (): Promise<AppRegistryEntry[]> => {
  const snapshot = await readAppRegistrySnapshot();
  return requireUsableAppRegistry(snapshot);
};

/** Reads one live app without materializing the full registry. */
export const getApp = async (appId: string): Promise<AppRegistryEntry | null> => {
  const key = `apps/${appId}`;
  const snap = await appRegistry.snapshot({ prefix: key });
  const entry = snap.entries.find((candidate) => candidate.key === key);
  if (!entry) return null;
  const reason = validateAppRegistryEntry(entry.value);
  if (!reason) {
    loggedInvalidReasons.delete(key);
    return entry.value;
  }
  reportInvalidEntry({ key, version: entry.version, reason });
  return null;
};

export const listCapabilities = async (): Promise<CapabilityRegistryEntry[]> => {
  const snap = await capabilityRegistry.snapshot({ prefix: "capabilities/" });
  return snap.entries.map((entry) => entry.value);
};

export const getCapability = async (appId: string): Promise<CapabilityRegistryEntry | null> => {
  const key = `capabilities/${appId}`;
  const snap = await capabilityRegistry.snapshot({ prefix: key });
  return snap.entries.find((entry) => entry.key === key)?.value ?? null;
};

/**
 * Same as `listApps` but returns registry metadata for admin observability.
 */
export const listAppsDetailed = async (): Promise<AppRegistryDetail[]> => {
  const snapshot = await readAppRegistrySnapshot();
  return snapshot.apps;
};

/**
 * Aggregate every running app's `legalLinks` into one flat list. Used by the
 * login footer, app Footer, and rail "more" dropdown to render a unified set
 * of legal/info links (Imprint, Privacy, Terms, FAQ, …).
 *
 * Order = registration order across apps (no explicit weights — KISS). Within
 * one app, declaration order is preserved. Duplicate `href`s are de-duped
 * (last-seen wins).
 */
export const listLegalLinks = async (): Promise<Array<{ label: string; href: string; icon?: string }>> => {
  const apps = await listApps();
  const seen = new Map<string, { label: string; href: string; icon?: string }>();
  for (const app of apps) {
    for (const link of app.legalLinks ?? []) seen.set(link.href, { ...link });
  }
  return [...seen.values()];
};

/**
 * Aggregate every running app's widget endpoints into one flat list. Used by
 * the dashboard app to build the widget grid: it fetches each widget URL
 * with the user's session forwarded and renders the response.
 *
 * Order = registration order across apps.
 */
export type DashboardWidget = {
  appId: string;
  appName: string;
  appIcon: string;
  widgetId: string;
  /** Fully-qualified URL — `<baseUrl>/<path>`. */
  url: string;
  presentation?: DashboardWidgetPresentation;
};

export const listWidgets = async (): Promise<DashboardWidget[]> => {
  const apps = await listApps();
  const out: DashboardWidget[] = [];
  for (const app of apps) {
    for (const w of app.widgets ?? []) {
      out.push({
        appId: app.id,
        appName: app.name,
        appIcon: app.icon,
        widgetId: w.id,
        url: `${app.baseUrl.replace(/\/$/, "")}${w.path.startsWith("/") ? w.path : `/${w.path}`}`,
        presentation: w.presentation,
      });
    }
  }
  return out;
};
