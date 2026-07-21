import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "./migrate";

const suite = process.env.MAIL_INTEGRATION_TESTS === "1" ? describe : describe.skip;

suite("Mail conversation context cleanup migration", () => {
  test("removes the retired Space-link schema and its historical migration marker", async () => {
    await migrate();
    const [shape] = await sql<Array<{ cleanup_applied: boolean; legacy_applied: boolean; table_present: boolean }>>`
      SELECT
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 70 AND name = 'remove_conversation_space_links'
        ) AS cleanup_applied,
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 68 AND name = 'conversation_space_links'
        ) AS legacy_applied,
        to_regclass('mail.conversation_space_links') IS NOT NULL AS table_present
    `;

    expect(shape).toEqual({
      cleanup_applied: true,
      legacy_applied: false,
      table_present: false,
    });
  });
});
