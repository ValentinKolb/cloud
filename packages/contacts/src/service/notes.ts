import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { isUuid } from "./shared";
import type { ContactNote, CreateContactNoteInput, UpdateContactNoteInput } from "./types";

type DbContactNote = {
  id: string;
  contact_id: string;
  author_user_id: string | null;
  author_display_name: string;
  author_avatar_hash: string | null;
  content: string;
  created_at: Date;
  updated_at: Date;
};

const mapNote = (row: DbContactNote): ContactNote => ({
  id: row.id,
  contactId: row.contact_id,
  authorUserId: row.author_user_id,
  authorDisplayName: row.author_display_name,
  authorAvatarHash: row.author_avatar_hash,
  content: row.content,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const MAX_CONTENT_LENGTH = 10_000;

const verifyContactInBook = async (config: { bookId: string; contactId: string }): Promise<boolean> => {
  if (!isUuid(config.bookId) || !isUuid(config.contactId)) return false;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM contacts.contacts
    WHERE id = ${config.contactId}::uuid
      AND book_id = ${config.bookId}::uuid
  `;
  return !!row;
};

/**
 * Lists notes for one contact in chronological order (newest first).
 * Caller must already have read access to the contact's book.
 */
export const list = async (config: { bookId: string; contactId: string }): Promise<ContactNote[]> => {
  if (!(await verifyContactInBook(config))) return [];

  const rows = await sql<DbContactNote[]>`
    SELECT n.id, n.contact_id, n.author_user_id, n.author_display_name, u.avatar_hash AS author_avatar_hash, n.content, n.created_at, n.updated_at
    FROM contacts.contact_notes n
    LEFT JOIN auth.users u ON u.id = n.author_user_id
    WHERE n.contact_id = ${config.contactId}::uuid
    ORDER BY n.created_at DESC
  `;
  return rows.map(mapNote);
};

/**
 * Appends one note to a contact. Author identity is snapshotted so the note
 * stays readable if the user account is later removed.
 */
export const create = async (config: {
  bookId: string;
  contactId: string;
  authorUserId: string;
  authorDisplayName: string;
  data: CreateContactNoteInput;
}): Promise<Result<ContactNote>> => {
  const trimmed = config.data.content.trim();
  if (!trimmed) return fail(err.badInput("Note content is required"));
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return fail(err.badInput(`Note must be ${MAX_CONTENT_LENGTH} characters or fewer`));
  }
  if (!(await verifyContactInBook(config))) return fail(err.notFound("Contact"));

  const [row] = await sql<DbContactNote[]>`
    WITH inserted AS (
      INSERT INTO contacts.contact_notes (
        contact_id,
        author_user_id,
        author_display_name,
        content
      ) VALUES (
        ${config.contactId}::uuid,
        ${config.authorUserId}::uuid,
        ${config.authorDisplayName},
        ${trimmed}
      )
      RETURNING id, contact_id, author_user_id, author_display_name, content, created_at, updated_at
    )
    SELECT i.id, i.contact_id, i.author_user_id, i.author_display_name, u.avatar_hash AS author_avatar_hash, i.content, i.created_at, i.updated_at
    FROM inserted i
    LEFT JOIN auth.users u ON u.id = i.author_user_id
  `;
  if (!row) return fail(err.internal("Failed to create note"));
  return ok(mapNote(row));
};

/**
 * Updates one note's content. Caller must be the author. Book admins can
 * delete any note (see `remove`) but cannot edit other users' wording.
 */
export const update = async (config: {
  bookId: string;
  contactId: string;
  noteId: string;
  authorUserId: string;
  data: UpdateContactNoteInput;
}): Promise<Result<ContactNote>> => {
  const trimmed = config.data.content.trim();
  if (!trimmed) return fail(err.badInput("Note content is required"));
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return fail(err.badInput(`Note must be ${MAX_CONTENT_LENGTH} characters or fewer`));
  }
  if (!isUuid(config.noteId)) return fail(err.notFound("Note"));
  if (!(await verifyContactInBook(config))) return fail(err.notFound("Contact"));

  const [existing] = await sql<{ author_user_id: string | null }[]>`
    SELECT author_user_id FROM contacts.contact_notes
    WHERE id = ${config.noteId}::uuid
      AND contact_id = ${config.contactId}::uuid
  `;
  if (!existing) return fail(err.notFound("Note"));
  if (existing.author_user_id !== config.authorUserId) {
    return fail(err.forbidden("Only the author may edit this note"));
  }

  const [row] = await sql<DbContactNote[]>`
    WITH updated AS (
      UPDATE contacts.contact_notes
      SET content = ${trimmed}, updated_at = now()
      WHERE id = ${config.noteId}::uuid
      RETURNING id, contact_id, author_user_id, author_display_name, content, created_at, updated_at
    )
    SELECT u2.id, u2.contact_id, u2.author_user_id, u2.author_display_name, au.avatar_hash AS author_avatar_hash, u2.content, u2.created_at, u2.updated_at
    FROM updated u2
    LEFT JOIN auth.users au ON au.id = u2.author_user_id
  `;
  if (!row) return fail(err.internal("Failed to update note"));
  return ok(mapNote(row));
};

/**
 * Deletes one note. Caller must be the author or a book admin.
 */
export const remove = async (config: {
  bookId: string;
  contactId: string;
  noteId: string;
  authorUserId: string;
  isBookAdmin: boolean;
}): Promise<Result<void>> => {
  if (!isUuid(config.noteId)) return fail(err.notFound("Note"));
  if (!(await verifyContactInBook(config))) return fail(err.notFound("Contact"));

  const [existing] = await sql<{ author_user_id: string | null }[]>`
    SELECT author_user_id FROM contacts.contact_notes
    WHERE id = ${config.noteId}::uuid
      AND contact_id = ${config.contactId}::uuid
  `;
  if (!existing) return fail(err.notFound("Note"));
  if (existing.author_user_id !== config.authorUserId && !config.isBookAdmin) {
    return fail(err.forbidden("Only the author or a book admin may delete this note"));
  }

  await sql`DELETE FROM contacts.contact_notes WHERE id = ${config.noteId}::uuid`;
  return ok(undefined);
};
