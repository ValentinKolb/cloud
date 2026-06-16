import { describe, expect, test } from "bun:test";
import type { Field } from "../service/types";
import { buildDslQueryIntelligence } from "./intelligence";
import type { DslResolverContext, DslTableSource, DslViewSource } from "./resolver";

const table = (id: string, shortId: string, name: string): DslTableSource => ({
  kind: "table",
  id,
  shortId,
  name,
});

const field = (tableId: string, id: string, shortId: string, name: string, type: string, config: Record<string, unknown> = {}): Field => ({
  id,
  shortId,
  tableId,
  name,
  description: null,
  icon: null,
  type,
  config,
  position: Number(shortId.replace(/\D/g, "")) || 0,
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

const orders = table("orders", "ORD01", "Orders");
const customers = table("customers", "CUS01", "Customers");
const accounts = table("accounts", "ACC01", "Accounts");
const transactions = table("transactions", "TRN01", "Transactions");

const amount = field(orders.id, "amount", "AMT01", "Amount", "number");
const stage = field(orders.id, "stage", "STG01", "Stage", "select", {
  options: [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
  ],
});
const customerLink = field(orders.id, "customer", "CST01", "Customer", "relation", { targetTableId: customers.id });
const customerName = field(customers.id, "name", "NAM01", "Name", "text");
const accountName = field(accounts.id, "account_name", "ACN01", "Name", "text");
const transactionAmount = field(transactions.id, "transaction_amount", "TAM01", "Amount", "number");

const revenueView: DslViewSource = {
  kind: "view",
  id: "revenue-view",
  shortId: "REV01",
  tableId: orders.id,
  name: "Revenue by customer",
  query: {
    groupBy: [{ fieldId: customerLink.id }],
    aggregations: [{ fieldId: amount.id, agg: "sum", label: "revenue" }],
  },
};

const ctx = (overrides: Partial<DslResolverContext> = {}): DslResolverContext => ({
  currentTable: orders,
  tables: [orders, customers, accounts, transactions],
  views: [revenueView],
  fieldsByTableId: {
    [orders.id]: [amount, stage, customerLink],
    [customers.id]: [customerName],
    [accounts.id]: [accountName],
    [transactions.id]: [transactionAmount],
  },
  ...overrides,
});

const labels = (query: string, context = ctx()) =>
  buildDslQueryIntelligence({ query, caret: query.length, ctx: context }).map((item) => item.label);

const labelsForCurrentSource = (query: string, currentSource: { kind: "table"; tableId: string } | { kind: "view"; viewId: string }) =>
  buildDslQueryIntelligence({ query, caret: query.length, ctx: ctx(), currentSource }).map((item) => item.label);

const item = (query: string, label: string, context = ctx()) =>
  buildDslQueryIntelligence({ query, caret: query.length, ctx: context }).find((candidate) => candidate.label === label);

describe("GQL query intelligence", () => {
  test("suggests only typed sources after from and never offers untyped source refs", () => {
    expect(labels("from ")).toEqual(expect.arrayContaining(["table", "view"]));
    expect(labels("from Or")).not.toContain("Orders");
    expect(labels("from table ")).toEqual(expect.arrayContaining(["Orders", "Customers"]));
    expect(labels("from view ")).toContain("Revenue by customer");
  });

  test("uses an explicit from source instead of the current table scope", () => {
    const context = ctx({ currentTable: accounts });
    const suggestions = labels("from table Transactions\nselect ", context);

    expect(suggestions).toContain("Amount");
    expect(item("from table Transactions\nselect ", "Amount", context)?.detail).toContain("TAM01");
    expect(item("from table Transactions\nselect ", "Name", context)).toBeUndefined();
  });

  test("uses implicit current table and view sources when no from clause is present", () => {
    expect(labelsForCurrentSource("select ", { kind: "table", tableId: transactions.id })).toContain("Amount");
    expect(labelsForCurrentSource("select ", { kind: "view", viewId: revenueView.id })).toEqual(
      expect.arrayContaining(["Customer", "revenue"]),
    );
  });

  test("suggests fields for the scoped join alias", () => {
    const query = "from table Orders\njoin table Customers as customer on Customer = customer.id\nselect customer.";
    const suggestions = labels(query);

    expect(suggestions).toContain("Name");
    expect(suggestions).not.toContain("Amount");
    expect(item(query, "Name")?.textEdit).toMatchObject({ text: "Name", start: query.length, end: query.length });
  });

  test("suggests GQL predicate helpers in where clauses", () => {
    expect(labels("from table Orders\nwhere ico")).toContain("icontains");
    expect(item("from table Orders\nwhere one", "oneof")?.textEdit.text).toBe("oneof(");
  });

  test("suggests aggregate aliases for having and grouped sort", () => {
    const prefix = "from table Orders\ngroup by Stage\naggregate sum(Amount) as total";

    expect(labels(`${prefix}\nhaving `)).toContain("total");
    expect(labels(`${prefix}\nsort `)).toContain("total");
  });

  test("suggests derived saved-view output columns instead of raw source fields", () => {
    const suggestions = labels('from view "Revenue by customer"\nselect ');

    expect(suggestions).toEqual(expect.arrayContaining(["Customer", "revenue"]));
    expect(suggestions).not.toContain("Amount");
  });

  test("does not suggest sources or fields omitted from the permission-shaped context", () => {
    const context = ctx({
      tables: [orders],
      views: [],
      fieldsByTableId: {
        [orders.id]: [amount, stage],
      },
    });

    expect(labels("from table ", context)).toEqual(["Orders"]);
    expect(labels("from table Orders\njoin table ", context)).not.toContain("Customers");
    expect(labels("from table Orders\nselect ", context)).not.toContain("Customer");
  });
});
