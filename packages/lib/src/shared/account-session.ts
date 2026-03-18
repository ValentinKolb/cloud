import type { User } from "@valentinkolb/cloud-contracts/shared";

export const isAdminUser = (user: Pick<User, "roles">): boolean => user.roles.includes("admin");

export const isGroupManagerUser = (user: Pick<User, "roles">): boolean => user.roles.includes("group-manager");

export const canManageAnyGroups = (user: Pick<User, "roles">): boolean => isAdminUser(user) || isGroupManagerUser(user);

export const canManageGroup = (user: Pick<User, "roles" | "managesGroupIds">, groupId: string): boolean =>
  isAdminUser(user) || user.managesGroupIds.includes(groupId);

export const getDefaultGroupScope = (user: Pick<User, "roles">): "all" | "managed" | "member" => {
  if (isAdminUser(user)) return "all";
  return canManageAnyGroups(user) ? "managed" : "member";
};
