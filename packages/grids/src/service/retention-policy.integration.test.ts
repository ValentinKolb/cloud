import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { get, preview, remove, update } from "./retention-policy";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Record retention policy integration", () => {
  postgresTest("keeps the default unchanged and derives bounded eligibility without deleting Records", async () => {
    const baseId = testUuid();
    const tableId = testUuid();
    const schemaRevisionId = testUuid();
    const finalRevisionId = testUuid();
    const oldRecordId = testUuid();
    const recentRecordId = testUuid();
    const finalRecordId = testUuid();
    const baseShortId = testShortId("B");
    const tableShortId = testShortId("T");
    const oldShortId = testShortId("O");
    const recentShortId = testShortId("R");
    const finalShortId = testShortId("F");
    const boundedPrefix = testShortId("X").slice(0, 2);
    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Retention fixture')`;
      await sql`INSERT INTO grids.tables (id, short_id, base_id, name) VALUES (${tableId}::uuid, ${tableShortId}, ${baseId}::uuid, 'Cases')`;
      await sql`
        INSERT INTO grids.records (id, short_id, table_id, data, deleted_at) VALUES
          (${oldRecordId}::uuid, ${oldShortId}, ${tableId}::uuid, '{}'::jsonb, now() - interval '100 days'),
          (${recentRecordId}::uuid, ${recentShortId}, ${tableId}::uuid, '{}'::jsonb, now() - interval '10 days'),
          (${finalRecordId}::uuid, ${finalShortId}, ${tableId}::uuid, '{}'::jsonb, now() - interval '200 days')
      `;
      await sql`INSERT INTO grids.table_schema_revisions (id, table_id, schema_hash, fields) VALUES (${schemaRevisionId}::uuid, ${tableId}::uuid, ${"a".repeat(64)}, '{}'::jsonb)`;
      await sql`
        INSERT INTO grids.record_revisions (id, short_id, table_id, record_id, schema_revision_id, revision_no, action, record_version, data)
        VALUES (${finalRevisionId}::uuid, ${testShortId("V")}, ${tableId}::uuid, ${finalRecordId}::uuid, ${schemaRevisionId}::uuid, 1, 'finalized', 1, '{}'::jsonb)
      `;
      await sql`UPDATE grids.records SET finalized_at = now() - interval '200 days', final_revision_id = ${finalRevisionId}::uuid WHERE id = ${finalRecordId}::uuid`;

      expect(await get(baseId)).toBeNull();
      const saved = await update(baseId, { minimumDays: 30 }, null);
      expect(saved.minimumDays).toBe(30);
      const impact = await preview(baseId, { minimumDays: 30 });
      expect(impact.counts).toEqual({ trashedRecords: 3, floorReached: 1, retainedUntilLater: 1, protectedFinalized: 1 });
      expect(impact.examples.map((item) => item.recordId)).toEqual([oldShortId, recentShortId]);
      expect(impact.examples.every((item) => item.tableId === tableShortId)).toBe(true);
      expect(impact.truncated).toBe(false);
      await sql`
        INSERT INTO grids.records (id, short_id, table_id, data, deleted_at)
        SELECT gen_random_uuid(), ${boundedPrefix} || lpad(value::text, 4, '0'), ${tableId}::uuid, '{}'::jsonb, now() - interval '100 days'
        FROM generate_series(1, 101) value
      `;
      const bounded = await preview(baseId, { minimumDays: 30 });
      expect(bounded.examples).toHaveLength(100);
      expect(bounded.truncated).toBe(true);
      const [records] = await sql<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM grids.records WHERE table_id = ${tableId}::uuid`;
      expect(records?.count).toBe(104);
      expect(await remove(baseId, null)).toBe(true);
      expect(await remove(baseId, null)).toBe(false);
      expect(await get(baseId)).toBeNull();
      const audits = await sql<
        Array<{ action: string }>
      >`SELECT action FROM grids.audit_log WHERE base_id = ${baseId}::uuid ORDER BY created_at`;
      expect(audits.map((entry) => entry.action)).toEqual(["retention_policy.updated", "retention_policy.removed"]);
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`UPDATE grids.records SET finalized_at = NULL, finalized_by = NULL, final_revision_id = NULL WHERE table_id = ${tableId}::uuid`;
      await sql`DELETE FROM grids.record_revisions WHERE table_id = ${tableId}::uuid`;
      await sql`DELETE FROM grids.table_schema_revisions WHERE table_id = ${tableId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
