import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { admitDestruction, create, list, release } from "./preservation-holds";
import { listByBase } from "./tables";

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("scoped preservation holds", () => {
  postgresTest("keeps multiple holds independent and gates destruction through the Base lock", async () => {
    const baseId = testUuid();
    const baseShortId = testShortId("B");
    const firstTableId = testUuid();
    const secondTableId = testUuid();
    const unheldTableId = testUuid();
    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${baseShortId}, 'Preservation fixture')`;
      await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position) VALUES
          (${firstTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Invoices', 0),
          (${secondTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Cases', 1),
          (${unheldTableId}::uuid, ${testShortId("T")}, ${baseId}::uuid, 'Notes', 2)
      `;
      const matchingTables = await listByBase(baseId, { search: "invoice", limit: 1 });
      expect(matchingTables.map((table) => table.name)).toEqual(["Invoices"]);

      const baseHold = await create(
        baseId,
        { reason: "Financial review", scope: { type: "base" } },
        { id: null, displayName: "Base Admin" },
      );
      const firstTableHold = await create(
        baseId,
        { reason: "Invoice dispute", scope: { type: "table", tableId: firstTableId } },
        { id: null, displayName: "Base Admin" },
      );
      const secondTableHold = await create(
        baseId,
        { reason: "Case review", scope: { type: "table", tableId: secondTableId } },
        { id: null, displayName: "Base Admin" },
      );
      expect(baseHold.ok && baseHold.data.id).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(firstTableHold.ok && firstTableHold.data.scope).toMatchObject({ type: "table", tableName: "Invoices" });
      expect(secondTableHold.ok && secondTableHold.data.id).not.toBe(baseHold.ok && baseHold.data.id);

      const active = await list(baseId, { status: "active", scope: "all", tableId: null, perPage: 1, offset: 0 });
      expect(active.total).toBe(3);
      expect(active.items).toHaveLength(1);
      expect(active.items[0]?.baseId).toBe(baseShortId);
      const tableOnly = await list(baseId, { status: "active", scope: "table", tableId: firstTableId, perPage: 25, offset: 0 });
      expect(tableOnly.items).toHaveLength(1);
      expect(tableOnly.items[0]?.scope).toMatchObject({ type: "table", tableName: "Invoices" });

      await sql.begin(async (tx) => expect((await admitDestruction({ type: "table", baseId, tableId: unheldTableId }, tx)).ok).toBe(false));
      if (!baseHold.ok || !firstTableHold.ok || !secondTableHold.ok) throw new Error("Hold setup failed");
      expect(
        (await release(baseId, baseHold.data.id, { reason: "Base review completed" }, { id: null, displayName: "Base Admin" })).ok,
      ).toBe(true);
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "table", baseId, tableId: firstTableId }, tx)).ok).toBe(false));
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "table", baseId, tableId: unheldTableId }, tx)).ok).toBe(true));
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "base", baseId }, tx)).ok).toBe(false));

      expect(
        (await release(baseId, firstTableHold.data.id, { reason: "Invoice dispute resolved" }, { id: null, displayName: "Base Admin" })).ok,
      ).toBe(true);
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "table", baseId, tableId: firstTableId }, tx)).ok).toBe(true));
      await sql`DELETE FROM grids.tables WHERE id = ${firstTableId}::uuid`;
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "base", baseId }, tx)).ok).toBe(false));
      expect(
        (await release(baseId, secondTableHold.data.id, { reason: "Case review completed" }, { id: null, displayName: "Base Admin" })).ok,
      ).toBe(true);
      await sql.begin(async (tx) => expect((await admitDestruction({ type: "base", baseId }, tx)).ok).toBe(true));

      const released = await list(baseId, { status: "released", scope: "all", tableId: null, perPage: 25, offset: 0 });
      expect(released.total).toBe(3);
      expect(released.items.every((hold) => hold.status === "released" && hold.releaseReason)).toBe(true);
      expect(released.items.some((hold) => hold.scope.type === "table" && hold.scope.tableName === "Invoices")).toBe(true);
      const audits = await sql<Array<{ action: string }>>`
        SELECT action FROM grids.audit_log WHERE base_id = ${baseId}::uuid ORDER BY created_at, id
      `;
      expect(audits.map((entry) => entry.action).sort()).toEqual([
        "preservation_hold.created",
        "preservation_hold.created",
        "preservation_hold.created",
        "preservation_hold.released",
        "preservation_hold.released",
        "preservation_hold.released",
      ]);
    } finally {
      await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
