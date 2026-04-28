import type { UserProfile, UserProvider } from "../contracts/shared";

type AccountLike = {
  provider: UserProvider;
  profile: UserProfile;
};

type SupplementalRole = "admin" | "group-manager";

export const getAccountTypeLabel = (user: Pick<AccountLike, "profile">): string =>
  user.profile === "user" ? "Full account" : "Guest account";

export const getManagementLabel = (user: Pick<AccountLike, "provider">): string =>
  user.provider === "ipa" ? "FreeIPA" : "Local";

export const getSupplementalRoleLabel = (role: SupplementalRole): string =>
  role === "group-manager" ? "Group Manager" : "Admin";
