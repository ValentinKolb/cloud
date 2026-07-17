import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { list } from "./comments";
import { splitRecurring, update } from "./items";

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
        INSERT INTO spaces.items (
          space_id, column_id, title, starts_at, ends_at, recurrence_rrule, recurrence_dtstart, rank
        )
        VALUES (
          ${space!.id}::uuid,
          ${column!.id}::uuid,
          'Review comments',
          '2026-07-01T09:00:00.000Z',
          '2026-07-01T09:30:00.000Z',
          'FREQ=DAILY',
          '2026-07-01T09:00:00.000Z',
          1024
        )
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

      const firstOccurrence = "2026-07-17T09:00:00.000Z";
      const secondOccurrence = "2026-07-18T09:00:00.000Z";
      await sql`
        INSERT INTO spaces.comments (item_id, recurrence_id, user_id, content)
        VALUES
          (${item!.id}::uuid, ${firstOccurrence}::timestamptz, NULL, 'First occurrence'),
          (${item!.id}::uuid, ${secondOccurrence}::timestamptz, NULL, 'Second occurrence')
      `;

      const series = await list({ itemId: item!.id });
      expect(series.total).toBe(55);
      const occurrence = await list({ itemId: item!.id, recurrenceId: firstOccurrence });
      expect(occurrence.items.map((entry) => [entry.content, entry.recurrenceId])).toEqual([["First occurrence", firstOccurrence]]);

      const [override] = await sql<{ id: string }[]>`
        INSERT INTO spaces.items (
          space_id, column_id, title, starts_at, ends_at, recurring_event_id, recurrence_id, rank
        )
        VALUES (
          ${space!.id}::uuid,
          ${column!.id}::uuid,
          'Moved occurrence',
          '2026-07-17T10:00:00.000Z',
          '2026-07-17T10:30:00.000Z',
          ${item!.id}::uuid,
          ${firstOccurrence}::timestamptz,
          2048
        )
        RETURNING id
      `;
      const shifted = await update({
        id: item!.id,
        data: {
          startsAt: "2026-07-01T10:00:00.000Z",
          endsAt: "2026-07-01T10:30:00.000Z",
        },
      });
      expect(shifted.ok).toBe(true);
      const [shiftedOverride] = await sql<{ recurrence_id: Date; starts_at: Date }[]>`
        SELECT recurrence_id, starts_at
        FROM spaces.items
        WHERE id = ${override!.id}::uuid
      `;
      expect(shiftedOverride?.recurrence_id.toISOString()).toBe("2026-07-17T10:00:00.000Z");
      expect(shiftedOverride?.starts_at.toISOString()).toBe("2026-07-17T11:00:00.000Z");
      const shiftedOccurrence = await list({ itemId: item!.id, recurrenceId: "2026-07-17T10:00:00.000Z" });
      expect(shiftedOccurrence.items.map((entry) => entry.content)).toEqual(["First occurrence"]);

      const splitRecurrenceId = "2026-07-18T10:00:00.000Z";
      const [futureOverride] = await sql<{ id: string }[]>`
        INSERT INTO spaces.items (
          space_id, column_id, title, starts_at, ends_at, recurring_event_id, recurrence_id, rank
        )
        VALUES (
          ${space!.id}::uuid,
          ${column!.id}::uuid,
          'Future moved occurrence',
          '2026-07-18T13:00:00.000Z',
          '2026-07-18T13:30:00.000Z',
          ${item!.id}::uuid,
          ${splitRecurrenceId}::timestamptz,
          3072
        )
        RETURNING id
      `;
      const split = await splitRecurring({
        id: item!.id,
        data: {
          recurrenceId: splitRecurrenceId,
          startsAt: "2026-07-18T12:00:00.000Z",
          endsAt: "2026-07-18T12:30:00.000Z",
          allDay: false,
        },
        createdBy: null,
      });
      expect(split.ok).toBe(true);
      if (!split.ok) throw new Error(split.error);

      const [movedOverride] = await sql<{ recurring_event_id: string; recurrence_id: Date; starts_at: Date }[]>`
        SELECT recurring_event_id, recurrence_id, starts_at
        FROM spaces.items
        WHERE id = ${futureOverride!.id}::uuid
      `;
      expect(movedOverride?.recurring_event_id).toBe(split.data.id);
      expect(movedOverride?.recurrence_id.toISOString()).toBe("2026-07-18T12:00:00.000Z");
      expect(movedOverride?.starts_at.toISOString()).toBe("2026-07-18T15:00:00.000Z");
      const movedComment = await list({ itemId: split.data.id, recurrenceId: "2026-07-18T12:00:00.000Z" });
      expect(movedComment.items.map((entry) => entry.content)).toEqual(["Second occurrence"]);
      expect((await list({ itemId: item!.id, recurrenceId: splitRecurrenceId })).total).toBe(0);

      const [seriesBefore] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM spaces.items
        WHERE space_id = ${space!.id}::uuid
          AND recurrence_rrule IS NOT NULL
      `;
      const firstOccurrenceMove = await splitRecurring({
        id: split.data.id,
        data: {
          recurrenceId: "2026-07-18T12:00:00.000Z",
          startsAt: "2026-07-18T14:00:00.000Z",
          endsAt: "2026-07-18T14:30:00.000Z",
          allDay: false,
        },
        createdBy: null,
      });
      expect(firstOccurrenceMove.ok).toBe(true);
      if (!firstOccurrenceMove.ok) throw new Error(firstOccurrenceMove.error);
      expect(firstOccurrenceMove.data.id).toBe(split.data.id);
      const [seriesAfter] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM spaces.items
        WHERE space_id = ${space!.id}::uuid
          AND recurrence_rrule IS NOT NULL
      `;
      expect(seriesAfter?.count).toBe(seriesBefore?.count);
      expect((await list({ itemId: split.data.id, recurrenceId: "2026-07-18T14:00:00.000Z" })).items[0]?.content).toBe("Second occurrence");
    } finally {
      await sql`DELETE FROM spaces.spaces WHERE id = ${space!.id}::uuid`;
    }
  });
});
