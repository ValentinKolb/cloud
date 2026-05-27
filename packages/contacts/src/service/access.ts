import {
  type AccessEntry,
  createAccess,
  deleteAccess,
  getEffectivePermission,
  hasPermission,
  type PermissionLevel,
  type Principal,
  resolveDisplayNames,
} from "@valentinkolb/cloud/server";
import { err, fail, ok, type PageParams, type Paginated, paginate, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { isUuid } from "./shared";

type DbBookAccess = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const sliced = items.slice(offset, offset + perPage);
  return {
    items: sliced,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

/**
 * Links one `auth.access` entry to one contact book.
 */
export const addBookAccess = async (bookId: string, accessId: string): Promise<Result<void>> => {
  if (!isUuid(bookId) || !isUuid(accessId)) {
    return fail(err.notFound("Book or access entry"));
  }

  try {
    await sql`
      INSERT INTO contacts.book_access (book_id, access_id)
      VALUES (${bookId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23505") {
      return fail(err.conflict("Book access entry"));
    }
    if (dbError.code === "23503") {
      return fail(err.notFound("Book or access entry"));
    }
    throw error;
  }
};

/**
 * Lists all access entries for a contact book with resolved display names.
 */
export const listBookAccess = async (bookId: string): Promise<AccessEntry[]> => {
  if (!isUuid(bookId)) return [];

  const rows = await sql<DbBookAccess[]>`
    SELECT
      a.id AS access_id,
      a.user_id,
      a.group_id,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM contacts.book_access ba
    JOIN auth.access a ON ba.access_id = a.id
    WHERE ba.book_id = ${bookId}::uuid
    ORDER BY
      CASE
        WHEN a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false THEN 4
        WHEN a.authenticated_only THEN 3
        WHEN a.group_id IS NOT NULL THEN 2
        ELSE 1
      END,
      a.created_at
  `;

  const entries: AccessEntry[] = rows.map((row) => ({
    id: row.access_id,
    principal: row.user_id
      ? { type: "user" as const, userId: row.user_id }
      : row.group_id
        ? { type: "group" as const, groupId: row.group_id }
        : row.authenticated_only
          ? { type: "authenticated" as const }
          : { type: "public" as const },
    permission: row.permission,
    createdAt: row.created_at.toISOString(),
  }));

  return resolveDisplayNames(entries);
};

/**
 * Paginates and filters access entries for one contact book.
 */
export const listBookAccessPaginated = async (config: {
  bookId: string;
  pagination?: PageParams;
  filter?: {
    query?: string;
    principalType?: AccessEntry["principal"]["type"];
  };
}): Promise<Paginated<AccessEntry>> => {
  const items = await listBookAccess(config.bookId);
  const query = config.filter?.query?.trim().toLowerCase();
  const principalType = config.filter?.principalType;

  const filtered = items.filter((entry) => {
    if (principalType && entry.principal.type !== principalType) return false;
    if (!query) return true;

    const displayName = (entry.displayName ?? "").toLowerCase();
    if (displayName.includes(query)) return true;

    if (entry.principal.type === "user") {
      return entry.principal.userId.toLowerCase().includes(query);
    }
    if (entry.principal.type === "group") {
      return entry.principal.groupId.toLowerCase().includes(query);
    }
    if (entry.principal.type === "authenticated") {
      return "all signed-in users authenticated".includes(query);
    }

    return "public".includes(query);
  });

  return paginateItems(filtered, config.pagination);
};

/**
 * Creates a new principal permission and binds it to one book.
 */
export const grantBookAccess = async (config: {
  bookId: string;
  principal: Principal;
  permission: PermissionLevel;
}): Promise<Result<AccessEntry>> => {
  if (!isUuid(config.bookId)) {
    return fail(err.notFound("Book"));
  }

  const existing = await listBookAccess(config.bookId);
  const duplicate = existing.find((entry) => {
    if (config.principal.type === "public" && entry.principal.type === "public") {
      return true;
    }
    if (config.principal.type === "authenticated" && entry.principal.type === "authenticated") {
      return true;
    }
    if (config.principal.type === "user" && entry.principal.type === "user" && config.principal.userId === entry.principal.userId) {
      return true;
    }
    if (config.principal.type === "group" && entry.principal.type === "group" && config.principal.groupId === entry.principal.groupId) {
      return true;
    }
    return false;
  });
  if (duplicate) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this book",
      status: 409,
    });
  }

  const created = await createAccess({
    principal: config.principal,
    permission: config.permission,
  });
  if (!created.ok) return created;

  const linked = await addBookAccess(config.bookId, created.data.id);
  if (!linked.ok) {
    await deleteAccess({ id: created.data.id });
    return linked;
  }

  const entries = await listBookAccess(config.bookId);
  const createdEntry = entries.find((entry) => entry.id === created.data.id);
  if (!createdEntry) {
    return fail(err.internal("Failed to retrieve created access entry"));
  }

  return ok(createdEntry);
};

/**
 * Removes one access entry from a contact book after relation validation.
 */
export const removeBookAccess = async (bookId: string, accessId: string): Promise<Result<void>> => {
  if (!isUuid(bookId) || !isUuid(accessId)) {
    return fail(err.notFound("Book or access entry"));
  }

  const [exists] = await sql<{ access_id: string }[]>`
    SELECT access_id
    FROM contacts.book_access
    WHERE book_id = ${bookId}::uuid
      AND access_id = ${accessId}::uuid
  `;
  if (!exists) {
    return fail(err.notFound("Access entry for this book"));
  }

  return deleteAccess({ id: accessId });
};

/**
 * Counts access entries for one contact book.
 */
export const countBookAccess = async (bookId: string): Promise<number> => {
  if (!isUuid(bookId)) return 0;

  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM contacts.book_access
    WHERE book_id = ${bookId}::uuid
  `;

  return row?.count ?? 0;
};

/**
 * Returns guard values for safe ACL update/removal operations.
 */
export const getBookAccessGuard = async (config: {
  bookId: string;
  accessId: string;
}): Promise<{
  total: number;
  otherAdmins: number;
  currentPermission: PermissionLevel | null;
}> => {
  if (!isUuid(config.bookId) || !isUuid(config.accessId)) {
    return { total: 0, otherAdmins: 0, currentPermission: null };
  }

  const [row] = await sql<
    {
      total: number;
      other_admins: number;
      current_permission: PermissionLevel | null;
    }[]
  >`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE a.permission = 'admin'::auth.permission_level
          AND a.id <> ${config.accessId}::uuid
      )::int AS other_admins,
      MAX(CASE WHEN a.id = ${config.accessId}::uuid THEN a.permission END) AS current_permission
    FROM contacts.book_access ba
    JOIN auth.access a ON ba.access_id = a.id
    WHERE ba.book_id = ${config.bookId}::uuid
  `;

  return {
    total: row?.total ?? 0,
    otherAdmins: row?.other_admins ?? 0,
    currentPermission: row?.current_permission ?? null,
  };
};

/**
 * Resolves the effective permission of a user for one manual book.
 */
export const getBookPermission = async (config: {
  bookId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  if (!isUuid(config.bookId)) return "none";

  const accessRows = await sql<{ access_id: string }[]>`
    SELECT access_id
    FROM contacts.book_access
    WHERE book_id = ${config.bookId}::uuid
  `;

  const accessIds = accessRows.map((row) => row.access_id);
  if (accessIds.length === 0) return "none";

  return getEffectivePermission({
    accessIds,
    userId: config.userId,
    userGroups: config.userGroups,
  });
};

/**
 * Checks whether the user satisfies the required permission for one manual book.
 */
export const canAccessBook = async (config: {
  bookId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const permission = await getBookPermission({
    bookId: config.bookId,
    userId: config.userId,
    userGroups: config.userGroups,
  });

  return hasPermission(permission, config.requiredLevel ?? "read");
};
