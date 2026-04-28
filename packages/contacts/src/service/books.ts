import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import {
  addBookAccess,
  canAccessBook,
  countBookAccess,
  getBookAccessGuard,
  getBookPermission,
  grantBookAccess,
  listBookAccessPaginated,
  removeBookAccess,
} from "./access";
import { isUuid, toPgUuidArray } from "./shared";
import type { ContactBook, CreateBookInput, UpdateBookInput } from "./types";

type DbBook = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
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
      a.user_id = ${config.userId}::uuid
      OR a.group_id = ANY(${toPgUuidArray(config.groups)}::uuid[])
      OR (${config.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
      OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
    ORDER BY b.name ASC
  `;

  return rows.map(mapBook);
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

  if (!accessResult.ok) return fail(accessResult.error);
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
  return ok();
};

/**
 * Returns effective permission for one manual book.
 */
export const getPermission = async (config: { bookId: string; userId: string | null; userGroups: string[] }): Promise<PermissionLevel> =>
  getBookPermission({
    bookId: config.bookId,
    userId: config.userId,
    userGroups: config.userGroups,
  });

/**
 * Checks whether user/groups can access one manual book for the requested level.
 */
export const canAccess = async (config: {
  bookId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> =>
  canAccessBook({
    bookId: config.bookId,
    userId: config.userId,
    userGroups: config.userGroups,
    requiredLevel: config.requiredLevel,
  });

/**
 * Access helpers scoped to manual contact books.
 */
export const access = {
  list: listBookAccessPaginated,
  grant: grantBookAccess,
  remove: (config: { bookId: string; accessId: string }) => removeBookAccess(config.bookId, config.accessId),
  add: (config: { bookId: string; accessId: string }) => addBookAccess(config.bookId, config.accessId),
  count: (config: { bookId: string }) => countBookAccess(config.bookId),
  guard: getBookAccessGuard,
};
