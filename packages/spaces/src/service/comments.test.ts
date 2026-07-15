import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { list } from "./comments";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<{ comments: string | null }[]>`SELECT to_regclass('spaces.comments')::text AS comments`;
    return Boolean(row?.comments);
  } catch {
    return false;
  }
};

describe("Spaces comment pagination", () => {
  test("returns the newest bounded page in chronological display order", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping Spaces comments DB test: spaces tables are not available.");
      return;
    }

    const [space] = await sql<{ id: string }[]>`
      INSERT INTO spaces.spaces (name, description, color)
      VALUES (${`Comments Test ${crypto.randomUUID()}`}, 'comments pagination test', '#2563eb')
      RETURNING id
    `;

    try {
      const [column] = await sql<{ id: string }[]>`
        INSERT INTO spaces.columns (space_id, name, rank, is_done)
        VALUES (${space!.id}::uuid, 'To Do', 1024, false)
        RETURNING id
      `;
      const [item] = await sql<{ id: string }[]>`
        INSERT INTO spaces.items (space_id, column_id, title, rank)
        VALUES (${space!.id}::uuid, ${column!.id}::uuid, 'Review comments', 1024)
        RETURNING id
      `;
      await sql`
        INSERT INTO spaces.comments (item_id, user_id, content, created_at, updated_at)
        SELECT
          ${item!.id}::uuid,
          NULL,
          'Comment ' || entry,
          '2026-01-01T00:00:00Z'::timestamptz + entry * interval '1 minute',
          '2026-01-01T00:00:00Z'::timestamptz + entry * interval '1 minute'
        FROM generate_series(1, 55) AS entry
      `;

      const first = await list({ itemId: item!.id, pagination: { page: 1, perPage: 20 } });
      expect(first.total).toBe(55);
      expect(first.hasNext).toBe(true);
      expect(first.items.map((entry) => entry.content)).toEqual(Array.from({ length: 20 }, (_, index) => `Comment ${index + 36}`));

      const last = await list({ itemId: item!.id, pagination: { page: 3, perPage: 20 } });
      expect(last.hasNext).toBe(false);
      expect(last.items.map((entry) => entry.content)).toEqual(Array.from({ length: 15 }, (_, index) => `Comment ${index + 1}`));
    } finally {
      await sql`DELETE FROM spaces.spaces WHERE id = ${space!.id}::uuid`;
    }
  });
});
