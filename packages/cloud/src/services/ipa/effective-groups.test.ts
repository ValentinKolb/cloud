import { describe, expect, test } from "bun:test";
import { buildEffectiveIpaGroupsByUid } from "./effective-groups";

describe("buildEffectiveIpaGroupsByUid", () => {
  test("includes direct and inherited parent groups", () => {
    const effective = buildEffectiveIpaGroupsByUid([
      { cn: "base-sync", users: [], groups: ["team"] },
      { cn: "base-realm", users: [], groups: ["base-sync"] },
      { cn: "team", users: ["eva"], groups: [] },
    ]);

    expect(effective.get("eva")).toEqual(["base-realm", "base-sync", "team"]);
  });

  test("keeps transit groups available even when callers hide them from display", () => {
    const effective = buildEffectiveIpaGroupsByUid([
      { cn: "base-realm", users: [], groups: ["excluded-transit"] },
      { cn: "excluded-transit", users: [], groups: ["team"] },
      { cn: "team", users: ["eva"], groups: [] },
    ]);

    expect(effective.get("eva")).toEqual(["base-realm", "excluded-transit", "team"]);
  });

  test("terminates on cyclic group nesting", () => {
    const effective = buildEffectiveIpaGroupsByUid([
      { cn: "a", users: ["eva"], groups: ["b"] },
      { cn: "b", users: [], groups: ["a"] },
    ]);

    expect(effective.get("eva")).toEqual(["a", "b"]);
  });
});
