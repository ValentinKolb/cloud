import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { isUuid, toPgUuidArray } from "./shared";
import type { ContactTag, CreateContactTagInput, UpdateContactTagInput } from "./types";

type DbTag = {
  id: string;
  book_id: string;
  name: string;
  color: string;
  created_at: Date;
  updated_at: Date;
};

const mapTag = (row: DbTag): ContactTag => ({
  id: row.id,
  bookId: row.book_id,
  name: row.name,
  color: row.color,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const validateInput = (input: { name?: string; color?: string }): Result<void> => {
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) return fail(err.badInput("Tag name is required"));
    if (trimmed.length > 50) return fail(err.badInput("Tag name must be 50 characters or fewer"));
  }
  if (input.color !== undefined && !HEX_COLOR.test(input.color)) {
    return fail(err.badInput("Tag color must be a #RRGGBB hex value"));
  }
  return ok(undefined);
};

/** Lists all tags belonging to one book, alphabetical by name. */
export const list = async (config: { bookId: string }): Promise<ContactTag[]> => {
  if (!isUuid(config.bookId)) return [];
  const rows = await sql<DbTag[]>`
    SELECT id, book_id, name, color, created_at, updated_at
    FROM contacts.tags
    WHERE book_id = ${config.bookId}::uuid
    ORDER BY LOWER(name) ASC
  `;
  return rows.map(mapTag);
};

export const create = async (config: { bookId: string; data: CreateContactTagInput }): Promise<Result<ContactTag>> => {
  const validation = validateInput(config.data);
  if (!validation.ok) return validation;
  if (!isUuid(config.bookId)) return fail(err.notFound("Book"));

  try {
    const [row] = await sql<DbTag[]>`
      INSERT INTO contacts.tags (book_id, name, color)
      VALUES (${config.bookId}::uuid, ${config.data.name.trim()}, ${config.data.color})
      RETURNING id, book_id, name, color, created_at, updated_at
    `;
    if (!row) return fail(err.internal("Failed to create tag"));
    return ok(mapTag(row));
  } catch (error) {
    // PG error 23505 = unique_violation. The (book_id, name) unique constraint
    // hits when the user re-creates a tag with an existing name.
    // Bun's sql client surfaces the SQLSTATE on `errno`; older versions of the
    // same client (and other parts of this repo) read it from `code`. Check
    // both so the conflict response works regardless of runtime version.
    if (isObject(error) && (error["errno"] === "23505" || error["code"] === "23505")) {
      return fail(err.conflict("Tag with that name"));
    }
    throw error;
  }
};

export const update = async (config: { bookId: string; id: string; data: UpdateContactTagInput }): Promise<Result<ContactTag>> => {
  const validation = validateInput(config.data);
  if (!validation.ok) return validation;
  if (!isUuid(config.bookId) || !isUuid(config.id)) return fail(err.notFound("Tag"));

  const [existing] = await sql<DbTag[]>`
    SELECT id, book_id, name, color, created_at, updated_at
    FROM contacts.tags
    WHERE id = ${config.id}::uuid AND book_id = ${config.bookId}::uuid
  `;
  if (!existing) return fail(err.notFound("Tag"));

  const nextName = config.data.name === undefined ? existing.name : config.data.name.trim();
  const nextColor = config.data.color === undefined ? existing.color : config.data.color;

  try {
    const [row] = await sql<DbTag[]>`
      UPDATE contacts.tags
      SET name = ${nextName}, color = ${nextColor}, updated_at = now()
      WHERE id = ${config.id}::uuid AND book_id = ${config.bookId}::uuid
      RETURNING id, book_id, name, color, created_at, updated_at
    `;
    if (!row) return fail(err.internal("Failed to update tag"));
    return ok(mapTag(row));
  } catch (error) {
    // Bun's sql client surfaces the SQLSTATE on `errno`; older versions of the
    // same client (and other parts of this repo) read it from `code`. Check
    // both so the conflict response works regardless of runtime version.
    if (isObject(error) && (error["errno"] === "23505" || error["code"] === "23505")) {
      return fail(err.conflict("Tag with that name"));
    }
    throw error;
  }
};

export const remove = async (config: { bookId: string; id: string }): Promise<Result<void>> => {
  if (!isUuid(config.bookId) || !isUuid(config.id)) return fail(err.notFound("Tag"));
  const [row] = await sql<{ id: string }[]>`
    DELETE FROM contacts.tags
    WHERE id = ${config.id}::uuid AND book_id = ${config.bookId}::uuid
    RETURNING id
  `;
  if (!row) return fail(err.notFound("Tag"));
  return ok(undefined);
};

/**
 * Validates that every id in `tagIds` is a UUID belonging to `bookId`. Used
 * by the contact upsert flow to guard tag assignment BEFORE the contact row
 * is inserted/updated, so a bad tag list cannot leave a half-persisted
 * contact behind.
 *
 * Returns the deduplicated, validated id list on success.
 */
export const validateTagsInBook = async (config: { bookId: string; tagIds: string[] }): Promise<Result<string[]>> => {
  const validIds = config.tagIds.filter(isUuid);
  if (validIds.length !== config.tagIds.length) {
    return fail(err.badInput("Tag ids must be UUIDs"));
  }
  if (validIds.length === 0) return ok([]);

  const found = await sql<{ id: string }[]>`
    SELECT id FROM contacts.tags
    WHERE id = ANY(${toPgUuidArray(validIds)}::uuid[])
      AND book_id = ${config.bookId}::uuid
  `;
  if (found.length !== validIds.length) {
    return fail(err.badInput("One or more tags do not belong to this book"));
  }
  return ok(validIds);
};

/**
 * Replaces all tag assignments for a contact. The caller MUST have validated
 * the tag ids beforehand via `validateTagsInBook`; this function trusts its
 * inputs and only writes.
 */
export const replaceAssignments = async (config: { contactId: string; tagIds: string[] }): Promise<void> => {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM contacts.contact_tag_assignments WHERE contact_id = ${config.contactId}::uuid`;
    if (config.tagIds.length === 0) return;
    for (const tagId of config.tagIds) {
      await tx`
        INSERT INTO contacts.contact_tag_assignments (contact_id, tag_id)
        VALUES (${config.contactId}::uuid, ${tagId}::uuid)
        ON CONFLICT DO NOTHING
      `;
    }
  });
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
