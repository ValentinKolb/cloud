import { sql } from "bun";
import type { MutationResult, SpaceColumn, CreateColumn, UpdateColumn } from "@/contracts";
import { rank } from "./rank";

// ==========================
// Columns Service
// ==========================

type DbColumn = {
  id: string;
  space_id: string;
  name: string;
  color: string | null;
  rank: string;
  is_done: boolean;
  created_at: Date;
};

/**
 * Converts one database column row into the public `SpaceColumn` shape.
 */
const mapToColumn = (row: DbColumn): SpaceColumn => ({
  id: row.id,
  spaceId: row.space_id,
  name: row.name,
  color: row.color,
  rank: row.rank,
  isDone: row.is_done,
});

/**
 * List columns for a space
 */
export const list = async (params: { spaceId: string }): Promise<SpaceColumn[]> => {
  const rows = await sql<DbColumn[]>`
    SELECT id, space_id, name, color, rank::text AS rank, is_done, created_at
    FROM spaces.columns
    WHERE space_id = ${params.spaceId}
    ORDER BY rank
  `;
  return rows.map(mapToColumn);
};

/**
 * Get a column by ID
 */
export const get = async (params: { id: string }): Promise<SpaceColumn | null> => {
  const [row] = await sql<DbColumn[]>`
    SELECT c.id, c.space_id, c.name, c.color, c.rank::text AS rank, c.is_done, c.created_at
    FROM spaces.columns c
    WHERE c.id = ${params.id}
  `;
  return row ? mapToColumn(row) : null;
};

/**
 * Create a new column
 */
export const create = async (params: { spaceId: string; data: CreateColumn }): Promise<MutationResult<SpaceColumn>> => {
  const { spaceId, data } = params;

  // Get next rank at the end of this space
  const [maxRow] = await sql<{ max: string | null }[]>`
    SELECT MAX(rank)::text AS max
    FROM spaces.columns
    WHERE space_id = ${spaceId}
  `;
  const nextRank = rank.next(maxRow?.max);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO spaces.columns (space_id, name, color, rank, is_done)
    VALUES (${spaceId}, ${data.name}, ${data.color ?? null}, ${rank.toDb(nextRank)}::bigint, ${data.isDone})
    RETURNING id
  `;

  if (!row) {
    return { ok: false, error: "Failed to create column", status: 500 };
  }

  const created = await get({ id: row.id });
  if (!created) {
    return { ok: false, error: "Failed to load created column", status: 500 };
  }

  return { ok: true, data: created };
};

/**
 * Update a column
 */
export const update = async (params: { id: string; data: UpdateColumn }): Promise<MutationResult<SpaceColumn>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Column not found", status: 404 };
  }

  const name = data.name ?? existing.name;
  const color = data.color === undefined ? existing.color : data.color;
  const isDone = data.isDone ?? existing.isDone;

  const [row] = await sql<{ id: string }[]>`
    UPDATE spaces.columns
    SET name = ${name}, color = ${color}, is_done = ${isDone}
    WHERE id = ${id}
    RETURNING id
  `;

  if (!row) {
    return { ok: false, error: "Failed to update column", status: 500 };
  }

  const updated = await get({ id: row.id });
  if (!updated) {
    return { ok: false, error: "Failed to load updated column", status: 500 };
  }

  return { ok: true, data: updated };
};

/**
 * Delete a column (only if empty)
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  // Check if column has items
  const [itemCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM spaces.items WHERE column_id = ${params.id}
  `;

  if (itemCount && itemCount.count > 0) {
    return { ok: false, error: "Cannot delete column with items", status: 400 };
  }

  const result = await sql`
    DELETE FROM spaces.columns
    WHERE id = ${params.id}
  `;

  if (result.count === 0) {
    return { ok: false, error: "Column not found", status: 404 };
  }

  return { ok: true, data: undefined };
};

/**
 * Reorder columns
 */
export const reorder = async (params: { spaceId: string; columnIds: string[] }): Promise<MutationResult<void>> => {
  const { spaceId, columnIds } = params;

  // Verify all columns belong to the space
  const columns = await list({ spaceId });
  const columnIdSet = new Set(columns.map((c) => c.id));

  for (const id of columnIds) {
    if (!columnIdSet.has(id)) {
      return { ok: false, error: `Column ${id} not found in space`, status: 400 };
    }
  }

  if (columnIds.length !== columns.length) {
    return { ok: false, error: "Must include all columns in reorder", status: 400 };
  }

  // Update ranks by explicit order
  for (let i = 0; i < columnIds.length; i++) {
    const nextRank = rank.atIndex(i);
    await sql`
      UPDATE spaces.columns
      SET rank = ${rank.toDb(nextRank)}::bigint
      WHERE id = ${columnIds[i]}
    `;
  }

  return { ok: true, data: undefined };
};
