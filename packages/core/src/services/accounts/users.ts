import { sql } from "bun";
import { env } from "../../config/env";
import { notifications } from "../notifications";
import * as settings from "../settings";
import { renderTemplate } from "../settings/templates";
import { session } from "../session";
import { freeipa } from "@valentinkolb/cloud-lib/server/services";
import { providers } from "../providers";
import { transitionIpaUserToLocal } from "./switching";
import {
  canPersistStoredAdmin,
  getDefaultAccountExpiry,
  normalizeManualAccountExpiry,
  resolveEffectiveAdminState,
  resolveAccountExpires,
  resolveStoredAdminState,
  resolveTargetAccountExpiry,
} from "./model";
import { buildRoles } from "./authz";
import { toPgTextArray, toPgUuidArray } from "../postgres";
import { buildBaseUser, resolveProviderProfile } from "./base-user";
import {
  managedGroupIdsSubquery,
  managedGroupsNamesSubquery,
  recursiveGroupIdsSubquery,
  recursiveGroupNamesSubquery,
} from "./group-sql";
import { getFreeIpaConfigSync } from "../freeipa-config";
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
import { buildIpaUserData, userIpaDataColumns, userIpaDataJoin } from "./ipa-data";

type DbRow = Record<string, unknown>;
type UserMutationTarget = BaseUser & { accountExpires: string | null; storedAdmin: boolean };

type CreateUserData = {
  provider: UserProvider;
  profile: UserProfile;
  admin?: boolean;
  email: string;
  givenname: string;
  sn: string;
  displayName?: string;
  autoSendNotification?: boolean;
  requestId?: string;
  accountExpires?: string | null;
};

type UpdateUserData = {
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

const getUserRow = async (id: string): Promise<DbRow | null> => {
  const rows = await sql<DbRow[]>`
    SELECT *
    FROM auth.users
    WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
};

const sendMagicLinkEmail = async (email: string): Promise<void> => {
  const token = await providers.local.auth.createMagicLinkToken({ email, ttlSeconds: 300 });
  const appUrl = env.APP_URL.startsWith("http") ? env.APP_URL : `https://${env.APP_URL}`;
  const magicLink = `${appUrl}/auth/login?token=${token}`;
  const appName = await settings.get<string>("app.name");
  const template = await settings.get<string>("mail.magic_link_login");

  await notifications.send({
    type: "email",
    recipient: email,
    subject: `${appName} Login Code`,
    rawHtml: renderTemplate(template, {
      TOKEN: token,
      MAGIC_LINK: magicLink,
      APP_NAME: appName,
    }),
    autoSend: true,
  });
};

const buildUserMutationTarget = (row: DbRow): UserMutationTarget => ({
  ...buildBaseUser(row),
  accountExpires: resolveAccountExpires(row)?.toISOString() ?? null,
  storedAdmin: Boolean(row.admin),
});

export const emptyIpaUserData = (): IpaUserData => ({
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

export const get = async (params: { id: string } | { uid: string }): Promise<User | null> => {
  const whereClause = "id" in params ? sql`u.id = ${params.id}` : sql`u.uid = ${params.uid}`;
  const userIdExpr = "id" in params ? sql`${params.id}` : sql`u.id`;
  const rows = await sql<DbRow[]>`
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
        ${managedGroupsNamesSubquery(userIdExpr)}
      ), '{}') AS manages,
      COALESCE(ARRAY(
        ${managedGroupIdsSubquery(userIdExpr)}
      ), '{}') AS manages_group_ids
    FROM auth.users u
    ${userIpaDataJoin}
    WHERE ${whereClause}
  `;
  if (rows.length === 0) return null;
  return buildUser(rows[0]!);
};

export const getMinimal = async (params: { id: string } | { uid: string }): Promise<UserMutationTarget | null> => {
  const whereClause = "id" in params ? sql`id = ${params.id}` : sql`uid = ${params.uid}`;
  const rows = await sql<DbRow[]>`
    SELECT id, uid, provider, profile, admin, given_name, sn, display_name, mail, account_expires
    FROM auth.users
    WHERE ${whereClause}
  `;
  if (rows.length === 0) return null;
  return buildUserMutationTarget(rows[0]!);
};

export const getByUid = async (params: { uid: string }): Promise<{ id: string; roles: Role[] } | null> => {
  const rows = await sql<DbRow[]>`SELECT id, provider, profile, admin FROM auth.users WHERE uid = ${params.uid}`;
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

export const list = async (params: {
  ids?: string[];
  uids?: string[];
  search?: string;
  provider?: UserProvider;
  profile?: UserProfile;
  page?: number;
  perPage?: number;
}) => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 100;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${freeipa.util.escapeLike(params.search.toLowerCase())}%` : null;
  const ids = params.ids;
  const uids = params.uids;

  if ((ids && ids.length === 0) || (uids && uids.length === 0)) {
    return {
      users: [],
      total: 0,
      pagination: {
        page,
        per_page: perPage,
        total: 0,
        total_pages: 0,
        has_next: false,
      } satisfies PaginationResponse,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [sql`TRUE`];
  if (ids) conditions.push(sql`id = ANY(${toPgUuidArray(ids)}::uuid[])`);
  if (uids) conditions.push(sql`uid = ANY(${toPgTextArray(uids)}::text[])`);
  if (params.provider) conditions.push(sql`provider = ${params.provider}`);
  if (params.profile) conditions.push(sql`profile = ${params.profile}`);
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
  const countRows = await sql<DbRow[]>`SELECT COUNT(*)::int AS count FROM auth.users WHERE ${where}`;
  const total = (countRows[0]?.count as number) ?? 0;
  const totalPages = Math.ceil(total / perPage);
  const groupsAdmin = getFreeIpaConfigSync().groupsAdmin;
  const rows = await sql<DbRow[]>`
    SELECT u.*,
      CASE
        WHEN u.provider = 'local' THEN u.admin
        ELSE EXISTS(
          SELECT 1
            FROM auth.user_groups_v2 ug
            JOIN auth.groups g_admin ON g_admin.id = ug.group_id
            WHERE ug.user_id = u.id
            AND g_admin.provider = 'ipa'
            AND g_admin.name = ANY(${toPgTextArray(groupsAdmin)}::text[])
        )
      END AS effective_admin
    FROM auth.users u
    WHERE ${where}
    ORDER BY uid
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    users: rows.map(buildBaseUser),
    total,
    pagination: {
      page,
      per_page: perPage,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
    } satisfies PaginationResponse,
  };
};

export const getGroups = async (params: { id: string; recursive?: boolean }): Promise<string[]> => {
  if (params.recursive) {
    const rows = await sql<DbRow[]>`${recursiveGroupNamesSubquery(params.id)}`;
    return rows.map((row) => row.name as string);
  }

  const rows = await sql<DbRow[]>`
    SELECT g.name
    FROM auth.user_groups_v2 ug
    JOIN auth.groups g ON g.id = ug.group_id
    WHERE ug.user_id = ${params.id}::uuid
    ORDER BY g.name
  `;
  return rows.map((row) => row.name as string);
};

export const getGroupIds = async (params: { id: string; recursive?: boolean }): Promise<string[]> => {
  if (params.recursive) {
    const rows = await sql<DbRow[]>`${recursiveGroupIdsSubquery(params.id)}`;
    return rows.map((row) => row.group_id as string);
  }

  const rows = await sql<DbRow[]>`
    SELECT ug.group_id
    FROM auth.user_groups_v2 ug
    JOIN auth.groups g ON g.id = ug.group_id
    WHERE ug.user_id = ${params.id}::uuid
    ORDER BY g.name
  `;
  return rows.map((row) => row.group_id as string);
};

export const getManagedGroups = async (params: { id: string; recursive?: boolean }): Promise<string[]> => {
  if (params.recursive === false) {
    const rows = await sql<DbRow[]>`
      SELECT DISTINCT g.name
      FROM auth.groups g
      LEFT JOIN auth.group_manager_users_v2 gmu ON gmu.group_id = g.id AND gmu.user_id = ${params.id}::uuid
      LEFT JOIN auth.group_manager_groups_v2 gmg ON gmg.group_id = g.id
      LEFT JOIN auth.user_groups_v2 ug ON ug.group_id = gmg.manager_group_id AND ug.user_id = ${params.id}::uuid
      LEFT JOIN auth.groups g_manager ON g_manager.id = gmg.manager_group_id
      WHERE gmu.user_id IS NOT NULL OR (ug.user_id IS NOT NULL AND g_manager.provider = g.provider)
      ORDER BY g.name
    `;
    return rows.map((row) => row.name as string);
  }

  const rows = await sql<DbRow[]>`${managedGroupsNamesSubquery(params.id)}`;
  return rows.map((row) => row.name as string);
};

export const demoteToGuest = async (params: {
  ipaSession?: string | null;
  id: string;
  actor: { userId: string; uid: string };
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (user.provider !== "ipa") {
    return { ok: false, error: "Only IPA-backed accounts can be demoted to local guests", status: 400 };
  }
  if (!params.ipaSession) {
    return { ok: false, error: "IPA session required to demote IPA-backed users", status: 401 };
  }

  return providers.ipa.users.demoteToGuest({
    ipaSession: params.ipaSession,
    id: params.id,
    actor: params.actor,
  });
};

export const create = async (params: {
  ipaSession?: string | null;
  data: CreateUserData;
}): Promise<MutationResult<{ user: User; temporaryPassword?: string }>> => {
  if (params.data.provider === "local" && params.data.admin && !canPersistStoredAdmin("local", params.data.profile)) {
    return { ok: false, error: "Only local full accounts can be created as admins", status: 400 };
  }

  const accountExpires = await resolveTargetAccountExpiry({
    provider: params.data.provider,
    profile: params.data.profile,
    requested: params.data.accountExpires,
  });

  if (params.data.provider === "local") {
    const created = await providers.local.users.create({
      data: {
        email: params.data.email,
        givenname: params.data.givenname,
        sn: params.data.sn,
        displayName: params.data.displayName,
      },
      profile: params.data.profile,
      accountExpires,
      admin: params.data.admin,
    });
    if (!created.ok) return created;
    const user = await get({ id: created.data.id });
    if (!user) return { ok: false, error: "Created user not found", status: 500 };
    return { ok: true, data: { user } };
  }

  if (!params.ipaSession) {
    return { ok: false, error: "IPA session required to create IPA-backed users", status: 401 };
  }

  const created = await providers.ipa.users.create({
    ipaSession: params.ipaSession,
    profile: params.data.profile,
    accountExpires,
    data: {
      email: params.data.email,
      givenname: params.data.givenname,
      sn: params.data.sn,
      displayName: params.data.displayName,
      autoSendNotification: params.data.autoSendNotification,
      requestId: params.data.requestId,
    },
  });
  if (!created.ok) return created;
  const user = await get({ id: created.data.id });
  if (!user) return { ok: false, error: "Created user not found", status: 500 };
  return {
    ok: true,
    data: {
      user,
      temporaryPassword: created.data._temporaryPassword,
    },
  };
};

export const update = async (params: {
  ipaSession?: string | null;
  id: string;
  data: UpdateUserData;
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };

  if (user.provider === "ipa") {
    if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA-backed users", status: 401 };
    return providers.ipa.users.update({
      ipaSession: params.ipaSession,
      id: params.id,
      data: params.data,
    });
  }

  if (params.data.ipa) {
    return { ok: false, error: "IPA-only fields can only be updated for IPA-backed users", status: 400 };
  }

  return providers.local.users.update({
    id: params.id,
    data: params.data,
  });
};

export const setProfile = async (params: {
  id: string;
  profile: UserProfile;
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (user.provider !== "local") {
    return { ok: false, error: "IPA profile is derived from IPA groups and cannot be set directly", status: 400 };
  }

  const accountExpires = user.accountExpires ? new Date(user.accountExpires) : await getDefaultAccountExpiry("local", params.profile);
  return providers.local.users.setProfile({
    id: params.id,
    profile: params.profile,
    accountExpires,
  });
};

export const setAdmin = async (params: {
  id: string;
  admin: boolean;
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (!canPersistStoredAdmin(user.provider, user.profile)) {
    return {
      ok: false,
      error: user.provider === "ipa" ? "FreeIPA admin access is managed through FreeIPA groups" : "Guest accounts cannot be granted admin access",
      status: 400,
    };
  }

  return providers.local.users.setAdmin(params);
};

export const setExpiry = async (params: {
  ipaSession?: string | null;
  id: string;
  expiryDate: string | null;
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };

  if (user.provider === "ipa") {
    if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA-backed expiry", status: 401 };
    return providers.ipa.users.setExpiry({
      ipaSession: params.ipaSession,
      id: params.id,
      expiryDate: params.expiryDate,
    });
  }

  return providers.local.users.setExpiry({
    id: params.id,
    profile: user.profile,
    accountExpires: normalizeManualAccountExpiry(params.expiryDate),
  });
};

export const sendLoginLink = async (params: { id: string }): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (user.provider !== "local") {
    return { ok: false, error: "Login links are only available for local accounts", status: 400 };
  }
  if (!user.mail) return { ok: false, error: "A local account requires an email address to receive a login link", status: 400 };

  await sendMagicLinkEmail(user.mail);
  return { ok: true, data: undefined };
};

export const createLoginToken = async (params: {
  id: string;
}): Promise<MutationResult<{ token: string; magicLink: string; expiresInSeconds: number }>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (user.provider !== "local") {
    return { ok: false, error: "Login tokens are only available for local accounts", status: 400 };
  }
  if (!user.mail) {
    return { ok: false, error: "A local account requires an email address before a login token can be created", status: 400 };
  }

  const expiresInSeconds = 300;
  const token = await providers.local.auth.createMagicLinkToken({
    email: user.mail,
    ttlSeconds: expiresInSeconds,
  });
  const appUrl = env.APP_URL.startsWith("http") ? env.APP_URL : `https://${env.APP_URL}`;

  return {
    ok: true,
    data: {
      token,
      magicLink: `${appUrl}/auth/login?token=${token}`,
      expiresInSeconds,
    },
  };
};

export const resetPassword = async (params: {
  ipaSession?: string | null;
  id: string;
}): Promise<MutationResult<{ password: string }>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  if (user.provider !== "ipa") {
    return { ok: false, error: "Password resets are only available for IPA-backed accounts", status: 400 };
  }
  if (!params.ipaSession) return { ok: false, error: "IPA session required to reset IPA-backed passwords", status: 401 };

  return providers.ipa.users.resetPassword({
    ipaSession: params.ipaSession,
    id: params.id,
  });
};

export const switchProvider = async (params: {
  ipaSession?: string | null;
  id: string;
  provider: UserProvider;
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };
  const freeIpaConfig = getFreeIpaConfigSync();

  const currentProvider = user.provider;
  const currentProfile = user.profile;
  const currentExpiry = user.accountExpires ? new Date(user.accountExpires) : null;

  if (currentProvider === params.provider) {
    return { ok: false, error: `Account already uses provider '${params.provider}'`, status: 400 };
  }

  if (!freeIpaConfig.enabled) {
    return { ok: false, error: "FreeIPA is disabled.", status: 400 };
  }

  if (!params.ipaSession) {
    return { ok: false, error: "IPA session required to switch account providers", status: 401 };
  }

  if (params.provider === "ipa") {
    if (!user.mail) {
      return { ok: false, error: "A local account needs an email address before it can be switched to IPA", status: 400 };
    }

    const result = await providers.ipa.users.create({
      ipaSession: params.ipaSession,
      profile: currentProfile,
      accountExpires: currentExpiry,
      data: {
        email: user.mail,
        givenname: user.givenname,
        sn: user.sn,
        displayName: user.displayName || undefined,
        autoSendNotification: false,
      },
    });
    if (!result.ok) return result;
    return { ok: true, data: undefined };
  }

  const response = await freeipa.client.call({
    url: freeIpaConfig.url,
    ipaSession: params.ipaSession,
    method: "user_del",
    args: [user.uid],
    options: {},
  });
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
    await transitionIpaUserToLocal({
      userId: params.id,
      targetProfile: currentProfile,
      accountExpires: currentExpiry,
      db: tx,
    });
  });

  try {
    await session.deleteAllForUser(params.id);
  } catch {
    // Best-effort cleanup. Provider switch already succeeded.
  }

  return { ok: true, data: undefined };
};

export const remove = async (params: {
  ipaSession?: string | null;
  id: string;
  actor: { userId: string; uid: string };
}): Promise<MutationResult<void>> => {
  const user = await getMinimal({ id: params.id });
  if (!user) return { ok: false, error: "User not found", status: 404 };

  if (user.provider === "ipa") {
    if (!params.ipaSession) return { ok: false, error: "IPA session required to delete IPA-backed users", status: 401 };
    return providers.ipa.users.remove({
      ipaSession: params.ipaSession,
      id: params.id,
      actor: params.actor,
    });
  }

  return providers.local.users.remove({
    id: params.id,
    actor: params.actor,
  });
};
