import { sql } from "bun";
import type { MutationResult, SpaceComment } from "@/spaces/contracts";

// ==========================
// Comments Service
// ==========================

type DbComment = {
  id: string;
  item_id: string;
  user_id: string | null;
  user_name: string | null;
  content: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * Converts one joined comment row (including optional author name) to `SpaceComment`.
 */
const mapToComment = (row: DbComment): SpaceComment => ({
  id: row.id,
  itemId: row.item_id,
  userId: row.user_id,
  userName: row.user_name,
  content: row.content,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * List comments for an item
 */
export const list = async (params: { itemId: string }): Promise<SpaceComment[]> => {
  const rows = await sql<DbComment[]>`
    SELECT c.id, c.item_id, c.user_id, u.display_name as user_name, c.content, c.created_at, c.updated_at
    FROM spaces.comments c
    LEFT JOIN auth.users u ON c.user_id = u.id
    WHERE c.item_id = ${params.itemId}
    ORDER BY c.created_at ASC
  `;
  return rows.map(mapToComment);
};

/**
 * Get a comment by ID
 */
export const get = async (params: { id: string }): Promise<SpaceComment | null> => {
  const [row] = await sql<DbComment[]>`
    SELECT c.id, c.item_id, c.user_id, u.display_name as user_name, c.content, c.created_at, c.updated_at
    FROM spaces.comments c
    LEFT JOIN auth.users u ON c.user_id = u.id
    WHERE c.id = ${params.id}
  `;
  return row ? mapToComment(row) : null;
};

/**
 * Create a new comment
 */
export const create = async (params: { itemId: string; userId: string; content: string }): Promise<MutationResult<SpaceComment>> => {
  const { itemId, userId, content } = params;

  // Verify item exists
  const [itemExists] = await sql<{ id: string }[]>`
    SELECT id FROM spaces.items WHERE id = ${itemId}
  `;

  if (!itemExists) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  const [row] = await sql<DbComment[]>`
    INSERT INTO spaces.comments (item_id, user_id, content)
    VALUES (${itemId}, ${userId}, ${content})
    RETURNING id, item_id, user_id, content, created_at, updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to create comment", status: 500 };
  }

  // Get user name
  const [user] = await sql<{ display_name: string }[]>`
    SELECT display_name FROM auth.users WHERE id = ${userId}
  `;

  return {
    ok: true,
    data: {
      ...mapToComment(row),
      userName: user?.display_name ?? null,
    },
  };
};

/**
 * Update a comment
 */
export const update = async (params: { id: string; content: string; userId: string }): Promise<MutationResult<SpaceComment>> => {
  const { id, content, userId } = params;

  // Verify comment exists and belongs to user
  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Comment not found", status: 404 };
  }

  if (existing.userId !== userId) {
    return { ok: false, error: "Cannot edit another user's comment", status: 403 };
  }

  const [row] = await sql<DbComment[]>`
    UPDATE spaces.comments
    SET content = ${content}, updated_at = now()
    WHERE id = ${id}
    RETURNING id, item_id, user_id, content, created_at, updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to update comment", status: 500 };
  }

  return {
    ok: true,
    data: {
      ...mapToComment(row),
      userName: existing.userName,
    },
  };
};

/**
 * Delete a comment
 */
export const remove = async (params: { id: string; userId: string; isAdmin?: boolean }): Promise<MutationResult<void>> => {
  const { id, userId, isAdmin } = params;

  // Verify comment exists
  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Comment not found", status: 404 };
  }

  // Only owner or admin can delete
  if (!isAdmin && existing.userId !== userId) {
    return { ok: false, error: "Cannot delete another user's comment", status: 403 };
  }

  await sql`DELETE FROM spaces.comments WHERE id = ${id}`;

  return { ok: true, data: undefined };
};
