import { describe, expect, test } from "bun:test";
import type { ViewQuery } from "../contracts";
import type { Field } from "../service/types";
import { parseGridsQueryDsl } from "./parser";
import { resolveDslPreviewLimit } from "./preview";
import { resolveDslQueryToQueryPlan, resolveDslQueryToViewQuery, type DslResolverContext } from "./resolver";
import { compileDslAggregateQueryPlanToSql, compileDslGroupedQueryPlanToSql, compileDslQueryPlanToSql } from "./sql-compiler";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type">): Field => ({
  id: overrides.id,
  shortId: overrides.shortId,
  tableId: overrides.tableId ?? "table_orders",
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
const regions = { kind: "table" as const, id: "44444444-4444-4444-8444-444444444444", shortId: "Regs", name: "Regions" };
const cities = { kind: "table" as const, id: "55555555-5555-4555-8555-555555555555", shortId: "Cities", name: "Cities" };
const countries = { kind: "table" as const, id: "66666666-6666-4666-8666-666666666666", shortId: "Cntrs", name: "Countries" };

const customerFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const amountFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const costFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const statusFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const orderedAtFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const paidFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const customerLinkFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const attachmentFieldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8";
const customerNameFieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const customerRegionFieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const regionNameFieldId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const regionCityFieldId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const cityCountryFieldId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const countryNameFieldId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const fields: Field[] = [
  field({ id: customerFieldId, shortId: "customer", name: "Customer", type: "text", position: 1 }),
  field({ id: amountFieldId, shortId: "amount", name: "Amount", type: "number", position: 2 }),
  field({ id: costFieldId, shortId: "cost", name: "Cost", type: "number", position: 3 }),
  field({ id: statusFieldId, shortId: "status", name: "Status", type: "select", position: 4 }),
  field({ id: orderedAtFieldId, shortId: "ordered_at", name: "Ordered at", type: "date", position: 5 }),
  field({ id: paidFieldId, shortId: "paid", name: "Paid", type: "boolean", position: 6 }),
  field({
    id: customerLinkFieldId,
    shortId: "customer_link",
    name: "Customer link",
    type: "relation",
    position: 7,
    config: { targetTableId: customers.id },
  }),
];

const customerFields: Field[] = [
  field({ id: customerNameFieldId, tableId: customers.id, shortId: "name", name: "Name", type: "text", position: 1 }),
  field({
    id: customerRegionFieldId,
    tableId: customers.id,
    shortId: "region",
    name: "Region",
    type: "relation",
    position: 2,
    config: { targetTableId: regions.id },
  }),
];

const regionFields: Field[] = [
  field({ id: regionNameFieldId, tableId: regions.id, shortId: "name", name: "Name", type: "text", position: 1 }),
  field({
    id: regionCityFieldId,
    tableId: regions.id,
    shortId: "city",
    name: "City",
    type: "relation",
    position: 2,
    config: { targetTableId: cities.id },
  }),
];

const cityFields: Field[] = [
  field({
    id: cityCountryFieldId,
    tableId: cities.id,
    shortId: "country",
    name: "Country",
    type: "relation",
    position: 1,
    config: { targetTableId: countries.id },
  }),
];

const countryFields: Field[] = [
  field({ id: countryNameFieldId, tableId: countries.id, shortId: "name", name: "Name", type: "text", position: 1 }),
];

const ctx = (overrides: Partial<DslResolverContext> = {}): DslResolverContext => ({
  currentTable: orders,
  tables: [orders, customers, regions, cities, countries],
  views: [],
  fieldsByTableId: {
    [orders.id]: fields,
    [customers.id]: customerFields,
    [regions.id]: regionFields,
    [cities.id]: cityFields,
    [countries.id]: countryFields,
  },
  ...overrides,
});

const parseOk = (source: string) => {
  const parsed = parseGridsQueryDsl(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("; "));
  return parsed.ast;
};

const normalizedSqlParts = (query: unknown): { text: string; values: unknown[] } => {
  const target = query as Record<symbol, unknown>;
  const symbols = Object.getOwnPropertySymbols(query as object);
  const symbol = (name: string) => symbols.find((item) => item.description === name);
  const strings = symbol("strings");
  const values = symbol("values");
  const adapter = symbol("adapter");
  const normalizeQuery = (adapter ? target[adapter] : null) as {
    normalizeQuery: (strings: unknown, values: unknown) => [string, unknown[]];
  } | null;
  if (!strings || !values || !normalizeQuery) throw new Error("Bun SQL query internals changed");
  const [text, params] = normalizeQuery.normalizeQuery(target[strings], target[values]);
  return { text, values: params };
};
const normalizedSql = (query: unknown): string => normalizedSqlParts(query).text;

describe("resolveDslQueryToViewQuery", () => {
  test("resolves a table DSL query into the canonical ViewQuery shape", () => {
    const ast = parseOk(`
      from table #Orders
      select #customer, #amount as net, formula(#amount * 1.19) as gross
      where #status = "open" && #amount > 100
      sort net desc
      limit 50
    `);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tableId).toBe(orders.id);
    expect(result.plan.query).toEqual({
      filter: {
        op: "AND",
        filters: [
          { fieldId: statusFieldId, op: "is", value: "open" },
          { fieldId: amountFieldId, op: ">", value: 100 },
        ],
      },
      columns: [
        { fieldId: customerFieldId },
        { fieldId: amountFieldId, label: "net" },
        { kind: "computed", id: expect.stringMatching(/^computed_[A-Za-z0-9]{5,32}$/), label: "gross", expression: "#amount * 1.19" },
      ],
      sort: [{ fieldId: amountFieldId, direction: "desc" }],
      limit: 50,
    });
  });

  test("uses the current table when from is omitted", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select #amount`), ctx());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.source).toEqual(orders);
  });

  test("rejects non-filter-only view sources until view subqueries exist", () => {
    const viewQuery: ViewQuery = {
      filter: { fieldId: paidFieldId, op: "=", value: true },
      sort: [{ fieldId: orderedAtFieldId, direction: "desc" }],
      limit: 25,
    };
    const ast = parseOk(`
      from view #Paid
      select #customer
      limit 5
    `);

    const result = resolveDslQueryToViewQuery(
      ast,
      ctx({
        views: [
          {
            kind: "view",
            id: "33333333-3333-4333-8333-333333333333",
            shortId: "Paid",
            name: "Paid orders",
            tableId: orders.id,
            query: viewQuery,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        "view source uses sort, limit, but DSL view sources support only filters until view subqueries are implemented",
      ]);
    }
  });

  test("keeps a view source filter as a hard scope when DSL adds a filter", () => {
    const viewFilter = { fieldId: paidFieldId, op: "=", value: true } as const;
    const ast = parseOk(`
      from view #Paid
      where #status = "open"
    `);

    const result = resolveDslQueryToViewQuery(
      ast,
      ctx({
        views: [
          {
            kind: "view",
            id: "33333333-3333-4333-8333-333333333333",
            shortId: "Paid",
            name: "Paid orders",
            tableId: orders.id,
            query: { filter: viewFilter },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.filter).toEqual({
      op: "AND",
      filters: [viewFilter, { fieldId: statusFieldId, op: "is", value: "open" }],
    });
  });

  test("resolves group-by and aggregations without inventing SQL", () => {
    const ast = parseOk(`
      group by #ordered_at by month
      aggregate sum(#amount) as revenue, count(*) as rows
    `);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.groupBy).toEqual([{ fieldId: orderedAtFieldId, granularity: "month" }]);
    expect(result.plan.query.aggregations).toEqual([
      { fieldId: amountFieldId, agg: "sum", label: "revenue" },
      { fieldId: "*", agg: "count", label: "rows" },
    ]);
  });

  test("rejects sources the caller did not expose to the resolver", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`from table #Secret`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["source #Secret is not available"]);
  });

  test("rejects ambiguous untyped sources instead of guessing table or view", () => {
    const result = resolveDslQueryToViewQuery(
      parseOk(`from #Orders`),
      ctx({
        views: [
          {
            kind: "view",
            id: "33333333-3333-4333-8333-333333333333",
            shortId: "Orders",
            name: "Orders view",
            tableId: orders.id,
            query: {},
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["source #Orders is ambiguous; use table or view"]);
  });

  test("rejects duplicate select aliases before ViewQuery validation", () => {
    const ast = parseOk(`select #customer as label, formula(#amount * 2) as label`);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['duplicate select alias "label"']);
  });

  test("rejects duplicate field aliases before alias-based sorting can become ambiguous", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select #amount as value, #cost as value`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['duplicate select alias "value"']);
  });

  test("generates stable distinct computed ids for aliases that normalize similarly", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select formula(#amount * 2) as a, formula(#amount * 3) as a_`), ctx());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const computedIds = result.plan.query.columns
      ?.map((column) => ("kind" in column && column.kind === "computed" ? column.id : null))
      .filter(Boolean);
    expect(computedIds).toHaveLength(2);
    expect(new Set(computedIds).size).toBe(2);
  });

  test("rejects unknown field refs with a direct diagnostic", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`where #missing = "x"`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["unknown field #missing"]);
  });

  test("allows count(*) but rejects other aggregate functions over *", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`group by #status aggregate sum(*) as total`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['aggregate "sum" cannot use *']);
  });

  test("rejects aggregate-only save-as-view because preview renders a synthetic aggregate row", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`aggregate sum(#amount) as revenue`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toContain(
        "aggregate-only DSL queries cannot be saved as a regular view yet; add group by or use preview",
      );
    }
  });

  test("query plan still supports aggregate-only previews", () => {
    const median = resolveDslQueryToViewQuery(parseOk(`aggregate median(#amount) as middle`), ctx());
    expect(median.ok).toBe(false);
    if (!median.ok) {
      expect(median.diagnostics.map((d) => d.message)).toContain(
        "aggregate-only DSL queries cannot be saved as a regular view yet; add group by or use preview",
      );
    }

    const latest = resolveDslQueryToQueryPlan(parseOk(`aggregate latest(#ordered_at) as latest_order`), ctx());
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.plan.query.aggregations).toEqual([{ fieldId: orderedAtFieldId, agg: "latest", label: "latest_order" }]);
  });

  test("rejects save-as-view grouped shapes that the group compiler cannot run", () => {
    const textSum = resolveDslQueryToViewQuery(parseOk(`group by #status aggregate sum(#customer) as total`), ctx());
    expect(textSum.ok).toBe(false);
    if (!textSum.ok) expect(textSum.diagnostics.map((d) => d.message)).toEqual(['agg "sum" not compatible with field type "text"']);

    const median = resolveDslQueryToViewQuery(parseOk(`group by #status aggregate median(#amount) as middle`), ctx());
    expect(median.ok).toBe(false);
    if (!median.ok)
      expect(median.diagnostics.map((d) => d.message)).toEqual(['aggregate "median" is not supported by grouped SQL queries yet']);

    const fileField = field({ id: attachmentFieldId, shortId: "files", name: "Files", type: "file", position: 8 });
    const fileGroup = resolveDslQueryToViewQuery(
      parseOk(`group by #files`),
      ctx({ fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: [...fields, fileField] } }),
    );
    expect(fileGroup.ok).toBe(false);
    if (!fileGroup.ok) expect(fileGroup.diagnostics.map((d) => d.message)).toEqual(['field "Files" (type "file") is not groupable']);
  });

  test("rejects joins, having, and formula aggregate arguments until they have a validated QueryPlan path", () => {
    const ast = parseOk(`
      left join table #Custs as c on #customer = c.#id
      aggregate avg(formula(#amount - #cost)) as margin
      having #margin > 10
    `);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        "joins are parsed, but relation-safe QueryPlan joins are not enabled yet",
        "having is parsed, but QueryPlan having support is not enabled yet",
        "aggregate-only DSL queries cannot be saved as a regular view yet; add group by or use preview",
        'aggregate "margin" uses a formula argument; formula aggregates need QueryPlan',
      ]);
    }
  });

  test("rejects save-as-view computed selects that cannot compile to SQL", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select formula(#customer_link) as linked`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        'select "linked": Field Customer link (relation) cannot be compiled into SQL formulas yet',
      ]);
    }
  });

  test("rejects formula filters instead of silently running them client-side", () => {
    const ast = parseOk(`where #amount > formula(#cost * 1.10)`);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["filter values must be literals in the ViewQuery resolver"]);
  });

  test("rejects sorting by computed aliases because ViewQuery cannot sort them yet", () => {
    const ast = parseOk(`
      select formula(#amount * 2) as doubled
      sort doubled desc
    `);

    const result = resolveDslQueryToViewQuery(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((d) => d.message)).toEqual(['sort by computed alias "doubled" is not supported by ViewQuery yet']);
  });

  test("query plan accepts sorting by computed select aliases without changing ViewQuery behavior", () => {
    const ast = parseOk(`
      select formula(#amount * 2) as doubled
      sort doubled desc
    `);

    const viewResult = resolveDslQueryToViewQuery(ast, ctx());
    const planResult = resolveDslQueryToQueryPlan(ast, ctx());

    expect(viewResult.ok).toBe(false);
    if (!viewResult.ok)
      expect(viewResult.diagnostics.map((d) => d.message)).toEqual(['sort by computed alias "doubled" is not supported by ViewQuery yet']);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.plan.query.sort).toBeUndefined();
    expect(planResult.plan.sqlSort).toEqual([{ kind: "computed", alias: "doubled", direction: "desc" }]);
  });

  test("rejects non-zero offset when compiling to a regular ViewQuery", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select #amount\nskip 10`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["offset cannot be saved as a regular view yet"]);
  });

  test("allows no-op offset when compiling to a regular ViewQuery", () => {
    const result = resolveDslQueryToViewQuery(parseOk(`select #amount\nskip 0`), ctx());

    expect(result.ok).toBe(true);
  });

  test("query plan accepts SQL-valid formula where predicates without changing ViewQuery behavior", () => {
    const ast = parseOk(`where #amount > formula(#cost * 1.10)`);

    const viewResult = resolveDslQueryToViewQuery(ast, ctx());
    const planResult = resolveDslQueryToQueryPlan(ast, ctx());

    expect(viewResult.ok).toBe(false);
    if (!viewResult.ok)
      expect(viewResult.diagnostics.map((d) => d.message)).toEqual(["filter values must be literals in the ViewQuery resolver"]);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    expect(planResult.plan.query.filter).toBeUndefined();
    expect(planResult.plan.formulaWhere).toMatchObject({
      kind: "formula",
      source: "#amount > (#cost * 1.10)",
      sqlType: "boolean",
    });
  });

  test("query plan rejects formula select expressions that cannot compile to SQL", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`select formula(#customer_link) as linked`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        'select "linked": Field Customer link (relation) cannot be compiled into SQL formulas yet',
      ]);
    }
  });

  test("query plan rejects view sources with scope keys the SQL preview cannot compile yet", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        from view #Mine
        select #amount
      `),
      ctx({
        views: [
          {
            kind: "view",
            id: "33333333-3333-4333-8333-333333333333",
            shortId: "Mine",
            name: "Scoped view",
            tableId: orders.id,
            query: {
              search: { q: "open" },
              recordMeta: { users: { createdBy: ["11111111-1111-4111-8111-111111111111"] } },
            },
          },
        ],
      }),
    );

    expect(resolved).toEqual({
      ok: false,
      diagnostics: [
        {
          message:
            "view source uses search, record metadata, but DSL view sources support only filters until view subqueries are implemented",
        },
      ],
    });
  });

  test("query plan rejects non-filter-only view sources before flattening their semantics", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        from view #Top
        select #amount
      `),
      ctx({
        views: [
          {
            kind: "view",
            id: "33333333-3333-4333-8333-333333333333",
            shortId: "Top",
            name: "Top orders",
            tableId: orders.id,
            query: { sort: [{ fieldId: amountFieldId, direction: "desc" }], limit: 10 },
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        "view source uses sort, limit, but DSL view sources support only filters until view subqueries are implemented",
      ]);
    }
  });

  test("query plan rejects formula where predicates that cannot compile to SQL", () => {
    const missing = resolveDslQueryToQueryPlan(parseOk(`where #missing > formula(#cost * 1.10)`), ctx());
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics.map((d) => d.message)).toEqual(["where formula: Unknown formula field reference #missing"]);

    const relation = resolveDslQueryToQueryPlan(parseOk(`where #customer_link = "abc"`), ctx());
    expect(relation.ok).toBe(false);
    if (!relation.ok) {
      expect(relation.diagnostics.map((d) => d.message)).toEqual([
        "where formula: Field Customer link (relation) cannot be compiled into SQL formulas yet",
      ]);
    }
  });

  test("query plan rejects non-boolean formula where predicates", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`where formula(#amount + 1)`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["where formula must return a boolean value"]);
  });

  test("query plan accepts having predicates over aggregate aliases", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue, count(*) as rows
        having #revenue > 100 && #rows >= 2
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.formulaHaving).toMatchObject({
      kind: "formula",
      source: "#revenue > 100 && #rows >= 2",
      sqlType: "boolean",
      aggregateRefs: [
        { ref: "revenue", fieldId: amountFieldId, agg: "sum" },
        { ref: "rows", fieldId: "*", agg: "count" },
      ],
    });
  });

  test("query plan accepts formula aggregate arguments and having over their aliases", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(formula(#amount - #cost)) as margin
        having #margin > 10
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.aggregations).toBeUndefined();
    expect(result.plan.formulaAggregations).toHaveLength(1);
    expect(result.plan.formulaAggregations?.[0]).toMatchObject({
      kind: "formula",
      id: "margin",
      ref: "margin",
      agg: "sum",
      source: "#amount - #cost",
      sqlType: "numeric",
    });
    expect(result.plan.formulaHaving?.aggregateRefs).toMatchObject([
      {
        kind: "formula",
        id: "margin",
        ref: "margin",
        agg: "sum",
      },
    ]);
  });

  test("query plan rejects incompatible formula aggregate arguments", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(formula(CONCAT(#customer, "x"))) as bad
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['agg "sum" not compatible with formula type "text"']);
  });

  test("query plan rejects formula aggregate aliases before SQL alias generation", () => {
    const alias = "a".repeat(51);
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(formula(#amount - #cost)) as ${alias}
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual([`formula aggregate alias "${alias}" must be 50 characters or less`]);
    }
  });

  test("query plan rejects incompatible normal aggregate arguments before runtime compilation", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#customer) as total
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['agg "sum" not compatible with field type "text"']);
  });

  test("query plan rejects having predicates over unknown aggregate aliases", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
        having #missing > 100
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["having formula: Unknown formula field reference #missing"]);
  });

  test("query plan rejects duplicate aggregate aliases before having can resolve ambiguously", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as metric, count(*) as metric
        having #metric > 1
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toContain('duplicate aggregate alias "metric"');
  });

  test("rejects duplicate aggregate output keys even when aliases differ", () => {
    const saved = resolveDslQueryToViewQuery(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue, sum(#amount) as total
      `),
      ctx(),
    );
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.diagnostics.map((d) => d.message)).toContain('duplicate aggregate output for "Amount" with "sum"');

    const preview = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue, sum(#amount) as total
      `),
      ctx(),
    );
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.diagnostics.map((d) => d.message)).toContain('duplicate aggregate output for "Amount" with "sum"');
  });

  test("query plan rejects having without an effective grouped query", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`having true`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["having requires a grouped query"]);
  });

  test("query plan resolves aggregate-only output for preview", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        where #status = "open"
        aggregate count(*) as rows, sum(#amount) as revenue
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.filter).toEqual({ fieldId: statusFieldId, op: "is", value: "open" });
    expect(result.plan.query.groupBy).toBeUndefined();
    expect(result.plan.query.aggregations).toEqual([
      { fieldId: "*", agg: "count", label: "rows" },
      { fieldId: amountFieldId, agg: "sum", label: "revenue" },
    ]);
  });

  test("query plan rejects ambiguous aggregate-only shapes", () => {
    const selected = resolveDslQueryToQueryPlan(parseOk(`select #customer aggregate count(*) as rows`), ctx());
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.diagnostics.map((d) => d.message)).toContain("aggregate-only DSL queries cannot select row fields");

    const sorted = resolveDslQueryToQueryPlan(parseOk(`aggregate count(*) as rows sort rows desc`), ctx());
    expect(sorted.ok).toBe(false);
    if (!sorted.ok) expect(sorted.diagnostics.map((d) => d.message)).toContain("aggregate-only DSL queries cannot sort");

    const formulaAggregate = resolveDslQueryToQueryPlan(parseOk(`aggregate sum(formula(#amount - #cost)) as margin`), ctx());
    expect(formulaAggregate.ok).toBe(true);
    if (formulaAggregate.ok) expect(formulaAggregate.plan.formulaAggregations?.map((aggregation) => aggregation.id)).toEqual(["margin"]);
  });

  test("query plan maps grouped sort to group key direction and group aggregate sort", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
        sort #ordered_at asc, revenue desc
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.groupBy).toEqual([{ fieldId: orderedAtFieldId, granularity: "month", direction: "asc" }]);
    expect(result.plan.query.groupSort).toEqual([{ fieldId: amountFieldId, agg: "sum", direction: "desc" }]);
    expect(result.plan.query.sort).toBeUndefined();
    expect(result.plan.sqlSort).toBeUndefined();
  });

  test("query plan rejects grouped sort targets that cannot be represented by grouped SQL", () => {
    const missingGroup = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
        sort #status asc
      `),
      ctx(),
    );
    expect(missingGroup.ok).toBe(false);
    if (!missingGroup.ok) {
      expect(missingGroup.diagnostics.map((d) => d.message)).toEqual(['grouped sort field "Status" must also be in group by']);
    }
  });

  test("query plan maps grouped formula aggregate sort aliases to groupSort", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(formula(#amount - #cost)) as margin
        sort margin desc
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.groupSort).toBeUndefined();
    expect(result.plan.formulaGroupSort).toEqual([{ fieldId: "margin", agg: "sum", direction: "desc" }]);
  });

  test("query plan accepts relation-safe joins and joined select columns", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount, customer.#name as customer_name
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.joins).toMatchObject([
      {
        mode: "inner",
        alias: "customer",
        tableId: customers.id,
        fromScope: null,
        fromTableId: orders.id,
        relationFieldId: customerLinkFieldId,
        depth: 1,
      },
    ]);
    expect(result.plan.query.columns).toEqual([{ fieldId: amountFieldId }]);
    expect(result.plan.joinedColumns).toEqual([
      { joinAlias: "customer", tableId: customers.id, fieldId: customerNameFieldId, label: "customer_name" },
    ]);
  });

  test("query plan rejects duplicate join aliases", () => {
    const ast = parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        join table #Custs as duplicate on #customer_link = duplicate.#id
      `);
    ast.joins[1]!.alias = "customer";
    ast.joins[1]!.on.right.scope = "customer";
    const result = resolveDslQueryToQueryPlan(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toContain('duplicate join alias "customer"');
  });

  test("query plan rejects select aliases that collide with join aliases", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount as customer
      `),
      ctx(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['duplicate select alias "customer"']);
  });

  test("query plan rejects join predicates that do not use the join alias on one side", () => {
    const ast = parseOk(`join table #Custs as customer on #customer_link = customer.#id`);
    ast.joins[0]!.on.right.scope = undefined;
    ast.joins[0]!.on.right.ref = "customer_link";
    const result = resolveDslQueryToQueryPlan(ast, ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.message)).toEqual(['join "customer" must compare one relation field to customer.#id']);
    }
  });

  test("query plan accepts sorting by joined select aliases", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select customer.#name as customer_name
        sort customer_name asc
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sqlSort).toEqual([{ kind: "joined", alias: "customer_name", direction: "asc" }]);
  });

  test("query plan accepts sorting by scoped joined fields without selecting them", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount
        sort customer.#name asc
      `),
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.query.sort).toBeUndefined();
    expect(result.plan.sqlSort).toEqual([
      { kind: "joinedField", joinAlias: "customer", tableId: customers.id, fieldId: customerNameFieldId, direction: "asc" },
    ]);
  });

  test("query plan rejects join targets that are not exposed to the resolver", () => {
    const result = resolveDslQueryToQueryPlan(
      parseOk(`join table #Custs as customer on #customer_link = customer.#id`),
      ctx({ tables: [orders] }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["source #Custs is not available"]);
  });

  test("query plan rejects relation field output when the target table is not readable", () => {
    const unreadableTarget = ctx({
      tables: [orders],
      fieldsByTableId: { [orders.id]: fields },
    });

    const selected = resolveDslQueryToQueryPlan(parseOk(`select #customer_link`), unreadableTarget);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.diagnostics.map((d) => d.message)).toEqual(['relation field "Customer link" target table is not available']);
    }

    const grouped = resolveDslQueryToQueryPlan(parseOk(`group by #customer_link aggregate count(*) as rows`), unreadableTarget);
    expect(grouped.ok).toBe(false);
    if (!grouped.ok) {
      expect(grouped.diagnostics.map((d) => d.message)).toEqual(['relation field "Customer link" target table is not available']);
    }
  });

  test("query plan omits unreadable relation fields from implicit row output", () => {
    const unreadableTarget = ctx({
      tables: [orders],
      fieldsByTableId: { [orders.id]: fields },
    });
    const resolved = resolveDslQueryToQueryPlan(parseOk(`limit 10`), unreadableTarget);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.query.columns?.map((column) => ("fieldId" in column ? column.fieldId : column.id))).toEqual([
      customerFieldId,
      amountFieldId,
      costFieldId,
      statusFieldId,
      orderedAtFieldId,
      paidFieldId,
    ]);
  });

  test("query plan rejects arbitrary joins that do not start from a relation field", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`join table #Custs as customer on #customer = customer.#id`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['join "customer" must start from a relation field']);
  });

  test("query plan rejects joins whose target table does not match the relation field", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`join table #Regs as region on #customer_link = region.#id`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((d) => d.message)).toEqual(['join "region" target table does not match the relation field']);
  });

  test("query plan rejects joins against non-record-id target refs", () => {
    const result = resolveDslQueryToQueryPlan(parseOk(`join table #Custs as customer on #customer_link = customer.#name`), ctx());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(['join "customer" must target customer.#id']);
  });

  test("query plan caps join count and join depth", () => {
    const tooMany = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as c1 on #customer_link = c1.#id
        join table #Custs as c2 on #customer_link = c2.#id
        join table #Custs as c3 on #customer_link = c3.#id
        join table #Custs as c4 on #customer_link = c4.#id
        join table #Custs as c5 on #customer_link = c5.#id
        join table #Custs as c6 on #customer_link = c6.#id
      `),
      ctx(),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.diagnostics.map((d) => d.message)).toContain("query can join at most 5 tables");

    const tooDeep = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        join table #Regs as region on customer.#region = region.#id
        join table #Cities as city on region.#city = city.#id
        join table #Cntrs as country on city.#country = country.#id
      `),
      ctx(),
    );
    expect(tooDeep.ok).toBe(false);
    if (!tooDeep.ok) expect(tooDeep.diagnostics.map((d) => d.message)).toContain("join depth exceeds 3");
  });

  test("SQL compiler turns relation-safe joins into row-query metadata", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount, customer.#name as customer_name, formula(#amount - #cost) as margin
        where #amount > formula(#cost * 1.10)
        sort #amount desc, customer_name asc
        limit 25
        skip 10
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.limit).toBe(25);
    expect(compiled.query.offset).toBe(10);
    expect(compiled.query.joinAliases).toEqual({ customer: "jq0" });
    expect(compiled.query.columns).toEqual([
      {
        key: "q_col_0",
        label: "Amount",
        tableId: orders.id,
        fieldId: amountFieldId,
        type: "number",
        sqlType: "numeric",
      },
      {
        key: "q_col_1",
        label: "margin",
        tableId: "",
        type: "formula",
        sqlType: "numeric",
      },
      {
        key: "q_col_2",
        label: "customer_name",
        tableId: customers.id,
        fieldId: customerNameFieldId,
        joinAlias: "customer",
        type: "text",
        sqlType: "text",
      },
    ]);
    expect(typeof compiled.query.sql).toBe("object");
    const text = normalizedSql(compiled.query.sql);
    expect(text).toContain("ORDER BY grids.try_numeric(r.data->>");
    expect(text).toContain(" DESC NULLS LAST, q_col_2 ASC NULLS FIRST");
  });

  test("SQL compiler can cap relation join fanout for preview queries", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount, customer.#name as customer_name
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      joinFanoutLimit: 50,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { text, values } = normalizedSqlParts(compiled.query.sql);
    expect(text).toContain("JOIN LATERAL");
    expect(text).toContain("FROM grids.record_links _dsl_link");
    expect(text).toContain("ORDER BY _dsl_link.to_record_id");
    expect(values).toContain(50);
  });

  test("SQL compiler accepts computed alias sorts and preserves mixed sort order in metadata", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        select #amount, formula(#amount - #cost) as margin
        sort margin desc, #amount asc
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.query.sort).toEqual([{ fieldId: amountFieldId, direction: "asc" }]);
    expect(resolved.plan.sqlSort).toEqual([
      { kind: "computed", alias: "margin", direction: "desc" },
      { kind: "field", fieldId: amountFieldId, direction: "asc" },
    ]);

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns.map((column) => column.label)).toEqual(["Amount", "margin"]);
    expect(normalizedSql(compiled.query.sql)).toContain("ORDER BY q_col_1 DESC NULLS LAST, grids.try_numeric");
  });

  test("SQL compiler accepts scoped joined field sorts without selecting the sorted field", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount
        sort customer.#name asc
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns.map((column) => column.label)).toEqual(["Amount"]);
    const text = normalizedSql(compiled.query.sql);
    expect(text).toContain("ORDER BY jq0.data->>");
    expect(text).toContain("ASC NULLS FIRST");
  });

  test("SQL compiler accepts joined rows with base literal filters", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        select #amount, customer.#name as customer_name
        where #amount > 10
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.joinAliases).toEqual({ customer: "jq0" });
    expect(compiled.query.columns.map((column) => column.label)).toEqual(["Amount", "customer_name"]);
  });

  test("SQL compiler selects SQL-projectable formula fields", () => {
    const formulaField = field({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
      shortId: "total",
      name: "Total",
      type: "formula",
      position: 9,
      config: { expression: "#amount - #cost" },
    });
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`select #total`),
      ctx({ fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: [...fields, formulaField] } }),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: [...fields, formulaField] },
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns).toEqual([
      {
        key: "q_col_0",
        label: "Total",
        tableId: orders.id,
        fieldId: formulaField.id,
        type: "formula",
        sqlType: "numeric",
      },
    ]);
    const text = normalizedSql(compiled.query.sql);
    expect(text).toContain("AS q_col_0");
    expect(text).toContain("grids.try_numeric");
  });

  test("SQL compiler rejects formula field selects without a SQL-projectable expression", () => {
    const formulaField = field({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
      shortId: "total",
      name: "Total",
      type: "formula",
      position: 9,
    });
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`select #total`),
      ctx({ fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: [...fields, formulaField] } }),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: [...fields, formulaField] },
    });

    expect(compiled).toEqual({ ok: false, error: 'formula field "Total" has no expression' });
  });

  test("SQL compiler includes projectable formula fields and skips file fields for implicit default selects", () => {
    const formulaField = field({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
      shortId: "total",
      name: "Total",
      type: "formula",
      position: 9,
      config: { expression: "#amount - #cost" },
    });
    const fileField = field({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
      shortId: "files",
      name: "Files",
      type: "file",
      position: 10,
    });
    const fieldsByTableId = { ...ctx().fieldsByTableId, [orders.id]: [...fields, formulaField, fileField] };
    const resolved = resolveDslQueryToQueryPlan(parseOk(`limit 10`), ctx({ fieldsByTableId }));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslQueryPlanToSql(resolved.plan, { fieldsByTableId });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns.map((column) => column.label)).toEqual([
      "Customer",
      "Amount",
      "Cost",
      "Status",
      "Ordered at",
      "Paid",
      "Customer link",
      "Total",
    ]);
  });

  test("SQL compiler clamps limits and rejects grouped row execution", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        select #amount
        limit 25
        offset 100
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    resolved.plan.offset = 10001;

    const compiled = compileDslQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      limit: 99_999,
    });

    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.query.limit).toBe(10_000);
      expect(compiled.query.offset).toBe(10_000);
    }

    const grouped = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
      `),
      ctx(),
    );
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const groupedCompiled = compileDslQueryPlanToSql(grouped.plan, { fieldsByTableId: ctx().fieldsByTableId });
    expect(groupedCompiled).toEqual({ ok: false, error: "grouped DSL query execution is not compiled by the row-query compiler yet" });
  });

  test("aggregate-only SQL compiler emits one aggregate result row", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        where formula(#amount > #cost)
        aggregate count(*) as rows, sum(#amount) as revenue, latest(#ordered_at) as last_order, sum(formula(#amount - #cost)) as margin
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslAggregateQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.limit).toBe(1);
    expect(compiled.query.offset).toBe(0);
    expect(compiled.query.columns).toEqual([
      { key: "*__count", label: "rows", fieldId: "*", agg: "count", sqlType: "numeric" },
      { key: `${amountFieldId}__sum`, label: "revenue", fieldId: amountFieldId, agg: "sum", sqlType: "numeric" },
      { key: `${orderedAtFieldId}__latest`, label: "last_order", fieldId: orderedAtFieldId, agg: "latest", sqlType: "date" },
      { key: "margin__sum", label: "margin", fieldId: "margin", agg: "sum", sqlType: "numeric" },
    ]);
    const { text, values } = normalizedSqlParts(compiled.query.sql);
    expect(text).toContain("SELECT jsonb_build_object");
    expect(text).toContain("COUNT(*)");
    expect(text).toContain("SUM(");
    expect(text).toContain("grids.try_iso_date");
    expect(values).toContain("margin__sum");
    expect(text).toContain("r.table_id =");
    expect(text).toContain("r.deleted_at IS NULL");
  });

  test("aggregate-only SQL compiler can sample matching records for preview", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        where formula(#amount > #cost)
        aggregate sum(#amount) as revenue
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslAggregateQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      previewBaseLimit: 5000,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { text, values } = normalizedSqlParts(compiled.query.sql);
    expect(text).toContain("FROM (");
    expect(text).toContain("SELECT r.*");
    expect(text).toContain("ORDER BY r.id ASC");
    expect(values).toContain(5000);
  });

  test("aggregate-only SQL compiler accepts formula-only aggregate output", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        where formula(#amount > #cost)
        aggregate sum(formula(#amount - #cost)) as margin
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslAggregateQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns).toEqual([{ key: "margin__sum", label: "margin", fieldId: "margin", agg: "sum", sqlType: "numeric" }]);
    const { text, values } = normalizedSqlParts(compiled.query.sql);
    expect(text).toContain("SELECT jsonb_build_object");
    expect(text).toContain("SUM(");
    expect(values).toContain("margin__sum");
  });

  test("preview limit keeps DSL limits inside the preview contract", () => {
    const resolved = resolveDslQueryToQueryPlan(parseOk("limit 9999"), ctx());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolveDslPreviewLimit(resolved.plan, undefined)).toBe(500);
    expect(resolveDslPreviewLimit(resolved.plan, 25)).toBe(25);
  });

  test("grouped SQL compiler delegates grouped DSL plans to the group compiler", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        where #amount > formula(#cost * 1.10)
        group by #ordered_at by month
        aggregate sum(formula(#amount - #cost)) as margin
        having formula(#margin > 100)
        sort margin desc
        limit 12
        skip 2
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslGroupedQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.limit).toBe(12);
    expect(compiled.query.offset).toBe(2);
    expect(compiled.query.cursorable).toBe(false);
    expect(compiled.query.columns).toEqual([
      {
        kind: "group",
        key: "gk_0",
        label: "Ordered at",
        fieldId: orderedAtFieldId,
        type: "date",
        sqlType: "date",
      },
      {
        kind: "aggregate",
        key: "margin__sum",
        label: "margin",
        fieldId: "margin",
        agg: "sum",
        sqlType: "numeric",
      },
    ]);
    expect(typeof compiled.query.sql).toBe("object");
    expect(normalizedSql(compiled.query.sql)).toContain('ORDER BY "margin__sum" DESC NULLS LAST');
  });

  test("grouped SQL compiler can sample matching records for preview", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslGroupedQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      previewBaseLimit: 5000,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { text, values } = normalizedSqlParts(compiled.query.sql);
    expect(text).toContain("FROM (");
    expect(text).toContain("SELECT r.*");
    expect(text).toContain("ORDER BY r.id ASC");
    expect(values).toContain(5000);
  });

  test("grouped SQL compiler keeps aggregate output metadata typed", () => {
    const resolved = resolveDslQueryToQueryPlan(
      parseOk(`
        group by #status
        aggregate min(#customer) as first_customer, max(#ordered_at) as latest_order
      `),
      ctx(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const compiled = compileDslGroupedQueryPlanToSql(resolved.plan, {
      fieldsByTableId: ctx().fieldsByTableId,
      timeZone: "Europe/Berlin",
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.query.columns).toEqual([
      {
        kind: "group",
        key: "gk_0",
        label: "Status",
        fieldId: statusFieldId,
        type: "select",
        sqlType: "json",
      },
      {
        kind: "aggregate",
        key: `${customerFieldId}__min`,
        label: "first_customer",
        fieldId: customerFieldId,
        agg: "min",
        sqlType: "text",
      },
      {
        kind: "aggregate",
        key: `${orderedAtFieldId}__max`,
        label: "latest_order",
        fieldId: orderedAtFieldId,
        agg: "max",
        sqlType: "date",
      },
    ]);
  });

  test("grouped SQL compiler rejects unsupported grouped join and select shapes", () => {
    const selected = resolveDslQueryToQueryPlan(
      parseOk(`
        select #amount
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
      `),
      ctx(),
    );
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(compileDslGroupedQueryPlanToSql(selected.plan, { fieldsByTableId: ctx().fieldsByTableId })).toEqual({
        ok: false,
        error: "grouped DSL queries use group and aggregate output, not select columns",
      });
    }

    const joined = resolveDslQueryToQueryPlan(
      parseOk(`
        join table #Custs as customer on #customer_link = customer.#id
        group by #ordered_at by month
        aggregate sum(#amount) as revenue
      `),
      ctx(),
    );
    expect(joined.ok).toBe(false);
    if (!joined.ok) {
      expect(joined.diagnostics.map((d) => d.message)).toContain("grouped DSL queries with relation joins are not supported yet");
    }
  });
});
