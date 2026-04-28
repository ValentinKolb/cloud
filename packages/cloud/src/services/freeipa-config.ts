import { coreSettings } from "./settings/api";
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
