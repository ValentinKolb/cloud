import { describe, expect, test } from "bun:test";
import { bindDslQueryContext, type DslQueryContextValues, dslQueryContextKeys, isDslQueryContextKey } from "./parameters";
import { parseGridsQueryDsl } from "./parser";

const parse = (source: string) => {
  const parsed = parseGridsQueryDsl(source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  return parsed.ast;
};

const context = (overrides: Partial<DslQueryContextValues> = {}): DslQueryContextValues => ({
  "auth.id": "10000000-0000-4000-8000-000000000001",
  "auth.name": "App Reader",
  "auth.username": "reader",
  "auth.email": "reader@example.test",
  "auth.subjects": ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"],
  "page.id": "loans",
  "page.title": "My loans",
  "page.url": "/apps/loans/my-loans",
  "app.id": "20000000-0000-4000-8000-000000000001",
  "app.shortId": "LOANS01",
  "app.name": "Loans",
  "base.id": "30000000-0000-4000-8000-000000000001",
  "base.name": "Equipment",
  "time.now": "2026-08-10T14:00:00.000Z",
  "time.today": "2026-08-10",
  "time.timeZone": "Europe/Berlin",
  "params.record_id": "40000000-0000-4000-8000-000000000001",
  ...overrides,
});

describe("GQL query context binding", () => {
  test("reports context references for surface-specific admission", () => {
    const ast = parse("from table Articles\nwhere Owner = @auth.id and List = @params.list_id\nselect formula(@time.today) as today");
    expect(dslQueryContextKeys(ast)).toEqual(["auth.id", "params.list_id", "time.today"]);
  });
  test("keeps context-free GQL usable without a synthetic runtime context", () => {
    const ast = parse("from table Articles\nwhere Published = true");
    expect(bindDslQueryContext(ast)).toEqual({ ok: true, ast });
  });

  test("recognizes exactly the official fixed namespaces and dynamic params", () => {
    for (const key of [
      "auth.id",
      "auth.name",
      "auth.username",
      "auth.email",
      "auth.subjects",
      "page.id",
      "page.title",
      "page.url",
      "app.id",
      "app.shortId",
      "app.name",
      "base.id",
      "base.name",
      "time.now",
      "time.today",
      "time.timeZone",
      "params.record_id",
    ]) {
      expect(isDslQueryContextKey(key), key).toBe(true);
    }
    expect(isDslQueryContextKey("auth.avatar")).toBe(false);
    expect(isDslQueryContextKey("params.bad-name")).toBe(false);
    expect(isDslQueryContextKey("params.foo.bar")).toBe(false);
  });

  test("expands auth subjects only inside membership predicates", () => {
    const result = bindDslQueryContext(parse("from table Articles\nwhere oneof(Participants, @auth.subjects)"), context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.expression).toMatchObject({
      kind: "call",
      fn: "ONEOF",
      args: [
        { kind: "field" },
        { kind: "literal", value: "10000000-0000-4000-8000-000000000001" },
        { kind: "literal", value: "10000000-0000-4000-8000-000000000002" },
      ],
    });
    expect(bindDslQueryContext(parse("from table Articles\nwhere @auth.subjects = null"), context())).toEqual({
      ok: false,
      error: 'Query context reference "@auth.subjects" is only valid inside oneof, noneof, or containsall',
    });
  });

  test("binds anonymous auth subjects as an empty membership list", () => {
    const result = bindDslQueryContext(
      parse("from table Articles\nwhere oneof(Participants, @auth.subjects)"),
      context({ "auth.subjects": [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.ast.where?.expression as { args?: unknown[] }).args).toHaveLength(1);
  });

  test("binds implicit context references as typed literals", () => {
    const result = bindDslQueryContext(
      parse("from table Articles\nwhere record.createdBy = @auth.id and List = @params.record_id"),
      context(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.expression).toMatchObject({
      kind: "binop",
      left: {
        kind: "binop",
        right: { kind: "literal", value: "10000000-0000-4000-8000-000000000001" },
      },
      right: {
        kind: "binop",
        right: { kind: "literal", value: "40000000-0000-4000-8000-000000000001" },
      },
    });
  });

  test("preserves anonymous auth as null", () => {
    const result = bindDslQueryContext(parse("from table Articles\nwhere @auth.id = null"), context({ "auth.id": null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.expression).toMatchObject({
      kind: "binop",
      left: { kind: "literal", value: null },
      right: { kind: "literal", value: null },
    });
  });

  test("binds context in formula selections, aggregate formulas, and having", () => {
    const result = bindDslQueryContext(
      parse(
        "from table Articles\nselect formula(@page.title) as page_title\naggregate sum(formula(@time.today)) as total\nhaving total > @params.record_id",
      ),
      context(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.select[0]).toMatchObject({ expression: { kind: "literal", value: "My loans" } });
    expect(result.ast.aggregations[0]).toMatchObject({
      argument: { kind: "formula", expression: { kind: "literal", value: "2026-08-10" } },
    });
    expect(result.ast.having?.expression).toMatchObject({ right: { kind: "literal", value: context()["params.record_id"] } });
  });

  test("rejects unknown and missing context references", () => {
    expect(bindDslQueryContext(parse("from table Articles\nwhere @auth.avatar = null"), context())).toEqual({
      ok: false,
      error: 'Unknown query context reference "@auth.avatar"',
    });

    const values = context();
    delete values["params.record_id"];
    expect(bindDslQueryContext(parse("from table Articles\nwhere List = @params.record_id"), values)).toEqual({
      ok: false,
      error: 'Missing query context value "@params.record_id"',
    });
  });

  test("removes param() instead of retaining an alias", () => {
    expect(bindDslQueryContext(parse("from table Articles\nwhere List = param('record_id')"), context())).toEqual({
      ok: false,
      error: "param() is not supported; use @params.<name>",
    });
  });
});
