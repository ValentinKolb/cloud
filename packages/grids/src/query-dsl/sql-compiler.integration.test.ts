import { sql } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import type { Field } from "../service/types";
import { parseGridsQueryDsl } from "./parser";
import { previewDslQuery } from "./preview";
import { resolveDslQueryToQueryPlan, type DslResolverContext } from "./resolver";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type DslDbFixture = {
  baseId: string;
  orders: { kind: "table"; id: string; shortId: string; name: string };
  customers: { kind: "table"; id: string; shortId: string; name: string };
  fieldsByTableId: Record<string, Field[]>;
  amountId: string;
  costId: string;
  statusId: string;
  customerLinkId: string;
  customerNameId: string;
};

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "tableId" | "name" | "type">): Field => ({
  id: overrides.id,
  shortId: overrides.shortId,
  tableId: overrides.tableId,
  name: overrides.name,
  description: null,
  icon: null,
  type: overrides.type,
  config: overrides.config ?? {},
  position: overrides.position ?? 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const cleanupFixture = async (baseId: string): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
};

const insertDslDbFixture = async (): Promise<DslDbFixture> => {
  const baseId = uuid();
  const orders = { kind: "table" as const, id: uuid(), shortId: shortId("O"), name: "Orders" };
  const customers = { kind: "table" as const, id: uuid(), shortId: shortId("C"), name: "Customers" };
  const orderAId = uuid();
  const orderBId = uuid();
  const customerAId = uuid();
  const customerBId = uuid();
  const amountId = uuid();
  const costId = uuid();
  const statusId = uuid();
  const customerLinkId = uuid();
  const customerNameId = uuid();

  const orderFields = [
    field({ id: amountId, shortId: "AMT01", tableId: orders.id, name: "Amount", type: "number", position: 0 }),
    field({ id: costId, shortId: "COST1", tableId: orders.id, name: "Cost", type: "number", position: 1 }),
    field({ id: statusId, shortId: "STAT1", tableId: orders.id, name: "Status", type: "text", position: 2 }),
    field({
      id: customerLinkId,
      shortId: "CUSTL",
      tableId: orders.id,
      name: "Customer",
      type: "relation",
      config: { targetTableId: customers.id },
      position: 3,
    }),
  ];
  const customerFields = [field({ id: customerNameId, shortId: "NAME1", tableId: customers.id, name: "Name", type: "text", position: 0 })];

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Query DSL integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${orders.id}::uuid, ${orders.shortId}, ${baseId}::uuid, ${orders.name}, 0),
      (${customers.id}::uuid, ${customers.shortId}, ${baseId}::uuid, ${customers.name}, 1)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${amountId}::uuid, 'AMT01', ${orders.id}::uuid, 'Amount', 'number', '{}'::jsonb, 0),
      (${costId}::uuid, 'COST1', ${orders.id}::uuid, 'Cost', 'number', '{}'::jsonb, 1),
      (${statusId}::uuid, 'STAT1', ${orders.id}::uuid, 'Status', 'text', '{}'::jsonb, 2),
      (${customerLinkId}::uuid, 'CUSTL', ${orders.id}::uuid, 'Customer', 'relation', ${{ targetTableId: customers.id }}::jsonb, 3),
      (${customerNameId}::uuid, 'NAME1', ${customers.id}::uuid, 'Name', 'text', '{}'::jsonb, 0)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, version)
    VALUES
      (${customerAId}::uuid, ${customers.id}::uuid, ${{ [customerNameId]: "Alice" }}::jsonb, 1),
      (${customerBId}::uuid, ${customers.id}::uuid, ${{ [customerNameId]: "Bob" }}::jsonb, 1),
      (${orderAId}::uuid, ${orders.id}::uuid, ${{ [amountId]: "12.50", [costId]: "5.00", [statusId]: "Open" }}::jsonb, 1),
      (${orderBId}::uuid, ${orders.id}::uuid, ${{ [amountId]: "4.00", [costId]: "6.00", [statusId]: "Closed" }}::jsonb, 1)
  `;
  await sql`
    INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
    VALUES
      (${orderAId}::uuid, ${customerLinkId}::uuid, ${customerAId}::uuid, 0),
      (${orderBId}::uuid, ${customerLinkId}::uuid, ${customerBId}::uuid, 0)
  `;

  return {
    baseId,
    orders,
    customers,
    fieldsByTableId: {
      [orders.id]: orderFields,
      [customers.id]: customerFields,
    },
    amountId,
    costId,
    statusId,
    customerLinkId,
    customerNameId,
  };
};

const ctx = (fixture: DslDbFixture): DslResolverContext => ({
  currentTable: fixture.orders,
  tables: [fixture.orders, fixture.customers],
  views: [],
  fieldsByTableId: fixture.fieldsByTableId,
});

const preview = async (fixture: DslDbFixture, source: string) => {
  const parsed = parseGridsQueryDsl(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "));

  const resolved = resolveDslQueryToQueryPlan(parsed.ast, ctx(fixture));
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) throw new Error(resolved.diagnostics.map((diagnostic) => diagnostic.message).join("; "));

  const result = await previewDslQuery(resolved.plan, { fieldsByTableId: fixture.fieldsByTableId, limit: 10 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

afterAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await sql.end();
});

describe("Query DSL Postgres smoke", () => {
  postgresTest("executes row formulas, relation joins, and joined sorting", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table #${fixture.orders.shortId}
          join table #${fixture.customers.shortId} as customer on #CUSTL = customer.#id
          select #AMT01 as amount, customer.#NAME1 as customer_name, formula(#AMT01 - #COST1) as margin
          where formula(#AMT01 > #COST1)
          sort customer_name asc
          limit 10
        `,
      );

      expect(result.mode).toBe("rows");
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0]?.values.q_col_0)).toBe(12.5);
      expect(result.rows[0]?.values.q_col_1).toBe("Alice");
      expect(Number(result.rows[0]?.values.q_col_2)).toBe(7.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped formula aggregates with having", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table #${fixture.orders.shortId}
          group by #STAT1
          aggregate sum(formula(#AMT01 - #COST1)) as margin
          having #margin > 5
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.values.gk_0).toBe("Open");
      expect(Number(result.rows[0]?.values.margin__sum)).toBe(7.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes aggregate-only formula predicates and aggregate output", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table #${fixture.orders.shortId}
          where formula(#AMT01 > #COST1)
          aggregate count(*) as rows, sum(#AMT01) as revenue
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0]?.values["*__count"])).toBe(1);
      expect(Number(result.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(12.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
