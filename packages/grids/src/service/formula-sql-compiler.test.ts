import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { parseFormula } from "../formula/parser";
import { compileFormulaPredicateAstToSql, compileFormulaSourceToSql } from "./formula-sql-compiler";
import type { Field } from "./types";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type">): Field => ({
  id: overrides.id,
  shortId: overrides.shortId,
  tableId: "table_1",
  name: overrides.name,
  description: null,
  icon: null,
  type: overrides.type,
  config: overrides.config ?? {},
  position: 0,
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

const fields = [
  field({ id: "price_id", shortId: "price", name: "Price", type: "number" }),
  field({ id: "qty_id", shortId: "qty", name: "Quantity", type: "number" }),
  field({ id: "name_id", shortId: "name", name: "Name", type: "text" }),
  field({ id: "paid_id", shortId: "paid", name: "Paid", type: "boolean" }),
  field({ id: "due_id", shortId: "due", name: "Due", type: "date" }),
  field({ id: "at_id", shortId: "at", name: "Timestamp", type: "date", config: { includeTime: true } }),
  field({ id: "created_at_id", shortId: "created_at", name: "Created at", type: "created_at" }),
  field({ id: "created_by_id", shortId: "created_by", name: "Created by", type: "created_by" }),
  field({ id: "customer_id", shortId: "cust", name: "Customer", type: "relation" }),
  field({ id: "subtotal_id", shortId: "subtl", name: "Subtotal", type: "formula", config: { expression: "#price * #qty" } }),
  field({ id: "blank_formula_id", shortId: "blankf", name: "Blank", type: "formula" }),
  field({ id: "cycle_a_id", shortId: "cyca", name: "Cycle A", type: "formula", config: { expression: "#cycb + 1" } }),
  field({ id: "cycle_b_id", shortId: "cycb", name: "Cycle B", type: "formula", config: { expression: "#cyca + 1" } }),
];

describe("compileFormulaSourceToSql", () => {
  test("compiles decimal arithmetic over named field refs", () => {
    const result = compileFormulaSourceToSql("Price * Quantity", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("numeric");
  });

  test("keeps legacy short field refs readable", () => {
    const result = compileFormulaSourceToSql("#price * #qty", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("numeric");
  });

  test("compiles quoted field names", () => {
    const spaced = [field({ id: "unit_price_id", shortId: "uprice", name: "Unit price", type: "number" })];
    const result = compileFormulaSourceToSql('"Unit price" * 1.19', { fields: spaced });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("numeric");
  });

  test("compiles text functions", () => {
    const result = compileFormulaSourceToSql("CONCAT(UPPER(Name), ' / ', Quantity)", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("text");
  });

  test("compiles boolean comparisons and IF", () => {
    const result = compileFormulaSourceToSql("IF(Price > 10 && Paid, 'ok', 'hold')", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("text");
  });

  test("compiles date helpers with stable TODAY", () => {
    const result = compileFormulaSourceToSql("DATEDIFF(TODAY(), Due, 'days')", {
      fields,
      now: new Date("2026-06-08T12:00:00.000Z"),
      dateConfig: { timeZone: "Europe/Berlin" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("numeric");
  });

  test("compiles date-time helpers", () => {
    const result = compileFormulaSourceToSql("DATEADD(Timestamp, 2, 'hours')", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("datetime");

    const calendarResult = compileFormulaSourceToSql("DATEADD(Timestamp, 1, 'days')", { fields });
    expect(calendarResult.ok).toBe(true);
    if (calendarResult.ok) expect(calendarResult.expression.type).toBe("datetime");
  });

  test("rejects date functions over untyped text instead of guessing", () => {
    for (const source of ["DAY(Name)", "DATEADD(Name, 1, 'days')", "DATEDIFF(Name, Due, 'days')", "YEAR('not-a-date')"]) {
      const result = compileFormulaSourceToSql(source, { fields });
      expect(result.ok, source).toBe(false);
      if (!result.ok) expect(result.error).toContain("expects date/datetime fields or ISO date/instant literals");
    }
  });

  test("types system timestamps as datetime and system users as text", () => {
    const timestamp = compileFormulaSourceToSql('"Created at"', { fields });
    expect(timestamp.ok).toBe(true);
    if (timestamp.ok) expect(timestamp.expression.type).toBe("datetime");

    const user = compileFormulaSourceToSql('"Created by"', { fields });
    expect(user.ok).toBe(true);
    if (user.ok) expect(user.expression.type).toBe("text");
  });

  test("rejects unknown field refs", () => {
    const result = compileFormulaSourceToSql("#missing + 1", { fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown formula field reference");
  });

  test("rejects non-projectable relation refs instead of falling back to JS", () => {
    const result = compileFormulaSourceToSql("#cust", { fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot be compiled into SQL formulas");
  });

  test("inlines a referenced formula field's own expression", () => {
    const result = compileFormulaSourceToSql("#subtl + 1", { fields });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expression.type).toBe("numeric");
  });

  test("rejects a formula field that has no expression", () => {
    const result = compileFormulaSourceToSql("#blankf + 1", { fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("has no expression");
  });

  test("rejects a cycle between formula fields", () => {
    const result = compileFormulaSourceToSql("#cyca + 1", { fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cycle");
  });

  test("rejects unsafe record aliases", () => {
    const result = compileFormulaSourceToSql("#price", { fields, recordAlias: "r; drop table records" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unsafe SQL record alias");
  });

  test("compiles only boolean formula predicates", () => {
    const bool = parseFormula("#price <= #qty");
    expect(bool.ok).toBe(true);
    if (bool.ok) expect(compileFormulaPredicateAstToSql(bool.ast, { fields })).toMatchObject({ ok: true });

    const numeric = parseFormula("#price + #qty");
    expect(numeric.ok).toBe(true);
    if (numeric.ok) expect(compileFormulaPredicateAstToSql(numeric.ast, { fields })).toMatchObject({ ok: false });
  });

  test("compiles predicates over caller-provided SQL refs", () => {
    const bool = parseFormula("#revenue > 100 && #rows >= 2");
    expect(bool.ok).toBe(true);
    if (!bool.ok) return;

    const result = compileFormulaPredicateAstToSql(bool.ast, {
      fields: [],
      resolveField: (ref) => {
        if (ref === "revenue") return { sql: sql`SUM(r.amount)`, type: "numeric" };
        if (ref === "rows") return { sql: sql`COUNT(*)`, type: "numeric" };
        return null;
      },
    });

    expect(result.ok).toBe(true);
  });

  test("compiles mixed-type comparisons without raw incompatible SQL operators", () => {
    const text = compileFormulaSourceToSql("Price = '10'", { fields });
    expect(text.ok).toBe(true);
    if (text.ok) expect(text.expression.type).toBe("boolean");

    const date = compileFormulaSourceToSql("Due < '2026-06-10'", { fields });
    expect(date.ok).toBe(true);
    if (date.ok) expect(date.expression.type).toBe("boolean");
  });

  test("rejects unsupported date units at compile time", () => {
    const result = compileFormulaSourceToSql("DATEADD(Due, 1, 'fortnights')", { fields });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("DATEADD needs a literal unit");
  });

  test("rejects wrong formula function arity before SQL generation", () => {
    const cases = [
      ["AND()", "AND needs at least 1 argument; got 0"],
      ["CONCAT()", "CONCAT needs at least 1 argument; got 0"],
      ["IF(Paid, 'ok')", "IF needs 3 arguments; got 2"],
      ["SUBSTRING(#name, 1)", "SUBSTRING needs 3 arguments; got 2"],
      ["TODAY(#due)", "TODAY needs 0 arguments; got 1"],
    ] as const;

    for (const [source, message] of cases) {
      const result = compileFormulaSourceToSql(source, { fields });
      expect(result.ok, source).toBe(false);
      if (!result.ok) expect(result.error).toBe(message);
    }
  });

  test("covers the current formula function surface", () => {
    const examples = [
      "ABS(#price)",
      "ROUND(#price, 2)",
      "FLOOR(#price)",
      "CEIL(#price)",
      "SQRT(#price)",
      "POW(#price, 2)",
      "MOD(#qty, 2)",
      "SUM(#price, #qty)",
      "AVG(#price, #qty)",
      "MEAN(#price, #qty)",
      "COUNT(#price, #name)",
      "MEDIAN(#price, #qty, 10)",
      "MIN(#price, #qty)",
      "MAX(#price, #qty)",
      "PERCENT(#price, #qty)",
      "CONCAT(#name, ' ', #qty)",
      "LEN(#name)",
      "LOWER(#name)",
      "UPPER(#name)",
      "TRIM(#name)",
      "LEFT(#name, 2)",
      "RIGHT(#name, 2)",
      "SUBSTRING(#name, 1, 2)",
      "REPLACE(#name, 'a', 'b')",
      "IF(#paid, 'yes', 'no')",
      "IFEMPTY(#name, 'missing')",
      "IFERROR(#price / 0, 'bad')",
      "AND(#paid, #price > 0)",
      "OR(#paid, #price > 0)",
      "NOT(#paid)",
      "ISBLANK(#name)",
      "CONTAINS(#name, 'a')",
      "TODAY()",
      "NOW()",
      "YEAR(#due)",
      "MONTH(#due)",
      "DAY(#due)",
      "DATEADD(#due, 1, 'days')",
      "DATEDIFF(#due, TODAY(), 'days')",
    ];

    for (const source of examples) {
      const result = compileFormulaSourceToSql(source, { fields, now: new Date("2026-06-08T12:00:00.000Z") });
      expect(result, source).toMatchObject({ ok: true });
    }
  });
});

const postgresTest = process.env.GRIDS_SQL_COMPILER_DB_TEST === "1" ? test : test.skip;

describe("compileFormulaSourceToSql postgres smoke", () => {
  postgresTest("runs decimal-safe arithmetic in Postgres numeric", async () => {
    const result = compileFormulaSourceToSql("#price + #qty * 0.20", { fields });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await sql`
      SELECT ${result.expression.sql} AS value
      FROM (
        SELECT jsonb_build_object(${fields[0]!.id}::text, ${"0.10"}::text, ${fields[1]!.id}::text, ${"1.00"}::text) AS data
      ) r
    `;

    expect(String(rows[0]?.value)).toBe("0.300");
  });

  postgresTest("runs date helpers in Postgres", async () => {
    const result = compileFormulaSourceToSql("DATEDIFF(TODAY(), #due, 'days')", {
      fields,
      now: new Date("2026-06-08T12:00:00.000Z"),
      dateConfig: { timeZone: "Europe/Berlin" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await sql`
      SELECT ${result.expression.sql} AS value
      FROM (
        SELECT jsonb_build_object(${fields[4]!.id}::text, ${"2026-06-10"}::text) AS data
      ) r
    `;

    expect(String(rows[0]?.value)).toBe("2");
  });

  postgresTest("runs text and IF helpers in Postgres", async () => {
    const result = compileFormulaSourceToSql("IF(#paid, CONCAT(UPPER(#name), ' paid'), 'open')", { fields });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await sql`
      SELECT ${result.expression.sql} AS value
      FROM (
        SELECT jsonb_build_object(${fields[2]!.id}::text, ${"invoice"}::text, ${fields[3]!.id}::text, ${"true"}::text) AS data
      ) r
    `;

    expect(String(rows[0]?.value)).toBe("INVOICE paid");
  });
});
