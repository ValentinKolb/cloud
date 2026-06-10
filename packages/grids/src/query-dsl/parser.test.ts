import { describe, expect, test } from "bun:test";
import { parseGridsQueryDsl } from "./parser";

describe("parseGridsQueryDsl", () => {
  test("parses the first table query slice into typed AST data only", () => {
    const result = parseGridsQueryDsl(`
      from table #Orders
      select #customer, #amount as amount, formula(#amount * 1.19) as gross
      where #status = "Open" && #amount > formula(#cost * 1.10)
      sort #ordered_at descending, gross desc
      limit 50
      offset 10
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.source).toEqual({ kind: "table", ref: "Orders" });
    expect(result.ast.select).toHaveLength(3);
    expect(result.ast.select[0]).toEqual({ kind: "field", field: { ref: "customer" } });
    expect(result.ast.select[1]).toEqual({ kind: "field", field: { ref: "amount" }, alias: "amount" });
    expect(result.ast.select[2]?.kind).toBe("formula");
    expect(result.ast.where?.source).toBe('#status = "Open" && #amount > (#cost * 1.10)');
    expect(result.ast.sort).toEqual([
      { target: { ref: "ordered_at" }, direction: "desc" },
      { target: { kind: "alias", alias: "gross" }, direction: "desc" },
    ]);
    expect(result.ast.limit).toBe(50);
    expect(result.ast.offset).toBe(10);
  });

  test("parses skip as an offset alias", () => {
    const result = parseGridsQueryDsl("skip 20");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.offset).toBe(20);
  });

  test("parses multiple top-level clauses on one physical line", () => {
    const result = parseGridsQueryDsl(
      `from table #Orders select #customer, formula(#amount * #quantity) as total where #status = "Open" sort total desc limit 20 skip 5`,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.source).toEqual({ kind: "table", ref: "Orders" });
    expect(result.ast.select).toHaveLength(2);
    expect(result.ast.select[1]?.kind).toBe("formula");
    expect(result.ast.where?.source).toBe('#status = "Open"');
    expect(result.ast.sort).toEqual([{ target: { kind: "alias", alias: "total" }, direction: "desc" }]);
    expect(result.ast.limit).toBe(20);
    expect(result.ast.offset).toBe(5);
  });

  test("keeps inline clause keywords inside strings and formulas", () => {
    const result = parseGridsQueryDsl(`where CONTAINS(#notes, "sort this text") && #price <= formula(#cost * 1.10) sort #created_at desc`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.source).toBe('CONTAINS(#notes, "sort this text") && #price <= (#cost * 1.10)');
    expect(result.ast.sort).toEqual([{ target: { ref: "created_at" }, direction: "desc" }]);
  });

  test("does not split clause-like formula call names", () => {
    const direct = parseGridsQueryDsl(`where SORT (#notes)`);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.ast.where?.source).toBe("SORT (#notes)");

    const nested = parseGridsQueryDsl(`where #rank + SORT (#notes) > 0 sort #created_at desc`);
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.ast.where?.source).toBe("#rank + SORT (#notes) > 0");
    expect(nested.ast.sort).toEqual([{ target: { ref: "created_at" }, direction: "desc" }]);
  });

  test("parses inline relation joins before select clauses", () => {
    const result = parseGridsQueryDsl(
      `from table #orders left join table #customers as customer on #customer_id = customer.#id select #id, customer.#name as customer_name limit 10`,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.joins).toHaveLength(1);
    expect(result.ast.select[1]).toEqual({ kind: "field", field: { scope: "customer", ref: "name" }, alias: "customer_name" });
    expect(result.ast.limit).toBe(10);
  });

  test("formula expressions accept underscore refs used by DSL field refs", () => {
    const result = parseGridsQueryDsl(`
      where #ordered_at = "2026-06-09"
      select formula(#customer_id + 1) as customer_rank
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.source).toBe('#ordered_at = "2026-06-09"');
    expect(result.ast.select[0]?.kind).toBe("formula");
  });

  test("parses grouping, aggregates, having, and comments", () => {
    const result = parseGridsQueryDsl(`
      from #orders -- current table/view source can be resolved later
      group by #ordered_at by month, #category
      aggregate sum(#amount) as revenue, count(*) as rows, avg(formula(#amount - #cost)) as margin
      having #revenue > 100
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.source).toEqual({ kind: "unknown", ref: "orders" });
    expect(result.ast.groupBy).toEqual([{ field: { ref: "ordered_at" }, granularity: "month" }, { field: { ref: "category" } }]);
    expect(result.ast.aggregations.map((item) => [item.fn, item.alias])).toEqual([
      ["sum", "revenue"],
      ["count", "rows"],
      ["avg", "margin"],
    ]);
    expect(result.ast.aggregations[1]?.argument).toBe("*");
    expect(result.ast.having?.source).toBe("#revenue > 100");
  });

  test("normalizes aggregate function casing", () => {
    const result = parseGridsQueryDsl(`
      aggregate SUM(#amount) as revenue, countUnique(#customer) as customers
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.aggregations.map((item) => [item.fn, item.alias])).toEqual([
      ["sum", "revenue"],
      ["countUnique", "customers"],
    ]);
  });

  test("normalizes only standalone formula wrappers", () => {
    const wrapped = parseGridsQueryDsl(`where #price <= formula(#cost * 1.10)`);
    expect(wrapped.ok).toBe(true);
    if (wrapped.ok) expect(wrapped.ast.where?.source).toBe("#price <= (#cost * 1.10)");

    const functionName = parseGridsQueryDsl(`where MYFORMULA(#x) = 1`);
    expect(functionName.ok).toBe(true);
    if (functionName.ok) expect(functionName.ast.where?.source).toBe("MYFORMULA(#x) = 1");
  });

  test("parses bounded join syntax without resolving permissions or SQL", () => {
    const result = parseGridsQueryDsl(`
      from table #orders
      left join table #customers as customer on #customer_id = customer.#id
      select #id, customer.#name as customer_name
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.joins).toEqual([
      {
        mode: "left",
        source: { kind: "table", ref: "customers" },
        alias: "customer",
        on: {
          left: { ref: "customer_id" },
          right: { scope: "customer", ref: "id" },
        },
      },
    ]);
    expect(result.ast.select[1]).toEqual({ kind: "field", field: { scope: "customer", ref: "name" }, alias: "customer_name" });
  });

  test("rejects unsafe or ambiguous join scopes", () => {
    const bothUnscoped = parseGridsQueryDsl(`
      join table #customers as customer on #customer_id = #id
    `);
    expect(bothUnscoped.ok).toBe(false);
    if (!bothUnscoped.ok)
      expect(bothUnscoped.diagnostics.map((d) => d.message)).toContain('join on must reference "customer" on exactly one side');

    const unknownScope = parseGridsQueryDsl(`
      join table #customers as customer on orders.#customer_id = customer.#id
    `);
    expect(unknownScope.ok).toBe(false);
    if (!unknownScope.ok) expect(unknownScope.diagnostics.map((d) => d.message)).toContain('unknown join scope "orders"');

    const duplicate = parseGridsQueryDsl(`
      join table #customers as customer on #customer_id = customer.#id
      join table #regions as customer on #region_id = customer.#id
    `);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics.map((d) => d.message)).toContain('duplicate join alias "customer"');
  });

  test("reports diagnostics for invalid aliases, duplicate singleton clauses, and invalid limits", () => {
    const result = parseGridsQueryDsl(`
      from #a
      from #b
      select formula(#amount * 2)
      aggregate sum(#amount) as select
      limit 0
      skip nope
    `);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "duplicate from clause",
      "formula select items need an alias",
      'alias "select" is reserved',
      "limit must be between 1 and 10000",
      "offset must be a non-negative integer",
    ]);
  });

  test("rejects duplicate offset and skip clauses", () => {
    const result = parseGridsQueryDsl(`
      offset 5
      skip 10
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toEqual(["duplicate offset clause"]);
  });

  test("rejects overlong source refs and trailing comma lists", () => {
    const source = parseGridsQueryDsl(`from #${"a".repeat(81)}`);
    expect(source.ok).toBe(false);
    if (!source.ok) expect(source.diagnostics.map((d) => d.message)).toEqual(["invalid from source"]);

    for (const query of ["select #a,", "group by #a,", "aggregate sum(#a) as total,", "sort #a,"]) {
      const result = parseGridsQueryDsl(query);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.map((d) => d.message)).toContain("trailing comma");
    }
  });

  test("does not treat comment markers inside strings as comments", () => {
    const result = parseGridsQueryDsl(`where CONTAINS(#notes, "-- not a comment")`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.source).toBe('CONTAINS(#notes, "-- not a comment")');
  });

  test("does not treat comment markers inside braced field refs as comments", () => {
    const result = parseGridsQueryDsl(`where {abc--def} = 1`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.source).toBe("{abc--def} = 1");
  });
});
