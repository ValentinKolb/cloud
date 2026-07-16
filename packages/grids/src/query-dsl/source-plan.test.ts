import { describe, expect, test } from "bun:test";
import type { DslResolvedSqlQueryPlan, DslTableSource, DslViewSource } from "./resolver";
import { collectDslFieldTableIds, collectDslPlanExtraFieldTableIds, needsDslViewCatalog } from "./source-plan";
import type { DslQueryAst, DslSourceRef } from "./types";

const ast = (overrides: Partial<DslQueryAst> = {}): DslQueryAst => ({
  joins: [],
  select: [],
  groupBy: [],
  aggregations: [],
  sort: [],
  ...overrides,
});

const source = (kind: DslSourceRef["kind"], ref: string): DslSourceRef => ({ kind, ref });

const table = (id: string, shortId = id): DslTableSource => ({
  kind: "table",
  id,
  shortId,
  name: shortId,
});

const view = (id: string, shortId: string, tableId: string): DslViewSource => ({
  kind: "view",
  id,
  shortId,
  name: shortId,
  tableId,
  query: {},
});

describe("DSL source planning", () => {
  const orders = table("table_orders", "Orders");
  const customers = table("table_customers", "Customers");
  const customerView = view("view_customers", "Customers", customers.id);

  test("does not need the view catalog for explicit table-only queries", () => {
    const query = ast({
      source: source("table", "Orders"),
      joins: [
        {
          mode: "left",
          source: source("table", "Customers"),
          alias: "customer",
          on: { left: { ref: "customer" }, right: { scope: "customer", ref: "id" } },
        },
      ],
    });

    expect(needsDslViewCatalog(query)).toBe(false);
    expect(collectDslFieldTableIds({ ast: query, tables: [orders, customers] })).toEqual([orders.id, customers.id]);
  });

  test("uses the current table when the query omits from", () => {
    const query = ast();

    expect(needsDslViewCatalog(query)).toBe(false);
    expect(collectDslFieldTableIds({ ast: query, currentTableId: orders.id, tables: [orders, customers] })).toEqual([orders.id]);
  });

  test("loads the owner table fields for explicit view sources", () => {
    const query = ast({ source: source("view", "view_customers") });

    expect(needsDslViewCatalog(query)).toBe(true);
    expect(collectDslFieldTableIds({ ast: query, tables: [orders, customers], views: [customerView] })).toEqual([customers.id]);
  });

  test("keeps unavailable refs empty so resolver owns the diagnostic", () => {
    const query = ast({ source: source("table", "Missing") });

    expect(collectDslFieldTableIds({ ast: query, tables: [orders, customers] })).toEqual([]);
  });

  test("only hydrates relation-search fields for readable target tables", () => {
    const relationColumn = {
      kind: "group" as const,
      key: "gk_0",
      label: "Customer",
      refs: ["Customer"],
      sqlType: "text" as const,
      type: "relation",
      targetTableId: customers.id,
    };
    const plan: DslResolvedSqlQueryPlan = {
      source: orders,
      tableId: orders.id,
      query: {},
      readableTableIds: [orders.id],
      derivedViewSource: {
        query: {},
        columns: [relationColumn],
        outputColumns: [relationColumn],
        sort: [],
        search: { q: "Ada", columns: [relationColumn] },
      },
    };

    expect(collectDslPlanExtraFieldTableIds(plan)).toEqual([]);
    expect(collectDslPlanExtraFieldTableIds({ ...plan, readableTableIds: [orders.id, customers.id] })).toEqual([customers.id]);
  });
});
