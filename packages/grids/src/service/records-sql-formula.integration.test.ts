import { sql } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { get, list } from "./records";

const postgresTest = process.env.GRIDS_RECORD_SQL_FORMULA_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type TestShape = {
  baseId: string;
  tableId: string;
  recordId: string;
  priceId: string;
  quantityId: string;
  subtotalId: string;
  grossId: string;
};

const insertSqlFormulaFixture = async (): Promise<TestShape> => {
  const baseId = uuid();
  const tableId = uuid();
  const recordId = uuid();
  const priceId = uuid();
  const quantityId = uuid();
  const subtotalId = uuid();
  const grossId = uuid();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'SQL formula integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Line items')
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${priceId}::uuid, 'PRICE', ${tableId}::uuid, 'Price', 'number', '{}'::jsonb, 0),
      (${quantityId}::uuid, 'QTY01', ${tableId}::uuid, 'Quantity', 'number', '{}'::jsonb, 1),
      (${subtotalId}::uuid, 'SUBTL', ${tableId}::uuid, 'Subtotal', 'formula', ${{ expression: "#PRICE + #QTY01 * 0.20" }}::jsonb, 2),
      (${grossId}::uuid, 'GROSS', ${tableId}::uuid, 'Gross', 'formula', ${{ expression: "#SUBTL + 1" }}::jsonb, 3)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, version)
    VALUES (
      ${recordId}::uuid,
      ${tableId}::uuid,
      ${{ [priceId]: "0.10", [quantityId]: "1.00" }}::jsonb,
      1
    )
  `;

  return { baseId, tableId, recordId, priceId, quantityId, subtotalId, grossId };
};

const cleanupFixture = async (baseId: string): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
};

afterAll(async () => {
  if (process.env.GRIDS_RECORD_SQL_FORMULA_DB_TEST === "1") await sql.end();
});

describe("records SQL formula projection integration", () => {
  postgresTest("list returns SQL-projected formula values and keeps JS fallback dependencies correct", async () => {
    const fixture = await insertSqlFormulaFixture();
    try {
      const result = await list({ tableId: fixture.tableId, limit: 10 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const record = result.data.items.find((item) => item.id === fixture.recordId);
      expect(record?.data[fixture.subtotalId]).toBe("0.300");
      expect(record?.data[fixture.grossId]).toBe("1.3");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("get returns the same SQL-projected formula values as list", async () => {
    const fixture = await insertSqlFormulaFixture();
    try {
      const result = await get(fixture.tableId, fixture.recordId);
      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.data[fixture.subtotalId]).toBe("0.300");
      expect(result.data[fixture.grossId]).toBe("1.3");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
