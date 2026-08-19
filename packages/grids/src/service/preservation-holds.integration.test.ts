import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { admitDestruction, create, list, release } from "./preservation-holds";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("Base-wide preservation holds", () => {
  postgresTest("keeps multiple holds independent and gates destruction through the Base lock", async () => {
    const baseId = testUuid();
    const baseShortId = testShortId("B");
    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Preservation fixture')`;

      const first = await create(baseId, { reason: "Financial review" }, { id: null, displayName: "Base Admin" });
      const second = await create(baseId, { reason: "Customer dispute" }, { id: null, displayName: "Base Admin" });
      expect(first.id).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(second.id).not.toBe(first.id);

      const active = await list(baseId, { status: "active", perPage: 1, offset: 0 });
      expect(active.total).toBe(2);
      expect(active.items).toHaveLength(1);
      expect(active.items[0]?.baseId).toBe(baseShortId);

      await sql.begin(async (tx) => expect((await admitDestruction(baseId, tx)).ok).toBe(false));
      expect((await release(baseId, first.id, { reason: "Review completed" }, { id: null, displayName: "Base Admin" })).ok).toBe(true);
      await sql.begin(async (tx) => expect((await admitDestruction(baseId, tx)).ok).toBe(false));

      expect((await release(baseId, second.id, { reason: "Dispute resolved" }, { id: null, displayName: "Base Admin" })).ok).toBe(true);
      await sql.begin(async (tx) => expect((await admitDestruction(baseId, tx)).ok).toBe(true));

      const released = await list(baseId, { status: "released", perPage: 25, offset: 0 });
      expect(released.total).toBe(2);
      expect(released.items.every((hold) => hold.status === "released" && hold.releaseReason)).toBe(true);
      const audits = await sql<Array<{ action: string }>>`
        SELECT action FROM grids.audit_log WHERE base_id = ${baseId}::uuid ORDER BY created_at, id
      `;
      expect(audits.map((entry) => entry.action).sort()).toEqual([
        "preservation_hold.created",
        "preservation_hold.created",
        "preservation_hold.released",
        "preservation_hold.released",
      ]);
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
