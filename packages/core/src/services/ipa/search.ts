import { sql } from "bun";
import type { BaseUser, BaseGroup, Role } from "@valentinkolb/cloud-contracts/shared";

/** Build minimal roles array from realm string */
const realmToRoles = (realm: string): Role[] => {
  if (realm === "ipa") return ["ipa"];
  if (realm === "ipa-limited") return ["ipa-limited"];
  return ["guest"];
};

// ==========================
// Search Options
// ==========================

export type SearchOptions = {
  /** Search users */
  users?: boolean;
  /** Search groups */
  groups?: boolean;
  /** User UUIDs to exclude from results */
  excludeUserIds?: string[];
  /** Group CNs to exclude from results */
  excludeGroups?: string[];
  /** Only return groups the user is a member of */
  onlyUserGroups?: string[];
  /** Only return POSIX groups (have gid_number) */
  onlyPosixGroups?: boolean;
  /** Only return users that are members of these groups */
  usersInGroups?: string[];
};

// ==========================
// Search (autocomplete for member/manager add dialogs)
// Returns BaseUser/BaseGroup (no relations needed for autocomplete)
// ==========================

/**
 * Executes a filtered lookup query and returns normalized matches.
 */
export const search = async (query: string, options: SearchOptions): Promise<{ users: BaseUser[]; groups: BaseGroup[] }> => {
  const q = `%${query.toLowerCase()}%`;
  let users: BaseUser[] = [];
  let groups: BaseGroup[] = [];

  // ========== Search Users ==========
  if (options.users) {
    const excludeIds = options.excludeUserIds ?? [];
    const inGroups = options.usersInGroups ?? [];

    // Build optional WHERE fragments
    const excludeFilter = excludeIds.length > 0 ? sql`AND u.id NOT IN ${sql(excludeIds)}` : sql``;
    const groupFilter =
      inGroups.length > 0
        ? sql`AND EXISTS (SELECT 1 FROM auth.user_groups ug WHERE ug.user_id = u.id AND ug.group_cn IN ${sql(inGroups)})`
        : sql``;

    const rows = await sql`
      SELECT u.id, u.uid, u.realm, u.given_name, u.sn, u.display_name, u.mail
      FROM auth.users u
      WHERE u.realm IN ('ipa', 'ipa-limited')
        AND (
          LOWER(u.uid) LIKE ${q} OR LOWER(u.display_name) LIKE ${q} OR
          LOWER(u.given_name) LIKE ${q} OR LOWER(u.sn) LIKE ${q} OR LOWER(u.mail) LIKE ${q}
        )
        ${excludeFilter}
        ${groupFilter}
      ORDER BY u.uid
      LIMIT 10
    `;

    users = (rows as any[]).map((row) => ({
      id: row.id,
      uid: row.uid,
      roles: realmToRoles(row.realm),
      givenname: row.given_name ?? "",
      sn: row.sn ?? "",
      displayName: row.display_name ?? "",
      mail: row.mail ?? null,
    }));
  }

  // ========== Search Groups ==========
  if (options.groups) {
    const excludeCns = options.excludeGroups ?? [];
    const onlyUserGroups = options.onlyUserGroups ?? [];
    const onlyPosix = options.onlyPosixGroups ?? false;

    // Build optional WHERE fragments
    const excludeFilter = excludeCns.length > 0 ? sql`AND cn NOT IN ${sql(excludeCns)}` : sql``;
    const userGroupsFilter = onlyUserGroups.length > 0 ? sql`AND cn IN ${sql(onlyUserGroups)}` : sql``;
    const posixFilter = onlyPosix ? sql`AND gid_number IS NOT NULL` : sql``;

    const rows = await sql`
      SELECT cn, description, gid_number
      FROM auth.groups
      WHERE (LOWER(cn) LIKE ${q} OR LOWER(description) LIKE ${q})
        ${excludeFilter}
        ${userGroupsFilter}
        ${posixFilter}
      ORDER BY cn
      LIMIT 10
    `;

    groups = (rows as any[]).map((row) => ({
      cn: row.cn,
      description: row.description ?? null,
      gidnumber: row.gid_number ?? null,
    }));
  }

  return { users, groups };
};
