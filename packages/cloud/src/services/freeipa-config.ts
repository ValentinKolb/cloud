import { coreSettings } from "./settings/api";
import * as settings from "./settings";
import { setFreeIpaTlsResolver } from "../server/services/freeipa/tls";

export type FreeIpaConfig = {
  enabled: boolean;
  configured: boolean;
  url: string;
  serviceUser: string;
  servicePassword: string;
  groupsAdmin: string[];
  groupsBaseSync: string[];
  groupsBaseIpaRealm: string[];
  groupsExcluded: string[];
  caCert: string;
  allowInsecure: boolean;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeStringList = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

/**
 * Sync version — reads via the legacy settings cache (still populated until
 * phase H). Many sync helpers (getIpaUrl, isIpa* predicates, scheduled jobs)
 * depend on this; converting them to async would cascade widely. Keep both
 * surfaces alive during the transition; phase H removes the sync side.
 */
export const getFreeIpaConfigSync = (): FreeIpaConfig => {
  const get = <T>(key: string): T => settings.getSync<T>(key);
  const url = normalizeString(get<string>("freeipa.url"));
  const serviceUser = normalizeString(get<string>("freeipa.service_user"));
  const servicePassword = normalizeString(get<string>("freeipa.service_password"));
  const enabled = Boolean(get<boolean>("freeipa.enable"));
  const configured = url.length > 0 && serviceUser.length > 0 && servicePassword.length > 0;
  return {
    enabled,
    configured,
    url,
    serviceUser,
    servicePassword,
    groupsAdmin: normalizeStringList(get<string[]>("freeipa.groups.admin"), ["admins"]),
    groupsBaseSync: normalizeStringList(get<string[]>("freeipa.groups.base_sync"), ["users"]),
    groupsBaseIpaRealm: normalizeStringList(get<string[]>("freeipa.groups.base_ipa_realm"), ["cloud"]),
    groupsExcluded: normalizeStringList(get<string[]>("freeipa.groups.excluded"), ["editors", "trust admins", "admins"]),
    caCert: normalizeString(get<string>("freeipa.ca_cert")),
    allowInsecure: Boolean(get<boolean>("freeipa.allow_insecure")),
  };
};

export const getFreeIpaConfig = async (): Promise<FreeIpaConfig> => {
  const [
    rawUrl,
    rawServiceUser,
    rawServicePassword,
    rawEnabled,
    rawAdmin,
    rawBaseSync,
    rawBaseIpaRealm,
    rawExcluded,
  ] = await Promise.all([
    coreSettings.get<string>("freeipa.url"),
    coreSettings.get<string>("freeipa.service_user"),
    coreSettings.get<string>("freeipa.service_password"),
    coreSettings.get<boolean>("freeipa.enable"),
    coreSettings.get<string[]>("freeipa.groups.admin"),
    coreSettings.get<string[]>("freeipa.groups.base_sync"),
    coreSettings.get<string[]>("freeipa.groups.base_ipa_realm"),
    coreSettings.get<string[]>("freeipa.groups.excluded"),
  ]);

  const url = normalizeString(rawUrl);
  const serviceUser = normalizeString(rawServiceUser);
  const servicePassword = normalizeString(rawServicePassword);
  const enabled = Boolean(rawEnabled);
  const configured = url.length > 0 && serviceUser.length > 0 && servicePassword.length > 0;

  return {
    enabled,
    configured,
    url,
    serviceUser,
    servicePassword,
    groupsAdmin: normalizeStringList(rawAdmin, ["admins"]),
    groupsBaseSync: normalizeStringList(rawBaseSync, ["users"]),
    groupsBaseIpaRealm: normalizeStringList(rawBaseIpaRealm, ["cloud"]),
    groupsExcluded: normalizeStringList(rawExcluded, ["editors", "trust admins", "admins"]),
    // For consistency the async getter also exposes these — the values used by
    // the transport layer come via the sync resolver below (kept for parity
    // with the env vars and the rest of the config surface).
    caCert: normalizeString(await coreSettings.get<string>("freeipa.ca_cert")),
    allowInsecure: Boolean(await coreSettings.get<boolean>("freeipa.allow_insecure")),
  };
};

// ── TLS resolver wiring ──────────────────────────────────────────────────────
// Register a side-effect resolver at module load so the freeipa transport
// (`server/services/freeipa/client.ts` + `session.ts`) can read TLS opts
// without taking a hard dependency on settings (would create a layering cycle).
//
// Resolution order: ca_cert (proper, signed by your private CA) wins over
// allow_insecure (lab/dev kill switch). When neither is set we return
// undefined so Bun uses its default system trust store.
setFreeIpaTlsResolver(() => {
  const config = getFreeIpaConfigSync();
  if (config.caCert) return { ca: config.caCert };
  if (config.allowInsecure) return { rejectUnauthorized: false };
  return undefined;
});
