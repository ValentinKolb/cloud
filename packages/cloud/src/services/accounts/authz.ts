import type { Role, UserProfile, UserProvider } from "../../contracts/shared";

export type AccountsActor = { userId: string; uid: string; roles: string[]; provider?: string | null };

const SELF_UPDATE_FIELDS = new Set(["givenname", "sn", "displayName", "ipa"]);

export const buildRoles = (params: {
  provider: UserProvider;
  profile: UserProfile;
  memberofGroup: string[];
  manages: string[];
  admin?: boolean;
}): Role[] => {
  const { provider, profile, manages } = params;
  const roles = new Set<Role>();

  roles.add(profile);
  roles.add(provider);
  roles.add(`${provider}/${profile}` as Extract<Role, "ipa/user" | "ipa/guest" | "local/user" | "local/guest">);

  if (profile === "guest") return [...roles];

  if (params.admin) roles.add("admin");
  if (manages.length > 0) roles.add("group-manager");
  return [...roles];
};

export const isAdminActor = (actor: AccountsActor | null | undefined): boolean => !!actor?.roles.includes("admin");

export const isSelfTarget = (params: { actor: AccountsActor | null | undefined; targetUserId: string }): boolean =>
  params.actor?.userId === params.targetUserId;

export const canMutateManagedGroup = (params: {
  actor: AccountsActor | null | undefined;
  groupId: string;
  managedGroupIds: string[];
}): boolean => {
  if (isAdminActor(params.actor)) return true;
  if (!params.actor?.roles.includes("user") || !params.actor.roles.includes("group-manager")) return false;
  return params.managedGroupIds.includes(params.groupId);
};

export const hasOnlySelfUpdateFields = (data: Record<string, unknown>): boolean =>
  Object.keys(data).every((field) => SELF_UPDATE_FIELDS.has(field));
