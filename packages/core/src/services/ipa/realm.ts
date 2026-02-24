/**
 * Centralized Realm Calculation
 *
 * Single source of truth for determining user realms based on group memberships.
 * Always uses the LOCAL DATABASE as source - FreeIPA is synced periodically.
 */

import { sql } from "bun";
import { env } from "@valentinkolb/cloud-core/config/env";

type DbRow = Record<string, unknown>;

/**
 * Get all groups a user belongs to (direct + indirect via group hierarchy).
 * Uses recursive CTE to resolve nested group memberships.
 */
export const getAllUserGroups = async (userId: string): Promise<string[]> => {
  const rows: DbRow[] = await sql`
    WITH RECURSIVE all_groups AS (
      -- Direct memberships
      SELECT group_cn as cn FROM auth.user_groups WHERE user_id = ${userId}
      UNION
      -- Indirect via group hierarchy (child groups inherit parent membership)
      SELECT gg.parent_cn as cn
      FROM auth.group_groups gg
      JOIN all_groups ag ON gg.child_cn = ag.cn
    )
    SELECT DISTINCT cn FROM all_groups
  `;
  return rows.map((r) => r.cn as string);
};

/**
 * Calculate realm based on group memberships.
 * - "ipa" if user is in any GROUPS_BASE_IPA_REALM group
 * - "ipa-limited" otherwise
 */
export const calculateRealm = (memberOfGroups: string[]): "ipa" | "ipa-limited" => {
  return env.GROUPS_BASE_IPA_REALM.some((g) => memberOfGroups.includes(g)) ? "ipa" : "ipa-limited";
};

/**
 * Calculate realm for a user from local DB.
 * Combines getAllUserGroups + calculateRealm.
 */
export const calculateRealmFromLocalDb = async (userId: string): Promise<"ipa" | "ipa-limited"> => {
  const groups = await getAllUserGroups(userId);
  return calculateRealm(groups);
};

/**
 * Update a user's realm based on their current group memberships in local DB.
 * Only updates if user is ipa or ipa-limited (not guest).
 */
export const updateUserRealm = async (userId: string): Promise<void> => {
  const realm = await calculateRealmFromLocalDb(userId);
  await sql`
    UPDATE auth.users
    SET realm = ${realm}
    WHERE id = ${userId} AND realm IN ('ipa', 'ipa-limited')
  `;
};

/**
 * Update realm for all users affected by a group hierarchy change.
 * Called when a group is added/removed as member of another group.
 */
export const updateRealmForAffectedUsers = async (groupCn: string): Promise<void> => {
  // Get all users in this group and its child groups (recursively)
  const affectedUsers: DbRow[] = await sql`
    WITH RECURSIVE affected_groups AS (
      -- Start with the changed group
      SELECT ${groupCn}::text as cn
      UNION
      -- Add all child groups
      SELECT gg.child_cn as cn
      FROM auth.group_groups gg
      JOIN affected_groups ag ON gg.parent_cn = ag.cn
    )
    SELECT DISTINCT ug.user_id
    FROM auth.user_groups ug
    JOIN affected_groups ag ON ug.group_cn = ag.cn
  `;

  // Update realm for each affected user
  for (const row of affectedUsers) {
    await updateUserRealm(row.user_id as string);
  }
};
