import { describe, expect, test } from "bun:test";
import type { AccessResource } from "./access-support";
import { recordScopeFromFlags } from "./access-support";

const resource = (type: AccessResource["type"]): AccessResource => ({
  type,
  id: Bun.randomUUIDv7(),
  label: type,
  allowed: ["read", "none"],
});

describe("recordScopeFromFlags", () => {
  test("keeps omitted flags backward compatible", () => {
    expect(recordScopeFromFlags(resource("table"), {})).toBeUndefined();
  });

  test("maps all and creator scopes", () => {
    expect(recordScopeFromFlags(resource("base"), { recordScope: "all" })).toEqual({ kind: "all" });
    expect(recordScopeFromFlags(resource("table"), { recordScope: "created-by" })).toEqual({ kind: "created_by" });
  });

  test("maps a related creator scope with a UUIDv7 relation field", () => {
    const relationFieldId = Bun.randomUUIDv7();
    expect(recordScopeFromFlags(resource("view"), { recordScope: "related-created-by", relationFieldId })).toEqual({
      kind: "related_created_by",
      relationFieldId,
    });
  });

  test("rejects invalid resource and flag combinations", () => {
    expect(() => recordScopeFromFlags(resource("form"), { recordScope: "created-by" })).toThrow(
      "Record scopes are only supported on base, table, and view grants.",
    );
    expect(() =>
      recordScopeFromFlags(resource("base"), { recordScope: "related-created-by", relationFieldId: Bun.randomUUIDv7() }),
    ).toThrow("requires a table or view resource");
    expect(() => recordScopeFromFlags(resource("table"), { relationFieldId: Bun.randomUUIDv7() })).toThrow("Pass --record-scope");
    expect(() => recordScopeFromFlags(resource("table"), { recordScope: "related-created-by" })).toThrow("requires --relation-field-id");
    expect(() => recordScopeFromFlags(resource("table"), { recordScope: "related-created-by", relationFieldId: "not-a-uuid" })).toThrow(
      "must be a UUID",
    );
    expect(() => recordScopeFromFlags(resource("table"), { recordScope: "all", relationFieldId: Bun.randomUUIDv7() })).toThrow(
      "only valid with --record-scope related-created-by",
    );
  });
});
