import * as settings from "./settings";

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
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeStringList = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

const buildConfig = (getter: <T>(key: string) => T): FreeIpaConfig => {
  const url = normalizeString(getter<string>("freeipa.url"));
  const serviceUser = normalizeString(getter<string>("freeipa.service_user"));
  const servicePassword = normalizeString(getter<string>("freeipa.service_password"));
  const enabled = Boolean(getter<boolean>("freeipa.enable"));
  const configured = url.length > 0 && serviceUser.length > 0 && servicePassword.length > 0;

  return {
    enabled,
    configured,
    url,
    serviceUser,
    servicePassword,
    groupsAdmin: normalizeStringList(getter<string[]>("freeipa.groups.admin"), ["admins"]),
    groupsBaseSync: normalizeStringList(getter<string[]>("freeipa.groups.base_sync"), ["users"]),
    groupsBaseIpaRealm: normalizeStringList(getter<string[]>("freeipa.groups.base_ipa_realm"), ["cloud"]),
    groupsExcluded: normalizeStringList(getter<string[]>("freeipa.groups.excluded"), ["editors", "trust admins", "admins"]),
  };
};

export const getFreeIpaConfigSync = (): FreeIpaConfig => buildConfig(settings.getSync);

export const getFreeIpaConfig = async (): Promise<FreeIpaConfig> => buildConfig((key) => settings.getSync(key));
