import { ephemeral } from "@k2b/sync";
import type { AppRegistryEntry } from "../contracts/registry";
import type { DashboardWidgetPresentation } from "../contracts/widgets";

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
  // Capability manifests contain bounded JSON Schemas. Keep the registry
  // contract explicit instead of inheriting ephemeral's presence-sized 4 KiB
  // default; compileCapabilities caps the manifest itself at 256 KiB.
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

/**
 * List all currently live (TTL-valid) app registry entries.
 */
export const listApps = async (): Promise<AppRegistryEntry[]> => {
  const snap = await appRegistry.snapshot({ prefix: "apps/" });
  return snap.entries.map((e) => e.value);
};

/** Reads one live app without materializing the full registry. */
export const getApp = async (appId: string): Promise<AppRegistryEntry | null> => {
  const key = `apps/${appId}`;
  const snap = await appRegistry.snapshot({ prefix: key });
  return snap.entries.find((entry) => entry.key === key)?.value ?? null;
};

/**
 * Same as `listApps` but returns registry metadata for admin observability.
 */
export const listAppsDetailed = async (): Promise<AppRegistryDetail[]> => {
  const snap = await appRegistry.snapshot({ prefix: "apps/" });
  return snap.entries.map((e) => ({
    ...e.value,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    expiresAt: e.expiresAt,
    version: e.version,
  }));
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
