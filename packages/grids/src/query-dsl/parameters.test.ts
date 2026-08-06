import { describe, expect, test } from "bun:test";
import { parseGridsQueryDsl } from "./parser";
import { bindDslQueryParameters } from "./parameters";

const parse = (source: string) => {
  const parsed = parseGridsQueryDsl(source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  return parsed.ast;
};

describe("GQL query parameter binding", () => {
  test("binds declared parameters as typed literals without changing query text", () => {
    const result = bindDslQueryParameters(parse("from table Articles\nwhere List = param('list_id')"), {
      list_id: "20000000-0000-4000-8000-000000000201",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.where?.expression).toMatchObject({
      kind: "binop",
      right: { kind: "literal", value: "20000000-0000-4000-8000-000000000201" },
    });
  });

  test("rejects missing, unused, and malformed bindings", () => {
    expect(bindDslQueryParameters(parse("from table Articles\nwhere List = param('missing')"), {})).toEqual({
      ok: false,
      error: 'Unknown query parameter "missing"',
    });
    expect(bindDslQueryParameters(parse("from table Articles"), { unused: "value" })).toEqual({
      ok: false,
      error: "Unused query parameter: unused",
    });
    expect(bindDslQueryParameters(parse("from table Articles\nwhere List = param(List)"), { List: "value" })).toEqual({
      ok: false,
      error: "param() expects exactly one text parameter name",
    });
  });
});
