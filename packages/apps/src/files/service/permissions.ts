import { sql } from "bun";
import type { SessionUser, FileBase, FileBaseInfo, MutationResult } from "@/files/contracts";

type DbRow = Record<string, unknown>;

/**
 * Get all group CNs a user belongs to (direct + indirect via group hierarchy).
 */
const getAllGroups = async (userId: string): Promise<string[]> => {
  const rows: DbRow[] = await sql`
    WITH RECURSIVE all_groups AS (
      SELECT group_cn FROM auth.user_groups WHERE user_id = ${userId}
      UNION
      SELECT gg.parent_cn FROM auth.group_groups gg
      JOIN all_groups ag ON gg.child_cn = ag.group_cn
    )
    SELECT group_cn FROM all_groups`;
  return rows.map((r) => r.group_cn as string);
};

/**
 * Check if a user can access a file base (home directory or group directory).
 * Checks recursive group membership.
 */
export const canAccess = async (user: SessionUser, base: FileBase): Promise<MutationResult<void>> => {
  if (base.type === "home") {
    if (base.uid !== user.uid) {
      return {
        ok: false,
        error: "Access denied: not your home directory",
        status: 403,
      };
    }
    return { ok: true, data: undefined };
  }

  const allGroups = await getAllGroups(user.id);
  if (!allGroups.includes(base.name)) {
    return {
      ok: false,
      error: "Access denied: not a member of this group",
      status: 403,
    };
  }
  return { ok: true, data: undefined };
};

/**
 * List all file bases accessible to a user (with numeric IDs for ownership).
 * Includes bases from indirect group memberships (group hierarchy).
 */
export const listBases = async (user: SessionUser): Promise<FileBase[]> => {
  const bases: FileBase[] = [];

  // Get user's uidNumber for home directory
  const userRows: DbRow[] = await sql`
    SELECT uid_number FROM auth.users WHERE uid = ${user.uid}
  `;
  const uidNumber = userRows[0]?.uid_number as number | null;

  bases.push({
    type: "home",
    uid: user.uid,
    uidNumber: uidNumber ?? undefined,
    gidNumber: uidNumber ?? undefined, // Home dirs: user's uid as gid
  });

  // Get all groups (direct + indirect) and their gidNumbers
  const allGroups = await getAllGroups(user.id);
  if (allGroups.length > 0) {
    const groupRows: DbRow[] = await sql`
      SELECT cn, gid_number FROM auth.groups
      WHERE cn IN ${sql(allGroups)}
      AND gid_number IS NOT NULL
    `;

    for (const row of groupRows) {
      bases.push({
        type: "group",
        name: row.cn as string,
        gidNumber: row.gid_number as number,
      });
    }
  }

  return bases;
};

/**
 * Convert FileBase to FileBaseInfo for API response
 */
export const toBaseInfo = (base: FileBase): FileBaseInfo => {
  if (base.type === "home") {
    return {
      type: "home",
      id: base.uid,
      name: "Home",
    };
  }
  return {
    type: "group",
    id: base.name,
    name: base.name,
  };
};
