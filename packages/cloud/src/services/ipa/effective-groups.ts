export type IpaGroupMembership = {
  cn: string;
  users: string[];
  groups: string[];
};

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => a.localeCompare(b));

/**
 * Build effective IPA group membership from authoritative group records.
 * A group contains direct users and child groups; user effective membership is
 * direct groups plus every parent group reached through group nesting.
 */
export const buildEffectiveIpaGroupsByUid = (groups: IpaGroupMembership[]): Map<string, string[]> => {
  const groupNames = new Set(groups.map((group) => group.cn).filter(Boolean));
  const childToParents = new Map<string, Set<string>>();
  const directGroupsByUid = new Map<string, Set<string>>();

  for (const group of groups) {
    if (!group.cn) continue;

    for (const uid of group.users) {
      if (!uid) continue;
      const directGroups = directGroupsByUid.get(uid) ?? new Set<string>();
      directGroups.add(group.cn);
      directGroupsByUid.set(uid, directGroups);
    }

    for (const child of group.groups) {
      if (!child || !groupNames.has(child)) continue;
      const parents = childToParents.get(child) ?? new Set<string>();
      parents.add(group.cn);
      childToParents.set(child, parents);
    }
  }

  const memo = new Map<string, Set<string>>();
  const resolveGroupClosure = (groupName: string, visiting = new Set<string>()): Set<string> => {
    const cached = memo.get(groupName);
    if (cached) return cached;

    const closure = new Set<string>([groupName]);
    if (visiting.has(groupName)) return closure;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(groupName);

    for (const parent of childToParents.get(groupName) ?? []) {
      for (const inherited of resolveGroupClosure(parent, nextVisiting)) {
        closure.add(inherited);
      }
    }

    memo.set(groupName, closure);
    return closure;
  };

  const effectiveByUid = new Map<string, string[]>();
  for (const [uid, directGroups] of directGroupsByUid) {
    const effective = new Set<string>();
    for (const groupName of directGroups) {
      for (const inherited of resolveGroupClosure(groupName)) {
        effective.add(inherited);
      }
    }
    effectiveByUid.set(uid, sorted(effective));
  }

  return effectiveByUid;
};
