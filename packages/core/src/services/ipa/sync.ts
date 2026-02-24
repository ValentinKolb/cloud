import { sql } from "bun";
import { env } from "@valentinkolb/cloud-core/config/env";
import { call, str, num, parseGeneralizedTime, toPgTextArray, excludedGroupsSet, type DbRow } from "./lib";
import { getServiceSession } from "./auth";
import { calculateRealm, calculateRealmFromLocalDb } from "./realm";
import { logger } from "@valentinkolb/cloud-core/services/logging";

const log = logger("ipa-sync");

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

type SyncHost = {
  fqdn: string;
  description: string | null;
  location: string | null;
  locality: string | null;
  memberofHostgroup: string[];
  macAddress: string[];
  platform: string | null;
  osVersion: string | null;
  sshFingerprints: string[];
};

type SyncHostgroup = {
  cn: string;
  description: string | null;
  hosts: string[];
  hostgroups: string[];
};

type IpaCallResponse = Awaited<ReturnType<typeof call>>;

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
    uid: str(raw.uid),
    uidNumber: num(raw.uidnumber),
    givenname: str(raw.givenname),
    sn: str(raw.sn),
    displayName: str(raw.displayname) || [str(raw.givenname), str(raw.sn)].filter(Boolean).join(" ") || str(raw.uid),
    mail: str(raw.mail) || null,
    phone: str(raw.telephonenumber) || null,
    ipaAccountExpires: parseGeneralizedTime(raw.krbprincipalexpiration),
    ipaPasswordExpires: parseGeneralizedTime(raw.krbpasswordexpiration),
    lastLoginIpa: parseGeneralizedTime(raw.krblastsuccessfulauth),
    memberofGroup: [...directGroups, ...indirectGroups],
    employeeType: str(raw.employeetype) || null,
    addrStreet: str(raw.street) || null,
    addrPostalCode: str(raw.postalcode) || null,
    addrCity: str(raw.l) || null,
    addrState: str(raw.st) || null,
    mobile: str(raw.mobile) || null,
    sshPublicKeys: Array.isArray(raw.ipasshpubkey) ? raw.ipasshpubkey : [],
    sshFingerprints: Array.isArray(raw.sshpubkeyfp) ? raw.sshpubkeyfp : [],
  };
};

/**
 * Normalizes one raw IPA group record into the sync group model.
 */
const transformSyncGroup = (raw: Record<string, unknown>): SyncGroup => ({
  cn: str(raw.cn),
  description: str(raw.description) || null,
  gidnumber: num(raw.gidnumber),
  users: (raw.member_user as string[]) ?? [],
  groups: ((raw.member_group as string[]) ?? []).filter((g) => !excludedGroupsSet.has(g)),
  parentGroups: ((raw.memberof_group as string[]) ?? []).filter((g) => !excludedGroupsSet.has(g)),
  managerUsers: (raw.membermanager_user as string[]) ?? [],
  managerGroups: ((raw.membermanager_group as string[]) ?? []).filter((g) => !excludedGroupsSet.has(g)),
});

/**
 * Normalizes one raw IPA host record into the sync host model.
 */
const transformSyncHost = (raw: Record<string, unknown>): SyncHost => ({
  fqdn: str(raw.fqdn),
  description: str(raw.description) || null,
  location: str(raw.nshostlocation) || null,
  locality: str(raw.l) || null,
  memberofHostgroup: ((raw.memberof_hostgroup as string[]) ?? []).filter((g) => !excludedGroupsSet.has(g)),
  macAddress: Array.isArray(raw.macaddress) ? raw.macaddress : [],
  platform: str(raw.nshardwareplatform) || null,
  osVersion: str(raw.nsosversion) || null,
  sshFingerprints: Array.isArray(raw.sshpubkeyfp) ? raw.sshpubkeyfp : [],
});

/**
 * Normalizes one raw IPA hostgroup record into the sync hostgroup model.
 */
const transformSyncHostgroup = (raw: Record<string, unknown>): SyncHostgroup => ({
  cn: str(raw.cn),
  description: str(raw.description) || null,
  hosts: (raw.member_host as string[]) ?? [],
  hostgroups: ((raw.member_hostgroup as string[]) ?? []).filter((g) => !excludedGroupsSet.has(g)),
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
 * Runs a full IPA-to-local sync pass for users, groups, hosts, and memberships.
 */
export const syncFromIpa = async (): Promise<void> => {
  const session = await getServiceSession();

  const [usersRes, groupsRes, hostsRes, hostgroupsRes] = await Promise.all([
    call(session, "user_find", [], { sizelimit: 0, all: true }),
    call(session, "group_find", [], {
      sizelimit: 0,
      no_members: false,
      all: true,
    }),
    call(session, "host_find", [], { sizelimit: 0, all: true }),
    call(session, "hostgroup_find", [], {
      sizelimit: 0,
      no_members: false,
      all: true,
    }),
  ]);

  const allRawUsers = readIpaList({ response: usersRes, entity: "users" });

  const users = allRawUsers
    .filter((raw) => {
      const groups = (raw.memberof_group as string[]) ?? [];
      return env.GROUPS_BASE_SYNC.some((g) => groups.includes(g));
    })
    .map(transformSyncUser);

  const allRawGroups = readIpaList({ response: groupsRes, entity: "groups" });
  const groups = allRawGroups.map(transformSyncGroup).filter((g) => !excludedGroupsSet.has(g.cn));

  const allRawHosts = readIpaList({ response: hostsRes, entity: "hosts" });
  const hosts = allRawHosts.map(transformSyncHost);

  const allRawHostgroups = readIpaList({ response: hostgroupsRes, entity: "hostgroups" });
  const hostgroups = allRawHostgroups.map(transformSyncHostgroup);

  const activeUsers = users.filter((u) => !isExpired(u));
  const activeUids = activeUsers.map((u) => u.uid);
  const groupCns = new Set(groups.map((g) => g.cn));
  const hostFqdns = hosts.map((h) => h.fqdn);
  const hostgroupCns = new Set(hostgroups.map((hg) => hg.cn));

  const [localCountsRow] = await sql<DbRow[]>`
    SELECT
      (SELECT COUNT(*)::int FROM auth.users WHERE realm IN ('ipa', 'ipa-limited')) AS ipa_users,
      (SELECT COUNT(*)::int FROM auth.groups) AS groups,
      (SELECT COUNT(*)::int FROM auth.hosts) AS hosts,
      (SELECT COUNT(*)::int FROM auth.hostgroups) AS hostgroups
  `;

  const localIpaUsers = Number(localCountsRow?.ipa_users ?? 0);
  const localGroups = Number(localCountsRow?.groups ?? 0);
  const localHosts = Number(localCountsRow?.hosts ?? 0);
  const localHostgroups = Number(localCountsRow?.hostgroups ?? 0);

  if (activeUsers.length === 0 && localIpaUsers > 0) {
    throw new Error(`Refusing IPA sync: remote active users list is empty while local has ${localIpaUsers} IPA users`);
  }
  if (groupCns.size === 0 && localGroups > 0) {
    throw new Error(`Refusing IPA sync: remote groups list is empty while local has ${localGroups} groups`);
  }
  if (hostFqdns.length === 0 && localHosts > 0) {
    throw new Error(`Refusing IPA sync: remote hosts list is empty while local has ${localHosts} hosts`);
  }
  if (hostgroupCns.size === 0 && localHostgroups > 0) {
    throw new Error(`Refusing IPA sync: remote hostgroups list is empty while local has ${localHostgroups} hostgroups`);
  }

  await sql.begin(async (tx) => {
    // 1. Upsert active IPA users
    //    Match order: mail (existing IPA user, handles UID renames) → mail (guest promotion) → uid (new or unchanged)
    for (const u of activeUsers) {
      const realm = calculateRealm(u.memberofGroup);

      if (u.mail) {
        // First: match existing IPA/ipa-limited user by mail (handles UID renames)
        const updated = await tx`
          UPDATE auth.users SET
            uid = ${u.uid}, realm = ${realm},
            uid_number = ${u.uidNumber},
            given_name = ${u.givenname}, sn = ${u.sn},
            display_name = ${u.displayName}, mail = ${u.mail},
            phone = ${u.phone}, ipa_account_expires = ${u.ipaAccountExpires},
            ipa_password_expires = ${u.ipaPasswordExpires},
            last_login_ipa = ${u.lastLoginIpa},
            employee_type = ${u.employeeType},
            addr_street = ${u.addrStreet},
            addr_postal_code = ${u.addrPostalCode},
            addr_city = ${u.addrCity},
            addr_state = ${u.addrState},
            mobile = ${u.mobile},
            ssh_public_keys = ${toPgTextArray(u.sshPublicKeys)}::text[],
            ssh_fingerprints = ${toPgTextArray(u.sshFingerprints)}::text[],
            synced_at = now()
          WHERE mail = ${u.mail} AND realm IN ('ipa', 'ipa-limited')
          RETURNING id`;
        if (updated.length > 0) continue;

        // Second: promote guest with matching mail (keep existing UID if it's an abbreviation)
        const promoted = await tx`
          UPDATE auth.users SET
            uid = ${u.uid}, realm = ${realm},
            uid_number = ${u.uidNumber},
            given_name = ${u.givenname}, sn = ${u.sn},
            display_name = ${u.displayName}, mail = ${u.mail},
            phone = ${u.phone}, ipa_account_expires = ${u.ipaAccountExpires},
            ipa_password_expires = ${u.ipaPasswordExpires},
            last_login_ipa = ${u.lastLoginIpa},
            employee_type = ${u.employeeType},
            addr_street = ${u.addrStreet},
            addr_postal_code = ${u.addrPostalCode},
            addr_city = ${u.addrCity},
            addr_state = ${u.addrState},
            mobile = ${u.mobile},
            ssh_public_keys = ${toPgTextArray(u.sshPublicKeys)}::text[],
            ssh_fingerprints = ${toPgTextArray(u.sshFingerprints)}::text[],
            synced_at = now()
          WHERE mail = ${u.mail} AND realm = 'guest'
          RETURNING id`;
        if (promoted.length > 0) continue;
      }

      // Third: insert new or update existing by uid
      await tx`
        INSERT INTO auth.users (uid, uid_number, realm, given_name, sn, display_name, mail, phone, ipa_account_expires, ipa_password_expires, last_login_ipa, employee_type, addr_street, addr_postal_code, addr_city, addr_state, mobile, ssh_public_keys, ssh_fingerprints, synced_at)
        VALUES (${u.uid}, ${u.uidNumber}, ${realm}, ${u.givenname}, ${u.sn}, ${
          u.displayName
        }, ${u.mail}, ${u.phone}, ${u.ipaAccountExpires}, ${u.ipaPasswordExpires}, ${u.lastLoginIpa}, ${u.employeeType}, ${u.addrStreet}, ${
          u.addrPostalCode
        }, ${u.addrCity}, ${u.addrState}, ${u.mobile}, ${toPgTextArray(
          u.sshPublicKeys,
        )}::text[], ${toPgTextArray(u.sshFingerprints)}::text[], now())
        ON CONFLICT (uid) DO UPDATE SET
          realm = ${realm},
          uid_number = EXCLUDED.uid_number,
          given_name = EXCLUDED.given_name, sn = EXCLUDED.sn,
          display_name = EXCLUDED.display_name, mail = EXCLUDED.mail,
          phone = EXCLUDED.phone, ipa_account_expires = EXCLUDED.ipa_account_expires,
          ipa_password_expires = EXCLUDED.ipa_password_expires,
          last_login_ipa = EXCLUDED.last_login_ipa,
          employee_type = EXCLUDED.employee_type,
          addr_street = EXCLUDED.addr_street,
          addr_postal_code = EXCLUDED.addr_postal_code,
          addr_city = EXCLUDED.addr_city,
          addr_state = EXCLUDED.addr_state,
          mobile = EXCLUDED.mobile,
          ssh_public_keys = EXCLUDED.ssh_public_keys,
          ssh_fingerprints = EXCLUDED.ssh_fingerprints,
          synced_at = now()`;
    }

    // 2. Demote IPA/ipa-limited users not active anymore → guest (keep UID, clear uid_number + IPA fields)
    if (activeUids.length > 0) {
      await tx`
        UPDATE auth.users
        SET realm = 'guest', uid_number = NULL, synced_at = NULL,
            employee_type = NULL, addr_street = NULL, addr_postal_code = NULL,
            addr_city = NULL, addr_state = NULL, mobile = NULL,
            ssh_public_keys = '{}', ssh_fingerprints = '{}',
            ipa_account_expires = NULL, ipa_password_expires = NULL,
            last_login_ipa = NULL
        WHERE realm IN ('ipa', 'ipa-limited') AND uid NOT IN ${sql(activeUids)}`;
    } else {
      await tx`
        UPDATE auth.users
        SET realm = 'guest', uid_number = NULL, synced_at = NULL,
            employee_type = NULL, addr_street = NULL, addr_postal_code = NULL,
            addr_city = NULL, addr_state = NULL, mobile = NULL,
            ssh_public_keys = '{}', ssh_fingerprints = '{}',
            ipa_account_expires = NULL, ipa_password_expires = NULL,
            last_login_ipa = NULL
        WHERE realm IN ('ipa', 'ipa-limited')`;
    }
    await tx`DELETE FROM auth.user_groups WHERE user_id IN (SELECT id FROM auth.users WHERE realm = 'guest')`;
    await tx`DELETE FROM auth.group_manager_users WHERE user_id IN (SELECT id FROM auth.users WHERE realm = 'guest')`;

    // 3. Upsert groups + delete stale
    for (const g of groups) {
      await tx`
        INSERT INTO auth.groups (cn, description, gid_number, synced_at)
        VALUES (${g.cn}, ${g.description}, ${g.gidnumber}, now())
        ON CONFLICT (cn) DO UPDATE SET
          description = EXCLUDED.description, gid_number = EXCLUDED.gid_number, synced_at = now()`;
    }
    const groupCnArray = [...groupCns];
    if (groupCnArray.length > 0) {
      await tx`DELETE FROM auth.groups WHERE cn NOT IN ${sql(groupCnArray)}`;
    } else {
      log.warn("Skipping stale group deletion because resolved group list is empty");
    }

    // 4. Upsert hosts + delete stale
    for (const h of hosts) {
      await tx`
        INSERT INTO auth.hosts (fqdn, description, location, locality, mac_address, platform, os_version, ssh_fingerprints, synced_at)
        VALUES (${h.fqdn}, ${h.description}, ${h.location}, ${h.locality}, ${toPgTextArray(h.macAddress)}::text[], ${h.platform}, ${
          h.osVersion
        }, ${toPgTextArray(h.sshFingerprints)}::text[], now())
        ON CONFLICT (fqdn) DO UPDATE SET
          description = EXCLUDED.description, location = EXCLUDED.location,
          locality = EXCLUDED.locality,
          mac_address = EXCLUDED.mac_address, platform = EXCLUDED.platform,
          os_version = EXCLUDED.os_version, ssh_fingerprints = EXCLUDED.ssh_fingerprints,
          synced_at = now()`;
    }
    if (hostFqdns.length > 0) {
      await tx`DELETE FROM auth.hosts WHERE fqdn NOT IN ${sql(hostFqdns)}`;
    } else {
      log.warn("Skipping stale host deletion because resolved host list is empty");
    }

    // 5. Upsert hostgroups + delete stale
    for (const hg of hostgroups) {
      await tx`
        INSERT INTO auth.hostgroups (cn, description, synced_at)
        VALUES (${hg.cn}, ${hg.description}, now())
        ON CONFLICT (cn) DO UPDATE SET description = EXCLUDED.description, synced_at = now()`;
    }
    const hgCnArray = [...hostgroupCns];
    if (hgCnArray.length > 0) {
      await tx`DELETE FROM auth.hostgroups WHERE cn NOT IN ${sql(hgCnArray)}`;
    } else {
      log.warn("Skipping stale hostgroup deletion because resolved hostgroup list is empty");
    }

    // 6. Rebuild junction tables
    await tx`TRUNCATE auth.user_groups, auth.group_groups, auth.group_manager_users, auth.group_manager_groups, auth.host_hostgroups, auth.hostgroup_hostgroups`;

    const userIdRows: DbRow[] = await tx`SELECT id, uid FROM auth.users WHERE realm IN ('ipa', 'ipa-limited')`;
    const uidToId = new Map<string, string>(userIdRows.map((r) => [r.uid as string, r.id as string]));

    // user_groups — built from group's member_user (authoritative source)
    for (const g of groups) {
      for (const uid of g.users) {
        const userId = uidToId.get(uid);
        if (userId) await tx`INSERT INTO auth.user_groups (user_id, group_cn) VALUES (${userId}, ${g.cn}) ON CONFLICT DO NOTHING`;
      }
    }

    // group_groups + manager junctions
    for (const g of groups) {
      for (const child of g.groups) {
        if (groupCns.has(child))
          await tx`INSERT INTO auth.group_groups (parent_cn, child_cn) VALUES (${g.cn}, ${child}) ON CONFLICT DO NOTHING`;
      }
      for (const uid of g.managerUsers) {
        const userId = uidToId.get(uid);
        if (userId) await tx`INSERT INTO auth.group_manager_users (group_cn, user_id) VALUES (${g.cn}, ${userId}) ON CONFLICT DO NOTHING`;
      }
      for (const mgr of g.managerGroups) {
        if (groupCns.has(mgr))
          await tx`INSERT INTO auth.group_manager_groups (group_cn, manager_cn) VALUES (${g.cn}, ${mgr}) ON CONFLICT DO NOTHING`;
      }
    }

    // host_hostgroups
    for (const h of hosts) {
      for (const hg of h.memberofHostgroup) {
        if (hostgroupCns.has(hg))
          await tx`INSERT INTO auth.host_hostgroups (host_fqdn, hostgroup_cn) VALUES (${h.fqdn}, ${hg}) ON CONFLICT DO NOTHING`;
      }
    }

    // hostgroup_hostgroups
    for (const hg of hostgroups) {
      for (const child of hg.hostgroups) {
        if (hostgroupCns.has(child))
          await tx`INSERT INTO auth.hostgroup_hostgroups (parent_cn, child_cn) VALUES (${hg.cn}, ${child}) ON CONFLICT DO NOTHING`;
      }
    }
  });

  log.info("Sync complete", {
    users: activeUsers.length,
    groups: groups.length,
    hosts: hosts.length,
    hostgroups: hostgroups.length,
  });
};

/** Start the sync interval (initial sync + every 5 min). */
let syncInterval: ReturnType<typeof setInterval> | undefined;

export const startSyncInterval = async (): Promise<void> => {
  if (syncInterval) return;

  try {
    await syncFromIpa();
  } catch (e) {
    log.error("Initial sync failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  syncInterval = setInterval(
    async () => {
      try {
        await syncFromIpa();
      } catch (e) {
        log.error("Periodic sync failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    5 * 60 * 1000,
  );
};

/**
 * Stops the periodic IPA sync interval.
 */
export const stopSyncInterval = async (): Promise<void> => {
  if (!syncInterval) return;
  clearInterval(syncInterval);
  syncInterval = undefined;
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
  const session = await getServiceSession();

  // Fetch user from FreeIPA
  const userRes = await call(session, "user_show", [username], { all: true });
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
  const inSyncGroups = env.GROUPS_BASE_SYNC.some((g) => user.memberofGroup.includes(g));
  if (!inSyncGroups) {
    log.warn("User not in sync groups, skipping", { username });
    return;
  }

  // Get user ID first to calculate realm from local DB
  const userRows: DbRow[] = await sql`SELECT id FROM auth.users WHERE uid = ${user.uid}`;
  if (userRows.length === 0) {
    log.warn("User not found in local DB", { username });
    return;
  }

  // Calculate realm from LOCAL DB group memberships (not FreeIPA!)
  const userId = userRows[0]!.id as string;
  const realm = await calculateRealmFromLocalDb(userId);

  // Update user attributes only (no group sync!)
  await sql`
    UPDATE auth.users SET
      realm = ${realm},
      uid_number = ${user.uidNumber},
      given_name = ${user.givenname},
      sn = ${user.sn},
      display_name = ${user.displayName},
      mail = ${user.mail},
      phone = ${user.phone},
      ipa_account_expires = ${user.ipaAccountExpires},
      ipa_password_expires = ${user.ipaPasswordExpires},
      employee_type = ${user.employeeType},
      addr_street = ${user.addrStreet},
      addr_postal_code = ${user.addrPostalCode},
      addr_city = ${user.addrCity},
      addr_state = ${user.addrState},
      mobile = ${user.mobile},
      ssh_public_keys = ${toPgTextArray(user.sshPublicKeys)}::text[],
      ssh_fingerprints = ${toPgTextArray(user.sshFingerprints)}::text[],
      synced_at = now()
    WHERE uid = ${user.uid}
  `;
};
