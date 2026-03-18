import { sql } from "bun";
import { writeDeletedAccountAudit } from "@valentinkolb/cloud-core/services/account-lifecycle/audit";
import { legacyAccountColumnsFromCanonical } from "@valentinkolb/cloud-core/services/accounts/compat";
import {
  buildRoles as buildAccountRoles,
  resolveEffectiveAdminState,
  resolveAccountExpires,
} from "@valentinkolb/cloud-core/services/account-model";
import { buildIpaUserData, userIpaDataColumns, userIpaDataJoin } from "../accounts/ipa-data";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import { session } from "@valentinkolb/cloud-core/services/session";
import * as settings from "@valentinkolb/cloud-core/services/settings";
import type {
  BaseUser,
  IpaUserData,
  MutationResult,
  PaginationResponse,
  Role,
  User,
  UserProfile,
  UserProvider,
} from "@valentinkolb/cloud-contracts/shared";
import { freeipa } from "@valentinkolb/cloud-lib/server/services";
import { toPgTextArray } from "../postgres";
import { getFreeIpaConfigSync } from "../freeipa-config";

type CreateUser = {
  email: string;
  givenname: string;
  sn: string;
  displayName?: string;
  autoSendNotification?: boolean;
  requestId?: string;
};

type IpaPatchData = {
  givenname?: string;
  sn?: string;
  displayName?: string;
  mail?: string;
  ipa?: {
    phone?: string;
    address?: {
      street?: string;
      postalCode?: string;
      city?: string;
      state?: string;
    };
    sshPublicKeys?: string[];
  };
};

type DbRow = Record<string, unknown>;
type MutationError = Extract<MutationResult<unknown>, { ok: false }>;

// ==========================
// Helper functions
// ==========================

const resolveProviderProfile = (row: DbRow): { provider: UserProvider; profile: UserProfile } => {
  return {
    provider: (row.provider as UserProvider | null | undefined) ?? "local",
    profile: (row.profile as UserProfile | null | undefined) ?? "guest",
  };
};

const buildRoles = (params: {
  provider: UserProvider;
  profile: UserProfile;
  memberofGroup: string[];
  manages: string[];
  admin?: boolean;
}): Role[] =>
  buildAccountRoles(params);

const log = logger("auth:ipa");
const getIpaUrl = (): string => getFreeIpaConfigSync().url;

const ensureFreeIpaMutationAvailable = (): MutationError | null => {
  const config = getFreeIpaConfigSync();
  if (!config.enabled) {
    return { ok: false, error: "FreeIPA is disabled.", status: 400 };
  }
  if (!config.configured) {
    return { ok: false, error: "FreeIPA is enabled but not fully configured.", status: 500 };
  }
  return null;
};

const emptyIpaUserData = (): IpaUserData => ({
  uidNumber: null,
  phone: null,
  employeeType: null,
  mobile: null,
  address: {
    street: null,
    postalCode: null,
    city: null,
    state: null,
  },
  passwordExpires: null,
  lastLoginIpa: null,
  syncedAt: null,
  sshPublicKeys: [],
  sshFingerprints: [],
});

const upsertUserIpaData = async (params: {
  userId: string;
  uidNumber?: number | null;
  phone?: string | null;
  employeeType?: string | null;
  mobile?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
  passwordExpires?: Date | null;
  lastLoginIpa?: Date | null;
  syncedAt?: Date | null;
  sshPublicKeys?: string[];
  sshFingerprints?: string[];
}) => {
  await sql`
    INSERT INTO auth.user_ipa_data (
      user_id, uid_number, phone, employee_type, mobile, addr_street, addr_postal_code,
      addr_city, addr_state, ipa_password_expires, last_login_ipa, synced_at, ssh_public_keys, ssh_fingerprints
    )
    VALUES (
      ${params.userId},
      ${params.uidNumber ?? null},
      ${params.phone ?? null},
      ${params.employeeType ?? null},
      ${params.mobile ?? null},
      ${params.street ?? null},
      ${params.postalCode ?? null},
      ${params.city ?? null},
      ${params.state ?? null},
      ${params.passwordExpires ?? null},
      ${params.lastLoginIpa ?? null},
      ${params.syncedAt ?? null},
      ${freeipa.util.toPgTextArray(params.sshPublicKeys ?? [])}::text[],
      ${freeipa.util.toPgTextArray(params.sshFingerprints ?? [])}::text[]
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
};

// ==========================
// READ: get (single user with relations)
// ==========================

/**
 * Get a user by ID or UID. Returns the canonical rich User with group relations and computed roles.
 * Used by auth middleware and detail pages.
 */
export const get = async (params: { id: string } | { uid: string }): Promise<User | null> => {
  const whereClause = "id" in params ? sql`u.id = ${params.id}` : sql`u.uid = ${params.uid}`;

  const rows: DbRow[] = await sql`
    SELECT u.*,
      ${userIpaDataColumns},
      COALESCE(ARRAY(
        SELECT g.name
        FROM auth.user_groups_v2 ug
        JOIN auth.groups g ON g.id = ug.group_id
        WHERE ug.user_id = u.id
        ORDER BY g.name
      ), '{}') AS member_groups,
      COALESCE(ARRAY(
        SELECT ug.group_id
        FROM auth.user_groups_v2 ug
        JOIN auth.groups g ON g.id = ug.group_id
        WHERE ug.user_id = u.id
        ORDER BY g.name
      ), '{}') AS member_group_ids,
      COALESCE(ARRAY(
        WITH RECURSIVE user_all_groups AS (
          SELECT ug.group_id, g.provider
          FROM auth.user_groups_v2 ug
          JOIN auth.groups g ON g.id = ug.group_id
          WHERE ug.user_id = u.id
          UNION
          SELECT gg.parent_group_id, g_parent.provider
          FROM auth.group_groups_v2 gg
          JOIN auth.groups g_parent ON g_parent.id = gg.parent_group_id
          JOIN user_all_groups ag ON gg.child_group_id = ag.group_id
          WHERE g_parent.provider = ag.provider
        )
        SELECT DISTINCT g.name
        FROM auth.groups g
        LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = u.id
        LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
        LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id AND ug.provider = g.provider
        WHERE gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL
        ORDER BY g.name
      ), '{}') AS manages
      ,
      COALESCE(ARRAY(
        WITH RECURSIVE user_all_groups AS (
          SELECT ug.group_id, g.provider
          FROM auth.user_groups_v2 ug
          JOIN auth.groups g ON g.id = ug.group_id
          WHERE ug.user_id = u.id
          UNION
          SELECT gg.parent_group_id, g_parent.provider
          FROM auth.group_groups_v2 gg
          JOIN auth.groups g_parent ON g_parent.id = gg.parent_group_id
          JOIN user_all_groups ag ON gg.child_group_id = ag.group_id
          WHERE g_parent.provider = ag.provider
        )
        SELECT managed.id
        FROM (
          SELECT DISTINCT g.id, g.name
          FROM auth.groups g
          LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = u.id
          LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
          LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id AND ug.provider = g.provider
          WHERE gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL
        ) managed
        ORDER BY managed.name
      ), '{}') AS manages_group_ids
  FROM auth.users u
  ${userIpaDataJoin}
  WHERE ${whereClause}`;
  if (rows.length === 0) return null;
  return buildUser(rows[0]!);
};

/**
 * Get a user by UID (minimal info for access checks).
 */
export const getByUid = async (params: { uid: string }): Promise<{ id: string; roles: Role[] } | null> => {
  const rows: DbRow[] = await sql`SELECT id, provider, profile, admin FROM auth.users WHERE uid = ${params.uid}`;
  if (rows.length === 0) return null;
  const { provider, profile } = resolveProviderProfile(rows[0]!);
  const roles = buildRoles({
    provider,
    profile,
    memberofGroup: [],
    manages: [],
    admin: resolveEffectiveAdminState({
      provider,
      storedAdmin: Boolean(rows[0]!.admin),
    }),
  });
  return { id: rows[0]!.id as string, roles };
};

// ==========================
// READ: list (paginated, without relations)
// ==========================

export type ListParams = {
  uids?: string[];
  search?: string;
  provider?: UserProvider;
  profile?: UserProfile;
  page?: number;
  perPage?: number;
};

export type ListResult = {
  users: BaseUser[];
  total: number;
  pagination: PaginationResponse;
};

/**
 * List users with pagination. Returns BaseUser without group relations.
 */
export const list = async (params: ListParams): Promise<ListResult> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${freeipa.util.escapeLike(params.search.toLowerCase())}%` : null;
  const uids = params.uids;

  // If uids filter is provided but empty, return empty result immediately
  if (uids && uids.length === 0) {
    return {
      users: [],
      total: 0,
      pagination: {
        page,
        per_page: perPage,
        total: 0,
        total_pages: 0,
        has_next: false,
      },
    };
  }

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [sql`TRUE`];
  if (uids) {
    conditions.push(sql`uid = ANY(${toPgTextArray(uids)}::text[])`);
  }
  if (params.provider) {
    conditions.push(sql`provider = ${params.provider}`);
  }
  if (params.profile) {
    conditions.push(sql`profile = ${params.profile}`);
  }
  if (search) {
    conditions.push(sql`(
      LOWER(uid) LIKE ${search} ESCAPE '\\' OR
      LOWER(display_name) LIKE ${search} ESCAPE '\\' OR
      LOWER(given_name) LIKE ${search} ESCAPE '\\' OR
      LOWER(sn) LIKE ${search} ESCAPE '\\' OR
      LOWER(mail) LIKE ${search} ESCAPE '\\'
    )`);
  }

  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const countRows: DbRow[] = await sql`SELECT COUNT(*)::int as count FROM auth.users WHERE ${where}`;
  const total = (countRows[0]?.count as number) ?? 0;
  const totalPages = Math.ceil(total / perPage);

  const rows: DbRow[] = await sql`
    SELECT u.*,
      EXISTS(
        SELECT 1
        FROM auth.user_groups_v2 ug_admin
        JOIN auth.groups g_admin ON g_admin.id = ug_admin.group_id
        WHERE ug_admin.user_id = u.id
          AND g_admin.provider = 'ipa'
          AND g_admin.name = ANY(${toPgTextArray(getFreeIpaConfigSync().groupsAdmin)}::text[])
      ) AS effective_admin
    FROM auth.users u
    WHERE ${where}
    ORDER BY uid
    LIMIT ${perPage} OFFSET ${offset}`;

  const users = rows.map(buildBaseUser);

  return {
    users,
    total,
    pagination: {
      page,
      per_page: perPage,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
    },
  };
};

// ==========================
// READ: getGroups (user's group memberships)
// ==========================

/**
 * Get groups a user belongs to.
 * @param recursive - If true, includes groups via nested group membership (default: false)
 */
export const getGroups = async (params: { id: string; recursive?: boolean }): Promise<string[]> => {
  if (params.recursive) {
    const rows: DbRow[] = await sql`
      WITH RECURSIVE all_groups AS (
        SELECT ug.group_id
        FROM auth.user_groups_v2 ug
        JOIN auth.groups g ON g.id = ug.group_id
        WHERE ug.user_id = ${params.id} AND g.provider = 'ipa'
        UNION
        SELECT gg.parent_group_id
        FROM auth.group_groups_v2 gg
        JOIN auth.groups g_parent ON g_parent.id = gg.parent_group_id
        JOIN all_groups ag ON gg.child_group_id = ag.group_id
        WHERE g_parent.provider = 'ipa'
      )
      SELECT g.name
      FROM all_groups ag
      JOIN auth.groups g ON g.id = ag.group_id
      ORDER BY g.name`;
    return rows.map((r) => r.name as string);
  }

  const rows: DbRow[] = await sql`
    SELECT g.name
    FROM auth.user_groups_v2 ug
    JOIN auth.groups g ON g.id = ug.group_id
    WHERE ug.user_id = ${params.id} AND g.provider = 'ipa'
    ORDER BY g.name
  `;
  return rows.map((r) => r.name as string);
};

// ==========================
// READ: getManagedGroups (groups user can manage)
// ==========================

/**
 * Get groups a user can manage (directly or via manager groups).
 * @param recursive - If true, traverses group hierarchy for transitive management (default: true)
 */
export const getManagedGroups = async (params: { id: string; recursive?: boolean }): Promise<string[]> => {
  if (params.recursive === false) {
    const rows: DbRow[] = await sql`
      SELECT DISTINCT g.name
      FROM auth.groups g
      LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = ${params.id}
      LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
      LEFT JOIN auth.user_groups_v2 ug ON ug.group_id = gmg.manager_group_id AND ug.user_id = ${params.id}
      LEFT JOIN auth.groups g_manager ON g_manager.id = gmg.manager_group_id
      WHERE g.provider = 'ipa'
        AND (gmu.user_id IS NOT NULL OR (ug.user_id IS NOT NULL AND g_manager.provider = 'ipa'))
      ORDER BY g.name`;
    return rows.map((r) => r.name as string);
  }

  const rows: DbRow[] = await sql`
    WITH RECURSIVE user_all_groups AS (
      SELECT ug.group_id
      FROM auth.user_groups_v2 ug
      JOIN auth.groups g ON g.id = ug.group_id
      WHERE ug.user_id = ${params.id} AND g.provider = 'ipa'
      UNION
      SELECT gg.parent_group_id
      FROM auth.group_groups_v2 gg
      JOIN auth.groups g_parent ON g_parent.id = gg.parent_group_id
      JOIN user_all_groups ag ON gg.child_group_id = ag.group_id
      WHERE g_parent.provider = 'ipa'
    )
    SELECT DISTINCT g.name
    FROM auth.groups g
    LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = ${params.id}
    LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
    LEFT JOIN user_all_groups ug ON ug.group_id = gmg.manager_group_id
    WHERE g.provider = 'ipa' AND (gmu.user_id IS NOT NULL OR ug.group_id IS NOT NULL)
    ORDER BY g.name`;
  return rows.map((r) => r.name as string);
};

// ==========================
// Internal builders
// ==========================

/**
 * Builds the lightweight user DTO used in list/search responses.
 */
const buildBaseUser = (row: DbRow): BaseUser => {
  const { provider, profile } = resolveProviderProfile(row);
  const displayName = (row.display_name as string) ?? "";
  const mail = (row.mail as string) ?? null;
  const roles = buildRoles({
    provider,
    profile,
    memberofGroup: [],
    manages: [],
    admin: resolveEffectiveAdminState({
      provider,
      storedAdmin: Boolean(row.effective_admin ?? row.admin),
    }),
  });
  return {
    id: row.id as string,
    uid: row.uid as string,
    roles,
    provider,
    profile,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    displayName: displayName || (profile === "guest" && mail ? mail : ""),
    mail,
  };
};

/**
 * Builds the canonical rich user DTO used for profile/detail views and session context.
 */
const buildUser = (row: DbRow): User => {
  const { provider, profile } = resolveProviderProfile(row);
  const displayName = (row.display_name as string) ?? "";
  const mail = (row.mail as string) ?? null;
  const memberofGroup = (row.member_groups as string[]) ?? [];
  const memberofGroupIds = (row.member_group_ids as string[]) ?? [];
  const manages = (row.manages as string[]) ?? [];
  const managesGroupIds = (row.manages_group_ids as string[]) ?? [];
  const roles = buildRoles({
    provider,
    profile,
    memberofGroup,
    manages,
    admin: resolveEffectiveAdminState({
      provider,
      storedAdmin: Boolean(row.admin),
      memberofGroup,
    }),
  });
  const common = {
    id: row.id as string,
    uid: row.uid as string,
    roles,
    profile,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    displayName: displayName || (profile === "guest" && mail ? mail : ""),
    mail,
    accountExpires: resolveAccountExpires(row)?.toISOString() ?? null,
    lastLoginLocal: row.last_login_local ? (row.last_login_local as Date).toISOString() : null,
    memberofGroup,
    memberofGroupIds,
    manages,
    managesGroupIds,
  };

  if (provider === "ipa") {
    return {
      ...common,
      provider: "ipa",
      ipa: buildIpaUserData(row) ?? emptyIpaUserData(),
    };
  }

  return {
    ...common,
    provider: "local",
    ipa: null,
  };
};

// ==========================
// MUTATION: addIpa (create FreeIPA user)
// ==========================

/** Generate random lowercase abbreviation of specified length */
export const generateAbbreviation = (length: number): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const limit = Math.floor(256 / chars.length) * chars.length;
  let value = "";
  while (value.length < length) {
    const bytes = new Uint8Array(length - value.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      value += chars[byte % chars.length]!;
      if (value.length === length) break;
    }
  }
  return value;
};

/** Check if a UID exists in auth.users */
const uidExists = async (uid: string): Promise<boolean> => {
  const rows: DbRow[] = await sql`
    SELECT 1 FROM auth.users
    WHERE uid = ${uid}
    LIMIT 1
  `;
  return rows.length > 0;
};

/** Generate a unique abbreviation that doesn't exist in the database */
export const generateUniqueAbbreviation = async (length: number, maxAttempts = 100): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    const abbr = generateAbbreviation(length);
    if (!(await uidExists(abbr))) {
      return abbr;
    }
  }
  throw new Error(`Failed to generate unique abbreviation after ${maxAttempts} attempts`);
};

/** Generate a secure random password that meets FreeIPA policy requirements */
const generatePassword = (): string => {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const special = "!@#$%&*_-+=?";
  const all = lower + upper + digits + special;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const password = [
    lower[bytes[0]! % lower.length],
    upper[bytes[1]! % upper.length],
    digits[bytes[2]! % digits.length],
    special[bytes[3]! % special.length],
    ...Array.from(bytes.slice(4), (b) => all[b % all.length]),
  ];

  for (let i = password.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length]! % (i + 1);
    [password[i], password[j]] = [password[j]!, password[i]!];
  }

  return password.join("");
};

/** Calculate account expiration date based on config */
const calculateAccountExpiration = async (): Promise<Date | null> => {
  const expiresDays = await settings.get<number | null>("user.account.ipa_expires_days");
  const days = expiresDays;

  if (days && days > 0) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    return expiry;
  }

  return null;
};

export type AddIpaResult = {
  id: string;
  uid: string;
  accountExpires: string | null;
  /** The temporary password - only for internal use (email sending), not exposed to client */
  _temporaryPassword: string;
};

/**
 * Create a new user in FreeIPA and the local database.
 * UID = existing guest UID (if promoting) or new abbreviation.
 */
export const addIpa = async (params: {
  ipaSession: string;
  data: CreateUser;
  profile?: UserProfile;
  accountExpires?: Date | null;
}): Promise<MutationResult<AddIpaResult>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, data } = params;
  const { email, givenname, sn } = data;
  const targetProfile = params.profile ?? "user";

  const displayName = data.displayName || `${givenname} ${sn}`;

  // Check if a local account with this email already exists (provider switch case)
  const existingLocalRows: DbRow[] = await sql`
    SELECT id, uid FROM auth.users WHERE mail = ${email} AND provider = 'local'
  `;

  // Use existing guest UID or generate a new one
  let uid: string;
  if (existingLocalRows.length > 0) {
    uid = existingLocalRows[0]!.uid as string;
  } else {
    try {
      const abbrLen = await settings.get<number>("user.abbr_length");
      uid = await generateUniqueAbbreviation(abbrLen);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to generate UID",
        status: 500,
      };
    }
  }

  if ((await uidExists(uid)) && existingLocalRows.length === 0) {
    return { ok: false, error: `UID '${uid}' already exists`, status: 400 };
  }

  const temporaryPassword = generatePassword();
  const accountExpiry = params.accountExpires === undefined ? await calculateAccountExpiration() : params.accountExpires;
  const now = new Date();
  const legacyColumns = legacyAccountColumnsFromCanonical({
    provider: "ipa",
    profile: targetProfile,
    accountExpires: accountExpiry,
  });

  const ipaOpts: Record<string, unknown> = {
    givenname,
    sn,
    cn: displayName,
    displayname: displayName,
    mail: email,
    userpassword: temporaryPassword,
  };
  if (accountExpiry) {
    ipaOpts.krbprincipalexpiration = freeipa.util.toGeneralizedTime(accountExpiry);
  }

  const response = await freeipa.client.call({ url: getIpaUrl(), ipaSession, method: "user_add", args: [uid], options: ipaOpts });
  if (response.error) {
    const code = response.error.code;
    if (code === 4001)
      return {
        ok: false,
        error: "IPA session expired. Please log in again.",
        status: 401,
      };
    if (code === 4301)
      return {
        ok: false,
        error: "You don't have permission to create users.",
        status: 403,
      };
    return {
      ok: false,
      error: response.error.message || "Failed to create user.",
      status: 400,
    };
  }

  // Extract uidNumber from IPA response
  const ipaResult = response.result?.result as Record<string, unknown> | undefined;
  const uidNumber = ipaResult ? freeipa.util.num(ipaResult.uidnumber) : null;

  let id: string;
  if (existingLocalRows.length > 0) {
    // Provider switch: update existing local account to IPA user
    const guestId = existingLocalRows[0]!.id as string;
    const updateRows: DbRow[] = await sql`
      UPDATE auth.users SET
        realm = ${legacyColumns.realm},
        provider = 'ipa',
        profile = ${targetProfile},
        admin = false,
        given_name = ${givenname},
        sn = ${sn},
        display_name = ${displayName},
        mail = ${email},
        account_expires = ${accountExpiry},
        ipa_account_expires = ${legacyColumns.ipaAccountExpires},
        guest_expires_at = ${legacyColumns.guestExpiresAt}
      WHERE id = ${guestId}
      RETURNING id
    `;
    id = updateRows[0]!.id as string;
    await upsertUserIpaData({
      userId: id,
      uidNumber,
      passwordExpires: now,
      syncedAt: now,
    });
    await session.deleteAllForUser(guestId);
  } else {
    // New user: insert
    const insertRows: DbRow[] = await sql`
      INSERT INTO auth.users (uid, realm, provider, profile, admin, given_name, sn, display_name, mail, account_expires, ipa_account_expires, guest_expires_at)
      VALUES (${uid}, ${legacyColumns.realm}, 'ipa', ${targetProfile}, false, ${givenname}, ${sn}, ${displayName}, ${email}, ${accountExpiry}, ${legacyColumns.ipaAccountExpires}, ${legacyColumns.guestExpiresAt})
      ON CONFLICT (uid) DO UPDATE SET
        realm = EXCLUDED.realm,
        provider = EXCLUDED.provider,
        profile = EXCLUDED.profile,
        admin = false,
        given_name = EXCLUDED.given_name,
        sn = EXCLUDED.sn,
        display_name = EXCLUDED.display_name,
        mail = EXCLUDED.mail,
        account_expires = EXCLUDED.account_expires,
        ipa_account_expires = EXCLUDED.ipa_account_expires,
        guest_expires_at = EXCLUDED.guest_expires_at
      RETURNING id
    `;
    id = insertRows[0]!.id as string;
    await upsertUserIpaData({
      userId: id,
      uidNumber,
      passwordExpires: now,
      syncedAt: now,
    });
  }

  return {
    ok: true,
    data: {
      id,
      uid,
      accountExpires: accountExpiry ? accountExpiry.toISOString() : null,
      _temporaryPassword: temporaryPassword,
    },
  };
};

// ==========================
// MUTATION: updateProfile
// ==========================

/**
 * Update user profile. Handles all realms internally.
 */
export const updateProfile = async (params: {
  ipaSession?: string | null;
  id: string;
  data: IpaPatchData;
}): Promise<MutationResult<void>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id, data } = params;

  const userRows: DbRow[] = await sql`SELECT uid, provider, profile FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;
  const { provider } = resolveProviderProfile(userRows[0]!);

  if (provider === "ipa") {
    if (!ipaSession) {
      return {
        ok: false,
        error: "IPA session required to update IPA user",
        status: 400,
      };
    }

    const ipaOptions: Record<string, unknown> = {
    };
    if (data.givenname !== undefined) ipaOptions.givenname = data.givenname;
    if (data.sn !== undefined) ipaOptions.sn = data.sn;
    if (data.displayName !== undefined) ipaOptions.displayname = data.displayName;
    if (data.mail !== undefined) ipaOptions.mail = data.mail || "";
    if (data.ipa?.phone !== undefined) ipaOptions.telephonenumber = data.ipa.phone || "";
    if (data.ipa?.address?.street !== undefined) ipaOptions.street = data.ipa.address.street || "";
    if (data.ipa?.address?.postalCode !== undefined) ipaOptions.postalcode = data.ipa.address.postalCode || "";
    if (data.ipa?.address?.city !== undefined) ipaOptions.l = data.ipa.address.city || "";
    if (data.ipa?.address?.state !== undefined) ipaOptions.st = data.ipa.address.state || "";
    if (data.ipa?.sshPublicKeys !== undefined) {
      ipaOptions.ipasshpubkey = data.ipa.sshPublicKeys.length > 0 ? data.ipa.sshPublicKeys : "";
    }

    const response = await freeipa.client.call({ url: getIpaUrl(), ipaSession, method: "user_mod", args: [uid], options: ipaOptions });
    if (response.error) {
      return {
        ok: false,
        error: response.error.message ?? "Failed to update user in FreeIPA",
        status: freeipa.util.mapIpaErrorCode(response.error.code),
      };
    }

    const result = response.result?.result as Record<string, unknown> | undefined;
    await upsertUserIpaData({
      userId: id,
      phone: data.ipa?.phone,
      street: data.ipa?.address?.street,
      postalCode: data.ipa?.address?.postalCode,
      city: data.ipa?.address?.city,
      state: data.ipa?.address?.state,
      sshPublicKeys:
        data.ipa?.sshPublicKeys !== undefined
          ? Array.isArray(result?.ipasshpubkey)
            ? (result?.ipasshpubkey as string[])
            : []
          : undefined,
      sshFingerprints:
        data.ipa?.sshPublicKeys !== undefined
          ? Array.isArray(result?.sshpubkeyfp)
            ? (result?.sshpubkeyfp as string[])
            : []
          : undefined,
      syncedAt: new Date(),
    });
  }

  await sql`
    UPDATE auth.users
    SET given_name = CASE WHEN ${data.givenname !== undefined} THEN ${data.givenname ?? ""} ELSE given_name END,
        sn = CASE WHEN ${data.sn !== undefined} THEN ${data.sn ?? ""} ELSE sn END,
        display_name = CASE WHEN ${data.displayName !== undefined} THEN ${data.displayName ?? ""} ELSE display_name END
    WHERE id = ${id}
  `;

  if (data.mail !== undefined) {
    await sql`UPDATE auth.users SET mail = ${data.mail || null} WHERE id = ${id}`;
  }

  return { ok: true, data: undefined };
};

// ==========================
// MUTATION: updateSshKeys
// ==========================

/**
 * Replace all SSH public keys for a user.
 */
export const updateSshKeys = async (params: { ipaSession: string; id: string; keys: string[] }): Promise<MutationResult<void>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id, keys } = params;

  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id} AND provider = 'ipa'`;
  if (userRows.length === 0) {
    return {
      ok: false,
      error: "User not found or not an IPA user",
      status: 404,
    };
  }
  const uid = userRows[0]!.uid as string;

  // FreeIPA: empty string clears all keys, array sets them
  const response = await freeipa.client.call({
    url: getIpaUrl(),
    ipaSession,
    method: "user_mod",
    args: [uid],
    options: { ipasshpubkey: keys.length > 0 ? keys : "" },
  });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to update SSH keys",
      status: freeipa.util.mapIpaErrorCode(response.error.code),
    };
  }

  // Read back fingerprints from FreeIPA response
  const result = response.result?.result as Record<string, unknown> | undefined;
  const newKeys = Array.isArray(result?.ipasshpubkey) ? (result.ipasshpubkey as string[]) : [];
  const newFingerprints = Array.isArray(result?.sshpubkeyfp) ? (result.sshpubkeyfp as string[]) : [];

  await sql`
    INSERT INTO auth.user_ipa_data (user_id, ssh_public_keys, ssh_fingerprints, synced_at)
    VALUES (${id}, ${freeipa.util.toPgTextArray(newKeys)}::text[], ${freeipa.util.toPgTextArray(newFingerprints)}::text[], now())
    ON CONFLICT (user_id) DO UPDATE SET
      ssh_public_keys = EXCLUDED.ssh_public_keys,
      ssh_fingerprints = EXCLUDED.ssh_fingerprints,
      synced_at = EXCLUDED.synced_at
  `;

  return { ok: true, data: undefined };
};

// ==========================
// MUTATION: resetPassword
// ==========================

/**
 * Reset a user's password to a new random password.
 */
export const resetPassword = async (params: {
  ipaSession: string;
  /** User ID (database UUID) */
  id: string;
}): Promise<MutationResult<{ password: string }>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id } = params;

  // Look up uid from database
  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;

  const newPassword = generatePassword();

  const response = await freeipa.client.call({
    url: getIpaUrl(),
    ipaSession,
    method: "user_mod",
    args: [uid],
    options: { userpassword: newPassword },
  });

  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to reset password",
      status: freeipa.util.mapIpaErrorCode(response.error.code),
    };
  }

  // Update password expiry in local DB (password is now "expired" / temporary)
  await sql`
    INSERT INTO auth.user_ipa_data (user_id, ipa_password_expires, synced_at)
    VALUES (${id}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      ipa_password_expires = EXCLUDED.ipa_password_expires,
      synced_at = EXCLUDED.synced_at
  `;

  return { ok: true, data: { password: newPassword } };
};

// ==========================
// MUTATION: setExpiry
// ==========================

/**
 * Set or remove account expiration date.
 */
export const setExpiry = async (params: {
  ipaSession: string;
  /** User ID (database UUID) */
  id: string;
  expiryDate: string | null;
}): Promise<MutationResult<void>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id, expiryDate } = params;

  // Look up uid from database
  const userRows: DbRow[] = await sql`SELECT uid, provider, profile FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;
  const { provider, profile } = resolveProviderProfile(userRows[0]!);

  if (provider === "local" && profile === "guest") {
    const guestExpiry = expiryDate ? new Date(expiryDate) : null;
    if (guestExpiry) guestExpiry.setUTCHours(23, 59, 59, 0);
    const legacyColumns = legacyAccountColumnsFromCanonical({
      provider: "local",
      profile,
      accountExpires: guestExpiry,
    });
    await sql`
      UPDATE auth.users
      SET account_expires = ${guestExpiry},
          ipa_account_expires = ${legacyColumns.ipaAccountExpires},
          guest_expires_at = ${legacyColumns.guestExpiresAt}
      WHERE id = ${id}
    `;
    return { ok: true, data: undefined };
  }

  let dbExpiry: Date | null = null;
  const response = await (async () => {
    if (expiryDate) {
      const date = new Date(expiryDate);
      date.setUTCHours(23, 59, 59, 0);
      const ipaExpiry = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
      dbExpiry = date;
      return freeipa.client.call({
        url: getIpaUrl(),
        ipaSession,
        method: "user_mod",
        args: [uid],
        options: { krbprincipalexpiration: ipaExpiry },
      });
    }
    return freeipa.client.call({
      url: getIpaUrl(),
      ipaSession,
      method: "user_mod",
      args: [uid],
      options: { krbprincipalexpiration: null },
    });
  })();

  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to update account expiry",
      status: freeipa.util.mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    UPDATE auth.users
    SET account_expires = ${dbExpiry},
        ipa_account_expires = ${dbExpiry},
        guest_expires_at = NULL
    WHERE id = ${id}
  `;
  await sql`
    INSERT INTO auth.user_ipa_data (user_id, synced_at)
    VALUES (${id}, now())
    ON CONFLICT (user_id) DO UPDATE SET synced_at = EXCLUDED.synced_at
  `;

  return { ok: true, data: undefined };
};

// ==========================
// MUTATION: demoteToGuest
// ==========================

/**
 * Demote IPA user to guest (removes from FreeIPA, keeps in local DB as guest).
 */
export const demoteToGuest = async (params: {
  ipaSession: string;
  /** User ID (database UUID) */
  id: string;
  actor: { userId: string; uid: string };
}): Promise<MutationResult<void>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id, actor } = params;

  const userRows: DbRow[] = await sql`
    SELECT uid, mail, display_name, provider, profile
    FROM auth.users
    WHERE id = ${id} AND provider = 'ipa'
  `;
  if (userRows.length === 0) {
    return {
      ok: false,
      error: "User not found or not an IPA user",
      status: 404,
    };
  }
  const { provider: previousProvider, profile: previousProfile } = resolveProviderProfile(userRows[0]!);
  const uid = userRows[0]!.uid as string;
  const mail = (userRows[0]!.mail as string) ?? null;
  const displayName = (userRows[0]!.display_name as string) ?? null;
  const guestExpiresDays = await settings.get<number | null>("user.account.local_guest_expires_days");
  const accountExpires = guestExpiresDays && guestExpiresDays > 0 ? new Date(Date.now() + guestExpiresDays * 24 * 60 * 60 * 1000) : null;
  const legacyColumns = legacyAccountColumnsFromCanonical({
    provider: "local",
    profile: "guest",
    accountExpires,
  });

  const response = await freeipa.client.call({ url: getIpaUrl(), ipaSession, method: "user_del", args: [uid], options: {} });
  const ipaDeleteMessage = (response.error?.message ?? "").toLowerCase();
  const ipaDeleteNotFound = ipaDeleteMessage.includes("not found") || ipaDeleteMessage.includes("does not exist");
  if (response.error && !ipaDeleteNotFound) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to delete user from FreeIPA",
      status: freeipa.util.mapIpaErrorCode(response.error.code),
    };
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE auth.users
      SET realm = ${legacyColumns.realm}, provider = 'local', profile = 'guest', admin = false,
          account_expires = ${accountExpires},
          ipa_account_expires = ${legacyColumns.ipaAccountExpires},
          guest_expires_at = ${legacyColumns.guestExpiresAt}
      WHERE id = ${id}
    `;
    await tx`DELETE FROM auth.user_ipa_data WHERE user_id = ${id}`;

    await tx`
      DELETE FROM auth.user_groups_v2
      WHERE user_id = ${id}
        AND group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
    `;
    await tx`
      DELETE FROM auth.group_manager_users_v2
      WHERE user_id = ${id}
        AND group_id IN (SELECT id FROM auth.groups WHERE provider = 'ipa')
    `;
    await writeDeletedAccountAudit({
      db: tx,
      userId: id,
      uid,
      mail,
      displayName,
      previousProvider,
      previousProfile,
      reason: "manual_demote",
      meta: {
        actorUserId: actor.userId,
        actorUid: actor.uid,
        guestExpiresAt: accountExpires?.toISOString() ?? null,
        freeIpaUserAlreadyMissing: ipaDeleteNotFound,
      },
    });
  });
  try {
    await session.deleteAllForUser(id);
  } catch (error) {
    log.warn("Failed to revoke sessions after manual demotion", {
      userId: id,
      uid,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, data: undefined };
};

// ==========================
// MUTATION: delete
// ==========================

/**
 * Permanently delete user (from FreeIPA if applicable, and from local DB).
 */
export const deleteUser = async (params: {
  ipaSession?: string | null;
  /** User ID (database UUID) */
  id: string;
  actor: { userId: string; uid: string };
}): Promise<MutationResult<void>> => {
  const unavailable = ensureFreeIpaMutationAvailable();
  if (unavailable) return unavailable;
  const { ipaSession, id, actor } = params;

  const userRows: DbRow[] = await sql`
    SELECT uid, provider, profile, mail, display_name
    FROM auth.users
    WHERE id = ${id}
  `;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;
  const { provider, profile } = resolveProviderProfile(userRows[0]!);
  const mail = (userRows[0]!.mail as string) ?? null;
  const displayName = (userRows[0]!.display_name as string) ?? null;
  let ipaDeleteNotFound = false;

  if (provider === "ipa") {
    if (!ipaSession) {
      return {
        ok: false,
        error: "IPA session required to delete IPA user",
        status: 400,
      };
    }
    const response = await freeipa.client.call({ url: getIpaUrl(), ipaSession, method: "user_del", args: [uid], options: {} });
    const ipaDeleteMessage = (response.error?.message ?? "").toLowerCase();
    ipaDeleteNotFound = ipaDeleteMessage.includes("not found") || ipaDeleteMessage.includes("does not exist");
    if (response.error && !ipaDeleteNotFound) {
      return {
        ok: false,
        error: response.error.message ?? "Failed to delete user from FreeIPA",
        status: freeipa.util.mapIpaErrorCode(response.error.code),
      };
    }
  }

  await sql.begin(async (tx) => {
    await writeDeletedAccountAudit({
      db: tx,
      userId: id,
      uid,
      mail,
      displayName,
      previousProvider: provider,
      previousProfile: profile,
      reason: "manual_delete",
      meta: {
        actorUserId: actor.userId,
        actorUid: actor.uid,
        deletedFromFreeIpa: provider === "ipa",
        freeIpaUserAlreadyMissing: provider === "ipa" ? ipaDeleteNotFound : false,
      },
    });
    await tx`DELETE FROM auth.users WHERE id = ${id}`;
  });
  try {
    await session.deleteAllForUser(id);
  } catch (error) {
    log.warn("Failed to revoke sessions after manual deletion", {
      userId: id,
      uid,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, data: undefined };
};
