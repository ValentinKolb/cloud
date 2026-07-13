import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "./migrate";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("mail migrations", () => {
  test("upgrades an existing version 23 schema with runtime and source identity hardening", async () => {
    await migrate();
    await sql.begin(async (tx) => {
      await tx`DELETE FROM mail.schema_migrations WHERE version IN (24, 25)`;
      await tx`DROP INDEX IF EXISTS mail.workflow_runs_mailbox_history_idx`;
      await tx`DROP INDEX IF EXISTS mail.message_contents_source_identity_idx`;
      await tx`
        ALTER TABLE mail.activity_events
        ADD CONSTRAINT activity_events_conversation_id_fkey
        FOREIGN KEY (conversation_id) REFERENCES mail.conversations(id) ON DELETE SET NULL
        NOT VALID
      `;
    });

    await migrate();

    const [state] = await sql<
      { migrated: boolean; history_index: boolean; source_identity_index: boolean; mutable_conversation_fk: boolean }[]
    >`
      SELECT
        NOT EXISTS (
          SELECT 1 FROM (VALUES (24), (25)) expected(version)
          WHERE NOT EXISTS (SELECT 1 FROM mail.schema_migrations migration WHERE migration.version = expected.version)
        ) AS migrated,
        to_regclass('mail.workflow_runs_mailbox_history_idx') IS NOT NULL AS history_index,
        to_regclass('mail.message_contents_source_identity_idx') IS NOT NULL AS source_identity_index,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'mail.activity_events'::regclass
            AND conname = 'activity_events_conversation_id_fkey'
        ) AS mutable_conversation_fk
    `;
    expect(state).toEqual({ migrated: true, history_index: true, source_identity_index: true, mutable_conversation_fk: false });
  });
});
