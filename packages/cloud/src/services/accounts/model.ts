import type { UserProfile, UserProvider } from "../../contracts/shared";
import * as settings from "../settings";

export type IpaMatchMode = "ignore" | "migrate";
export type IpaAccountTransitionPolicy = "delete" | "demote_to_local" | "demote_to_local_guest" | "demote_to_local_user";

export const isGuestProfile = (profile: UserProfile): boolean => profile === "guest";
export const isIpaProvider = (provider: UserProvider): boolean => provider === "ipa";
export const isLocalProvider = (provider: UserProvider): boolean => provider === "local";
export const canPersistStoredAdmin = (provider: UserProvider, profile: UserProfile): boolean => provider === "local" && profile === "user";

export const parseIpaMatchMode = (value: string | null | undefined): IpaMatchMode => (value === "migrate" ? "migrate" : "ignore");

export const parseIpaAccountTransitionPolicy = (value: string | null | undefined): IpaAccountTransitionPolicy => {
  if (value === "delete" || value === "demote_to_local" || value === "demote_to_local_user") return value;
  return "demote_to_local_guest";
};

/**
 * Pure helpers — caller passes the relevant FreeIPA group lists in. Avoids
 * an implicit settings dependency inside what is otherwise a pure data
 * transformation; the caller already needs `getFreeIpaConfig()` for other
 * fields, so reading both lists at once is a single roundtrip.
 */
export const calculateIpaProfileFromGroupNames = (groupNames: string[], groupsBaseIpaRealm: string[]): UserProfile =>
  groupsBaseIpaRealm.some((group) => groupNames.includes(group)) ? "user" : "guest";

export const deriveIpaAdminFromGroupNames = (groupNames: string[], groupsAdmin: string[]): boolean =>
  groupsAdmin.some((group) => groupNames.includes(group));

export const resolveStoredAdminState = (params: {
  provider: UserProvider;
  profile: UserProfile;
  currentAdmin?: boolean;
  requestedAdmin?: boolean;
}): boolean => {
  if (!canPersistStoredAdmin(params.provider, params.profile)) return false;
  return params.requestedAdmin ?? params.currentAdmin ?? false;
};

/**
 * `groupsAdmin` is required when `provider === "ipa"`; defaults to `[]` (no
 * admin grant via group membership) when omitted, matching the previous sync
 * behaviour where an unconfigured/disabled FreeIPA returned an empty list.
 */
export const resolveEffectiveAdminState = (params: {
  provider: UserProvider;
  storedAdmin?: boolean;
  memberofGroup?: string[];
  groupsAdmin?: string[];
}): boolean => {
  if (params.provider === "ipa") {
    return deriveIpaAdminFromGroupNames(params.memberofGroup ?? [], params.groupsAdmin ?? []);
  }
  return params.storedAdmin ?? false;
};

export const resolveAccountExpires = (row: Record<string, unknown>): Date | null => {
  return (row.account_expires as Date | null | undefined) ?? null;
};

/**
 * Discriminated parse of a user-supplied expiry value. An explicit `null` or
 * absent/empty string means "no expiry"; a malformed non-empty string is an
 * error — callers must surface that as a 400 rather than silently wiping the
 * expiry.
 */
export type ParsedExpiry = { ok: true; date: Date | null } | { ok: false; error: string };

export const parseManualAccountExpiry = (value: string | null | undefined): ParsedExpiry => {
  if (value === null || value === undefined || value === "") {
    return { ok: true, date: null };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "Invalid expiry date" };
  }
  date.setUTCHours(23, 59, 59, 0);
  return { ok: true, date };
};

/**
 * Legacy name kept for internal defaulting path where the input is already
 * known-valid (Zod has validated it). Prefer `parseManualAccountExpiry` for
 * new code — it distinguishes "no expiry" from "invalid input".
 */
export const normalizeManualAccountExpiry = (value: string | null | undefined): Date | null => {
  const parsed = parseManualAccountExpiry(value);
  return parsed.ok ? parsed.date : null;
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
