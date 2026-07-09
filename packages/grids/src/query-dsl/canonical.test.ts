import { describe, expect, test } from "bun:test";
import type { RecordQuery } from "../contracts";
import type { Field } from "../service/types";
import { canonicalizeDslQuery } from "./canonical";
import { parseGridsQueryDsl } from "./parser";
import { simpleQueryToGqlSource } from "./record-query-source";
import type { DslResolverContext } from "./resolver";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type" | "tableId">): Field => ({
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

const orders = { kind: "table" as const, id: "11111111-1111-4111-8111-111111111111", shortId: "Orders", name: "Orders" };
const customers = { kind: "table" as const, id: "22222222-2222-4222-8222-222222222222", shortId: "Custs", name: "Customers" };

const amountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const costId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const paidId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const customerLinkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const orderedAtId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const notesId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const stageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const customerNameId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const customerScoreId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const orderFields: Field[] = [
  field({ id: amountId, tableId: orders.id, shortId: "amount", name: "Amount", type: "number", position: 0 }),
  field({ id: costId, tableId: orders.id, shortId: "cost", name: "Cost", type: "number", position: 1 }),
  field({ id: paidId, tableId: orders.id, shortId: "paid", name: "Paid", type: "boolean", position: 2 }),
  field({
    id: customerLinkId,
    tableId: orders.id,
    shortId: "customer_link",
    name: "Customer link",
    type: "relation",
    config: { targetTableId: customers.id },
    position: 3,
  }),
  field({ id: orderedAtId, tableId: orders.id, shortId: "ordered_at", name: "Ordered at", type: "date", position: 4 }),
  field({ id: notesId, tableId: orders.id, shortId: "notes", name: "Notes", type: "text", position: 5 }),
  field({
    id: stageId,
    tableId: orders.id,
    shortId: "stage",
    name: "Stage",
    type: "select",
    config: {
      options: [
        { id: "open", label: "Open" },
        { id: "closed", label: "Closed" },
        { id: "hold", label: "On hold" },
      ],
    },
    position: 6,
  }),
];

const customerFields: Field[] = [
  field({ id: customerNameId, tableId: customers.id, shortId: "name", name: "Name", type: "text", position: 0 }),
  field({ id: customerScoreId, tableId: customers.id, shortId: "score", name: "Score", type: "number", position: 1 }),
];

const topOrdersView = {
  kind: "view" as const,
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "Top01",
  name: "Top orders",
  tableId: orders.id,
  query: { sort: [{ fieldId: amountId, direction: "desc" as const }], limit: 5 },
};

const statusSummaryView = {
  kind: "view" as const,
  id: "44444444-4444-4444-8444-444444444444",
  shortId: "Sum01",
  name: "Status summary",
  tableId: orders.id,
  query: {
    groupBy: [{ fieldId: paidId, label: "Payment status" }],
    aggregations: [{ fieldId: amountId, agg: "sum" as const, label: "revenue" }],
    groupSort: [{ fieldId: amountId, agg: "sum" as const, direction: "desc" as const }],
  },
};

const totalRevenueView = {
  kind: "view" as const,
  id: "55555555-5555-4555-8555-555555555555",
  shortId: "Tot01",
  name: "Total revenue",
  tableId: orders.id,
  query: {
    aggregations: [
      { fieldId: "*" as const, agg: "count" as const, label: "rows" },
      { fieldId: amountId, agg: "sum" as const, label: "revenue" },
    ],
  },
};

const ctx = (): DslResolverContext => ({
  currentTable: orders,
  tables: [orders, customers],
  views: [topOrdersView, statusSummaryView, totalRevenueView],
  fieldsByTableId: {
    [orders.id]: orderFields,
    [customers.id]: customerFields,
  },
});

const canonical = (source: string, context = ctx()): string => {
  const parsed = parseGridsQueryDsl(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("; "));
  const result = canonicalizeDslQuery(parsed.ast, context);
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("; "));
  expect(result.ok).toBe(true);

  const reparsed = parseGridsQueryDsl(result.source);
  expect(reparsed.ok).toBe(true);
  if (!reparsed.ok) throw new Error(reparsed.diagnostics.map((d) => d.message).join("; "));
  const recanonical = canonicalizeDslQuery(reparsed.ast, context);
  if (!recanonical.ok) throw new Error(recanonical.diagnostics.map((d) => d.message).join("; "));
  expect(recanonical.ok).toBe(true);
  expect(recanonical.source).toBe(result.source);
  return result.source;
};

const canonicalUiQuery = (query: RecordQuery, tableId = orders.id): string => {
  const converted = simpleQueryToGqlSource({ tableId, query });
  if (!converted.ok) throw new Error(converted.reason);
  return canonical(converted.source);
};

describe("canonicalizeDslQuery", () => {
  test("emits an explicit stable source for implicit table queries", () => {
    expect(
      canonical(`
        select Amount as order_amount, formula(Amount - Cost) as line_margin
        where Amount > Cost and Paid
        sort line_margin desc nulls last
        limit 20
      `),
    ).toBe(`from table {${orders.id}}
select {${amountId}} as order_amount, formula({${amountId}} - {${costId}}) as line_margin
where {${amountId}} > {${costId}} and {${paidId}}
sort line_margin desc nulls last
limit 20`);
  });

  test("emits stable refs for source aliases, joins, and scoped formulas", () => {
    expect(
      canonical(`
        from table Orders as o
        join table Customers as customer on o.customer_link = customer.id
        select O.Amount as order_amount, Customer.Name as customer_name, formula(O.Amount + Customer.Score) as weighted_score
        where Customer.Score > 5 and O.Paid = true
        sort weighted_score desc nulls first
        offset 3
      `),
    ).toBe(`from table {${orders.id}} as o
join table {${customers.id}} as customer on {${customerLinkId}} = customer.id
select o.{${amountId}} as order_amount, customer.{${customerNameId}} as customer_name, formula(o.{${amountId}} + customer.{${customerScoreId}}) as weighted_score
where customer.{${customerScoreId}} > 5 and o.{${paidId}} = true
sort weighted_score desc nulls first
offset 3`);
  });

  test("emits reverse joins and aggregate/having aliases", () => {
    expect(
      canonical(`
        from table Customers as c
        join table Orders as order on order.customer_link = c.id
        group by c.Name
        aggregate sum(order.Amount) as revenue, count(*) as rows, avg(formula(order.Amount + c.Score)) as weighted
        having revenue > 10 and rows >= 1
        sort revenue desc
        search 'Alice' in c.Name
        deleted only
      `),
    ).toBe(`from table {${customers.id}} as c
join table {${orders.id}} as order on order.{${customerLinkId}} = c.id
group by c.{${customerNameId}}
aggregate sum(order.{${amountId}}) as revenue, count(*) as rows, avg(formula(order.{${amountId}} + c.{${customerScoreId}})) as weighted
having revenue > 10 and rows >= 1
sort revenue desc
search 'Alice' in c.{${customerNameId}}
deleted only`);
  });

  test("emits stable view sources and aggregate-only output", () => {
    expect(
      canonical(`
        from view Top01
        where Amount > 0
        aggregate count(*) as rows, sum(Amount) as revenue
      `),
    ).toBe(`from view {${topOrdersView.id}}
where {${amountId}} > 0
aggregate count(*) as rows, sum({${amountId}}) as revenue`);
  });

  test("emits stable output refs for grouped derived view sources", () => {
    expect(
      canonical(`
        from view Sum01
        select "Payment status", revenue
        where revenue > 5
        sort revenue desc
        limit 10
      `),
    ).toBe(`from view {${statusSummaryView.id}}
select "gk_0", "${amountId}__sum"
where "${amountId}__sum" > 5
sort "${amountId}__sum" desc
limit 10`);
  });

  test("emits stable output refs for aggregate-only derived view sources", () => {
    expect(
      canonical(`
        from view Tot01
        select rows, revenue
        where revenue > 5
      `),
    ).toBe(`from view {${totalRevenueView.id}}
select "*__count", "${amountId}__sum"
where "${amountId}__sum" > 5`);
  });

  test("emits stable refs for grouped derived view output", () => {
    expect(
      canonical(`
        from view Sum01
        search 'paid' in "Payment status"
        group by "Payment status"
        aggregate sum(revenue) as total_revenue, count(*) as rows
        having total_revenue > 10
        sort total_revenue desc nulls last
        limit 5
      `),
    ).toBe(`from view {${statusSummaryView.id}}
group by "gk_0"
aggregate sum("${amountId}__sum") as total_revenue, count(*) as rows
having total_revenue > 10
sort total_revenue desc nulls last
search 'paid' in "gk_0"
limit 5`);
  });

  test("emits the public lowercase spelling for GQL predicate functions", () => {
    expect(
      canonical(`
        where ICONTAINS(Notes, 'urgent') and ONEOF(Paid, true, false)
        select formula(IF(Paid, Amount, 0)) as payable_amount
      `),
    ).toBe(`from table {${orders.id}}
select formula(IF({${paidId}}, {${amountId}}, 0)) as payable_amount
where icontains({${notesId}}, 'urgent') and oneof({${paidId}}, true, false)`);
  });

  test("emits stable select option ids instead of editable option labels", () => {
    expect(
      canonical(`
        where Stage = 'Open' and oneof(Stage, 'Closed', 'On hold')
      `),
    ).toBe(`from table {${orders.id}}
where {${stageId}} = 'open' and oneof({${stageId}}, 'closed', 'hold')`);
  });

  test("round-trips row RecordQuery UI state through canonical GQL", () => {
    const recordId = "66666666-6666-4666-8666-666666666666";
    const userId = "77777777-7777-4777-8777-777777777777";

    expect(
      canonicalUiQuery({
        columns: [{ fieldId: amountId }, { kind: "computed", id: "computed_margin", label: "Margin", expression: "Amount - Cost" }],
        filter: {
          op: "AND",
          filters: [
            { fieldId: stageId, op: "isAnyOf", value: ["Open", "Closed"] },
            { fieldId: notesId, op: "contains", value: "rush", caseInsensitive: true },
          ],
        },
        recordMeta: {
          ids: [recordId, recordId],
          users: { updatedBy: [userId] },
        },
        sort: [{ fieldId: orderedAtId, direction: "desc", nullsFirst: false }],
        search: { q: "camera", fieldIds: [notesId] },
        includeDeleted: true,
        limit: 50,
      }),
    ).toBe(`from table {${orders.id}}
select {${amountId}}, formula({${amountId}} - {${costId}}) as __computed_margin
where oneof({${stageId}}, 'open', 'closed') and icontains({${notesId}}, 'rush') and (record.id = '${recordId}' and record.updatedBy = '${userId}')
sort {${orderedAtId}} desc nulls last
search 'camera' in {${notesId}}
limit 50
include deleted`);
  });

  test("round-trips grouped RecordQuery UI state through canonical GQL", () => {
    expect(
      canonicalUiQuery({
        groupBy: [{ fieldId: orderedAtId, granularity: "month", direction: "desc" }],
        aggregations: [
          { fieldId: "*" as const, agg: "count", label: "rows" },
          { fieldId: amountId, agg: "sum", label: "revenue" },
        ],
        groupSort: [{ fieldId: amountId, agg: "sum", direction: "desc" }],
        deletedOnly: true,
        limit: 12,
      }),
    ).toBe(`from table {${orders.id}}
group by {${orderedAtId}} by month
aggregate count(*) as rows, sum({${amountId}}) as revenue
sort revenue desc, {${orderedAtId}} desc
limit 12
deleted only`);
  });

  test("rejects UI footer-only aggregations instead of inventing row GQL", () => {
    expect(
      simpleQueryToGqlSource({
        tableId: orders.id,
        query: { aggregations: [{ fieldId: amountId, agg: "sum", label: "footer_total" }] },
      }),
    ).toEqual({
      ok: false,
      reason: "table footer aggregations are not part of row GQL source; use a direct GQL aggregate query",
    });
  });
});
