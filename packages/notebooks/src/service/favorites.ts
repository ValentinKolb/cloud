import { sql } from "bun";
import type { MutationResult } from "@valentinkolb/cloud/contracts";
import { noteFavoriteChanged } from "./workspace-events";

export type FavoriteNoteId = {
  noteId: string;
  createdAt: string;
};

export const listIds = async (params: { notebookId: string; userId: string }): Promise<FavoriteNoteId[]> => {
  const rows = await sql<{ note_id: string; created_at: Date }[]>`
    SELECT note_id, created_at
    FROM notebooks.note_favorites
    WHERE notebook_id = ${params.notebookId}::uuid
      AND user_id = ${params.userId}::uuid
    ORDER BY created_at DESC
  `;
  return rows.map((row) => ({ noteId: row.note_id, createdAt: row.created_at.toISOString() }));
};

export const isFavorite = async (params: { noteId: string; userId: string }): Promise<boolean> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM notebooks.note_favorites
      WHERE note_id = ${params.noteId}::uuid
        AND user_id = ${params.userId}::uuid
    ) AS exists
  `;
  return row?.exists ?? false;
};

export const setFavorite = async (params: {
  notebookId: string;
  noteId: string;
  userId: string;
  favorite: boolean;
}): Promise<MutationResult<{ favorite: boolean }>> => {
  if (params.favorite) {
    await sql`
      INSERT INTO notebooks.note_favorites (user_id, notebook_id, note_id)
      VALUES (${params.userId}::uuid, ${params.notebookId}::uuid, ${params.noteId}::uuid)
      ON CONFLICT (user_id, note_id) DO NOTHING
    `;
  } else {
    await sql`
      DELETE FROM notebooks.note_favorites
      WHERE user_id = ${params.userId}::uuid
        AND note_id = ${params.noteId}::uuid
    `;
  }

  await noteFavoriteChanged(params);
  return { ok: true, data: { favorite: params.favorite } };
};

