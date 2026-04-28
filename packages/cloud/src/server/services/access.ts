import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

// ==========================
// Permission Levels
// ==========================

export const PERMISSION_LEVELS = ["none", "read", "write", "admin"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Compare permission levels (returns true if a >= b) */
export const hasPermission = (userLevel: PermissionLevel, requiredLevel: PermissionLevel): boolean => {
  const levels = PERMISSION_LEVELS;
  return levels.indexOf(userLevel) >= levels.indexOf(requiredLevel);
};

// ==========================
// Principal Types
// ==========================

export type PrincipalType = "user" | "group" | "authenticated" | "public";

export type Principal =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string }
  | { type: "authenticated" }
  | { type: "public" };

// ==========================
// Access Entry Types
// ==========================

export type AccessEntry = {
  id: string;
  principal: Principal;
  permission: PermissionLevel;
  createdAt: string;
  // Resolved display info (populated by service)
  displayName?: string;
};

type DbAccess = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

// ==========================
// Helper Functions
// ==========================

/**
 * Converts UUID strings into a PostgreSQL uuid[] literal for relation queries.
 */
const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

/**
 * Builds a typed access principal from one database access row.
 */
const principalFromDb = (row: DbAccess): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

/**
 * Maps raw access rows into the normalized AccessEntry shape used by app services.
 */
const mapToAccessEntry = (row: DbAccess): AccessEntry => ({
  id: row.id,
  principal: principalFromDb(row),
  permission: row.permission,
  createdAt: row.created_at.toISOString(),
});

// ==========================
// Core Access Service
// ==========================

/**
 * Create a new access entry.
 * Returns the created entry ID.
 */
export const createAccess = async (params: { principal: Principal; permission: PermissionLevel }): Promise<Result<{ id: string }>> => {
  const { principal, permission } = params;

  let userId: string | null = null;
  let groupId: string | null = null;
  let authenticatedOnly = false;

  if (principal.type === "user") {
    userId = principal.userId;
    // Verify user exists
    const [user] = await sql<{ id: string }[]>`
      SELECT id FROM auth.users WHERE id = ${userId}::uuid
    `;
    if (!user) {
      return fail(err.notFound("User"));
    }
  } else if (principal.type === "group") {
    groupId = principal.groupId;
    // Verify group exists
    const [group] = await sql<{ id: string }[]>`
      SELECT id FROM auth.groups WHERE id = ${groupId}::uuid
    `;
    if (!group) {
      return fail(err.notFound("Group"));
    }
  } else if (principal.type === "authenticated") {
    authenticatedOnly = true;
  }
  // public: user/group null, authenticated_only false

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (user_id, group_id, authenticated_only, permission)
    VALUES (${userId}::uuid, ${groupId}::uuid, ${authenticatedOnly}, ${permission}::auth.permission_level)
    RETURNING id
  `;

  if (!row) {
    return fail(err.internal("Failed to create access entry"));
  }

  return ok({ id: row.id });
};

/**
 * Get an access entry by ID.
 */
export const getAccess = async (params: { id: string }): Promise<AccessEntry | null> => {
  const [row] = await sql<DbAccess[]>`
    SELECT id, user_id, group_id, authenticated_only, permission, created_at
    FROM auth.access
    WHERE id = ${params.id}::uuid
  `;
  return row ? mapToAccessEntry(row) : null;
};

/**
 * Update an access entry's permission level.
 */
export const updateAccess = async (params: { id: string; permission: PermissionLevel }): Promise<Result<void>> => {
  const result = await sql`
    UPDATE auth.access
    SET permission = ${params.permission}::auth.permission_level
    WHERE id = ${params.id}::uuid
  `;

  if (result.count === 0) {
    return fail(err.notFound("Access entry"));
  }

  return ok();
};

/**
 * Delete an access entry.
 */
export const deleteAccess = async (params: { id: string }): Promise<Result<void>> => {
  const result = await sql`
    DELETE FROM auth.access
    WHERE id = ${params.id}::uuid
  `;

  if (result.count === 0) {
    return fail(err.notFound("Access entry"));
  }

  return ok();
};

// ==========================
// Resource Access Helpers
// ==========================

/**
 * Generic interface for resource access junction tables.
 * Each app implements this to connect their resources to auth.access.
 */
export type ResourceAccessAdapter<TResourceId = string> = {
  /** Get all access entries for a resource */
  list: (resourceId: TResourceId) => Promise<AccessEntry[]>;
  /** Add an access entry to a resource */
  add: (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  /** Remove an access entry from a resource */
  remove: (resourceId: TResourceId, accessId: string) => Promise<Result<void>>;
  /** Count access entries for a resource */
  count: (resourceId: TResourceId) => Promise<number>;
};

/**
 * Get the effective permission level for a user on a resource.
 * Returns the highest permission from:
 * - Direct user access
 * - Group memberships
 * - Public access
 */
export const getEffectivePermission = async (params: {
  accessIds: string[];
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  const accessIds = params.accessIds ?? [];
  const userId = params.userId;
  const userGroups = params.userGroups ?? [];

  if (accessIds.length === 0) return "none";

  // Query all matching access entries
  const rows = await sql<{ permission: PermissionLevel }[]>`
    SELECT permission
    FROM auth.access
    WHERE id = ANY(${toPgUuidArray(accessIds)}::uuid[])
      AND (
        user_id = ${userId}::uuid
        OR group_id = ANY(${toPgUuidArray(userGroups)}::uuid[])
        OR (${userId}::uuid IS NOT NULL AND authenticated_only = true)
        OR (user_id IS NULL AND group_id IS NULL AND authenticated_only = false)
      )
    ORDER BY
      CASE permission
        WHEN 'admin' THEN 4
        WHEN 'write' THEN 3
        WHEN 'read' THEN 2
        WHEN 'none' THEN 1
      END DESC
    LIMIT 1
  `;

  return rows[0]?.permission ?? "none";
};

/**
 * Resolve display names for access entries.
 * Populates the displayName field based on principal type.
 */
export const resolveDisplayNames = async (entries: AccessEntry[]): Promise<AccessEntry[]> => {
  const userIds = entries.filter((e) => e.principal.type === "user").map((e) => (e.principal as { type: "user"; userId: string }).userId);

  const groupIds = entries
    .filter((e) => e.principal.type === "group")
    .map((e) => (e.principal as { type: "group"; groupId: string }).groupId);

  // Fetch user display names
  const userNames = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await sql<{ id: string; display_name: string; uid: string }[]>`
      SELECT id, display_name, uid
      FROM auth.users
      WHERE id = ANY(${toPgUuidArray(userIds)}::uuid[])
    `;
    for (const u of users) {
      userNames.set(u.id, u.display_name || u.uid);
    }
  }

  const groupNames = new Map<string, string>();
  if (groupIds.length > 0) {
    const groups = await sql<{ id: string; name: string }[]>`
      SELECT id, name
      FROM auth.groups
      WHERE id = ANY(${toPgUuidArray(groupIds)}::uuid[])
    `;
    for (const group of groups) {
      groupNames.set(group.id, group.name);
    }
  }

  return entries.map((entry) => {
    let displayName: string;
    switch (entry.principal.type) {
      case "user":
        displayName = userNames.get(entry.principal.userId) ?? "Unknown User";
        break;
      case "group":
        displayName = groupNames.get(entry.principal.groupId) ?? "Unknown Group";
        break;
      case "authenticated":
        displayName = "All users (incl. guests)";
        break;
      case "public":
        displayName = "Public";
        break;
    }
    return { ...entry, displayName };
  });
};
