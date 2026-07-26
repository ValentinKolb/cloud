import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { logging } from "./index";

const canUseLoggingDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<Array<{ entries: string | null }>>`
      SELECT to_regclass('logging.entries')::text AS entries
    `;
    return Boolean(row?.entries);
  } catch {
    return false;
  }
};

const suite = (await canUseLoggingDatabase()) ? describe : describe.skip;

suite("logging observability", () => {
  test("returns bounded, gap-filled level buckets with the list filters applied", async () => {
    const source = `observability-${crypto.randomUUID()}`;
    try {
      await sql`
        INSERT INTO logging.entries (level, source, message, metadata, created_at)
        VALUES
          ('info', ${source}, 'fixture accepted', '{"kind":"fixture"}'::jsonb, now() - INTERVAL '3 hours'),
          ('warn', ${source}, 'fixture delayed', '{"kind":"fixture"}'::jsonb, now() - INTERVAL '2 hours'),
          ('error', ${source}, 'fixture failed', '{"kind":"fixture"}'::jsonb, now() - INTERVAL '1 hour')
      `;

      const points = await logging.timeseries({ sources: [source], search: "fixture", sinceHours: 24 });
      expect(points.length).toBeGreaterThanOrEqual(24);
      expect(points.length).toBeLessThanOrEqual(26);
      expect(points.every((point, index) => index === 0 || point.at >= points[index - 1]!.at)).toBe(true);
      expect(points.reduce((sum, point) => sum + point.total, 0)).toBe(3);
      expect(points.reduce((sum, point) => sum + point.error, 0)).toBe(1);
      expect(points.reduce((sum, point) => sum + point.warn, 0)).toBe(1);

      const errors = await logging.timeseries({ source, level: "error", sinceHours: 24 });
      expect(errors.reduce((sum, point) => sum + point.total, 0)).toBe(1);
      expect(errors.every((point) => point.debug === 0 && point.info === 0 && point.warn === 0)).toBe(true);
    } finally {
      await sql`DELETE FROM logging.entries WHERE source = ${source}`;
    }
  });
});
