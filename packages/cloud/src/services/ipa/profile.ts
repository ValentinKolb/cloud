/**
 * Centralized profile calculation for IPA-backed users.
 *
 * The calculation uses the local mirrored IPA group tree only and treats
 * `auth.groups.id` as the canonical group identity.
 */

import { sql } from "bun";
import { calculateIpaProfileFromGroupNames } from "../account-model";
import { getFreeIpaConfig } from "../freeipa-config";

type DbRow = Record<string, unknown>;

/**
 * Get all IPA group names a user belongs to (direct + inherited via parent groups).
 */
export const getAllUserGroups = async (userId: string): Promise<string[]> => {
  const rows: DbRow[] = await sql`
    WITH RECURSIVE all_groups AS (
      SELECT ug.group_id
      FROM auth.user_groups_v2 ug
      JOIN auth.groups g ON g.id = ug.group_id
      WHERE ug.user_id = ${userId} AND g.provider = 'ipa'
      UNION
      SELECT gg.parent_group_id
      FROM auth.group_groups_v2 gg
      JOIN auth.groups g ON g.id = gg.parent_group_id
      JOIN all_groups ag ON gg.child_group_id = ag.group_id
      WHERE g.provider = 'ipa'
    )
    SELECT DISTINCT g.name
    FROM all_groups ag
    JOIN auth.groups g ON g.id = ag.group_id
    ORDER BY g.name
  `;

  return rows.map((row) => row.name as string);
};

/**
 * Calculate canonical IPA profile from effective group names. Reads
 * `freeipa.groups.base_ipa_realm` from settings (cache-aside).
 */
export const calculateIpaProfile = async (memberOfGroups: string[]): Promise<"user" | "guest"> => {
  const config = await getFreeIpaConfig();
  return calculateIpaProfileFromGroupNames(memberOfGroups, config.groupsBaseIpaRealm);
};

/**
 * Calculate canonical IPA profile for a user from the local DB mirror.
 */
export const calculateIpaProfileFromLocalDb = async (userId: string): Promise<"user" | "guest"> => {
  const groups = await getAllUserGroups(userId);
  return calculateIpaProfile(groups);
};

/**
 * Update one IPA-backed user's canonical profile projection.
 */
export const updateUserIpaProfile = async (userId: string): Promise<void> => {
  const profile = await calculateIpaProfileFromLocalDb(userId);
  await sql`
    UPDATE auth.users
    SET provider = 'ipa',
        profile = ${profile}
    WHERE id = ${userId} AND provider = 'ipa'
  `;
};

/**
 * Update all IPA-backed users affected by a group hierarchy change.
 */
export const updateProfileForAffectedUsers = async (groupId: string): Promise<void> => {
  const affectedUsers: DbRow[] = await sql`
    WITH RECURSIVE affected_groups AS (
      SELECT ${groupId}::uuid AS group_id
      UNION
      SELECT gg.child_group_id
      FROM auth.group_groups_v2 gg
      JOIN affected_groups ag ON gg.parent_group_id = ag.group_id
    )
    SELECT DISTINCT ug.user_id
    FROM auth.user_groups_v2 ug
    JOIN affected_groups ag ON ug.group_id = ag.group_id
  `;

  for (const row of affectedUsers) {
    await updateUserIpaProfile(row.user_id as string);
  }
};
