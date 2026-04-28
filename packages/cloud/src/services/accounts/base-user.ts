import type { BaseUser, UserProfile, UserProvider } from "../../contracts/shared";
import { buildRoles } from "./authz";

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

/**
 * Build a BaseUser from a DB row. `admin` is taken from `row.effective_admin`
 * when present (list queries pre-compute it by joining IPA-admin group
 * membership), otherwise from `row.admin` for local users. The previous
 * implementation routed through `resolveEffectiveAdminState` with an empty
 * `memberofGroup` list, which silently dropped the admin role for IPA users.
 */
export const buildBaseUser = (row: DbRow): BaseUser => {
  const { provider, profile } = resolveProviderProfile(row);
  const effectiveAdmin = row.effective_admin !== undefined ? Boolean(row.effective_admin) : Boolean(row.admin);
  return {
    id: row.id as string,
    uid: row.uid as string,
    roles: buildRoles({
      provider,
      profile,
      memberofGroup: [],
      manages: [],
      admin: effectiveAdmin,
    }),
    provider,
    profile,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    displayName: resolveBaseUserDisplayName(row),
    mail: (row.mail as string) ?? null,
  };
};
