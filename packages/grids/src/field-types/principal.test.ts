import { describe, expect, test } from "bun:test";
import { MAX_PRINCIPALS_PER_FIELD, principalHandler } from "./principal";

const user = { type: "user" as const, id: "11111111-1111-4111-8111-111111111111" };
const group = { type: "group" as const, id: "22222222-2222-4222-8222-222222222222" };

describe("principal field", () => {
  test("normalizes one or many principals to a deduplicated array", () => {
    expect(principalHandler.validate(user, {}, false)).toEqual({ ok: true, value: [user] });
    expect(principalHandler.validate([user, group, user], {}, false)).toEqual({ ok: true, value: [user, group] });
  });

  test("enforces cardinality and required values", () => {
    expect(principalHandler.validate([user, group], { cardinality: "single" }, false)).toEqual({
      ok: false,
      error: "single-cardinality principal accepts at most one value",
    });
    expect(principalHandler.validate([], {}, true)).toEqual({ ok: false, error: "required" });
  });

  test("rejects unsupported principals and oversized values", () => {
    expect(principalHandler.validate([{ type: "public", id: user.id }], {}, false).ok).toBe(false);
    expect(
      principalHandler.validate(
        Array.from({ length: MAX_PRINCIPALS_PER_FIELD + 1 }, () => user),
        {},
        false,
      ).ok,
    ).toBe(false);
  });
});
