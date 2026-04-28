import { sql } from "bun";
import { toPgTextArray } from "@valentinkolb/cloud/services";
import type { User, FileBase, FileBaseInfo, MutationResult } from "@/contracts";

type DbRow = Record<string, unknown>;

/**
 * Get all group names a user belongs to (direct + indirect via group hierarchy).
 */
const getAllGroups = async (userId: string): Promise<string[]> => {
  const rows: DbRow[] = await sql`
    WITH RECURSIVE all_groups AS (
      SELECT g.id, g.name
      FROM auth.user_groups_v2 ug
      JOIN auth.groups g ON g.id = ug.group_id
      WHERE ug.user_id = ${userId}
      UNION
      SELECT gp.id, gp.name
      FROM auth.group_groups_v2 gg
      JOIN auth.groups gp ON gp.id = gg.parent_group_id
      JOIN all_groups ag ON gg.child_group_id = ag.id
    )
    SELECT name FROM all_groups`;
  return rows.map((r) => r.name as string);
};

/**
 * Check if a user can access a file base (home directory or group directory).
 * Checks recursive group membership.
 */
export const canAccess = async (user: User, base: FileBase): Promise<MutationResult<void>> => {
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
export const listBases = async (user: User): Promise<FileBase[]> => {
  const bases: FileBase[] = [];
  const uidNumber = user.ipa?.uidNumber ?? null;

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
      SELECT name, gid_number FROM auth.groups
      WHERE name = ANY(${toPgTextArray(allGroups)}::text[])
      AND gid_number IS NOT NULL
    `;

    for (const row of groupRows) {
      bases.push({
        type: "group",
        name: row.name as string,
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
