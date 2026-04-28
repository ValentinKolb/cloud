import { ephemeral } from "@valentinkolb/sync";
import type { AppRegistryEntry } from "../contracts/registry";

/**
 * Shared app registry backed by Redis via @valentinkolb/sync ephemeral store.
 * Replaces the v4 `registry` module with `ephemeral<T>` + prefix filter.
 *
 * TTL is 3× the heartbeat interval (see `./heartbeat.ts`).
 */
const REGISTRY_TTL_MS = 120_000;

export const appRegistry = ephemeral<AppRegistryEntry>({
  id: "cloud-apps",
  ttlMs: REGISTRY_TTL_MS,
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
