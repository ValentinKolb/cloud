import { describe, expect, test } from "bun:test";
import type { Field } from "../service/types";
import { type DslResolverContext, resolveDslQueryToQueryPlan, resolveDslQueryToRecordQuery } from "./resolver";
import {
  amountFieldId,
  ctx,
  customerFieldId,
  customerLinkFieldId,
  field,
  fields,
  normalizedSql,
  orderedAtFieldId,
  orders,
  paidFieldId,
  parseOk,
  statusFieldId,
} from "./resolver-fixtures";
import { compileDslQueryPlanToSql } from "./sql-compiler";

describe("GQL where predicates — first-class per field type", () => {
  const statusOptions = {
    options: [
      { id: "open", label: "Open" },
      { id: "closed", label: "Closed" },
      { id: "hold", label: "On hold" },
    ],
  };
  const optionFields: Field[] = fields.map((f) => (f.id === statusFieldId ? { ...f, config: statusOptions } : f));
  const optCtx = (overrides: Partial<DslResolverContext> = {}): DslResolverContext =>
    ctx({ fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: optionFields }, ...overrides });

  const filterOf = (source: string, context = optCtx()) => {
    const result = resolveDslQueryToRecordQuery(parseOk(source), context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("; "));
    return result.plan.query.filter;
  };

  const errorOf = (source: string, context = optCtx()) => {
    const result = resolveDslQueryToQueryPlan(parseOk(source), context);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    return result.diagnostics.map((d) => d.message);
  };

  const planSql = (source: string, context = optCtx()) => {
    const resolved = resolveDslQueryToQueryPlan(parseOk(source), context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.diagnostics.map((d) => d.message).join("; "));
    const compiled = compileDslQueryPlanToSql(resolved.plan, { fieldsByTableId: context.fieldsByTableId });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error);
    return normalizedSql(compiled.query.sql);
  };

  test("resolves select option labels to their stored id", () => {
    expect(filterOf(`where Status = 'Open'`)).toEqual({ fieldId: statusFieldId, op: "is", value: "open" });
    expect(filterOf(`where Status = 'open'`)).toEqual({ fieldId: statusFieldId, op: "is", value: "open" });
    expect(filterOf(`where Status = 'On hold'`)).toEqual({ fieldId: statusFieldId, op: "is", value: "hold" });
  });

  test("select != maps to isNot", () => {
    expect(filterOf(`where Status != 'Open'`)).toEqual({ fieldId: statusFieldId, op: "isNot", value: "open" });
  });

  test("unknown select option errors with the valid options", () => {
    expect(errorOf(`where Status = 'Nope'`)).toEqual(['unknown option "Nope" for "Status"; expected one of: Open, Closed, On hold']);
  });

  test("oneof / noneof on a select map to isAnyOf / isNoneOf with resolved ids", () => {
    expect(filterOf(`where oneof(Status, 'Open', 'Closed')`)).toEqual({
      fieldId: statusFieldId,
      op: "isAnyOf",
      value: ["open", "closed"],
    });
    expect(filterOf(`where noneof(Status, 'Open', 'Closed')`)).toEqual({
      fieldId: statusFieldId,
      op: "isNoneOf",
      value: ["open", "closed"],
    });
  });

  test("removed membership predicate aliases point to one canonical spelling", () => {
    expect(errorOf(`where anyof(Status, 'Open')`)).toEqual(["use oneof(field, ...) instead of ANYOF(field, ...) in GQL predicates"]);
    expect(errorOf(`where containsany(Status, 'Open')`)).toEqual([
      "use oneof(field, ...) instead of CONTAINSANY(field, ...) in GQL predicates",
    ]);
  });

  test("containsall on a select becomes an AND of is leaves", () => {
    expect(filterOf(`where containsall(Status, 'Open', 'Closed')`)).toEqual({
      op: "AND",
      filters: [
        { fieldId: statusFieldId, op: "is", value: "open" },
        { fieldId: statusFieldId, op: "is", value: "closed" },
      ],
    });
  });

  test("containsall rejects scalar fields instead of inventing a special meaning", () => {
    expect(errorOf(`where containsall(Customer, 'a', 'b')`)).toEqual([
      'CONTAINSALL is only valid on select and relation fields; use explicit comparisons for "Customer"',
    ]);
  });

  test("oneof on a scalar field expands to an OR of equals", () => {
    expect(filterOf(`where oneof(Customer, 'a', 'b')`)).toEqual({
      op: "OR",
      filters: [
        { fieldId: customerFieldId, op: "equals", value: "a" },
        { fieldId: customerFieldId, op: "equals", value: "b" },
      ],
    });
  });

  test("relation = and != map to record-link containment", () => {
    const id = "99999999-9999-4999-8999-999999999999";
    expect(filterOf(`where customer_link = '${id}'`)).toEqual({ fieldId: customerLinkFieldId, op: "containsAny", value: [id] });
    expect(filterOf(`where customer_link != '${id}'`)).toEqual({ fieldId: customerLinkFieldId, op: "notContainsAny", value: [id] });
  });

  test("relation oneof gathers ids into containsAny", () => {
    const a = "99999999-9999-4999-8999-999999999991";
    const b = "99999999-9999-4999-8999-999999999992";
    expect(filterOf(`where oneof(customer_link, '${a}', '${b}')`)).toEqual({
      fieldId: customerLinkFieldId,
      op: "containsAny",
      value: [a, b],
    });
  });

  test("text matching functions map to like-style filter ops", () => {
    expect(filterOf(`where contains(Customer, 'ab')`)).toEqual({ fieldId: customerFieldId, op: "contains", value: "ab" });
    expect(filterOf(`where startswith(Customer, 'ab')`)).toEqual({ fieldId: customerFieldId, op: "startsWith", value: "ab" });
    expect(filterOf(`where endswith(Customer, 'ab')`)).toEqual({ fieldId: customerFieldId, op: "endsWith", value: "ab" });
    expect(errorOf(`where contains(Status, 'Open')`)).toEqual(['use oneof for membership filters on select field "Status"']);
  });

  test("case-insensitive text matching functions map to explicit filter leaves", () => {
    expect(filterOf(`where icontains(Customer, 'AB')`)).toEqual({
      fieldId: customerFieldId,
      op: "contains",
      value: "AB",
      caseInsensitive: true,
    });
    expect(filterOf(`where istartswith(Customer, 'AB')`)).toEqual({
      fieldId: customerFieldId,
      op: "startsWith",
      value: "AB",
      caseInsensitive: true,
    });
    expect(filterOf(`where iendswith(Customer, 'AB')`)).toEqual({
      fieldId: customerFieldId,
      op: "endsWith",
      value: "AB",
      caseInsensitive: true,
    });
  });

  test("scoped text predicate functions compile through joined SQL", () => {
    const source = `
      join table Custs as customer on customer_link = customer.id
      where icontains(customer.name, 'AL') and startswith(customer.name, 'A') and endswith(customer.name, 'e')
    `;
    const view = resolveDslQueryToRecordQuery(parseOk(source), optCtx());
    expect(view.ok).toBe(false);

    const sql = planSql(source);
    expect(sql).toContain("LOWER(");
    expect(sql).toContain("POSITION(");
    expect(sql).toContain("RIGHT(");
  });

  test("date comparisons cover the full inclusive/exclusive operator set", () => {
    expect(filterOf(`where ordered_at = '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "=", value: "2026-01-01" });
    expect(filterOf(`where ordered_at != '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "notEquals", value: "2026-01-01" });
    expect(filterOf(`where ordered_at < '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "before", value: "2026-01-01" });
    expect(filterOf(`where ordered_at <= '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "onOrBefore", value: "2026-01-01" });
    expect(filterOf(`where ordered_at > '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "after", value: "2026-01-01" });
    expect(filterOf(`where ordered_at >= '2026-01-01'`)).toEqual({ fieldId: orderedAtFieldId, op: "onOrAfter", value: "2026-01-01" });
  });

  test("a bare boolean field means = true; != true means = false", () => {
    expect(filterOf(`where paid`)).toEqual({ fieldId: paidFieldId, op: "=", value: true });
    expect(filterOf(`where paid = false`)).toEqual({ fieldId: paidFieldId, op: "=", value: false });
    expect(filterOf(`where paid != true`)).toEqual({ fieldId: paidFieldId, op: "=", value: false });
  });

  test("emptiness works through null comparisons", () => {
    expect(filterOf(`where Status = null`)).toEqual({ fieldId: statusFieldId, op: "isEmpty" });
    expect(filterOf(`where Status != null`)).toEqual({ fieldId: statusFieldId, op: "isNotEmpty" });
    expect(errorOf(`where isempty(amount)`)).toEqual(["use field = null instead of ISEMPTY(field) in GQL predicates"]);
    expect(errorOf(`where isnotempty(customer_link)`)).toEqual(["use field != null instead of ISNOTEMPTY(field) in GQL predicates"]);
  });

  test("type-mismatched literals produce clear errors", () => {
    expect(errorOf(`where amount = 'lots'`)).toEqual(['"Amount" expects a number, got text']);
    expect(errorOf(`where paid = 'yes'`)).toEqual(['"Paid" expects true or false, got text']);
    expect(errorOf(`where customer_link = 'not-a-uuid'`)).toEqual(['"Customer link" is a relation; compare it to a record id (uuid)']);
    expect(errorOf(`where amount < 'x'`)).toEqual(['"Amount" expects a number, got text']);
  });

  test("unsupported operators per type are rejected, not silently ignored", () => {
    expect(errorOf(`where Customer < 'a'`)).toEqual(['operator "<" is not supported for text field "Customer"']);
    expect(errorOf(`where Status < 'Open'`)).toEqual(['operator "<" is not supported for select field "Status"']);
  });

  test("AND/OR/NOT and mixed filter+formula predicates compile to one SQL boolean (preview only)", () => {
    // Pure select+number AND -> representable FilterTree.
    expect(filterOf(`where Status = 'Open' and amount > 100`)).toEqual({
      op: "AND",
      filters: [
        { fieldId: statusFieldId, op: "is", value: "open" },
        { fieldId: amountFieldId, op: ">", value: 100 },
      ],
    });

    // Mixed: select filter + cross-field arithmetic -> not representable as FilterTree,
    // but fully SQL in preview.
    const mixed = resolveDslQueryToRecordQuery(parseOk(`where Status = 'Open' and amount > cost`), optCtx());
    expect(mixed.ok).toBe(false);

    const sql = planSql(`where Status = 'Open' and amount > cost`);
    expect(sql).toContain("@>");
    expect(sql).toContain("> (grids.try_numeric(r.data->>");

    // NOT compiles to a negated SQL group.
    const notSql = planSql(`where not (Status = 'Open')`);
    expect(notSql).toContain("NOT (");
  });

  test("a formula field can be filtered in where via inlined SQL", () => {
    const marginId = "ffffffff-ffff-4fff-8fff-fffffffffff1";
    const withFormula: Field[] = [
      ...optionFields,
      field({ id: marginId, shortId: "margin", name: "Margin", type: "formula", config: { expression: "amount - cost" } }),
    ];
    const context = ctx({ fieldsByTableId: { ...ctx().fieldsByTableId, [orders.id]: withFormula } });

    // Not representable as RecordQuery (computed predicate), but compiles to SQL.
    const view = resolveDslQueryToRecordQuery(parseOk(`where margin > 0`), context);
    expect(view.ok).toBe(false);

    const sql = planSql(`where margin > 0`, context);
    // The margin formula is inlined into the WHERE as a numeric comparison.
    expect(sql).toContain(")::numeric - (grids.try_numeric(r.data->>");
    expect(sql).toMatch(/::numeric > \(\$\d+ ::numeric\)/);
  });
});
