import { describe, expect, test } from "bun:test";
import { resolveContactInitials } from "./shared";

describe("resolveContactInitials", () => {
  test("uses first and last name initials", () => {
    expect(resolveContactInitials({ firstName: "Ada", lastName: "Lovelace" })).toBe("AL");
  });

  test("falls back to the resolved label", () => {
    expect(resolveContactInitials({ label: "Example GmbH" })).toBe("EX");
  });
});
