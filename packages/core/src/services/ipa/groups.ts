import { sql } from "bun";
import type { BaseGroup, GroupMember, MutationResult } from "@valentinkolb/cloud-contracts/shared";
import { call, mapIpaErrorCode, num, type DbRow } from "./lib";
import { updateUserRealm, updateRealmForAffectedUsers } from "./realm";

// ==========================
// Reads: get (single group by CN, no relations)
// ==========================

/**
 * Returns one mirrored group by CN without expanding member or manager relations.
 */
export const get = async (params: { cn: string }): Promise<BaseGroup | null> => {
  const { cn } = params;
  const rows: DbRow[] = await sql`SELECT cn, description, gid_number FROM auth.groups WHERE cn = ${cn}`;
  if (rows.length === 0) return null;

  return {
    cn: rows[0]!.cn as string,
    description: rows[0]!.description as string | null,
    gidnumber: rows[0]!.gid_number as number | null,
  };
};

// ==========================
// Reads: list (no relations, supports search/filter/pagination)
// ==========================

/**
 * List groups with optional filters.
 * @param cns - Filter to specific group CNs
 * @param userId - Filter to groups the user is associated with:
 *   direct group memberships and any manage permission (direct or via manager group)
 * @param search - Search in group name and description
 */
export const list = async (params: {
  cns?: string[];
  userId?: string;
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{
  groups: BaseGroup[];
  total: number;
  pagination: {
    page: number;
    perPage: number;
    totalPages: number;
    hasNext: boolean;
  };
}> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${params.search.toLowerCase()}%` : null;
  const cns = params.cns;

  // If cns filter is provided but empty, return empty result immediately
  if (cns && cns.length === 0) {
    return {
      groups: [],
      total: 0,
      pagination: { page, perPage, totalPages: 0, hasNext: false },
    };
  }

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];
  if (cns) {
    conditions.push(sql`cn IN ${sql(cns)}`);
  }
  if (params.userId) {
    conditions.push(sql`(
      cn IN (SELECT group_cn FROM auth.user_groups WHERE user_id = ${params.userId})
      OR cn IN (
        WITH RECURSIVE user_all_groups AS (
          SELECT group_cn FROM auth.user_groups WHERE user_id = ${params.userId}
          UNION
          SELECT gg.parent_cn FROM auth.group_groups gg
          JOIN user_all_groups ag ON gg.child_cn = ag.group_cn
        )
        SELECT DISTINCT g.cn FROM auth.groups g
        LEFT JOIN auth.group_manager_users gmu ON gmu.group_cn = g.cn AND gmu.user_id = ${params.userId}
        LEFT JOIN auth.group_manager_groups gmg ON gmg.group_cn = g.cn
        LEFT JOIN user_all_groups ug ON ug.group_cn = gmg.manager_cn
        WHERE gmu.user_id IS NOT NULL OR ug.group_cn IS NOT NULL
      )
    )`);
  }
  if (search) {
    conditions.push(sql`(LOWER(cn) LIKE ${search} OR LOWER(description) LIKE ${search})`);
  }

  const where = conditions.length > 0 ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`) : sql`TRUE`;

  const countRows: DbRow[] = await sql`SELECT COUNT(*)::int as count FROM auth.groups WHERE ${where}`;
  const total = (countRows[0]?.count as number) ?? 0;
  const totalPages = Math.ceil(total / perPage);

  const groupRows: DbRow[] = await sql`
    SELECT cn, description, gid_number FROM auth.groups
    WHERE ${where}
    ORDER BY cn
    LIMIT ${perPage} OFFSET ${offset}`;

  const groups: BaseGroup[] = groupRows.map((row) => ({
    cn: row.cn as string,
    description: row.description as string | null,
    gidnumber: row.gid_number as number | null,
  }));

  return {
    groups,
    total,
    pagination: { page, perPage, totalPages, hasNext: page < totalPages },
  };
};

// ==========================
// Reads: getMembers (users and/or groups that are members)
// ==========================

/**
 * Lists group members (users and/or groups), optionally traversing child-group recursion.
 */
export const getMembers = async (params: { cn: string; type?: "user" | "group"; recursive?: boolean }): Promise<GroupMember[]> => {
  const { cn, type, recursive } = params;
  const members: GroupMember[] = [];

  // Get user members
  if (!type || type === "user") {
    if (recursive) {
      // Recursive: get all users from this group and child groups
      const userRows: DbRow[] = await sql`
        WITH RECURSIVE child_groups AS (
          SELECT ${cn}::text as group_cn
          UNION
          SELECT gg.child_cn FROM auth.group_groups gg
          JOIN child_groups cg ON gg.parent_cn = cg.group_cn
        )
        SELECT DISTINCT u.uid, u.display_name
        FROM auth.user_groups ug
        JOIN child_groups cg ON ug.group_cn = cg.group_cn
        JOIN auth.users u ON u.id = ug.user_id
        ORDER BY u.uid`;
      for (const row of userRows) {
        members.push({
          type: "user",
          id: row.uid as string,
          displayName: row.display_name as string | null,
        });
      }
    } else {
      // Direct members only
      const userRows: DbRow[] = await sql`
        SELECT u.uid, u.display_name
        FROM auth.user_groups ug
        JOIN auth.users u ON u.id = ug.user_id
        WHERE ug.group_cn = ${cn}
        ORDER BY u.uid`;
      for (const row of userRows) {
        members.push({
          type: "user",
          id: row.uid as string,
          displayName: row.display_name as string | null,
        });
      }
    }
  }

  // Get group members
  if (!type || type === "group") {
    if (recursive) {
      // Recursive: get all child groups
      const groupRows: DbRow[] = await sql`
        WITH RECURSIVE child_groups AS (
          SELECT child_cn FROM auth.group_groups WHERE parent_cn = ${cn}
          UNION
          SELECT gg.child_cn FROM auth.group_groups gg
          JOIN child_groups cg ON gg.parent_cn = cg.child_cn
        )
        SELECT DISTINCT cg.child_cn as cn, g.description
        FROM child_groups cg
        LEFT JOIN auth.groups g ON g.cn = cg.child_cn
        ORDER BY cg.child_cn`;
      for (const row of groupRows) {
        members.push({
          type: "group",
          id: row.cn as string,
          displayName: row.description as string | null,
        });
      }
    } else {
      // Direct child groups only
      const groupRows: DbRow[] = await sql`
        SELECT gg.child_cn as cn, g.description
        FROM auth.group_groups gg
        LEFT JOIN auth.groups g ON g.cn = gg.child_cn
        WHERE gg.parent_cn = ${cn}
        ORDER BY gg.child_cn`;
      for (const row of groupRows) {
        members.push({
          type: "group",
          id: row.cn as string,
          displayName: row.description as string | null,
        });
      }
    }
  }

  return members;
};

// ==========================
// Reads: getManagers (users and/or groups that manage this group)
// ==========================

/**
 * Lists managers for a group, including recursive manager-group expansion when requested.
 */
export const getManagers = async (params: { cn: string; type?: "user" | "group"; recursive?: boolean }): Promise<GroupMember[]> => {
  const { cn, type, recursive } = params;
  const managers: GroupMember[] = [];

  // Get user managers
  if (!type || type === "user") {
    if (recursive) {
      // Recursive: managers of this group + managers via manager groups
      const userRows: DbRow[] = await sql`
        WITH RECURSIVE manager_groups AS (
          SELECT manager_cn FROM auth.group_manager_groups WHERE group_cn = ${cn}
          UNION
          SELECT gg.parent_cn FROM auth.group_groups gg
          JOIN manager_groups mg ON gg.child_cn = mg.manager_cn
        )
        SELECT DISTINCT u.uid, u.display_name
        FROM (
          -- Direct user managers
          SELECT user_id FROM auth.group_manager_users WHERE group_cn = ${cn}
          UNION
          -- User members of manager groups (recursive)
          SELECT ug.user_id
          FROM auth.user_groups ug
          JOIN manager_groups mg ON ug.group_cn = mg.manager_cn
        ) all_managers
        JOIN auth.users u ON u.id = all_managers.user_id
        ORDER BY u.uid`;
      for (const row of userRows) {
        managers.push({
          type: "user",
          id: row.uid as string,
          displayName: row.display_name as string | null,
        });
      }
    } else {
      // Direct user managers only
      const userRows: DbRow[] = await sql`
        SELECT u.uid, u.display_name
        FROM auth.group_manager_users gmu
        JOIN auth.users u ON u.id = gmu.user_id
        WHERE gmu.group_cn = ${cn}
        ORDER BY u.uid`;
      for (const row of userRows) {
        managers.push({
          type: "user",
          id: row.uid as string,
          displayName: row.display_name as string | null,
        });
      }
    }
  }

  // Get group managers
  if (!type || type === "group") {
    // Note: recursive for groups would mean finding all parent groups of manager groups,
    // which doesn't really make sense semantically. We'll just return direct manager groups.
    const groupRows: DbRow[] = await sql`
      SELECT gmg.manager_cn as cn, g.description
      FROM auth.group_manager_groups gmg
      LEFT JOIN auth.groups g ON g.cn = gmg.manager_cn
      WHERE gmg.group_cn = ${cn}
      ORDER BY gmg.manager_cn`;
    for (const row of groupRows) {
      managers.push({
        type: "group",
        id: row.cn as string,
        displayName: row.description as string | null,
      });
    }
  }

  return managers;
};

// ==========================
// Reads: getParents (groups this group is a member of)
// ==========================

/**
 * Lists parent groups for one group, optionally resolving the full parent chain.
 */
export const getParents = async (params: { cn: string; recursive?: boolean }): Promise<string[]> => {
  const { cn, recursive } = params;

  if (recursive) {
    const rows: DbRow[] = await sql`
      WITH RECURSIVE parent_groups AS (
        SELECT parent_cn FROM auth.group_groups WHERE child_cn = ${cn}
        UNION
        SELECT gg.parent_cn FROM auth.group_groups gg
        JOIN parent_groups pg ON gg.child_cn = pg.parent_cn
      )
      SELECT DISTINCT parent_cn FROM parent_groups ORDER BY parent_cn`;
    return rows.map((r) => r.parent_cn as string);
  } else {
    const rows: DbRow[] = await sql`
      SELECT parent_cn FROM auth.group_groups WHERE child_cn = ${cn} ORDER BY parent_cn`;
    return rows.map((r) => r.parent_cn as string);
  }
};

// ==========================
// Reads: getManagedGroups (groups this group manages)
// ==========================

/**
 * Lists groups that are managed by the provided manager group CN.
 */
export const getManagedGroups = async (params: { cn: string }): Promise<string[]> => {
  const { cn } = params;
  const rows: DbRow[] = await sql`
    SELECT group_cn FROM auth.group_manager_groups WHERE manager_cn = ${cn} ORDER BY group_cn`;
  return rows.map((r) => r.group_cn as string);
};

// ==========================
// Mutations (FreeIPA RPC + DB update)
// ==========================

/**
 * Creates a group in FreeIPA, then mirrors description/GID into the local `auth.groups` table.
 */
export const add = async (params: {
  ipaSession: string;
  cn: string;
  description?: string;
  posix?: boolean;
}): Promise<MutationResult<BaseGroup>> => {
  const { ipaSession, cn, description, posix } = params;

  const options: Record<string, unknown> = {};
  if (description) options.description = description;
  if (posix) options.nonposix = false;
  else options.nonposix = true;

  const response = await call(ipaSession, "group_add", [cn], options);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Extract gidnumber from FreeIPA response (only present for POSIX groups)
  const raw = response.result?.result as Record<string, unknown> | undefined;
  const gidnumber = raw ? num(raw.gidnumber) : null;

  await sql`
    INSERT INTO auth.groups (cn, description, gid_number, synced_at)
    VALUES (${cn}, ${description ?? null}, ${gidnumber}, now())
    ON CONFLICT (cn) DO UPDATE SET description = EXCLUDED.description, gid_number = ${gidnumber}, synced_at = now()`;

  return {
    ok: true,
    data: { cn, description: description ?? null, gidnumber },
  };
};

/**
 * Updates group description in FreeIPA and mirrors the new description locally.
 */
export const update = async (params: { ipaSession: string; cn: string; description: string }): Promise<MutationResult<void>> => {
  const { ipaSession, cn, description } = params;

  const response = await call(ipaSession, "group_mod", [cn], { description });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`UPDATE auth.groups SET description = ${description}, synced_at = now() WHERE cn = ${cn}`;
  return { ok: true, data: undefined };
};

/**
 * Deletes a group in FreeIPA and removes its mirrored row from `auth.groups`.
 */
export const del = async (params: { ipaSession: string; cn: string }): Promise<MutationResult<void>> => {
  const { ipaSession, cn } = params;

  const response = await call(ipaSession, "group_del", [cn], {});
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`DELETE FROM auth.groups WHERE cn = ${cn}`;
  return { ok: true, data: undefined };
};

/**
 * Converts a group to POSIX in FreeIPA and mirrors the resulting GID locally.
 */
export const makePosix = async (params: { ipaSession: string; cn: string }): Promise<MutationResult<{ gidnumber: number | null }>> => {
  const { ipaSession, cn } = params;

  const response = await call(ipaSession, "group_mod", [cn], { posix: true });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  const raw = response.result?.result as Record<string, unknown> | undefined;
  const gidnumber = raw ? num(raw.gidnumber) : null;
  await sql`UPDATE auth.groups SET gid_number = ${gidnumber}, synced_at = now() WHERE cn = ${cn}`;

  return { ok: true, data: { gidnumber } };
};

/**
 * Adds a user or child group as member in FreeIPA and mirrors the relation in local join tables.
 */
export const addMember = async (params: {
  ipaSession: string;
  cn: string;
  /** User ID (database UUID) */
  user?: string;
  /** Group CN */
  group?: string;
}): Promise<MutationResult<void>> => {
  const { ipaSession, cn, user, group } = params;

  // If user ID provided, look up the uid for FreeIPA
  let userUid: string | undefined;
  if (user) {
    const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${user}`;
    if (userRows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }
    userUid = userRows[0]!.uid as string;
  }

  const options: Record<string, unknown> = {};
  if (userUid) options.user = userUid;
  if (group) options.group = group;

  const response = await call(ipaSession, "group_add_member", [cn], options);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Check if FreeIPA actually added the member (it returns ok even if member wasn't added)
  const result = response.result?.result as Record<string, unknown> | undefined;
  const failed = result?.failed as Record<string, unknown> | undefined;
  const memberFailed = failed?.member as Record<string, unknown> | undefined;
  const userFailed = memberFailed?.user as Array<[string, string]> | undefined;
  const groupFailed = memberFailed?.group as Array<[string, string]> | undefined;

  if (userUid && userFailed && userFailed.length > 0) {
    const errorMsg = userFailed[0]?.[1] || "Failed to add user to group";
    return { ok: false, error: errorMsg, status: 400 };
  }
  if (group && groupFailed && groupFailed.length > 0) {
    const errorMsg = groupFailed[0]?.[1] || "Failed to add group to group";
    return { ok: false, error: errorMsg, status: 400 };
  }

  if (user) {
    await sql`INSERT INTO auth.user_groups (user_id, group_cn) VALUES (${user}, ${cn}) ON CONFLICT DO NOTHING`;
    // Update user's realm based on new group memberships
    await updateUserRealm(user);
  }
  if (group) {
    await sql`INSERT INTO auth.group_groups (parent_cn, child_cn) VALUES (${cn}, ${group}) ON CONFLICT DO NOTHING`;
    // Update realm for all users affected by this group hierarchy change
    await updateRealmForAffectedUsers(group);
  }

  return { ok: true, data: undefined };
};

/**
 * Removes a user/group membership in FreeIPA, mirrors local relation deletion, and refreshes affected user realms.
 */
export const removeMember = async (params: {
  ipaSession: string;
  cn: string;
  /** User ID (database UUID) */
  user?: string;
  /** Group CN */
  group?: string;
}): Promise<MutationResult<void>> => {
  const { ipaSession, cn, user, group } = params;

  // If user ID provided, look up the uid for FreeIPA
  let userUid: string | undefined;
  if (user) {
    const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${user}`;
    if (userRows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }
    userUid = userRows[0]!.uid as string;
  }

  const options: Record<string, unknown> = {};
  if (userUid) options.user = userUid;
  if (group) options.group = group;

  const response = await call(ipaSession, "group_remove_member", [cn], options);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Check if FreeIPA actually removed the member (it returns ok even if member wasn't removed)
  const result = response.result?.result as Record<string, unknown> | undefined;
  const failed = result?.failed as Record<string, unknown> | undefined;
  const memberFailed = failed?.member as Record<string, unknown> | undefined;
  const userFailed = memberFailed?.user as Array<[string, string]> | undefined;
  const groupFailed = memberFailed?.group as Array<[string, string]> | undefined;

  if (userUid && userFailed && userFailed.length > 0) {
    const errorMsg = userFailed[0]?.[1] || "Failed to remove user from group";
    return { ok: false, error: errorMsg, status: 400 };
  }
  if (group && groupFailed && groupFailed.length > 0) {
    const errorMsg = groupFailed[0]?.[1] || "Failed to remove group from group";
    return { ok: false, error: errorMsg, status: 400 };
  }

  if (user) {
    await sql`DELETE FROM auth.user_groups WHERE user_id = ${user} AND group_cn = ${cn}`;
    // Update user's realm based on remaining group memberships
    await updateUserRealm(user);
  }
  if (group) {
    // Get affected users BEFORE removing the group hierarchy
    const affectedUserIds: DbRow[] = await sql`
      WITH RECURSIVE child_groups AS (
        SELECT ${group}::text as cn
        UNION
        SELECT gg.child_cn FROM auth.group_groups gg
        JOIN child_groups cg ON gg.parent_cn = cg.cn
      )
      SELECT DISTINCT ug.user_id
      FROM auth.user_groups ug
      JOIN child_groups cg ON ug.group_cn = cg.cn
    `;

    await sql`DELETE FROM auth.group_groups WHERE parent_cn = ${cn} AND child_cn = ${group}`;

    // Update realm for all affected users after the hierarchy change
    for (const row of affectedUserIds) {
      await updateUserRealm(row.user_id as string);
    }
  }

  return { ok: true, data: undefined };
};

/**
 * Adds a user/group manager in FreeIPA and mirrors manager relations in local join tables.
 */
export const addManager = async (params: {
  ipaSession: string;
  cn: string;
  /** User ID (database UUID) */
  user?: string;
  /** Group CN */
  group?: string;
}): Promise<MutationResult<void>> => {
  const { ipaSession, cn, user, group } = params;

  // If user ID provided, look up the uid for FreeIPA
  let userUid: string | undefined;
  if (user) {
    const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${user}`;
    if (userRows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }
    userUid = userRows[0]!.uid as string;
  }

  const options: Record<string, unknown> = {};
  if (userUid) options.user = userUid;
  if (group) options.group = group;

  const response = await call(ipaSession, "group_add_member_manager", [cn], options);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Check if FreeIPA actually added the manager (it returns ok even if manager wasn't added)
  const result = response.result?.result as Record<string, unknown> | undefined;
  const failed = result?.failed as Record<string, unknown> | undefined;
  const memberManagerFailed = failed?.membermanager as Record<string, unknown> | undefined;
  const userFailed = memberManagerFailed?.user as Array<[string, string]> | undefined;
  const groupFailed = memberManagerFailed?.group as Array<[string, string]> | undefined;

  if (userUid && userFailed && userFailed.length > 0) {
    const errorMsg = userFailed[0]?.[1] || "Failed to add user as manager";
    return { ok: false, error: errorMsg, status: 400 };
  }
  if (group && groupFailed && groupFailed.length > 0) {
    const errorMsg = groupFailed[0]?.[1] || "Failed to add group as manager";
    return { ok: false, error: errorMsg, status: 400 };
  }

  if (user) {
    await sql`INSERT INTO auth.group_manager_users (group_cn, user_id) VALUES (${cn}, ${user}) ON CONFLICT DO NOTHING`;
  }
  if (group) {
    await sql`INSERT INTO auth.group_manager_groups (group_cn, manager_cn) VALUES (${cn}, ${group}) ON CONFLICT DO NOTHING`;
  }

  return { ok: true, data: undefined };
};

/**
 * Removes a user/group manager assignment in FreeIPA and mirrors the local manager relation deletion.
 */
export const removeManager = async (params: {
  ipaSession: string;
  cn: string;
  /** User ID (database UUID) */
  user?: string;
  /** Group CN */
  group?: string;
}): Promise<MutationResult<void>> => {
  const { ipaSession, cn, user, group } = params;

  // If user ID provided, look up the uid for FreeIPA
  let userUid: string | undefined;
  if (user) {
    const userRows: DbRow[] = await sql`SELECT uid FROM auth.users WHERE id = ${user}`;
    if (userRows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }
    userUid = userRows[0]!.uid as string;
  }

  const options: Record<string, unknown> = {};
  if (userUid) options.user = userUid;
  if (group) options.group = group;

  const response = await call(ipaSession, "group_remove_member_manager", [cn], options);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  // Check if FreeIPA actually removed the manager (it returns ok even if manager wasn't removed)
  const result = response.result?.result as Record<string, unknown> | undefined;
  const failed = result?.failed as Record<string, unknown> | undefined;
  const memberManagerFailed = failed?.membermanager as Record<string, unknown> | undefined;
  const userFailed = memberManagerFailed?.user as Array<[string, string]> | undefined;
  const groupFailed = memberManagerFailed?.group as Array<[string, string]> | undefined;

  if (userUid && userFailed && userFailed.length > 0) {
    const errorMsg = userFailed[0]?.[1] || "Failed to remove user as manager";
    return { ok: false, error: errorMsg, status: 400 };
  }
  if (group && groupFailed && groupFailed.length > 0) {
    const errorMsg = groupFailed[0]?.[1] || "Failed to remove group as manager";
    return { ok: false, error: errorMsg, status: 400 };
  }

  if (user) {
    await sql`DELETE FROM auth.group_manager_users WHERE group_cn = ${cn} AND user_id = ${user}`;
  }
  if (group) {
    await sql`DELETE FROM auth.group_manager_groups WHERE group_cn = ${cn} AND manager_cn = ${group}`;
  }

  return { ok: true, data: undefined };
};
