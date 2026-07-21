import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "./migrate";

const suite = process.env.MAIL_INTEGRATION_TESTS === "1" ? describe : describe.skip;

suite("Mail conversation Space link migration", () => {
  test("installs reserved migration v68 without foreign metadata columns", async () => {
    await migrate();
    const [shape] = await sql<Array<{ applied: boolean; table_present: boolean; index_present: boolean; columns: string[] }>>`
      SELECT
        EXISTS (
          SELECT 1 FROM mail.schema_migrations
          WHERE version = 68 AND name = 'conversation_space_links'
        ) AS applied,
        to_regclass('mail.conversation_space_links') IS NOT NULL AS table_present,
        to_regclass('mail.conversation_space_links_conversation_idx') IS NOT NULL AS index_present,
        (
          SELECT COALESCE(jsonb_agg(column_name ORDER BY ordinal_position), '[]'::jsonb)
          FROM information_schema.columns
          WHERE table_schema = 'mail' AND table_name = 'conversation_space_links'
        ) AS columns
    `;

    expect(shape).toEqual({
      applied: true,
      table_present: true,
      index_present: true,
      columns: ["id", "mailbox_id", "conversation_id", "space_id", "created_by_actor_kind", "created_by_actor_id", "created_at"],
    });
  });
});
