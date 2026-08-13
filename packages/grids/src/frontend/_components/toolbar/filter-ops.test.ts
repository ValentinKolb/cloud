import { describe, expect, test } from "bun:test";
import { opsForType } from "./filter-ops";

describe("principal filter operations", () => {
  test("offers identity membership and emptiness without text operators", () => {
    expect(opsForType("principal").map((operation) => operation.id)).toEqual(["containsAny", "notContainsAny", "isEmpty", "isNotEmpty"]);
  });
});
