import { sql } from "bun";
import { legacyAccountColumnsFromCanonical } from "@valentinkolb/cloud-core/services/accounts/compat";
import { applyIpaAccountTransitionPolicy } from "@valentinkolb/cloud-core/services/accounts/switching";
import {
  parseIpaAccountTransitionPolicy,
  parseIpaMatchMode,
} from "@valentinkolb/cloud-core/services/account-model";
import { writeDeletedAccountAudit } from "@valentinkolb/cloud-core/services/account-lifecycle/audit";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import * as settings from "@valentinkolb/cloud-core/services/settings";
import { session } from "@valentinkolb/cloud-core/services/session";
import { freeipa } from "@valentinkolb/cloud-lib/server/services";
import { getFreeIpaConfigSync } from "../freeipa-config";
import { calculateIpaProfile, calculateIpaProfileFromLocalDb } from "./profile";

type DbRow = Record<string, unknown>;

const log = logger("auth:ipa:sync");

const getExcludedGroupsSet = (): Set<string> => freeipa.util.toExcludedGroupsSet(getFreeIpaConfigSync().groupsExcluded);

const upsertUserIpaData = async (
  db: typeof sql,
  params: {
    userId: string;
    uidNumber: number | null;
    phone: string | null;
    ipaPasswordExpires: Date | null;
    lastLoginIpa: Date | null;
    employeeType: string | null;
    addrStreet: string | null;
    addrPostalCode: string | null;
    addrCity: string | null;
    addrState: string | null;
    mobile: string | null;
    sshPublicKeys: string[];
    sshFingerprints: string[];
  },
) =>
  db`
    INSERT INTO auth.user_ipa_data (
      user_id, uid_number, phone, employee_type, mobile, addr_street, addr_postal_code,
      addr_city, addr_state, ipa_password_expires, last_login_ipa, synced_at, ssh_public_keys, ssh_fingerprints
    )
    VALUES (
      ${params.userId},
      ${params.uidNumber},
      ${params.phone},
      ${params.employeeType},
      ${params.mobile},
      ${params.addrStreet},
      ${params.addrPostalCode},
      ${params.addrCity},
      ${params.addrState},
      ${params.ipaPasswordExpires},
      ${params.lastLoginIpa},
      now(),
      ${freeipa.util.toPgTextArray(params.sshPublicKeys)}::text[],
      ${freeipa.util.toPgTextArray(params.sshFingerprints)}::text[]
    )
    ON CONFLICT (user_id) DO UPDATE SET
      uid_number = EXCLUDED.uid_number,
      phone = EXCLUDED.phone,
      employee_type = EXCLUDED.employee_type,
      mobile = EXCLUDED.mobile,
      addr_street = EXCLUDED.addr_street,
      addr_postal_code = EXCLUDED.addr_postal_code,
      addr_city = EXCLUDED.addr_city,
      addr_state = EXCLUDED.addr_state,
      ipa_password_expires = EXCLUDED.ipa_password_expires,
      last_login_ipa = EXCLUDED.last_login_ipa,
      synced_at = EXCLUDED.synced_at,
      ssh_public_keys = EXCLUDED.ssh_public_keys,
      ssh_fingerprints = EXCLUDED.ssh_fingerprints
  `;

// ==========================
// Sync Types
// ==========================

type SyncUser = {
  uid: string;
  uidNumber: number | null;
  givenname: string;
  sn: string;
  displayName: string;
  mail: string | null;
  phone: string | null;
  ipaAccountExpires: Date | null;
  ipaPasswordExpires: Date | null;
  lastLoginIpa: Date | null;
  memberofGroup: string[];
  employeeType: string | null;
  addrStreet: string | null;
  addrPostalCode: string | null;
  addrCity: string | null;
  addrState: string | null;
  mobile: string | null;
  sshPublicKeys: string[];
  sshFingerprints: string[];
};

type SyncGroup = {
  cn: string;
  description: string | null;
  gidnumber: number | null;
  users: string[];
  groups: string[];
  parentGroups: string[];
  managerUsers: string[];
  managerGroups: string[];
};

type IpaCallResponse = Awaited<ReturnType<typeof freeipa.client.call>>;

// ==========================
// Transform helpers
// ==========================

/**
 * Normalizes one raw IPA user record into the sync user model.
 */
const transformSyncUser = (raw: Record<string, unknown>): SyncUser => {
  const directGroups = (raw.memberof_group as string[]) ?? [];
  const indirectGroups = (raw.memberofindirect_group as string[]) ?? [];
  return {
    uid: freeipa.util.str(raw.uid),
    uidNumber: freeipa.util.num(raw.uidnumber),
    givenname: freeipa.util.str(raw.givenname),
    sn: freeipa.util.str(raw.sn),
    displayName: freeipa.util.str(raw.displayname) || [freeipa.util.str(raw.givenname), freeipa.util.str(raw.sn)].filter(Boolean).join(" ") || freeipa.util.str(raw.uid),
    mail: freeipa.util.str(raw.mail) || null,
    phone: freeipa.util.str(raw.telephonenumber) || null,
    ipaAccountExpires: freeipa.util.parseGeneralizedTime(raw.krbprincipalexpiration),
    ipaPasswordExpires: freeipa.util.parseGeneralizedTime(raw.krbpasswordexpiration),
    lastLoginIpa: freeipa.util.parseGeneralizedTime(raw.krblastsuccessfulauth),
    memberofGroup: [...directGroups, ...indirectGroups],
    employeeType: freeipa.util.str(raw.employeetype) || null,
    addrStreet: freeipa.util.str(raw.street) || null,
    addrPostalCode: freeipa.util.str(raw.postalcode) || null,
    addrCity: freeipa.util.str(raw.l) || null,
    addrState: freeipa.util.str(raw.st) || null,
    mobile: freeipa.util.str(raw.mobile) || null,
    sshPublicKeys: Array.isArray(raw.ipasshpubkey) ? raw.ipasshpubkey : [],
    sshFingerprints: Array.isArray(raw.sshpubkeyfp) ? raw.sshpubkeyfp : [],
  };
};

/**
 * Normalizes one raw IPA group record into the sync group model.
 */
const transformSyncGroup = (raw: Record<string, unknown>): SyncGroup => ({
  cn: freeipa.util.str(raw.cn),
  description: freeipa.util.str(raw.description) || null,
  gidnumber: freeipa.util.num(raw.gidnumber),
  users: (raw.member_user as string[]) ?? [],
  groups: ((raw.member_group as string[]) ?? []).filter((g) => !getExcludedGroupsSet().has(g)),
  parentGroups: ((raw.memberof_group as string[]) ?? []).filter((g) => !getExcludedGroupsSet().has(g)),
  managerUsers: (raw.membermanager_user as string[]) ?? [],
  managerGroups: ((raw.membermanager_group as string[]) ?? []).filter((g) => !getExcludedGroupsSet().has(g)),
});

/**
 * Evaluates whether an IPA account is already expired based on account metadata.
 */
const isExpired = (u: SyncUser): boolean => {
  if (!u.ipaAccountExpires) return false;
  return u.ipaAccountExpires < new Date();
};

/**
 * Reads one IPA list response and throws for transport/protocol failures.
 * Sync must fail hard on invalid payloads to avoid destructive partial updates.
 */
const readIpaList = (config: { response: IpaCallResponse; entity: string }): Record<string, unknown>[] => {
  if (config.response.error) {
    throw new Error(`IPA ${config.entity} fetch failed: ${config.response.error.message}`);
  }

  const records = config.response.result?.result;
  if (!Array.isArray(records)) {
    throw new Error(`IPA ${config.entity} fetch returned invalid list payload`);
  }

  return records as Record<string, unknown>[];
};

// ==========================
// Sync
// ==========================

/**
 * Runs a full IPA-to-local sync pass for users, groups, and memberships.
 */
export const syncFromIpa = async (): Promise<void> => {
  const startedAt = Date.now();
  const config = getFreeIpaConfigSync();
  if (!config.enabled) {
    log.info("Sync skipped", { reason: "freeipa_disabled" });
    return;
  }
  if (!config.configured) {
    throw new Error("FreeIPA is enabled but not fully configured.");
  }
  const excludedGroupsSet = freeipa.util.toExcludedGroupsSet(config.groupsExcluded);
  const ipaSession = await freeipa.session.getServiceSession({
    url: config.url,
    serviceUser: config.serviceUser,
    servicePassword: config.servicePassword,
  });

  const [usersRes, groupsRes] = await Promise.all([
    freeipa.client.call({ url: config.url, ipaSession, method: "user_find", args: [], options: { sizelimit: 0, all: true } }),
    freeipa.client.call({
      url: config.url,
      ipaSession,
      method: "group_find",
      args: [],
      options: {
        sizelimit: 0,
        no_members: false,
        all: true,
      },
    }),
  ]);

  const allRawUsers = readIpaList({ response: usersRes, entity: "users" });

  const users = allRawUsers
    .filter((raw) => {
      const groups = (raw.memberof_group as string[]) ?? [];
      return config.groupsBaseSync.some((g) => groups.includes(g));
    })
    .map(transformSyncUser);

  const allRawGroups = readIpaList({ response: groupsRes, entity: "groups" });
  const groups = allRawGroups.map(transformSyncGroup).filter((g) => !excludedGroupsSet.has(g.cn));

  const activeUsers = users.filter((u) => !isExpired(u));
  const expiredUsers = users.length - activeUsers.length;
  const inScopeUids = new Set(users.map((u) => u.uid));
  const groupCns = new Set(groups.map((g) => g.cn));
  const matchMode = parseIpaMatchMode(await settings.get<string | null>("freeipa.user_match_mode"));
  const transitionPolicy = parseIpaAccountTransitionPolicy(
    await settings.get<string | null>("freeipa.account_transition_policy"),
  );

  let matchedExistingUsersByMail = 0;
  let migratedLocalUsers = 0;
  let skippedLocalMailConflicts = 0;
  let skippedLocalUidConflicts = 0;
  let upsertedUsersByUid = 0;
  let insertedUsersByUid = 0;
  let updatedUsersByUid = 0;
  let deletedGroups = 0;

  const [localCountsRow] = await sql<DbRow[]>`
    SELECT
      (SELECT COUNT(*)::int FROM auth.users WHERE provider = 'ipa') AS ipa_users,
      (SELECT COUNT(*)::int FROM auth.groups WHERE provider = 'ipa') AS groups
  `;

  const localIpaUsers = Number(localCountsRow?.ipa_users ?? 0);
  const localGroups = Number(localCountsRow?.groups ?? 0);

  if (activeUsers.length === 0 && localIpaUsers > 0) {
    throw new Error(`Refusing IPA sync: remote active users list is empty while local has ${localIpaUsers} IPA users`);
  }
  if (groupCns.size === 0 && localGroups > 0) {
    throw new Error(`Refusing IPA sync: remote groups list is empty while local has ${localGroups} groups`);
  }

  const localIpaRows = await sql<DbRow[]>`
    SELECT id, uid, mail, display_name, profile
    FROM auth.users
    WHERE provider = 'ipa'
    ORDER BY uid
  `;
  const staleLocalUsers = localIpaRows.filter((row) => !inScopeUids.has(row.uid as string));
  const staleLimit = Math.max(10, Math.ceil(Math.max(localIpaUsers, 1) * 0.2));
  if (staleLocalUsers.length > staleLimit) {
    throw new Error(
      `Refusing IPA sync: ${staleLocalUsers.length} local IPA users disappeared from sync scope (limit ${staleLimit})`,
    );
  }

  const staleDemotedUsers: Array<{ id: string; uid: string }> = [];
  await sql.begin(async (tx) => {
    // 1. Upsert active IPA users
    //    Match order: mail (existing IPA user, handles UID renames) → mail (guest promotion) → uid (new or unchanged)
    for (const u of activeUsers) {
      const profile = calculateIpaProfile(u.memberofGroup);
      const provider = "ipa";
      const legacyColumns = legacyAccountColumnsFromCanonical({
        provider,
        profile,
        accountExpires: u.ipaAccountExpires,
      });

      if (u.mail) {
        // First: match existing IPA user by mail (handles UID renames)
        const updated = await tx`
          UPDATE auth.users SET
            uid = ${u.uid}, realm = ${legacyColumns.realm}, provider = ${provider}, profile = ${profile}, admin = false,
            given_name = ${u.givenname}, sn = ${u.sn},
            display_name = ${u.displayName}, mail = ${u.mail},
            account_expires = ${u.ipaAccountExpires},
            ipa_account_expires = ${u.ipaAccountExpires},
            guest_expires_at = NULL
          WHERE mail = ${u.mail} AND provider = 'ipa'
          RETURNING id`;
        if (updated.length > 0) {
          await upsertUserIpaData(tx, { userId: updated[0]!.id as string, ...u });
          matchedExistingUsersByMail += 1;
          continue;
        }

        // Second: optionally migrate a unique local account to IPA.
        if (matchMode === "migrate") {
          const localMatches = await tx<DbRow[]>`
            SELECT id
            FROM auth.users
            WHERE mail = ${u.mail} AND provider = 'local'
            ORDER BY profile = 'user' DESC, created_at ASC
            LIMIT 2
          `;

          if (localMatches.length === 1) {
            const migrated = await tx`
              UPDATE auth.users SET
                uid = ${u.uid}, realm = ${legacyColumns.realm}, provider = ${provider}, profile = ${profile}, admin = false,
                given_name = ${u.givenname}, sn = ${u.sn},
                display_name = ${u.displayName}, mail = ${u.mail},
                account_expires = ${u.ipaAccountExpires},
                ipa_account_expires = ${u.ipaAccountExpires},
                guest_expires_at = NULL
              WHERE id = ${localMatches[0]!.id as string}::uuid
              RETURNING id`;
            if (migrated.length > 0) {
              await upsertUserIpaData(tx, { userId: migrated[0]!.id as string, ...u });
              migratedLocalUsers += 1;
              continue;
            }
          } else if (localMatches.length > 1) {
            skippedLocalMailConflicts += 1;
            log.warn("Skipping IPA provider migration because multiple local accounts matched by mail", {
              mail: u.mail,
              uid: u.uid,
            });
            continue;
          }
        }
      }

      const uidConflictRows = await tx<DbRow[]>`
        SELECT id
        FROM auth.users
        WHERE uid = ${u.uid} AND provider = 'local'
        LIMIT 1
      `;
      if (uidConflictRows.length > 0) {
        skippedLocalUidConflicts += 1;
        log.warn("Skipping IPA sync user upsert because a local account already uses the UID", {
          uid: u.uid,
          mail: u.mail,
        });
        continue;
      }

      // Third: insert new or update existing by uid
      const upserted = await tx<DbRow[]>`
        INSERT INTO auth.users (uid, realm, provider, profile, admin, given_name, sn, display_name, mail, account_expires, ipa_account_expires, guest_expires_at)
        VALUES (${u.uid}, ${legacyColumns.realm}, ${provider}, ${profile}, false, ${u.givenname}, ${u.sn}, ${
          u.displayName
        }, ${u.mail}, ${u.ipaAccountExpires}, ${u.ipaAccountExpires}, NULL)
        ON CONFLICT (uid) DO UPDATE SET
          realm = ${legacyColumns.realm},
          provider = ${provider},
          profile = ${profile},
          admin = false,
          given_name = EXCLUDED.given_name, sn = EXCLUDED.sn,
          display_name = EXCLUDED.display_name, mail = EXCLUDED.mail,
          account_expires = EXCLUDED.account_expires, ipa_account_expires = EXCLUDED.ipa_account_expires,
          guest_expires_at = NULL
        RETURNING id, (xmax = 0) AS inserted`;
      await upsertUserIpaData(tx, { userId: upserted[0]!.id as string, ...u });
      upsertedUsersByUid += 1;
      if (Boolean(upserted[0]?.inserted)) insertedUsersByUid += 1;
      else updatedUsersByUid += 1;
    }

    for (const stale of staleLocalUsers) {
      const userId = stale.id as string;
      const uid = stale.uid as string;
      const previousProfile = (stale.profile as "user" | "guest" | null) ?? "guest";

      if (transitionPolicy === "delete") {
        await writeDeletedAccountAudit({
          db: tx,
          userId,
          uid,
          mail: (stale.mail as string) ?? null,
          displayName: (stale.display_name as string) ?? null,
          previousProvider: "ipa",
          previousProfile,
          reason: "sync_out_of_scope_deleted",
          meta: {
            reason: "missing_from_ipa_sync_scope",
          },
        });
        await tx`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
        staleDemotedUsers.push({ id: userId, uid });
        continue;
      }

      const target = await applyIpaAccountTransitionPolicy({
        userId,
        currentProfile: previousProfile,
        policy: transitionPolicy,
        db: tx,
      });
      await writeDeletedAccountAudit({
        db: tx,
        userId,
        uid,
        mail: (stale.mail as string) ?? null,
        displayName: (stale.display_name as string) ?? null,
        previousProvider: "ipa",
        previousProfile,
        reason: "sync_out_of_scope_demoted",
        meta: {
          accountExpiresAt: target.accountExpires?.toISOString() ?? null,
          targetProfile: target.targetProfile,
          reason: "missing_from_ipa_sync_scope",
        },
      });
      staleDemotedUsers.push({ id: userId, uid });
    }

    // 2. Upsert groups + delete stale
    for (const g of groups) {
      await tx`
        INSERT INTO auth.groups (id, cn, name, provider, description, gid_number, synced_at)
        VALUES (gen_random_uuid(), ${g.cn}, ${g.cn}, 'ipa', ${g.description}, ${g.gidnumber}, now())
        ON CONFLICT (provider, name) DO UPDATE SET
          cn = EXCLUDED.cn,
          description = EXCLUDED.description,
          gid_number = EXCLUDED.gid_number,
          synced_at = now()`;
    }
    const groupCnArray = [...groupCns];
    if (groupCnArray.length > 0) {
      const deleted = await tx<DbRow[]>`
        DELETE FROM auth.groups
        WHERE provider = 'ipa'
          AND name <> ALL(${freeipa.util.toPgTextArray(groupCnArray)}::text[])
        RETURNING name
      `;
      deletedGroups = deleted.length;
    } else {
      log.warn("Skipping stale group deletion because resolved group list is empty");
    }

    const groupRows = await tx<DbRow[]>`SELECT id, name FROM auth.groups WHERE provider = 'ipa'`;
    const groupNameToId = new Map<string, string>(groupRows.map((row) => [row.name as string, row.id as string]));

    // 3. Rebuild junction tables
    await tx`DELETE FROM auth.user_groups_v2 WHERE group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')`;
    await tx`
      DELETE FROM auth.group_groups_v2
      WHERE parent_group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
         OR child_group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
    `;
    await tx`DELETE FROM auth.group_manager_users_v2 WHERE group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')`;
    await tx`
      DELETE FROM auth.group_manager_groups_v2
      WHERE group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
         OR manager_group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
    `;

    const userIdRows: DbRow[] = await tx`SELECT id, uid FROM auth.users WHERE provider = 'ipa'`;
    const uidToId = new Map<string, string>(userIdRows.map((r) => [r.uid as string, r.id as string]));

    // user_groups — built from group's member_user (authoritative source)
    for (const g of groups) {
      const groupId = groupNameToId.get(g.cn);
      if (!groupId) continue;
      for (const uid of g.users) {
        const userId = uidToId.get(uid);
        if (userId) {
          await tx`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${userId}, ${groupId}) ON CONFLICT DO NOTHING`;
        }
      }
    }

    // group_groups + manager junctions
    for (const g of groups) {
      const groupId = groupNameToId.get(g.cn);
      if (!groupId) continue;
      for (const child of g.groups) {
        const childGroupId = groupNameToId.get(child);
        if (childGroupId) {
          await tx`INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id) VALUES (${groupId}, ${childGroupId}) ON CONFLICT DO NOTHING`;
        }
      }
      for (const uid of g.managerUsers) {
        const userId = uidToId.get(uid);
        if (userId) {
          await tx`INSERT INTO auth.group_manager_users_v2 (group_id, user_id) VALUES (${groupId}, ${userId}) ON CONFLICT DO NOTHING`;
        }
      }
      for (const mgr of g.managerGroups) {
        const managerGroupId = groupNameToId.get(mgr);
        if (managerGroupId) {
          await tx`INSERT INTO auth.group_manager_groups_v2 (group_id, manager_group_id) VALUES (${groupId}, ${managerGroupId}) ON CONFLICT DO NOTHING`;
        }
      }
    }

  });

  for (const staleUser of staleDemotedUsers) {
    try {
      await session.deleteAllForUser(staleUser.id);
    } catch (error) {
      log.warn("Failed to revoke sessions after stale IPA demotion", {
        userId: staleUser.id,
        uid: staleUser.uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("Sync complete", {
    durationMs: Date.now() - startedAt,
    remoteUsersFetched: allRawUsers.length,
    remoteUsersInScope: users.length,
    remoteExpiredUsers: expiredUsers,
    activeUsersSynced: activeUsers.length,
    matchedExistingUsersByMail,
    migratedLocalUsers,
    skippedLocalMailConflicts,
    skippedLocalUidConflicts,
    staleUsersDemoted: staleDemotedUsers.length,
    upsertedUsersByUid,
    insertedUsersByUid,
    updatedUsersByUid,
    groupsSynced: groups.length,
    deletedGroups,
    localIpaUsersBefore: localIpaUsers,
    localGroupsBefore: localGroups,
  });
};

/**
 * Sync a single user's attributes from FreeIPA.
 * Called on login to ensure time-sensitive data is up-to-date.
 *
 * IMPORTANT: Only syncs user attributes (name, mail, expiry, aliases).
 * Does NOT sync group memberships - those are only synced via periodic syncFromIpa().
 * Realm is calculated from LOCAL DB group memberships (optimistically updated by mutations).
 */
export const syncUser = async (username: string): Promise<void> => {
  const config = getFreeIpaConfigSync();
  if (!config.enabled) {
    log.info("Single-user sync skipped", { reason: "freeipa_disabled", username });
    return;
  }
  if (!config.configured) {
    throw new Error("FreeIPA is enabled but not fully configured.");
  }
  const ipaSession = await freeipa.session.getServiceSession({
    url: config.url,
    serviceUser: config.serviceUser,
    servicePassword: config.servicePassword,
  });

  // Fetch user from FreeIPA
  const userRes = await freeipa.client.call({
    url: config.url,
    ipaSession,
    method: "user_show",
    args: [username],
    options: { all: true },
  });
  if (userRes.error || !userRes.result?.result) {
    log.warn("Could not fetch user", {
      username,
      error: userRes.error?.message,
    });
    return;
  }

  const raw = userRes.result.result as Record<string, unknown>;
  const user = transformSyncUser(raw);

  // Skip expired users
  if (isExpired(user)) {
    log.warn("User expired, skipping", { username });
    return;
  }

  // Check if user is in sync groups (from FreeIPA response)
  const inSyncGroups = config.groupsBaseSync.some((g) => user.memberofGroup.includes(g));
  if (!inSyncGroups) {
    log.warn("User not in sync groups, skipping", { username });
    return;
  }

  // Get user ID first to calculate the effective IPA profile from local DB state.
  const userRows: DbRow[] = await sql`SELECT id FROM auth.users WHERE uid = ${user.uid}`;
  if (userRows.length === 0) {
    log.warn("User not found in local DB", { username });
    return;
  }

  // Calculate profile from LOCAL DB group memberships (not FreeIPA!)
  const userId = userRows[0]!.id as string;
  const profile = await calculateIpaProfileFromLocalDb(userId);
  const provider = "ipa";
  const legacyColumns = legacyAccountColumnsFromCanonical({
    provider,
    profile,
    accountExpires: user.ipaAccountExpires,
  });

  // Update user attributes only (no group sync!)
  await sql`
    UPDATE auth.users SET
      realm = ${legacyColumns.realm},
      provider = ${provider},
      profile = ${profile},
      admin = false,
      given_name = ${user.givenname},
      sn = ${user.sn},
      display_name = ${user.displayName},
      mail = ${user.mail},
      account_expires = ${user.ipaAccountExpires},
      ipa_account_expires = ${user.ipaAccountExpires},
      guest_expires_at = NULL
    WHERE uid = ${user.uid}
  `;
  await upsertUserIpaData(sql, { userId, ...user });
};
