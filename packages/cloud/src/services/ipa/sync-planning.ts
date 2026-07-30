export type IpaIdentity = {
  uid: string;
  mail: string | null;
};

export const readCompleteIpaList = (params: {
  response: {
    result: { result: unknown; truncated?: unknown } | null;
    error: { message: string } | null;
  };
  entity: string;
}): Record<string, unknown>[] => {
  if (params.response.error) {
    throw new Error(`IPA ${params.entity} fetch failed: ${params.response.error.message}`);
  }
  const records = params.response.result?.result;
  if (!Array.isArray(records)) {
    throw new Error(`IPA ${params.entity} fetch returned invalid list payload`);
  }
  if (params.response.result?.truncated === true) {
    throw new Error(`IPA ${params.entity} fetch returned a truncated snapshot`);
  }
  if (params.response.result?.truncated !== false) {
    throw new Error(`IPA ${params.entity} fetch returned invalid completeness metadata`);
  }
  return records as Record<string, unknown>[];
};

export type IpaDestructionGuardLimits = {
  maxUserChanges: number;
  maxUserChangePercent: number;
  maxGroupDeletions: number;
  maxGroupDeletionPercent: number;
};

export type IpaDestructionGuardReport = {
  userChanges: number;
  userChangePercent: number;
  localUsers: number;
  groupDeletions: number;
  groupDeletionPercent: number;
  localGroups: number;
  limits: IpaDestructionGuardLimits;
  violations: Array<"user_count" | "user_percent" | "group_count" | "group_percent">;
};

export const selectStaleLocalIpaRows = <T extends IpaIdentity>(params: { localRows: T[]; activeRemoteUsers: IpaIdentity[] }): T[] => {
  const activeUids = new Set(params.activeRemoteUsers.map((user) => user.uid));
  const activeMails = new Set(params.activeRemoteUsers.map((user) => user.mail).filter((mail): mail is string => Boolean(mail)));

  return params.localRows.filter((row) => {
    if (activeUids.has(row.uid)) return false;
    if (row.mail && activeMails.has(row.mail)) return false;
    return true;
  });
};

const percentage = (affected: number, total: number): number => {
  if (affected === 0) return 0;
  if (total <= 0) return 100;
  return (affected / total) * 100;
};

export const assessIpaDestructionGuard = (params: {
  affectedUserIds: Iterable<string>;
  localUsers: number;
  deletedGroupNames: Iterable<string>;
  localGroups: number;
  limits: IpaDestructionGuardLimits;
}): IpaDestructionGuardReport => {
  const userChanges = new Set(params.affectedUserIds).size;
  const groupDeletions = new Set(params.deletedGroupNames).size;
  const userChangePercent = percentage(userChanges, params.localUsers);
  const groupDeletionPercent = percentage(groupDeletions, params.localGroups);
  const violations: IpaDestructionGuardReport["violations"] = [];

  if (userChanges > params.limits.maxUserChanges) violations.push("user_count");
  if (userChangePercent > params.limits.maxUserChangePercent) violations.push("user_percent");
  if (groupDeletions > params.limits.maxGroupDeletions) violations.push("group_count");
  if (groupDeletionPercent > params.limits.maxGroupDeletionPercent) violations.push("group_percent");

  return {
    userChanges,
    userChangePercent,
    localUsers: params.localUsers,
    groupDeletions,
    groupDeletionPercent,
    localGroups: params.localGroups,
    limits: params.limits,
    violations,
  };
};

export const formatIpaDestructionGuardFailure = (report: IpaDestructionGuardReport): string =>
  `Refusing IPA sync: destructive plan exceeds configured guard limits ` +
  `(users ${report.userChanges}/${report.localUsers} = ${report.userChangePercent.toFixed(2)}%, ` +
  `limits ${report.limits.maxUserChanges} and ${report.limits.maxUserChangePercent}%; ` +
  `groups ${report.groupDeletions}/${report.localGroups} = ${report.groupDeletionPercent.toFixed(2)}%, ` +
  `limits ${report.limits.maxGroupDeletions} and ${report.limits.maxGroupDeletionPercent}%; ` +
  `violations: ${report.violations.join(", ")})`;
