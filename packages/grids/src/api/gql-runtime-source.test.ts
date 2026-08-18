import { describe, expect, test } from "bun:test";
import type { DslResolverContext } from "../query-dsl/resolver";
import { emptyDslAst, sourceAst } from "./gql-runtime";

describe("GQL implicit source public ID boundary", () => {
  test("injects public table and view ids", () => {
    const context = {
      tables: [{ kind: "table", id: "11111111-1111-4111-8111-111111111111", shortId: "TABL01", name: "Items" }],
      views: [
        {
          kind: "view",
          id: "22222222-2222-4222-8222-222222222222",
          shortId: "VIEW01",
          name: "Current items",
          tableId: "11111111-1111-4111-8111-111111111111",
          query: {},
        },
      ],
      fieldsByTableId: {},
    } satisfies DslResolverContext;

    expect(sourceAst(emptyDslAst(), { kind: "table", tableId: "11111111-1111-4111-8111-111111111111" }, context).source).toEqual({
      kind: "table",
      ref: "TABL01",
    });
    expect(sourceAst(emptyDslAst(), { kind: "view", viewId: "22222222-2222-4222-8222-222222222222" }, context).source).toEqual({
      kind: "view",
      ref: "VIEW01",
    });
  });
});
