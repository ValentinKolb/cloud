import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { create, get, update } from "./workflows";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const source = `triggers:
  api: {}
steps:
  - succeed:
      message: done
`;

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("workflow updates integration", () => {
  postgresTest("rejects one of two concurrent updates using the same revision", async () => {
    const baseId = Bun.randomUUIDv7();
    await sql`
      INSERT INTO grids.bases (id, short_id, name)
      VALUES (${baseId}::uuid, ${Math.random().toString(36).slice(2, 7)}, 'Workflow revision integration')
    `;

    try {
      const created = await create(baseId, { name: "Original", source }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const results = await Promise.all([
        update(created.data.id, { name: "First edit" }, null, created.data.revision),
        update(created.data.id, { name: "Second edit" }, null, created.data.revision),
      ]);
      const succeeded = results.filter((result) => result.ok);
      const conflicted = results.filter((result) => !result.ok);

      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(1);
      expect(conflicted[0]!.error.status).toBe(409);
      expect(conflicted[0]!.error.message).toContain("Reload the latest version");

      const stored = await get(created.data.id);
      expect(stored?.revision).toBe(created.data.revision + 1);
      expect(stored?.name).toBe(succeeded[0]!.data.name);

      const [audit] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM grids.audit_log
        WHERE base_id = ${baseId}::uuid
          AND action = 'workflow.updated'
          AND diff->'workflow'->'new'->>'id' = ${created.data.id}
      `;
      expect(audit?.count).toBe(1);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
