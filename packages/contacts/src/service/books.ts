import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { serviceAccounts } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  addBookAccess,
  CONTACT_BOOK_RESOURCE_TYPE,
  CONTACTS_APP_ID,
  canAccessBook,
  countBookAccess,
  getBookAccessGuard,
  getBookPermission,
  grantBookAccess,
  listBookAccessPaginated,
  listContactBookApiKeys,
  removeBookAccess,
  updateBookAccessPermission,
} from "./access";
import { isUuid, toPgUuidArray } from "./shared";
import type { ContactBook, ContactBookAdminListItem, CreateBookInput, UpdateBookInput } from "./types";

type DbBook = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbAdminBook = DbBook & {
  permission_count: number;
  contact_count: number;
};

/**
 * Maps one manual book row into the public service model.
 */
const mapBook = (row: DbBook): ContactBook => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isSystem: false,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapAdminBook = (row: DbAdminBook): ContactBookAdminListItem => ({
  ...mapBook(row),
  permissionCount: row.permission_count,
  contactCount: row.contact_count,
});

/**
 * Lists manual books that are readable by the provided user/group principals.
 */
export const list = async (config: { userId: string | null; groups: string[] }): Promise<ContactBook[]> => {
  const rows = await sql<DbBook[]>`
    SELECT DISTINCT b.id, b.name, b.description, b.created_at, b.updated_at
    FROM contacts.books b
    JOIN contacts.book_access ba ON ba.book_id = b.id
    JOIN auth.access a ON a.id = ba.access_id
    WHERE
      a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
      AND (
        a.user_id = ${config.userId}::uuid
        OR a.group_id = ANY(${toPgUuidArray(config.groups)}::uuid[])
        OR (${config.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
        OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
      )
    ORDER BY b.name ASC
  `;

  return rows.map(mapBook);
};

/**
 * Lists all manual books for admin pages with permission and contact counts.
 */
export const listAdmin = async (params: {
  search?: string;
  pagination: { limit: number; offset: number };
}): Promise<{ items: ContactBookAdminListItem[]; total: number }> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const rows = await sql<DbAdminBook[]>`
    SELECT
      b.id,
      b.name,
      b.description,
      b.created_at,
      b.updated_at,
      COUNT(DISTINCT ba.access_id)::int AS permission_count,
      COUNT(DISTINCT c.id)::int AS contact_count
    FROM contacts.books b
    LEFT JOIN contacts.book_access ba ON ba.book_id = b.id
    LEFT JOIN contacts.contacts c ON c.book_id = b.id
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(b.name) LIKE ${pattern}
      OR LOWER(COALESCE(b.description, '')) LIKE ${pattern}
    )
    GROUP BY b.id, b.name, b.description, b.created_at, b.updated_at
    ORDER BY LOWER(b.name) ASC, b.created_at ASC
    LIMIT ${params.pagination.limit}
    OFFSET ${params.pagination.offset}
  `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM contacts.books b
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(b.name) LIKE ${pattern}
      OR LOWER(COALESCE(b.description, '')) LIKE ${pattern}
    )
  `;

  return {
    items: rows.map(mapAdminBook),
    total: countRow?.count ?? 0,
  };
};

/**
 * Aggregated admin stats for manual contact books.
 */
export const adminSummary = async (params: {
  search?: string;
}): Promise<{
  total: number;
  orphaned: number;
  totalPermissions: number;
  totalContacts: number;
}> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const [row] = await sql<{ total: number; orphaned: number; total_permissions: number; total_contacts: number }[]>`
    WITH filtered AS (
      SELECT
        b.id,
        COUNT(DISTINCT ba.access_id)::int AS permission_count,
        COUNT(DISTINCT c.id)::int AS contact_count
      FROM contacts.books b
      LEFT JOIN contacts.book_access ba ON ba.book_id = b.id
      LEFT JOIN contacts.contacts c ON c.book_id = b.id
      WHERE (
        ${pattern}::text IS NULL
        OR LOWER(b.name) LIKE ${pattern}
        OR LOWER(COALESCE(b.description, '')) LIKE ${pattern}
      )
      GROUP BY b.id
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE permission_count = 0)::int AS orphaned,
      COALESCE(SUM(permission_count), 0)::int AS total_permissions,
      COALESCE(SUM(contact_count), 0)::int AS total_contacts
    FROM filtered
  `;

  return {
    total: row?.total ?? 0,
    orphaned: row?.orphaned ?? 0,
    totalPermissions: row?.total_permissions ?? 0,
    totalContacts: row?.total_contacts ?? 0,
  };
};

/**
 * Loads one manual book by ID.
 */
export const get = async (config: { id: string }): Promise<ContactBook | null> => {
  if (!isUuid(config.id)) return null;

  const [row] = await sql<DbBook[]>`
    SELECT id, name, description, created_at, updated_at
    FROM contacts.books
    WHERE id = ${config.id}::uuid
  `;

  return row ? mapBook(row) : null;
};

/**
 * Creates a manual book and grants admin access to the creator.
 */
export const create = async (config: { data: CreateBookInput; creatorId: string }): Promise<Result<ContactBook>> => {
  const [row] = await sql<DbBook[]>`
    INSERT INTO contacts.books (name, description)
    VALUES (${config.data.name}, ${config.data.description ?? null})
    RETURNING id, name, description, created_at, updated_at
  `;

  if (!row) return fail(err.internal("Failed to create book"));

  const accessResult = await grantBookAccess({
    bookId: row.id,
    principal: { type: "user", userId: config.creatorId },
    permission: "admin",
  });

  if (!accessResult.ok) {
    await sql`
      DELETE FROM contacts.books
      WHERE id = ${row.id}::uuid
    `;
    return fail(accessResult.error);
  }
  return ok(mapBook(row));
};

/**
 * Updates mutable metadata of one manual book.
 */
export const update = async (config: { id: string; data: UpdateBookInput }): Promise<Result<ContactBook>> => {
  if (!isUuid(config.id)) return fail(err.notFound("Book"));

  const existing = await get({ id: config.id });
  if (!existing) return fail(err.notFound("Book"));

  const name = config.data.name ?? existing.name;
  const description = config.data.description === undefined ? existing.description : config.data.description;

  const [row] = await sql<DbBook[]>`
    UPDATE contacts.books
    SET
      name = ${name},
      description = ${description},
      updated_at = now()
    WHERE id = ${config.id}::uuid
    RETURNING id, name, description, created_at, updated_at
  `;

  if (!row) return fail(err.internal("Failed to update book"));
  return ok(mapBook(row));
};

/**
 * Deletes one manual book and all linked contacts/access junction rows.
 */
export const remove = async (config: { id: string }): Promise<Result<void>> => {
  if (!isUuid(config.id)) return fail(err.notFound("Book"));

  const result = await sql`
    DELETE FROM contacts.books
    WHERE id = ${config.id}::uuid
  `;

  if (result.count === 0) return fail(err.notFound("Book"));
  await serviceAccounts.deleteForResource({
    appId: CONTACTS_APP_ID,
    resourceType: CONTACT_BOOK_RESOURCE_TYPE,
    resourceId: config.id,
  });
  return ok();
};

/**
 * Returns effective permission for one manual book.
 */
export const getPermission = async (config: {
  bookId: string;
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
}): Promise<PermissionLevel> =>
  getBookPermission({
    bookId: config.bookId,
    userId: config.userId,
    userGroups: config.userGroups,
    serviceAccountId: config.serviceAccountId ?? null,
  });

/**
 * Checks whether user/groups can access one manual book for the requested level.
 */
export const canAccess = async (config: {
  bookId: string;
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  requiredLevel?: PermissionLevel;
}): Promise<boolean> =>
  canAccessBook({
    bookId: config.bookId,
    userId: config.userId,
    userGroups: config.userGroups,
    serviceAccountId: config.serviceAccountId ?? null,
    requiredLevel: config.requiredLevel,
  });

/**
 * Access helpers scoped to manual contact books.
 */
export const access = {
  list: listBookAccessPaginated,
  grant: grantBookAccess,
  update: updateBookAccessPermission,
  remove: (config: { bookId: string; accessId: string }) => removeBookAccess(config.bookId, config.accessId),
  add: (config: { bookId: string; accessId: string }) => addBookAccess(config.bookId, config.accessId),
  count: (config: { bookId: string }) => countBookAccess(config.bookId),
  guard: getBookAccessGuard,
  apiKeys: {
    list: (config: { bookId: string }) => listContactBookApiKeys(config.bookId),
  },
};
