import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { fieldUniqueIndexName } from "./field-indexes";
import * as fields from "./fields";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const createTableFixture = async (name: string) => {
  const baseId = Bun.randomUUIDv7();
  const tableId = Bun.randomUUIDv7();
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, ${name})
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Fields')
  `;
  return { baseId, tableId };
};

describe("field lifecycle Postgres integration", () => {
  postgresTest(
    "returns name conflicts without aborting the surrounding field transaction",
    async () => {
      await migrate();
      const fixture = await createTableFixture(`Field conflicts ${Bun.randomUUIDv7()}`);
      try {
        const original = await fields.create({ tableId: fixture.tableId, name: "Shared name", type: "text" }, null);
        expect(original.ok).toBe(true);
        if (!original.ok) throw new Error(original.error.message);

        const duplicate = await fields.create({ tableId: fixture.tableId, name: "Shared name", type: "text" }, null);
        expect(duplicate.ok).toBe(false);
        if (!duplicate.ok) expect(duplicate.error.code).toBe("CONFLICT");

        expect((await fields.softDelete(original.data.id, null)).ok).toBe(true);
        const replacement = await fields.create({ tableId: fixture.tableId, name: "Shared name", type: "text" }, null);
        expect(replacement.ok).toBe(true);
        const restore = await fields.restore(original.data.id, null);
        expect(restore.ok).toBe(false);
        if (!restore.ok) expect(restore.error.code).toBe("CONFLICT");

        const [trashed] = await sql<Array<{ deleted: boolean }>>`
          SELECT deleted_at IS NOT NULL AS deleted FROM grids.fields WHERE id = ${original.data.id}::uuid
        `;
        expect(trashed?.deleted).toBe(true);
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
      }
    },
    30_000,
  );

  postgresTest(
    "rolls back create, update, restore, and delete when their audit write fails",
    async () => {
      await migrate();
      const fixture = await createTableFixture(`Field lifecycle ${Bun.randomUUIDv7()}`);
      try {
        await expect(fields.create({ tableId: fixture.tableId, name: "Create rollback", type: "text" }, "not-a-uuid")).rejects.toThrow();
        const [createdAfterRollback] = await sql<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM grids.fields
          WHERE table_id = ${fixture.tableId}::uuid AND name = 'Create rollback'
        `;
        expect(createdAfterRollback?.count).toBe(0);

        const created = await fields.create({ tableId: fixture.tableId, name: "Lifecycle", type: "text" }, null);
        expect(created.ok).toBe(true);
        if (!created.ok) throw new Error(created.error.message);

        const updateResult = await fields.update(created.data.id, { description: "must roll back" }, "not-a-uuid");
        expect(updateResult.ok).toBe(false);
        const afterUpdate = await fields.get(created.data.id);
        expect(afterUpdate?.description).toBeNull();

        await expect(fields.softDelete(created.data.id, "not-a-uuid")).rejects.toThrow();
        expect((await fields.get(created.data.id))?.deletedAt).toBeNull();

        expect((await fields.softDelete(created.data.id, null)).ok).toBe(true);
        await expect(fields.restore(created.data.id, "not-a-uuid")).rejects.toThrow();
        const afterRestore = await sql<Array<{ deleted: boolean }>>`
          SELECT deleted_at IS NOT NULL AS deleted
          FROM grids.fields
          WHERE id = ${created.data.id}::uuid
        `;
        expect(afterRestore[0]?.deleted).toBe(true);
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
      }
    },
    30_000,
  );

  postgresTest(
    "records every materially changed field property in the update audit diff",
    async () => {
      await migrate();
      const fixture = await createTableFixture(`Field diff ${Bun.randomUUIDv7()}`);
      try {
        const created = await fields.create(
          {
            tableId: fixture.tableId,
            name: "Before",
            description: "old description",
            icon: "old-icon",
            type: "text",
            config: { maxLength: 20 },
            position: 1,
            required: false,
            presentable: false,
            hideInTable: false,
            defaultValue: "old default",
            uniqueConstraint: true,
          },
          null,
        );
        expect(created.ok).toBe(true);
        if (!created.ok) throw new Error(created.error.message);

        const updated = await fields.update(
          created.data.id,
          {
            name: "After",
            description: "new description",
            icon: "new-icon",
            config: { maxLength: 40, regex: "^new" },
            position: 4,
            required: true,
            presentable: true,
            hideInTable: true,
            defaultValue: "new default",
            uniqueConstraint: false,
          },
          null,
        );
        expect(updated.ok).toBe(true);
        const [updatedRow] = await sql<Array<{ uniqueConstraint: boolean; indexName: string | null }>>`
          SELECT f.unique_constraint AS "uniqueConstraint",
                 to_regclass(${`grids.${fieldUniqueIndexName(created.data.id)}`}::text)::text AS "indexName"
          FROM grids.fields f
          WHERE f.id = ${created.data.id}::uuid
        `;
        expect(updatedRow).toEqual({ uniqueConstraint: false, indexName: null });

        const [audit] = await sql<Array<{ diff: Record<string, { old: unknown; new: unknown }> }>>`
          SELECT diff
          FROM grids.audit_log
          WHERE table_id = ${fixture.tableId}::uuid
            AND action = 'updated'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
        expect(Object.keys(audit?.diff ?? {}).sort()).toEqual(
          [
            "config",
            "defaultValue",
            "description",
            "hideInTable",
            "icon",
            "name",
            "position",
            "presentable",
            "required",
            "uniqueConstraint",
          ].sort(),
        );
        expect(audit?.diff.name).toEqual({ old: "Before", new: "After" });
        expect(audit?.diff.config).toEqual({ old: { maxLength: 20 }, new: { maxLength: 40, regex: "^new" } });
        expect(audit?.diff.defaultValue).toEqual({ old: "old default", new: "new default" });
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
      }
    },
    30_000,
  );

  postgresTest(
    "does not list trashed fields from a trashed base",
    async () => {
      await migrate();
      const fixture = await createTableFixture(`Field trash ${Bun.randomUUIDv7()}`);
      try {
        const created = await fields.create({ tableId: fixture.tableId, name: "Trash me", type: "text" }, null);
        expect(created.ok).toBe(true);
        if (!created.ok) throw new Error(created.error.message);
        expect((await fields.softDelete(created.data.id, null)).ok).toBe(true);

        expect((await fields.listTrashedByBase(fixture.baseId)).map((field) => field.id)).toEqual([created.data.id]);
        await sql`UPDATE grids.bases SET deleted_at = now() WHERE id = ${fixture.baseId}::uuid`;
        expect(await fields.listTrashedByBase(fixture.baseId)).toEqual([]);
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
      }
    },
    30_000,
  );
});
