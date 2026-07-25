import { setFreeIpaTlsResolver } from "../server/services/freeipa/tls";
import { coreSettings } from "./settings/api";

export type FreeIpaConfig = {
  enabled: boolean;
  configured: boolean;
  /** Setting keys that are still empty. Empty when `configured` is true. */
  missingSettings: string[];
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

/**
 * `fallback` is only for groups that have a genuine FreeIPA-wide default.
 *
 * The scope groups deliberately have none: `base_sync` decides who gets a Cloud
 * account at all and `base_ipa_realm` decides who is a full user rather than a
 * guest, and both depend entirely on how the directory is organised. A guess
 * either over-provisions every FreeIPA user or silently demotes everyone to
 * guest, so an empty value has to make the config incomplete instead.
 */
const normalizeStringList = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

/**
 * Read the full FreeIPA config snapshot from settings (Redis cache-aside +
 * Postgres fallback). Always returns within Redis-TTL fresh data — no hidden
 * dependency on request-lifecycle middleware.
 */
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
    rawCaCert,
    rawAllowInsecure,
  ] = await Promise.all([
    coreSettings.get<string>("freeipa.url"),
    coreSettings.get<string>("freeipa.service_user"),
    coreSettings.get<string>("freeipa.service_password"),
    coreSettings.get<boolean>("freeipa.enable"),
    coreSettings.get<string[]>("freeipa.groups.admin"),
    coreSettings.get<string[]>("freeipa.groups.base_sync"),
    coreSettings.get<string[]>("freeipa.groups.base_ipa_realm"),
    coreSettings.get<string[]>("freeipa.groups.excluded"),
    coreSettings.get<string>("freeipa.ca_cert"),
    coreSettings.get<boolean>("freeipa.allow_insecure"),
  ]);

  const url = normalizeString(rawUrl);
  const serviceUser = normalizeString(rawServiceUser);
  const servicePassword = normalizeString(rawServicePassword);
  const enabled = Boolean(rawEnabled);

  // "admins" and the excluded list are real FreeIPA defaults; the scope groups
  // are not, so they stay empty and make the config incomplete.
  const groupsAdmin = normalizeStringList(rawAdmin, ["admins"]);
  const groupsBaseSync = normalizeStringList(rawBaseSync);
  const groupsBaseIpaRealm = normalizeStringList(rawBaseIpaRealm);
  const groupsExcluded = normalizeStringList(rawExcluded, ["editors", "trust admins", "admins"]);

  const missingSettings = [
    ...(url ? [] : ["freeipa.url"]),
    ...(serviceUser ? [] : ["freeipa.service_user"]),
    ...(servicePassword ? [] : ["freeipa.service_password"]),
    ...(groupsBaseSync.length > 0 ? [] : ["freeipa.groups.base_sync"]),
    ...(groupsBaseIpaRealm.length > 0 ? [] : ["freeipa.groups.base_ipa_realm"]),
  ];

  return {
    enabled,
    configured: missingSettings.length === 0,
    missingSettings,
    url,
    serviceUser,
    servicePassword,
    groupsAdmin,
    groupsBaseSync,
    groupsBaseIpaRealm,
    groupsExcluded,
    caCert: normalizeString(rawCaCert),
    allowInsecure: Boolean(rawAllowInsecure),
  };
};

// ── TLS resolver wiring ──────────────────────────────────────────────────────
// Register an async resolver at module load so the freeipa transport
// (`server/services/freeipa/client.ts` + `session.ts`) can read TLS opts
// without taking a hard dependency on settings (would create a layering cycle).
//
// Resolution order: ca_cert (proper, signed by your private CA) wins over
// allow_insecure (lab/dev kill switch). When neither is set we return
// undefined so Bun uses its default system trust store.
setFreeIpaTlsResolver(async () => {
  const config = await getFreeIpaConfig();
  if (config.caCert) return { ca: config.caCert };
  if (config.allowInsecure) return { rejectUnauthorized: false };
  return undefined;
});
