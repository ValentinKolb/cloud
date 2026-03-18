import type { UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";
import * as settings from "../settings";
import { getFreeIpaConfigSync } from "../freeipa-config";

export type IpaMatchMode = "ignore" | "migrate";
export type IpaAccountTransitionPolicy =
  | "delete"
  | "demote_to_local"
  | "demote_to_local_guest"
  | "demote_to_local_user";

export const isGuestProfile = (profile: UserProfile): boolean => profile === "guest";
export const isIpaProvider = (provider: UserProvider): boolean => provider === "ipa";
export const isLocalProvider = (provider: UserProvider): boolean => provider === "local";
export const canPersistStoredAdmin = (provider: UserProvider, profile: UserProfile): boolean =>
  provider === "local" && profile === "user";

export const parseIpaMatchMode = (value: string | null | undefined): IpaMatchMode => (value === "migrate" ? "migrate" : "ignore");

export const parseIpaAccountTransitionPolicy = (value: string | null | undefined): IpaAccountTransitionPolicy => {
  if (value === "delete" || value === "demote_to_local" || value === "demote_to_local_user") return value;
  return "demote_to_local_guest";
};

export const calculateIpaProfileFromGroupNames = (groupNames: string[]): UserProfile =>
  getFreeIpaConfigSync().groupsBaseIpaRealm.some((group: string) => groupNames.includes(group)) ? "user" : "guest";

export const deriveIpaAdminFromGroupNames = (groupNames: string[]): boolean =>
  getFreeIpaConfigSync().groupsAdmin.some((group: string) => groupNames.includes(group));

export const resolveStoredAdminState = (params: {
  provider: UserProvider;
  profile: UserProfile;
  currentAdmin?: boolean;
  requestedAdmin?: boolean;
}): boolean => {
  if (!canPersistStoredAdmin(params.provider, params.profile)) return false;
  return params.requestedAdmin ?? params.currentAdmin ?? false;
};

export const resolveEffectiveAdminState = (params: {
  provider: UserProvider;
  storedAdmin?: boolean;
  memberofGroup?: string[];
}): boolean => {
  if (params.provider === "ipa") {
    return deriveIpaAdminFromGroupNames(params.memberofGroup ?? []);
  }
  return params.storedAdmin ?? false;
};

export const resolveAccountExpires = (row: Record<string, unknown>): Date | null => {
  const accountExpires = row.account_expires as Date | null | undefined;
  if (accountExpires) return accountExpires;

  const ipaAccountExpires = row.ipa_account_expires as Date | null | undefined;
  if (ipaAccountExpires) return ipaAccountExpires;

  return (row.guest_expires_at as Date | null | undefined) ?? null;
};

export const normalizeManualAccountExpiry = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(23, 59, 59, 0);
  return date;
};

export const getConfiguredExpiryDays = async (provider: UserProvider, profile: UserProfile): Promise<number> => {
  if (provider === "ipa") {
    const configured = await settings.get<number | null>("user.account.ipa_expires_days");
    return typeof configured === "number" ? configured : 365;
  }

  if (profile === "guest") {
    const configured = await settings.get<number | null>("user.account.local_guest_expires_days");
    return typeof configured === "number" ? configured : 365;
  }

  const configured = await settings.get<number | null>("user.account.local_user_expires_days");
  return typeof configured === "number" ? configured : 0;
};

export const getDefaultAccountExpiry = async (provider: UserProvider, profile: UserProfile): Promise<Date | null> => {
  const days = await getConfiguredExpiryDays(provider, profile);
  if (days <= 0) return null;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  if (provider === "ipa") expiresAt.setUTCHours(23, 59, 59, 0);
  return expiresAt;
};

export const resolveTargetAccountExpiry = async (params: {
  provider: UserProvider;
  profile: UserProfile;
  requested?: string | null;
}): Promise<Date | null> => {
  const manual = normalizeManualAccountExpiry(params.requested);
  if (params.requested !== undefined) return manual;
  return getDefaultAccountExpiry(params.provider, params.profile);
};
