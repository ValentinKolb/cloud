import { sql } from "bun";
import { env } from "@valentinkolb/cloud-core/config/env";
import * as settings from "@valentinkolb/cloud-core/services/settings";
import type {
  BaseUser,
  FullUser,
  SessionUser,
  MutationResult,
  PaginationResponse,
  Role,
} from "@valentinkolb/cloud-contracts/shared";

type Realm = "ipa" | "ipa-limited" | "guest";
type CreateUser = {
  email: string;
  givenname: string;
  sn: string;
  displayName?: string;
  autoSendNotification?: boolean;
  requestId?: string;
};
import { call, mapIpaErrorCode, num, toPgTextArray, type DbRow } from "./lib";
import { session } from "@valentinkolb/cloud-core/services/session";

// ==========================
// Helper functions
// ==========================

/**
 * Build roles array from user data.
 * Realm roles are mutually exclusive (ipa, ipa-limited, guest).
 * Other roles (admin, group-manager) can be combined.
 */
const buildRoles = (params: { realm: string; memberofGroup: string[]; manages: string[] }): Role[] => {
  const { realm, memberofGroup, manages } = params;
  const roles: Role[] = [];

  // Realm role (mutually exclusive)
  if (realm === "ipa") {
    roles.push("ipa");
  } else if (realm === "ipa-limited") {
    roles.push("ipa-limited");
  } else {
    roles.push("guest");
  }

  // Guest and ipa-limited users don't get additional roles
  if (realm === "guest" || realm === "ipa-limited") {
    return roles;
  }

  // Admin role (member of any GROUPS_ADMIN group)
  if (env.GROUPS_ADMIN.some((g) => memberofGroup.includes(g))) {
    roles.push("admin");
  }

  // Group manager role
  if (manages.length > 0) {
    roles.push("group-manager");
  }

  return roles;
};

// ==========================
// READ: get (single user with relations)
// ==========================

/**
 * Get a user by ID or UID. Returns SessionUser with group relations and computed roles.
 * Used by auth middleware and detail pages.
 */
export const get = async (params: { id: string } | { uid: string }): Promise<SessionUser | null> => {
  const whereClause = "id" in params ? sql`u.id = ${params.id}` : sql`u.uid = ${params.uid}`;

  const rows: DbRow[] = await sql`
    SELECT u.*,
      COALESCE(ARRAY(SELECT group_cn FROM auth.user_groups WHERE user_id = u.id), '{}') AS member_groups,
      COALESCE(ARRAY(
        WITH RECURSIVE user_all_groups AS (
          SELECT group_cn FROM auth.user_groups WHERE user_id = u.id
          UNION
          SELECT gg.parent_cn FROM auth.group_groups gg
          JOIN user_all_groups ag ON gg.child_cn = ag.group_cn
        )
        SELECT DISTINCT g.cn FROM auth.groups g
        LEFT JOIN auth.group_manager_users gmu ON gmu.group_cn = g.cn AND gmu.user_id = u.id
        LEFT JOIN auth.group_manager_groups gmg ON gmg.group_cn = g.cn
        LEFT JOIN user_all_groups ug ON ug.group_cn = gmg.manager_cn
        WHERE gmu.user_id IS NOT NULL OR ug.group_cn IS NOT NULL
      ), '{}') AS manages
    FROM auth.users u WHERE ${whereClause}`;
  if (rows.length === 0) return null;
  return buildSessionUser(rows[0]!);
};

/**
 * Get a user by UID (minimal info for access checks).
 */
export const getByUid = async (params: { uid: string }): Promise<{ id: string; roles: Role[] } | null> => {
  const rows: DbRow[] = await sql`SELECT id, realm FROM auth.users WHERE uid = ${params.uid}`;
  if (rows.length === 0) return null;
  const realm = rows[0]!.realm as string;
  // For minimal lookup, we only have realm - no groups/manages info
  const roles = buildRoles({ realm, memberofGroup: [], manages: [] });
  return { id: rows[0]!.id as string, roles };
};

// ==========================
// READ: list (paginated, without relations)
// ==========================

export type ListParams = {
  uids?: string[];
  search?: string;
  realm?: Realm | Realm[];
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
  const search = params.search ? `%${params.search.toLowerCase()}%` : null;
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

  // Build realm filter
  const realms = params.realm ? (Array.isArray(params.realm) ? params.realm : [params.realm]) : ["ipa", "ipa-limited", "guest"];

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [sql`realm IN ${sql(realms)}`];
  if (uids) {
    conditions.push(sql`uid IN ${sql(uids)}`);
  }
  if (search) {
    conditions.push(sql`(
      LOWER(uid) LIKE ${search} OR
      LOWER(display_name) LIKE ${search} OR
      LOWER(given_name) LIKE ${search} OR
      LOWER(sn) LIKE ${search} OR
      LOWER(mail) LIKE ${search}
    )`);
  }

  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const countRows: DbRow[] = await sql`SELECT COUNT(*)::int as count FROM auth.users WHERE ${where}`;
  const total = (countRows[0]?.count as number) ?? 0;
  const totalPages = Math.ceil(total / perPage);

  const rows: DbRow[] = await sql`
    SELECT u.* FROM auth.users u
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
    // Recursive: use CTE to traverse group_groups
    const rows: DbRow[] = await sql`
      WITH RECURSIVE all_groups AS (
        -- Direct memberships
        SELECT group_cn FROM auth.user_groups WHERE user_id = ${params.id}
        UNION
        -- Indirect memberships via group hierarchy
        SELECT gg.parent_cn
        FROM auth.group_groups gg
        JOIN all_groups ag ON gg.child_cn = ag.group_cn
      )
      SELECT group_cn FROM all_groups`;
    return rows.map((r) => r.group_cn as string);
  }

  // Direct memberships only
  const rows: DbRow[] = await sql`SELECT group_cn FROM auth.user_groups WHERE user_id = ${params.id}`;
  return rows.map((r) => r.group_cn as string);
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
    // Direct manager assignments + direct group memberships only
    const rows: DbRow[] = await sql`
      SELECT DISTINCT g.cn FROM auth.groups g
      LEFT JOIN auth.group_manager_users gmu ON gmu.group_cn = g.cn AND gmu.user_id = ${params.id}
      LEFT JOIN auth.group_manager_groups gmg ON gmg.group_cn = g.cn
      LEFT JOIN auth.user_groups ug ON ug.group_cn = gmg.manager_cn AND ug.user_id = ${params.id}
      WHERE gmu.user_id IS NOT NULL OR ug.user_id IS NOT NULL`;
    return rows.map((r) => r.cn as string);
  }

  // Recursive (default): consider user's full group hierarchy
  const rows: DbRow[] = await sql`
    WITH RECURSIVE user_all_groups AS (
      SELECT group_cn FROM auth.user_groups WHERE user_id = ${params.id}
      UNION
      SELECT gg.parent_cn FROM auth.group_groups gg
      JOIN user_all_groups ag ON gg.child_cn = ag.group_cn
    )
    SELECT DISTINCT g.cn FROM auth.groups g
    LEFT JOIN auth.group_manager_users gmu ON gmu.group_cn = g.cn AND gmu.user_id = ${params.id}
    LEFT JOIN auth.group_manager_groups gmg ON gmg.group_cn = g.cn
    LEFT JOIN user_all_groups ug ON ug.group_cn = gmg.manager_cn
    WHERE gmu.user_id IS NOT NULL OR ug.group_cn IS NOT NULL`;
  return rows.map((r) => r.cn as string);
};

// ==========================
// Internal builders
// ==========================

/**
 * Builds the lightweight user DTO used in list/search responses.
 */
const buildBaseUser = (row: DbRow): BaseUser => {
  const realm = row.realm as string;
  const displayName = (row.display_name as string) ?? "";
  const mail = (row.mail as string) ?? null;
  // For BaseUser we don't have groups info, so build minimal roles
  const roles = buildRoles({ realm, memberofGroup: [], manages: [] });
  return {
    id: row.id as string,
    uid: row.uid as string,
    roles,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    // For guest users without a display name, use their email
    displayName: displayName || (realm === "guest" && mail ? mail : ""),
    mail,
  };
};

/**
 * Builds the full user DTO used for profile/detail views.
 */
const buildFullUser = (row: DbRow): FullUser => {
  const realm = row.realm as string;
  const displayName = (row.display_name as string) ?? "";
  const mail = (row.mail as string) ?? null;
  const memberofGroup = (row.member_groups as string[]) ?? [];
  const manages = (row.manages as string[]) ?? [];
  const roles = buildRoles({ realm, memberofGroup, manages });
  return {
    id: row.id as string,
    uid: row.uid as string,
    roles,
    givenname: (row.given_name as string) ?? "",
    sn: (row.sn as string) ?? "",
    displayName: displayName || (realm === "guest" && mail ? mail : ""),
    mail,
    phone: (row.phone as string) ?? null,
    uidNumber: (row.uid_number as number) ?? null,
    ipaAccountExpires: row.ipa_account_expires ? (row.ipa_account_expires as Date).toISOString() : null,
    ipaPasswordExpires: row.ipa_password_expires ? (row.ipa_password_expires as Date).toISOString() : null,
    lastLoginIpa: row.last_login_ipa ? (row.last_login_ipa as Date).toISOString() : null,
    lastLoginLocal: row.last_login_local ? (row.last_login_local as Date).toISOString() : null,
    employeeType: (row.employee_type as string) ?? null,
    address: {
      street: (row.addr_street as string) ?? null,
      postalCode: (row.addr_postal_code as string) ?? null,
      city: (row.addr_city as string) ?? null,
      state: (row.addr_state as string) ?? null,
    },
    mobile: (row.mobile as string) ?? null,
    sshPublicKeys: (row.ssh_public_keys as string[]) ?? [],
    sshFingerprints: (row.ssh_fingerprints as string[]) ?? [],
  };
};

/**
 * Builds the session user object including permission-relevant group relations.
 */
const buildSessionUser = (row: DbRow): SessionUser => {
  const realm = row.realm as string;
  const memberofGroup = (row.member_groups as string[]) ?? [];
  const manages = (row.manages as string[]) ?? [];
  const isLimited = realm === "guest" || realm === "ipa-limited";

  const full = buildFullUser(row);
  return {
    ...full,
    // For limited users, clear group relations
    memberofGroup: isLimited ? [] : memberofGroup,
    manages: isLimited ? [] : manages,
  };
};

// ==========================
// MUTATION: addGuest
// ==========================

/**
 * Create a guest user in the local database.
 */
export const addGuest = async (params: {
  email: string;
  givenname?: string;
  sn?: string;
  displayName?: string;
}): Promise<MutationResult<BaseUser>> => {
  let guestUid: string;
  try {
    const abbrLen = await settings.get<number>("user.abbr_length");
    guestUid = await generateUniqueAbbreviation(abbrLen);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to generate UID",
      status: 500,
    };
  }
  const displayName = params.displayName || "";

  try {
    const rows: DbRow[] = await sql`
      INSERT INTO auth.users (uid, realm, mail, given_name, sn, display_name)
      VALUES (${guestUid}, 'guest', ${params.email}, ${params.givenname ?? ""}, ${params.sn ?? ""}, ${displayName})
      RETURNING *
    `;
    return { ok: true, data: buildBaseUser(rows[0]!) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create guest user",
      status: 500,
    };
  }
};

// ==========================
// MUTATION: addIpa (create FreeIPA user)
// ==========================

/** Generate random lowercase abbreviation of specified length */
export const generateAbbreviation = (length: number): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
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
  const expiresDays = await settings.get<number | null>("user.account.expires_days");
  const expiresDay = await settings.get<number | null>("user.account.expires_date_day");
  const expiresMonth = await settings.get<number | null>("user.account.expires_date_month");
  const bufferDays = await settings.get<number>("user.account.expires_date_buffer_days");

  if (expiresDay && expiresMonth) {
    const now = new Date();
    const thisYear = now.getFullYear();
    let expiry = new Date(thisYear, expiresMonth - 1, expiresDay);
    const daysUntil = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil < bufferDays) {
      expiry = new Date(thisYear + 1, expiresMonth - 1, expiresDay);
    }
    return expiry;
  }

  if (expiresDays) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expiresDays);
    return expiry;
  }

  return null;
};

/** Format date to FreeIPA GeneralizedTime format (YYYYMMDDHHMMSSZ) */
const toGeneralizedTime = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}${s}Z`;
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
export const addIpa = async (params: { ipaSession: string; data: CreateUser }): Promise<MutationResult<AddIpaResult>> => {
  const { ipaSession, data } = params;
  const { email, givenname, sn } = data;

  const displayName = data.displayName || `${givenname} ${sn}`;

  // Check if a guest with this email already exists (promotion case)
  const existingGuestRows: DbRow[] = await sql`
    SELECT id, uid FROM auth.users WHERE mail = ${email} AND realm = 'guest'
  `;

  // Use existing guest UID or generate a new one
  let uid: string;
  if (existingGuestRows.length > 0) {
    uid = existingGuestRows[0]!.uid as string;
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

  if ((await uidExists(uid)) && existingGuestRows.length === 0) {
    return { ok: false, error: `UID '${uid}' already exists`, status: 400 };
  }

  const temporaryPassword = generatePassword();
  const accountExpiry = await calculateAccountExpiration();
  const now = new Date();

  const ipaOpts: Record<string, unknown> = {
    givenname,
    sn,
    cn: displayName,
    displayname: displayName,
    mail: email,
    userpassword: temporaryPassword,
  };
  if (accountExpiry) {
    ipaOpts.krbprincipalexpiration = toGeneralizedTime(accountExpiry);
  }

  const response = await call(ipaSession, "user_add", [uid], ipaOpts);
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
  const uidNumber = ipaResult ? num(ipaResult.uidnumber) : null;

  let id: string;
  if (existingGuestRows.length > 0) {
    // Promotion: update existing guest to IPA user
    const guestId = existingGuestRows[0]!.id as string;
    const updateRows: DbRow[] = await sql`
      UPDATE auth.users SET
        uid_number = ${uidNumber},
        realm = 'ipa',
        given_name = ${givenname},
        sn = ${sn},
        display_name = ${displayName},
        ipa_account_expires = ${accountExpiry},
        ipa_password_expires = ${now},
        synced_at = now()
      WHERE id = ${guestId}
      RETURNING id
    `;
    id = updateRows[0]!.id as string;
    await session.deleteAllForUser(guestId);
  } else {
    // New user: insert
    const insertRows: DbRow[] = await sql`
      INSERT INTO auth.users (uid, uid_number, realm, given_name, sn, display_name, mail, ipa_account_expires, ipa_password_expires, synced_at)
      VALUES (${uid}, ${uidNumber}, 'ipa', ${givenname}, ${sn}, ${displayName}, ${email}, ${accountExpiry}, ${now}, now())
      ON CONFLICT (uid) DO UPDATE SET
        uid_number = EXCLUDED.uid_number,
        given_name = EXCLUDED.given_name,
        sn = EXCLUDED.sn,
        display_name = EXCLUDED.display_name,
        mail = EXCLUDED.mail,
        ipa_account_expires = EXCLUDED.ipa_account_expires,
        ipa_password_expires = EXCLUDED.ipa_password_expires,
        synced_at = now()
      RETURNING id
    `;
    id = insertRows[0]!.id as string;
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

/** @deprecated Use addIpa instead */
export const add = async (
  ipaSession: string,
  params: CreateUser,
): Promise<{ ok: true; user: AddIpaResult } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 409 | 500 }> => {
  const result = await addIpa({ ipaSession, data: params });
  if (result.ok) {
    return { ok: true, user: result.data };
  }
  return result;
};

// ==========================
// MUTATION: updateProfile
// ==========================

export type UpdateProfileData = {
  givenname: string;
  sn: string;
  displayName: string;
  mail?: string;
  phone?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  state?: string;
};

/**
 * Update user profile. Handles all realms internally.
 */
export const updateProfile = async (params: {
  ipaSession?: string | null;
  id: string;
  data: UpdateProfileData;
}): Promise<MutationResult<void>> => {
  const { ipaSession, id, data } = params;

  const userRows: DbRow[] = await sql`SELECT uid, realm FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;
  const realm = userRows[0]!.realm as Realm;

  if (realm === "ipa" || realm === "ipa-limited") {
    if (!ipaSession) {
      return {
        ok: false,
        error: "IPA session required to update IPA user",
        status: 400,
      };
    }

    const ipaOptions: Record<string, unknown> = {
      givenname: data.givenname,
      sn: data.sn,
      displayname: data.displayName,
    };
    if (data.mail !== undefined) ipaOptions.mail = data.mail || "";
    if (data.phone !== undefined) ipaOptions.telephonenumber = data.phone || "";
    if (data.street !== undefined) ipaOptions.street = data.street || "";
    if (data.postalCode !== undefined) ipaOptions.postalcode = data.postalCode || "";
    if (data.city !== undefined) ipaOptions.l = data.city || "";
    if (data.state !== undefined) ipaOptions.st = data.state || "";

    const response = await call(ipaSession, "user_mod", [uid], ipaOptions);
    if (response.error) {
      return {
        ok: false,
        error: response.error.message ?? "Failed to update user in FreeIPA",
        status: mapIpaErrorCode(response.error.code),
      };
    }
  }

  await sql`
    UPDATE auth.users
    SET given_name = ${data.givenname},
        sn = ${data.sn},
        display_name = ${data.displayName},
        phone = CASE WHEN ${data.phone !== undefined} THEN ${data.phone ?? null} ELSE phone END,
        addr_street = CASE WHEN ${data.street !== undefined} THEN ${data.street ?? null} ELSE addr_street END,
        addr_postal_code = CASE WHEN ${data.postalCode !== undefined} THEN ${data.postalCode ?? null} ELSE addr_postal_code END,
        addr_city = CASE WHEN ${data.city !== undefined} THEN ${data.city ?? null} ELSE addr_city END,
        addr_state = CASE WHEN ${data.state !== undefined} THEN ${data.state ?? null} ELSE addr_state END,
        synced_at = now()
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
  const { ipaSession, id, keys } = params;

  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id} AND realm IN ('ipa', 'ipa-limited')`;
  if (userRows.length === 0) {
    return {
      ok: false,
      error: "User not found or not an IPA user",
      status: 404,
    };
  }
  const uid = userRows[0]!.uid as string;

  // FreeIPA: empty string clears all keys, array sets them
  const response = await call(ipaSession, "user_mod", [uid], {
    ipasshpubkey: keys.length > 0 ? keys : "",
  });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to update SSH keys",
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Read back fingerprints from FreeIPA response
  const result = response.result?.result as Record<string, unknown> | undefined;
  const newKeys = Array.isArray(result?.ipasshpubkey) ? (result.ipasshpubkey as string[]) : [];
  const newFingerprints = Array.isArray(result?.sshpubkeyfp) ? (result.sshpubkeyfp as string[]) : [];

  await sql`
    UPDATE auth.users
    SET ssh_public_keys = ${toPgTextArray(newKeys)}::text[],
        ssh_fingerprints = ${toPgTextArray(newFingerprints)}::text[],
        synced_at = now()
    WHERE id = ${id}
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
  const { ipaSession, id } = params;

  // Look up uid from database
  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;

  const newPassword = generatePassword();

  const response = await call(ipaSession, "user_mod", [uid], {
    userpassword: newPassword,
  });

  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to reset password",
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Update password expiry in local DB (password is now "expired" / temporary)
  await sql`
    UPDATE auth.users
    SET ipa_password_expires = now(), synced_at = now()
    WHERE id = ${id}
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
  const { ipaSession, id, expiryDate } = params;

  // Look up uid from database
  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;

  let dbExpiry: Date | null = null;
  const response = await (async () => {
    if (expiryDate) {
      const date = new Date(expiryDate);
      date.setUTCHours(23, 59, 59, 0);
      const ipaExpiry = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
      dbExpiry = date;
      return call(ipaSession, "user_mod", [uid], {
        krbprincipalexpiration: ipaExpiry,
      });
    }
    return call(ipaSession, "user_mod", [uid], {
      krbprincipalexpiration: null,
    });
  })();

  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to update account expiry",
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    UPDATE auth.users
    SET ipa_account_expires = ${dbExpiry}, synced_at = now()
    WHERE id = ${id}
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
}): Promise<MutationResult<void>> => {
  const { ipaSession, id } = params;

  const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${id} AND realm IN ('ipa', 'ipa-limited')`;
  if (userRows.length === 0) {
    return {
      ok: false,
      error: "User not found or not an IPA user",
      status: 404,
    };
  }
  const uid = userRows[0]!.uid as string;

  const response = await call(ipaSession, "user_del", [uid], {});
  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to delete user from FreeIPA",
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    UPDATE auth.users
    SET realm = 'guest', uid_number = NULL, synced_at = NULL,
        employee_type = NULL, addr_street = NULL, addr_postal_code = NULL,
        addr_city = NULL, addr_state = NULL, mobile = NULL,
        ssh_public_keys = '{}', ssh_fingerprints = '{}',
        ipa_account_expires = NULL, ipa_password_expires = NULL,
        last_login_ipa = NULL
    WHERE id = ${id}
  `;

  await sql`DELETE FROM auth.user_groups WHERE user_id = ${id}`;
  await sql`DELETE FROM auth.group_manager_users WHERE user_id = ${id}`;

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
}): Promise<MutationResult<void>> => {
  const { ipaSession, id } = params;

  const userRows: DbRow[] = await sql`SELECT uid, realm FROM auth.users WHERE id = ${id}`;
  if (userRows.length === 0) {
    return { ok: false, error: "User not found", status: 404 };
  }
  const uid = userRows[0]!.uid as string;
  const realm = userRows[0]!.realm as Realm;

  if (realm === "ipa" || realm === "ipa-limited") {
    if (!ipaSession) {
      return {
        ok: false,
        error: "IPA session required to delete IPA user",
        status: 400,
      };
    }
    const response = await call(ipaSession, "user_del", [uid], {});
    if (response.error) {
      return {
        ok: false,
        error: response.error.message ?? "Failed to delete user from FreeIPA",
        status: mapIpaErrorCode(response.error.code),
      };
    }
  }

  await sql`DELETE FROM auth.users WHERE id = ${id}`;

  return { ok: true, data: undefined };
};

// ==========================
// Type aliases
// ==========================

export type AddUserResult = AddIpaResult;

// Legacy: MutationResult type (now in schemas.ts)
type LegacyMutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };
