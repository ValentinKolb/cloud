import type { Role, UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";

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
