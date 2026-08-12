import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { shortIdsFinalized } from "./lib/short-id";
import { migrate } from "./migrate";

const canUseDatabase = async () => {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

const suite = (await canUseDatabase()) ? describe : describe.skip;

suite("Venue short-ID migration", () => {
  test("is idempotent and leaves every persisted public resource resolvable", async () => {
    await migrate();
    await migrate();
    expect(await shortIdsFinalized()).toBeTrue();
    const [row] = await sql<{ missing: number; malformed: number; duplicate_groups: number }[]>`
      SELECT
        ((SELECT count(*) FROM venue.venues WHERE short_id IS NULL)
          + (SELECT count(*) FROM venue.opening_rules WHERE short_id IS NULL)
          + (SELECT count(*) FROM venue.date_overrides WHERE short_id IS NULL)
          + (SELECT count(*) FROM venue.shift_templates WHERE short_id IS NULL)
          + (SELECT count(*) FROM venue.shift_assignments WHERE short_id IS NULL)
          + (SELECT count(*) FROM venue.public_sections WHERE short_id IS NULL))::int AS missing,
        ((SELECT count(*) FROM venue.venues WHERE short_id !~ '^[0-9A-Za-z]{6}$')
          + (SELECT count(*) FROM venue.opening_rules WHERE short_id !~ '^[0-9A-Za-z]{6}$')
          + (SELECT count(*) FROM venue.date_overrides WHERE short_id !~ '^[0-9A-Za-z]{6}$')
          + (SELECT count(*) FROM venue.shift_templates WHERE short_id !~ '^[0-9A-Za-z]{6}$')
          + (SELECT count(*) FROM venue.shift_assignments WHERE short_id !~ '^[0-9A-Za-z]{6}$')
          + (SELECT count(*) FROM venue.public_sections WHERE short_id !~ '^[0-9A-Za-z]{6}$'))::int AS malformed,
        ((SELECT count(*) FROM (SELECT short_id FROM venue.venues GROUP BY short_id HAVING count(*) > 1) d)
          + (SELECT count(*) FROM (SELECT short_id FROM venue.opening_rules GROUP BY short_id HAVING count(*) > 1) d)
          + (SELECT count(*) FROM (SELECT short_id FROM venue.date_overrides GROUP BY short_id HAVING count(*) > 1) d)
          + (SELECT count(*) FROM (SELECT short_id FROM venue.shift_templates GROUP BY short_id HAVING count(*) > 1) d)
          + (SELECT count(*) FROM (SELECT short_id FROM venue.shift_assignments GROUP BY short_id HAVING count(*) > 1) d)
          + (SELECT count(*) FROM (SELECT short_id FROM venue.public_sections GROUP BY short_id HAVING count(*) > 1) d))::int AS duplicate_groups
    `;
    expect(row).toEqual({ missing: 0, malformed: 0, duplicate_groups: 0 });
  }, 30_000);
});
