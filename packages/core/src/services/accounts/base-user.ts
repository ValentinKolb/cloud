import type { BaseUser, UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";
import { buildRoles } from "./authz";
import { resolveEffectiveAdminState } from "./model";

type DbRow = Record<string, unknown>;

export const resolveProviderProfile = (row: DbRow): { provider: UserProvider; profile: UserProfile } => ({
  provider: (row.provider as UserProvider | null | undefined) ?? "local",
  profile: (row.profile as UserProfile | null | undefined) ?? "guest",
});

export const resolveBaseUserDisplayName = (row: DbRow): string => {
  const displayName = (row.display_name as string | null | undefined) ?? "";
  const mail = (row.mail as string | null | undefined) ?? "";
  const uid = (row.uid as string | null | undefined) ?? "";
  return displayName || mail || uid;
};

export const buildBaseUser = (row: DbRow): BaseUser => {
  const { provider, profile } = resolveProviderProfile(row);
  return {
    id: row.id as string,
    uid: row.uid as string,
    roles: buildRoles({
      provider,
      profile,
      memberofGroup: [],
      manages: [],
      admin: resolveEffectiveAdminState({
        provider,
        storedAdmin: Boolean(row.effective_admin ?? row.admin),
      }),
    }),
    provider,
    profile,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    displayName: resolveBaseUserDisplayName(row),
    mail: (row.mail as string) ?? null,
  };
};
