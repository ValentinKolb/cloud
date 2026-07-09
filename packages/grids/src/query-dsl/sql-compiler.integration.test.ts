import { beforeAll, describe, expect } from "bun:test";
import { migrate } from "../migrate";
import { cleanupFixture, insertDslDbFixture, postgresTest, preview } from "./sql-compiler.integration-fixtures";

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("Query DSL Postgres smoke — rows and text search", () => {
  postgresTest("executes row formulas, relation joins, and joined sorting", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          select AMT01 as order_amount, customer.NAME1 as customer_label, formula(AMT01 - COST1) as line_margin
          where AMT01 > COST1
          sort customer_label asc
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

  postgresTest("executes scoped formula refs over joined records", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const rows = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          select formula(AMT01 + customer.SCORE) as weighted
          where customer.SCORE > 5
          sort weighted desc
        `,
      );

      expect(rows.mode).toBe("rows");
      expect(rows.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);
      expect(rows.rows[0]?.values.q_col_0).toBe("20.5");
      expect(Number(rows.rows[0]?.values.q_col_0)).toBe(20.5);

      const grouped = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.NAME1
          aggregate sum(formula(AMT01 + customer.SCORE)) as weighted
          sort weighted desc
        `,
      );

      expect(grouped.mode).toBe("groups");
      expect(grouped.rows.map((row) => row.values.gk_0)).toEqual(["Alice", "Bob"]);
      expect(Number(grouped.rows[0]?.values.weighted__sum)).toBe(20.5);
      expect(Number(grouped.rows[1]?.values.weighted__sum)).toBe(7);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes joined lookup and rollup fields in row select, formula, and sort", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          select customer.FAMT1 as favorite_amount, formula(customer.FSUM1 + 1) as favorite_plus_one
          sort customer.FSUM1 desc
        `,
      );

      expect(result.mode).toBe("rows");
      expect(result.rows.map((row) => row.recordId)).toEqual([fixture.orderAId, fixture.orderBId]);
      expect(Number(result.rows[0]?.values.q_col_0)).toBe(12.5);
      expect(Number(result.rows[0]?.values.q_col_1)).toBe(13.5);
      expect(Number(result.rows[1]?.values.q_col_0)).toBe(4);
      expect(Number(result.rows[1]?.values.q_col_1)).toBe(5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes a full-text search clause", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const all = await preview(fixture, `search 'Alice'`);
      expect(all.mode).toBe("rows");
      expect(all.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const scoped = await preview(fixture, `search 'Closed' in STAT1`);
      expect(scoped.rows.map((row) => row.recordId)).toEqual([fixture.orderBId]);

      const joined = await preview(
        fixture,
        `
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          search 'Bob' in customer.NAME1
        `,
      );
      expect(joined.rows.map((row) => row.recordId)).toEqual([fixture.orderBId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes explicit case-insensitive text predicates", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const contains = await preview(fixture, `where icontains(STAT1, 'open')`);
      expect(contains.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const startsWith = await preview(fixture, `where istartswith(STAT1, 'clo')`);
      expect(startsWith.rows.map((row) => row.recordId)).toEqual([fixture.orderBId]);

      const endsWith = await preview(fixture, `where iendswith(STAT1, 'LOG')`);
      expect(endsWith.rows.map((row) => row.recordId)).toEqual([fixture.orderCId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes scoped text predicates over joined records", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const contains = await preview(
        fixture,
        `
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          where icontains(customer.NAME1, 'AL')
        `,
      );
      expect(contains.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const startsWith = await preview(
        fixture,
        `
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          where istartswith(customer.NAME1, 'bo')
        `,
      );
      expect(startsWith.rows.map((row) => row.recordId)).toEqual([fixture.orderBId]);

      const endsWith = await preview(
        fixture,
        `
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          where iendswith(customer.NAME1, 'ICE')
        `,
      );
      expect(endsWith.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
