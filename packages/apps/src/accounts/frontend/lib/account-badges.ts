import type { BaseUser } from "@/accounts/contracts";
import {
  getAccountTypeLabel as getSharedAccountTypeLabel,
  getManagementLabel as getSharedManagementLabel,
  getSupplementalRoleLabel as getSharedSupplementalRoleLabel,
} from "@valentinkolb/cloud/lib/shared";

type AccountLike = Pick<BaseUser, "provider" | "profile">;
type SupplementalRole = Extract<BaseUser["roles"][number], "admin" | "group-manager">;
type ProviderLike = AccountLike["provider"];

const PRIMARY_ACCOUNT_BADGES: Record<"user" | "guest", { label: string; className: string }> = {
  user: {
    label: "Full Account",
    className: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
  },
  guest: {
    label: "Guest Account",
    className: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  },
};

const MANAGEMENT_BADGES: Record<"ipa" | "local", { label: string; className: string }> = {
  ipa: {
    label: "FreeIPA",
    className: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
  },
  local: {
    label: "Local",
    className: "bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300",
  },
};

const PROVIDER_DECORATION: Record<ProviderLike, { label: string; icon: string; shortLabel: string }> = {
  ipa: {
    label: "FreeIPA",
    shortLabel: "FreeIPA",
    icon: "ti ti-building-fortress",
  },
  local: {
    label: "Local",
    shortLabel: "Local",
    icon: "ti ti-home-spark",
  },
};

const SUPPLEMENTAL_ROLE_COLORS: Record<SupplementalRole, string> = {
  admin: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  "group-manager": "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300",
};

export const getPrimaryAccountBadge = (user: AccountLike) => PRIMARY_ACCOUNT_BADGES[user.profile];

export const getManagementBadge = (user: AccountLike) => MANAGEMENT_BADGES[user.provider];
export const getProviderBadge = (provider: ProviderLike) => MANAGEMENT_BADGES[provider];
export const getProviderIcon = (provider: ProviderLike) => PROVIDER_DECORATION[provider].icon;
export const getProviderShortLabel = (provider: ProviderLike) => PROVIDER_DECORATION[provider].shortLabel;

export const getSupplementalRoles = (user: Pick<BaseUser, "roles">): SupplementalRole[] =>
  user.roles.filter((role): role is SupplementalRole => role === "admin" || role === "group-manager");

export const getSupplementalRoleColor = (role: SupplementalRole): string => SUPPLEMENTAL_ROLE_COLORS[role];
export const getSupplementalRoleLabel = (role: SupplementalRole): string => getSharedSupplementalRoleLabel(role);

export const getAccountTypeLabel = (user: AccountLike): string => getSharedAccountTypeLabel(user);

export const getManagementLabel = (user: AccountLike): string => getSharedManagementLabel(user);
