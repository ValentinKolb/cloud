import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { ExpansionViewer } from "../service/relations";
import type { Field } from "../service/types";
import { parseGridsQueryDsl } from "./parser";
import { previewDslQuery } from "./preview";
import { type DslResolverContext, resolveDslQueryToQueryPlan } from "./resolver";

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
  stageId: string;
  tagsId: string;
  orderedAtId: string;
  customerLinkId: string;
  parentOrderLinkId: string;
  customerScoreRollupId: string;
  customerNameId: string;
  customerScoreId: string;
  customerScoreFormulaId: string;
  customerFavoriteOrderLinkId: string;
  customerFavoriteOrderAmountLookupId: string;
  customerFavoriteOrderAmountRollupId: string;
  orderAId: string;
  orderBId: string;
  orderCId: string;
  orderDeletedId: string;
  customerAId: string;
  customerBId: string;
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
  const orderCId = uuid();
  const orderDeletedId = uuid();
  const customerAId = uuid();
  const customerBId = uuid();
  const amountId = uuid();
  const costId = uuid();
  const statusId = uuid();
  const stageId = uuid();
  const tagsId = uuid();
  const orderedAtId = uuid();
  const customerLinkId = uuid();
  const parentOrderLinkId = uuid();
  const customerScoreRollupId = uuid();
  const customerNameId = uuid();
  const customerScoreId = uuid();
  const customerScoreFormulaId = uuid();
  const customerFavoriteOrderLinkId = uuid();
  const customerFavoriteOrderAmountLookupId = uuid();
  const customerFavoriteOrderAmountRollupId = uuid();
  const stageOptions = {
    options: [
      { id: "open", label: "Open" },
      { id: "closed", label: "Closed" },
      { id: "hold", label: "On hold" },
    ],
  };
  const tagOptions = {
    multiple: true,
    options: [
      { id: "priority", label: "Priority" },
      { id: "remote", label: "Remote" },
    ],
  };

  const orderFields = [
    field({ id: amountId, shortId: "AMT01", tableId: orders.id, name: "Amount", type: "number", position: 0 }),
    field({ id: costId, shortId: "COST1", tableId: orders.id, name: "Cost", type: "number", position: 1 }),
    field({ id: statusId, shortId: "STAT1", tableId: orders.id, name: "Status", type: "text", position: 2 }),
    field({ id: stageId, shortId: "STAGE", tableId: orders.id, name: "Stage", type: "select", config: stageOptions, position: 3 }),
    field({ id: tagsId, shortId: "TAGS1", tableId: orders.id, name: "Tags", type: "select", config: tagOptions, position: 4 }),
    field({ id: orderedAtId, shortId: "DATE1", tableId: orders.id, name: "Ordered at", type: "date", position: 5 }),
    field({
      id: customerLinkId,
      shortId: "CUSTL",
      tableId: orders.id,
      name: "Customer",
      type: "relation",
      config: { targetTableId: customers.id },
      position: 6,
    }),
    field({
      id: parentOrderLinkId,
      shortId: "PARNT",
      tableId: orders.id,
      name: "Parent order",
      type: "relation",
      config: { targetTableId: orders.id },
      position: 7,
    }),
    field({
      id: customerScoreRollupId,
      shortId: "CSCOR",
      tableId: orders.id,
      name: "Customer score",
      type: "rollup",
      config: { relationFieldId: customerLinkId, targetFieldId: customerScoreId, agg: "sum" },
      position: 8,
    }),
  ];
  const customerFields = [
    field({ id: customerNameId, shortId: "NAME1", tableId: customers.id, name: "Name", type: "text", position: 0 }),
    field({ id: customerScoreId, shortId: "SCORE", tableId: customers.id, name: "Score", type: "number", position: 1 }),
    field({
      id: customerScoreFormulaId,
      shortId: "SCOR2",
      tableId: customers.id,
      name: "Score x2",
      type: "formula",
      config: { expression: "SCORE * 2" },
      position: 2,
    }),
    field({
      id: customerFavoriteOrderLinkId,
      shortId: "FAVOR",
      tableId: customers.id,
      name: "Favorite order",
      type: "relation",
      config: { targetTableId: orders.id },
      position: 3,
    }),
    field({
      id: customerFavoriteOrderAmountLookupId,
      shortId: "FAMT1",
      tableId: customers.id,
      name: "Favorite amount",
      type: "lookup",
      config: { relationFieldId: customerFavoriteOrderLinkId, targetFieldId: amountId },
      position: 4,
    }),
    field({
      id: customerFavoriteOrderAmountRollupId,
      shortId: "FSUM1",
      tableId: customers.id,
      name: "Favorite sum",
      type: "rollup",
      config: { relationFieldId: customerFavoriteOrderLinkId, targetFieldId: amountId, agg: "sum" },
      position: 5,
    }),
  ];

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
      (${stageId}::uuid, 'STAGE', ${orders.id}::uuid, 'Stage', 'select', ${stageOptions}::jsonb, 3),
      (${tagsId}::uuid, 'TAGS1', ${orders.id}::uuid, 'Tags', 'select', ${tagOptions}::jsonb, 4),
      (${orderedAtId}::uuid, 'DATE1', ${orders.id}::uuid, 'Ordered at', 'date', '{}'::jsonb, 5),
      (${customerLinkId}::uuid, 'CUSTL', ${orders.id}::uuid, 'Customer', 'relation', ${{ targetTableId: customers.id }}::jsonb, 6),
      (${parentOrderLinkId}::uuid, 'PARNT', ${orders.id}::uuid, 'Parent order', 'relation', ${{ targetTableId: orders.id }}::jsonb, 7),
      (${customerScoreRollupId}::uuid, 'CSCOR', ${orders.id}::uuid, 'Customer score', 'rollup', ${{
        relationFieldId: customerLinkId,
        targetFieldId: customerScoreId,
        agg: "sum",
      }}::jsonb, 8),
      (${customerNameId}::uuid, 'NAME1', ${customers.id}::uuid, 'Name', 'text', '{}'::jsonb, 0),
      (${customerScoreId}::uuid, 'SCORE', ${customers.id}::uuid, 'Score', 'number', '{}'::jsonb, 1),
      (${customerScoreFormulaId}::uuid, 'SCOR2', ${customers.id}::uuid, 'Score x2', 'formula', ${{ expression: "SCORE * 2" }}::jsonb, 2),
      (${customerFavoriteOrderLinkId}::uuid, 'FAVOR', ${customers.id}::uuid, 'Favorite order', 'relation', ${{
        targetTableId: orders.id,
      }}::jsonb, 3),
      (${customerFavoriteOrderAmountLookupId}::uuid, 'FAMT1', ${customers.id}::uuid, 'Favorite amount', 'lookup', ${{
        relationFieldId: customerFavoriteOrderLinkId,
        targetFieldId: amountId,
      }}::jsonb, 4),
      (${customerFavoriteOrderAmountRollupId}::uuid, 'FSUM1', ${customers.id}::uuid, 'Favorite sum', 'rollup', ${{
        relationFieldId: customerFavoriteOrderLinkId,
        targetFieldId: amountId,
        agg: "sum",
      }}::jsonb, 5)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, version, deleted_at)
    VALUES
      (${customerAId}::uuid, ${customers.id}::uuid, ${{ [customerNameId]: "Alice", [customerScoreId]: "8" }}::jsonb, 1, NULL),
      (${customerBId}::uuid, ${customers.id}::uuid, ${{ [customerNameId]: "Bob", [customerScoreId]: "3" }}::jsonb, 1, NULL),
      (${orderAId}::uuid, ${orders.id}::uuid, ${{
        [amountId]: "12.50",
        [costId]: "5.00",
        [statusId]: "Open",
        [stageId]: ["open"],
        [tagsId]: ["priority", "remote"],
        [orderedAtId]: "2026-01-15",
      }}::jsonb, 1, NULL),
      (${orderBId}::uuid, ${orders.id}::uuid, ${{
        [amountId]: "4.00",
        [costId]: "6.00",
        [statusId]: "Closed",
        [stageId]: ["closed"],
        [tagsId]: ["remote"],
        [orderedAtId]: "2026-02-03",
      }}::jsonb, 1, NULL),
      (${orderCId}::uuid, ${orders.id}::uuid, ${{
        [costId]: "0",
        [statusId]: "Backlog",
        [stageId]: ["hold"],
        [tagsId]: ["priority"],
        [orderedAtId]: "2026-02-20",
      }}::jsonb, 1, NULL),
      (${orderDeletedId}::uuid, ${orders.id}::uuid, ${{
        [amountId]: "99.00",
        [costId]: "1.00",
        [statusId]: "Deleted",
        [stageId]: ["open"],
        [tagsId]: ["priority"],
        [orderedAtId]: "2026-03-01",
      }}::jsonb, 1, now())
  `;
  await sql`
    INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
    VALUES
      (${orderAId}::uuid, ${customerLinkId}::uuid, ${customerAId}::uuid, 0),
      (${orderBId}::uuid, ${customerLinkId}::uuid, ${customerBId}::uuid, 0),
      (${orderBId}::uuid, ${parentOrderLinkId}::uuid, ${orderAId}::uuid, 0),
      (${customerAId}::uuid, ${customerFavoriteOrderLinkId}::uuid, ${orderAId}::uuid, 0),
      (${customerBId}::uuid, ${customerFavoriteOrderLinkId}::uuid, ${orderBId}::uuid, 0)
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
    stageId,
    tagsId,
    orderedAtId,
    customerLinkId,
    parentOrderLinkId,
    customerScoreRollupId,
    customerNameId,
    customerScoreId,
    customerScoreFormulaId,
    customerFavoriteOrderLinkId,
    customerFavoriteOrderAmountLookupId,
    customerFavoriteOrderAmountRollupId,
    orderAId,
    orderBId,
    orderCId,
    orderDeletedId,
    customerAId,
    customerBId,
  };
};

const ctx = (fixture: DslDbFixture): DslResolverContext => ({
  currentTable: fixture.orders,
  tables: [fixture.orders, fixture.customers],
  views: [],
  fieldsByTableId: fixture.fieldsByTableId,
});

const preview = async (
  fixture: DslDbFixture,
  source: string,
  context: DslResolverContext = ctx(fixture),
  limit = 10,
  viewer?: ExpansionViewer,
) => {
  const parsed = parseGridsQueryDsl(source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  expect(parsed.ok).toBe(true);

  const resolved = resolveDslQueryToQueryPlan(parsed.ast, context);
  if (!resolved.ok) throw new Error(resolved.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  expect(resolved.ok).toBe(true);

  const result = await previewDslQuery(resolved.plan, { fieldsByTableId: context.fieldsByTableId, limit, viewer });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.ok).toBe(true);
  return result.data;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("Query DSL Postgres smoke", () => {
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

  postgresTest("executes row-shaped view source filter, search, and scoped limit", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const topView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "TOP1",
        name: "Top one order",
        tableId: fixture.orders.id,
        query: { sort: [{ fieldId: fixture.amountId, direction: "desc" as const }], limit: 1 },
      };
      const closedView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "CLOS1",
        name: "Closed orders",
        tableId: fixture.orders.id,
        query: {
          filter: { fieldId: fixture.statusId, op: "equals" as const, value: "Closed" },
          sort: [{ fieldId: fixture.amountId, direction: "desc" as const }],
          limit: 1,
        },
      };
      const openSearchView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "OPENS",
        name: "Open search",
        tableId: fixture.orders.id,
        query: { search: { q: "Open", fieldIds: [fixture.statusId] } },
      };
      const context = { ...ctx(fixture), views: [topView, closedView, openSearchView] };

      const scopedBeforeWhere = await preview(
        fixture,
        `
          from view TOP1
          select AMT01 as order_amount
          where STAT1 = 'Closed'
        `,
        context,
      );
      expect(scopedBeforeWhere.mode).toBe("rows");
      expect(scopedBeforeWhere.rows).toHaveLength(0);

      const filtered = await preview(fixture, `from view CLOS1\nselect AMT01 as order_amount`, context);
      expect(filtered.rows.map((row) => row.recordId)).toEqual([fixture.orderBId]);

      const searched = await preview(fixture, `from view OPENS\nsearch 'Closed' in STAT1`, context);
      expect(searched.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes view source scoped limits before grouped and aggregate previews", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const topTwoView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "TOP2",
        name: "Top two orders",
        tableId: fixture.orders.id,
        query: { sort: [{ fieldId: fixture.amountId, direction: "desc" as const }], limit: 2 },
      };
      const context = { ...ctx(fixture), views: [topTwoView] };

      const grouped = await preview(
        fixture,
        `
          from view TOP2
          group by STAT1
          aggregate count(*) as rows
        `,
        context,
      );
      expect(grouped.mode).toBe("groups");
      const groupedStatuses = new Set(grouped.rows.map((row) => row.values.gk_0));
      expect(groupedStatuses).toEqual(new Set(["Closed", "Open"]));

      const aggregate = await preview(fixture, `from view TOP2\naggregate count(*) as rows, sum(AMT01) as revenue`, context);
      expect(aggregate.mode).toBe("groups");
      expect(Number(aggregate.rows[0]?.values["*__count"])).toBe(2);
      expect(Number(aggregate.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(16.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped and aggregate saved views as derived sources", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byStatusView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "SUMRY",
        name: "Status summary",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.statusId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
          groupSort: [{ fieldId: fixture.amountId, agg: "sum" as const, direction: "desc" as const }],
        },
      };
      const totalsView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "TOTAL",
        name: "Totals",
        tableId: fixture.orders.id,
        query: {
          aggregations: [
            { fieldId: "*", agg: "count" as const, label: "rows" },
            { fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" },
          ],
        },
      };
      const context = { ...ctx(fixture), views: [byStatusView, totalsView] };

      const grouped = await preview(
        fixture,
        `
          from view SUMRY
          select Status, revenue
          where revenue > 5
          sort revenue desc
        `,
        context,
      );
      expect(grouped.mode).toBe("groups");
      expect(grouped.rows.map((row) => row.values.gk_0)).toEqual(["Open"]);
      expect(Number(grouped.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(12.5);

      const aggregate = await preview(fixture, `from view TOTAL\nselect rows, revenue\nwhere revenue > 10`, context);
      expect(aggregate.mode).toBe("groups");
      expect(Number(aggregate.rows[0]?.values["*__count"])).toBe(3);
      expect(Number(aggregate.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(16.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes derived relation output joins", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byCustomerView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "BYCUS",
        name: "Revenue by customer",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.customerLinkId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byCustomerView] };

      const result = await preview(
        fixture,
        `
          from view BYCUS
          join table ${fixture.customers.shortId} as customer on Customer = customer.id
          select Customer, revenue, customer.NAME1 as customer_name, customer.FAMT1 as favorite_amount
          sort customer.FSUM1 desc
        `,
        context,
      );

      expect(result.mode).toBe("groups");
      const joinedKey = result.columns.find((column) => column.label === "customer_name")?.key;
      expect(typeof joinedKey).toBe("string");
      expect(result.rows.map((row) => row.values.gk_0)).toEqual(["Alice", "Bob"]);
      expect(result.rows.map((row) => row.values[joinedKey!])).toEqual(["Alice", "Bob"]);
      expect(result.rows.map((row) => Number(row.values.q_col_3))).toEqual([12.5, 4]);
      const byCustomer = new Map(result.rows.map((row) => [row.values[joinedKey!], Number(row.values[`${fixture.amountId}__sum`])]));
      expect(byCustomer).toEqual(
        new Map([
          ["Alice", 12.5],
          ["Bob", 4],
        ]),
      );
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("searches derived relation group columns by visible labels", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byCustomerView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "BYCUS",
        name: "Revenue by customer",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.customerLinkId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byCustomerView] };

      const byLabel = await preview(
        fixture,
        `
          from view BYCUS
          search 'Alice' in Customer
          select Customer, revenue
        `,
        context,
      );

      expect(byLabel.mode).toBe("groups");
      expect(byLabel.rows).toHaveLength(1);
      expect(byLabel.rows[0]?.values.gk_0).toBe("Alice");
      expect(Number(byLabel.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(12.5);

      const byRawId = await preview(
        fixture,
        `
          from view BYCUS
          search '${fixture.customerAId.slice(0, 8)}' in Customer
          select Customer, revenue
        `,
        context,
      );

      expect(byRawId.mode).toBe("groups");
      expect(byRawId.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes joined predicates and regrouping over derived relation output joins", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byCustomerView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "BYCUS",
        name: "Revenue by customer",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.customerLinkId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byCustomerView] };

      const result = await preview(
        fixture,
        `
          from view BYCUS
          join table ${fixture.customers.shortId} as customer on Customer = customer.id
          search 'Alice' in customer.NAME1
          where customer.SCORE > 5 and revenue > 1
          group by customer.NAME1
          aggregate sum(revenue) as total_revenue, avg(customer.SCORE) as avg_score, sum(formula(revenue + customer.SCORE)) as weighted
          having total_revenue > 10
          sort total_revenue desc
        `,
        context,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.values.gk_0).toBe("Alice");
      expect(Number(result.rows[0]?.values["*__count"])).toBe(1);
      expect(Number(result.rows[0]?.values[`${fixture.amountId}__sum__sum`])).toBe(12.5);
      expect(Number(result.rows[0]?.values[`${fixture.customerScoreId}__avg`])).toBe(8);
      expect(Number(result.rows[0]?.values.weighted__sum)).toBe(20.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes chained joins while regrouping derived relation output", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byCustomerView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "BYCUS",
        name: "Revenue by customer",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.customerLinkId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byCustomerView] };

      const result = await preview(
        fixture,
        `
          from view BYCUS
          join table ${fixture.customers.shortId} as Customer on Customer = customer.id
          join table ${fixture.orders.shortId} as favorite on customer.FAVOR = favorite.id
          search 'Open' in favorite.STAT1
          where favorite.AMT01 > 10 and revenue > 1
          group by favorite.STAT1
          aggregate sum(revenue) as total_revenue, sum(formula(revenue + favorite.AMT01)) as weighted
          sort total_revenue desc
        `,
        context,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.values.gk_0).toBe("Open");
      expect(Number(result.rows[0]?.values["*__count"])).toBe(1);
      expect(Number(result.rows[0]?.values[`${fixture.amountId}__sum__sum`])).toBe(12.5);
      expect(Number(result.rows[0]?.values.weighted__sum)).toBe(25);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes search and re-aggregation over derived saved-view output", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byStatusView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "SUMRY",
        name: "Status summary",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.statusId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byStatusView] };

      const searched = await preview(
        fixture,
        `
          from view SUMRY
          search 'Open' in Status
          select Status, revenue
        `,
        context,
      );
      expect(searched.mode).toBe("groups");
      expect(searched.rows.map((row) => row.values.gk_0)).toEqual(["Open"]);
      expect(Number(searched.rows[0]?.values[`${fixture.amountId}__sum`])).toBe(12.5);

      const regrouped = await preview(
        fixture,
        `
          from view SUMRY
          group by Status
          aggregate sum(revenue) as total_revenue, count(*) as rows
          having total_revenue > 10
          sort total_revenue desc
        `,
        context,
      );
      expect(regrouped.mode).toBe("groups");
      expect(regrouped.rows.map((row) => row.values.gk_0)).toEqual(["Open"]);
      expect(Number(regrouped.rows[0]?.values[`${fixture.amountId}__sum__sum`])).toBe(12.5);
      expect(Number(regrouped.rows[0]?.values["*__count"])).toBe(1);

      const rollup = await preview(fixture, `from view SUMRY\naggregate sum(revenue) as total_revenue, count(*) as buckets`, context);
      expect(rollup.mode).toBe("groups");
      expect(Number(rollup.rows[0]?.values[`${fixture.amountId}__sum__sum`])).toBe(16.5);
      expect(Number(rollup.rows[0]?.values["*__count"])).toBe(3);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("searches derived select group columns by option labels", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const byStageView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "BYSTG",
        name: "Revenue by stage",
        tableId: fixture.orders.id,
        query: {
          groupBy: [{ fieldId: fixture.stageId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [byStageView] };

      const byLabel = await preview(
        fixture,
        `
          from view BYSTG
          search 'On hold' in Stage
          select Stage, revenue
        `,
        context,
      );

      expect(byLabel.mode).toBe("groups");
      expect(byLabel.rows).toHaveLength(1);
      expect(byLabel.rows[0]?.values.gk_0).toBe("hold");

      const byRawId = await preview(
        fixture,
        `
          from view BYSTG
          search 'closed' in Stage
          select Stage, revenue
        `,
        context,
      );

      expect(byRawId.mode).toBe("groups");
      expect(byRawId.rows).toHaveLength(1);
      expect(byRawId.rows[0]?.values.gk_0).toBe("closed");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("applies saved search before derived grouped view re-aggregation", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const openStatusView = {
        kind: "view" as const,
        id: uuid(),
        shortId: "OPNSM",
        name: "Open status summary",
        tableId: fixture.orders.id,
        query: {
          search: { q: "Open", fieldIds: [fixture.statusId] },
          groupBy: [{ fieldId: fixture.statusId, direction: "asc" as const }],
          aggregations: [{ fieldId: fixture.amountId, agg: "sum" as const, label: "revenue" }],
        },
      };
      const context = { ...ctx(fixture), views: [openStatusView] };

      const rollup = await preview(
        fixture,
        `
          from view OPNSM
          aggregate sum(revenue) as total_revenue, count(*) as buckets
        `,
        context,
      );
      expect(rollup.mode).toBe("groups");
      expect(Number(rollup.rows[0]?.values[`${fixture.amountId}__sum__sum`])).toBe(12.5);
      expect(Number(rollup.rows[0]?.values["*__count"])).toBe(1);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes select labels, membership, null ordering, and trash clauses", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const open = await preview(fixture, `where STAGE = 'Open'`);
      expect(open.mode).toBe("rows");
      expect(open.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const membership = await preview(fixture, `where oneof(STAGE, 'Open', 'Closed')\nsort AMT01 asc`);
      expect(membership.rows.map((row) => row.recordId)).toEqual([fixture.orderBId, fixture.orderAId]);

      const nullsLast = await preview(fixture, `select AMT01\nsort AMT01 asc`);
      expect(nullsLast.rows.map((row) => row.recordId)).toEqual([fixture.orderBId, fixture.orderAId, fixture.orderCId]);

      const nullsFirst = await preview(fixture, `select AMT01\nsort AMT01 asc nulls first`);
      expect(nullsFirst.rows.map((row) => row.recordId)).toEqual([fixture.orderCId, fixture.orderBId, fixture.orderAId]);

      const deletedOnly = await preview(fixture, `select STAT1\ndeleted only`);
      expect(deletedOnly.rows.map((row) => row.recordId)).toEqual([fixture.orderDeletedId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes readable table, field, and join references", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table Orders
          join table Customers as customer on Customer = customer.id
          select Amount as order_amount, customer.Name as customer_label, formula(Amount - Cost) as line_margin
          where Amount > Cost
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

  postgresTest("executes source aliases and self-joins", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId} as o
          join table ${fixture.orders.shortId} as parent on o.PARNT = parent.id
          select o.AMT01 as order_amount, parent.AMT01 as parent_amount
          sort o.AMT01 asc
          limit 10
        `,
      );

      expect(result.mode).toBe("rows");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.recordId).toBe(fixture.orderBId);
      expect(Number(result.rows[0]?.values.q_col_0)).toBe(4);
      expect(Number(result.rows[0]?.values.q_col_1)).toBe(12.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes reverse relation joins", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId} as c
          join table ${fixture.orders.shortId} as order on order.CUSTL = c.id
          select c.NAME1 as customer_name, order.AMT01 as order_amount
          sort order.AMT01 asc
        `,
      );

      expect(result.mode).toBe("rows");
      expect(result.rows.map((row) => row.recordId)).toEqual([fixture.customerBId, fixture.customerAId]);
      expect(result.rows[0]?.values.q_col_0).toBe("Bob");
      expect(Number(result.rows[0]?.values.q_col_1)).toBe(4);
      expect(result.rows[1]?.values.q_col_0).toBe("Alice");
      expect(Number(result.rows[1]?.values.q_col_1)).toBe(12.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped relation joins with joined aggregates", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId} as c
          join table ${fixture.orders.shortId} as order on order.CUSTL = c.id
          group by c.NAME1
          aggregate sum(order.AMT01) as revenue
          sort revenue desc
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows.map((row) => row.values.gk_0)).toEqual(["Alice", "Bob"]);
      const byCustomer = new Map(result.rows.map((row) => [row.values.gk_0, row.values]));
      expect(Number(byCustomer.get("Alice")?.[`${fixture.amountId}__sum`])).toBe(12.5);
      expect(Number(byCustomer.get("Bob")?.[`${fixture.amountId}__sum`])).toBe(4);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped relation joins with exploded joined group keys", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const tags = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId} as c
          join table ${fixture.orders.shortId} as order on order.CUSTL = c.id
          group by order.TAGS1
          aggregate count(*) as rows
          sort rows desc
        `,
      );
      expect(tags.mode).toBe("groups");
      expect(tags.explode).toBe(true);
      const byTag = new Map(tags.rows.map((row) => [row.values.gk_0, Number(row.values["*__count"])]));
      expect(byTag).toEqual(
        new Map([
          ["remote", 2],
          ["priority", 1],
        ]),
      );

      const implicitCount = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId} as c
          join table ${fixture.orders.shortId} as order on order.CUSTL = c.id
          group by order.TAGS1
        `,
      );
      expect(implicitCount.mode).toBe("groups");
      expect(implicitCount.explode).toBe(true);
      const implicitByTag = new Map(implicitCount.rows.map((row) => [row.values.gk_0, Number(row.values["*__count"])]));
      expect(implicitByTag).toEqual(
        new Map([
          ["remote", 2],
          ["priority", 1],
        ]),
      );

      const parent = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId} as c
          join table ${fixture.orders.shortId} as order on order.CUSTL = c.id
          group by order.PARNT
          aggregate count(*) as rows
        `,
      );
      expect(parent.mode).toBe("groups");
      expect(parent.explode).toBe(true);
      expect(parent.rows).toHaveLength(1);
      expect(Number(parent.rows[0]?.values["*__count"])).toBe(1);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped relation joins with base formula aggregates", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.NAME1
          aggregate sum(formula(AMT01 - COST1)) as margin
          having margin > 0
          sort margin desc
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.values.gk_0).toBe("Alice");
      expect(Number(result.rows[0]?.values.margin__sum)).toBe(7.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes grouped relation joins with computed joined group keys", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const formula = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.SCOR2
          aggregate count(*) as rows
        `,
      );
      expect(formula.mode).toBe("groups");
      const byScore = new Map(formula.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])]));
      expect(byScore.size).toBe(2);
      expect(byScore.get(16)).toBe(1);
      expect(byScore.get(6)).toBe(1);

      const lookup = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.FAMT1
          aggregate count(*) as rows
        `,
      );
      expect(lookup.mode).toBe("groups");
      const byLookup = new Map(lookup.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])]));
      expect(byLookup.size).toBe(2);
      expect(byLookup.get(12.5)).toBe(1);
      expect(byLookup.get(4)).toBe(1);

      const rollup = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.FSUM1
          aggregate count(*) as rows
        `,
      );
      expect(rollup.mode).toBe("groups");
      const byRollup = new Map(rollup.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])]));
      expect(byRollup.size).toBe(2);
      expect(byRollup.get(12.5)).toBe(1);
      expect(byRollup.get(4)).toBe(1);

      const aggregate = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.NAME1
          aggregate sum(customer.FSUM1) as favorite_total
          sort favorite_total desc
        `,
      );
      expect(aggregate.mode).toBe("groups");
      const byName = new Map(aggregate.rows.map((row) => [row.values.gk_0, Number(row.values.favorite_total__sum)]));
      expect(byName).toEqual(
        new Map([
          ["Alice", 12.5],
          ["Bob", 4],
        ]),
      );

      const lookupAggregate = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          group by customer.NAME1
          aggregate sum(customer.FAMT1) as favorite_lookup_total, avg(customer.FAMT1) as favorite_lookup_avg
          sort favorite_lookup_total desc
        `,
      );
      expect(lookupAggregate.mode).toBe("groups");
      const lookupByName = new Map(
        lookupAggregate.rows.map((row) => [
          row.values.gk_0,
          {
            avg: Number(row.values.favorite_lookup_avg__avg),
            total: Number(row.values.favorite_lookup_total__sum),
          },
        ]),
      );
      expect(lookupByName).toEqual(
        new Map([
          ["Alice", { avg: 12.5, total: 12.5 }],
          ["Bob", { avg: 4, total: 4 }],
        ]),
      );
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes base computed fields as group keys", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const formula = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId}
          group by SCOR2
          aggregate count(*) as rows
          sort SCOR2 asc
        `,
      );
      expect(formula.mode).toBe("groups");
      expect(formula.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])])).toEqual([
        [6, 1],
        [16, 1],
      ]);

      const lookup = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId}
          group by FAMT1
          aggregate count(*) as rows
          sort FAMT1 asc
        `,
      );
      expect(lookup.mode).toBe("groups");
      expect(lookup.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])])).toEqual([
        [4, 1],
        [12.5, 1],
      ]);

      const rollup = await preview(
        fixture,
        `
          from table ${fixture.customers.shortId}
          group by FSUM1
          aggregate count(*) as rows
          sort FSUM1 asc
        `,
      );
      expect(rollup.mode).toBe("groups");
      expect(rollup.rows.map((row) => [Number(row.values.gk_0), Number(row.values["*__count"])])).toEqual([
        [4, 1],
        [12.5, 1],
      ]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes date buckets and grouped aggregate variants", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          group by DATE1 by month
          aggregate count(*) as rows, median(AMT01) as middle, earliest(DATE1) as first_order, latest(DATE1) as last_order
        `,
      );

      expect(result.mode).toBe("groups");
      const byMonth = new Map(result.rows.map((row) => [String(row.values.gk_0).slice(0, 7), row.values]));
      expect(Number(byMonth.get("2026-01")?.["*__count"])).toBe(1);
      expect(Number(byMonth.get("2026-01")?.[`${fixture.amountId}__median`])).toBe(12.5);
      expect(Number(byMonth.get("2026-02")?.["*__count"])).toBe(2);
      expect(String(byMonth.get("2026-02")?.[`${fixture.orderedAtId}__earliest`])).toStartWith("2026-02-03");
      expect(String(byMonth.get("2026-02")?.[`${fixture.orderedAtId}__latest`])).toStartWith("2026-02-20");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes multi-select grouped explode semantics", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          group by TAGS1
          aggregate count(*) as rows
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.explode).toBe(true);
      const byTag = new Map(result.rows.map((row) => [row.values.gk_0, row.values["*__count"]]));
      expect(Number(byTag.get("priority"))).toBe(2);
      expect(Number(byTag.get("remote"))).toBe(2);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("labels relation preview values and surfaces truncation", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const rows = await preview(
        fixture,
        `
          select CUSTL as customer_label, PARNT as parent_label
          sort AMT01 asc
        `,
        ctx(fixture),
        1,
      );

      expect(rows.mode).toBe("rows");
      expect(rows.limit).toBe(1);
      expect(rows.truncated).toBe(true);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.recordId).toBe(fixture.orderBId);
      expect(rows.rows[0]?.values.q_col_0).toEqual(["Bob"]);
      expect(rows.rows[0]?.values.q_col_1).toEqual(["Open"]);

      const grouped = await preview(
        fixture,
        `
          group by CUSTL
          aggregate count(*) as rows
        `,
      );
      expect(grouped.mode).toBe("groups");
      expect(grouped.explode).toBe(true);
      expect(new Set(grouped.rows.map((row) => row.values.gk_0))).toEqual(new Set(["Alice", "Bob"]));
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("gates relation labels and relation search by viewer target-table access", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const blockedViewer: ExpansionViewer = { userId: uuid(), userGroups: [] };
      const adminViewer: ExpansionViewer = { userId: uuid(), userGroups: [], isAdmin: true };

      const visibleLabels = await preview(
        fixture,
        `
          select CUSTL as customer_label
          sort AMT01 asc
        `,
        ctx(fixture),
        2,
        adminViewer,
      );
      expect(visibleLabels.mode).toBe("rows");
      expect(visibleLabels.rows.map((row) => row.values.q_col_0)).toEqual([["Bob"], ["Alice"]]);

      const blockedLabels = await preview(
        fixture,
        `
          select CUSTL as customer_label
          sort AMT01 asc
        `,
        ctx(fixture),
        2,
        blockedViewer,
      );
      expect(blockedLabels.mode).toBe("rows");
      expect(blockedLabels.rows.map((row) => row.values.q_col_0)).toEqual([["Unknown record"], ["Unknown record"]]);

      const visibleSearch = await preview(fixture, `search 'Alice' in CUSTL`, ctx(fixture), 10, adminViewer);
      expect(visibleSearch.mode).toBe("rows");
      expect(visibleSearch.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const blockedSearch = await preview(fixture, `search 'Alice' in CUSTL`, ctx(fixture), 10, blockedViewer);
      expect(blockedSearch.mode).toBe("rows");
      expect(blockedSearch.rows).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes lookup/rollup computed projections through the real computed SQL map", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const rows = await preview(
        fixture,
        `
          select CSCOR as score, formula(CSCOR + AMT01) as adjusted
          where CSCOR > 5
        `,
      );

      expect(rows.mode).toBe("rows");
      expect(rows.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);
      expect(Number(rows.rows[0]?.values.q_col_0)).toBe(8);
      expect(Number(rows.rows[0]?.values.q_col_1)).toBe(20.5);

      const aggregate = await preview(fixture, `aggregate sum(formula(CSCOR + AMT01)) as adjusted_total`);
      expect(aggregate.mode).toBe("groups");
      expect(Number(aggregate.rows[0]?.values.adjusted_total__sum)).toBe(27.5);

      const directAggregate = await preview(fixture, `aggregate sum(CSCOR) as score_total`);
      expect(directAggregate.mode).toBe("groups");
      expect(Number(directAggregate.rows[0]?.values.score_total__sum)).toBe(11);

      const groupedDirectAggregate = await preview(
        fixture,
        `
          group by STAT1
          aggregate sum(CSCOR) as score_total
          sort score_total desc
        `,
      );
      expect(groupedDirectAggregate.mode).toBe("groups");
      const byStatus = new Map(groupedDirectAggregate.rows.map((row) => [row.values.gk_0, Number(row.values.score_total__sum)]));
      expect(byStatus.get("Open")).toBe(8);
      expect(byStatus.get("Closed")).toBe(3);
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
          from table ${fixture.orders.shortId}
          group by STAT1
          aggregate sum(formula(AMT01 - COST1)) as margin
          having margin > 5
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

  postgresTest("executes a relation = filter via record-link containment", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const linked = await preview(fixture, `where CUSTL = '${fixture.customerAId}'`);
      expect(linked.mode).toBe("rows");
      expect(linked.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);

      const excluded = await preview(fixture, `where CUSTL != '${fixture.customerAId}'`);
      expect(excluded.rows.map((row) => row.recordId)).toEqual([fixture.orderBId, fixture.orderCId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes a mixed filter + cross-field formula predicate in one SQL pass", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(fixture, `where Status = 'Open' and AMT01 > COST1`);
      expect(result.mode).toBe("rows");
      expect(result.rows.map((row) => row.recordId)).toEqual([fixture.orderAId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes a negated predicate", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(fixture, `where not (Status = 'Open')`);
      expect(result.mode).toBe("rows");
      expect(result.rows.map((row) => row.recordId)).toEqual([fixture.orderBId, fixture.orderCId]);
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
          from table ${fixture.orders.shortId}
          where AMT01 > COST1
          aggregate count(*) as rows, sum(AMT01) as revenue
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

  postgresTest("executes aggregate-only relation joins", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          join table ${fixture.customers.shortId} as customer on CUSTL = customer.id
          aggregate sum(customer.SCORE) as total_score, avg(customer.FAMT1) as favorite_avg, sum(formula(AMT01 + customer.SCORE)) as weighted
        `,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0]?.values[`${fixture.customerScoreId}__sum`])).toBe(11);
      expect(Number(result.rows[0]?.values.favorite_avg__avg)).toBe(8.25);
      expect(Number(result.rows[0]?.values.weighted__sum)).toBe(27.5);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("executes aggregate-only counts over system columns", async () => {
    const fixture = await insertDslDbFixture();
    try {
      const createdAtField = field({
        id: uuid(),
        shortId: "CRTAT",
        tableId: fixture.orders.id,
        name: "Created at",
        type: "created_at",
        position: 99,
      });
      const createdByField = field({
        id: uuid(),
        shortId: "CRTBY",
        tableId: fixture.orders.id,
        name: "Created by",
        type: "created_by",
        position: 100,
      });
      const context = {
        ...ctx(fixture),
        fieldsByTableId: {
          ...fixture.fieldsByTableId,
          [fixture.orders.id]: [...fixture.fieldsByTableId[fixture.orders.id]!, createdAtField, createdByField],
        },
      };

      const result = await preview(
        fixture,
        `
          from table ${fixture.orders.shortId}
          aggregate count(CRTAT) as created_rows, countEmpty(CRTBY) as missing_creator
        `,
        context,
      );

      expect(result.mode).toBe("groups");
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0]?.values[`${createdAtField.id}__count`])).toBe(3);
      expect(Number(result.rows[0]?.values[`${createdByField.id}__countEmpty`])).toBe(3);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

});
